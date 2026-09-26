import { readFileSync } from "node:fs";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";
import { startPostgrest, type Row, type StandIn } from "../helpers/postgrest";

const session = vi.hoisted(() => ({ current: { user: { email: "hi@noahyao.me" } } as { user: { email: string } } | null }));
vi.mock("@/lib/auth", () => ({
  auth: async () => session.current,
  isAllowedEmail: (email: string | null | undefined) => email === "hi@noahyao.me",
}));

const { POST: settle } = await import("@/app/api/settle/route");
const { GET: cron } = await import("@/app/api/cron/bill/route");

let db: StandIn;
let rpcArgs: Array<[string, Row]>;
beforeEach(async () => {
  session.current = { user: { email: "hi@noahyao.me" } };
  rpcArgs = [];
  const record = (name: string, reply: (args: Row) => { status: number; body: unknown }) =>
    (args: Row) => { rpcArgs.push([name, args]); return reply(args); };
  db = await startPostgrest(
    {
      subscribers: [{ id: "p-ann", name: "Ann" }],
      services: [{ id: "s1", name: "Svc", monthly_cost: 10, currency: "SGD" }],
      subscriptions: [{ id: "sub1", subscriber_id: "p-ann", service_id: "s1", start_date: "2026-09-01", active: true }],
      charges: [],
    },
    {
      rpc: {
        settle_charge: record("settle_charge", (a) => a.p_charge_id === "broke"
          ? { status: 400, body: { message: "Not enough in the wallet: 5.00 available, 30.00 needed" } }
          : { status: 200, body: 70 }),
        settle_person: record("settle_person", () => ({ status: 200, body: [{ settled: 2, total: 60, balance_left: 40 }] })),
        unsettle_charge: record("unsettle_charge", () => ({ status: 200, body: 100 })),
      },
      other: (req) => req.path === "/api/exchange-rate"
        ? { status: 200, body: { rates: { SGD: 5.3 }, source: "historical" } }
        : undefined,
    },
  );
  vi.stubEnv("NEXT_PUBLIC_SUPABASE_URL", db.url);
  vi.stubEnv("SUPABASE_SERVICE_ROLE_KEY", "stand-in");
});
afterEach(async () => {
  vi.unstubAllEnvs();
  vi.useRealTimers();
  await db.close();
});

async function callSettle(payload: Row) {
  const res = await settle(new NextRequest("http://localhost/api/settle", { method: "POST", body: JSON.stringify(payload) }));
  return { status: res.status, body: await res.json() };
}

describe("POST /api/settle", () => {
  it("settles through the database function and returns what is left", async () => {
    const { status, body } = await callSettle({ action: "settle", chargeId: "c1", walletOwnerId: "p-ann", note: "cash" });
    expect(status).toBe(200);
    expect(body).toEqual({ ok: true, balance: 70 });
    expect(rpcArgs).toEqual([["settle_charge", { p_charge_id: "c1", p_wallet_owner: "p-ann", p_note: "cash" }]]);
  });

  it("passes the function's refusal through as a 409 with its own words", async () => {
    const { status, body } = await callSettle({ action: "settle", chargeId: "broke", walletOwnerId: "p-ann" });
    expect(status).toBe(409);
    expect(body.error).toBe("Not enough in the wallet: 5.00 available, 30.00 needed");
  });

  it("settles a person and unsettles a charge", async () => {
    expect((await callSettle({ action: "settlePerson", chargeId: "p-ann", walletOwnerId: "p-ann" })).body)
      .toEqual({ ok: true, settled: 2, total: 60, balance: 40 });
    expect((await callSettle({ action: "unsettle", chargeId: "c1" })).body).toEqual({ ok: true, balance: 100 });
  });

  it("rejects a request missing what it needs, or not signed in", async () => {
    expect((await callSettle({ action: "settle", walletOwnerId: "p-ann" })).status).toBe(400);
    expect((await callSettle({ action: "settle", chargeId: "c1" })).status).toBe(400);
    expect((await callSettle({ action: "refund", chargeId: "c1" })).status).toBe(400);
    session.current = null;
    expect((await callSettle({ action: "settle", chargeId: "c1", walletOwnerId: "p-ann" })).status).toBe(401);
    expect(rpcArgs).toHaveLength(0);
  });
});

describe("GET /api/cron/bill", () => {
  const request = (headers: Record<string, string>) => {
    const host = new URL(db.url).host;
    return new NextRequest(`${db.url}/api/cron/bill`, { headers: { host, "x-forwarded-proto": "http", ...headers } });
  };

  it("refuses to run at all until CRON_SECRET is set", async () => {
    expect((await cron(request({}))).status).toBe(500);
  });

  it("requires the secret as a bearer token", async () => {
    vi.stubEnv("CRON_SECRET", "s3cret");
    expect((await cron(request({ authorization: "Bearer wrong" }))).status).toBe(401);
    expect(db.tables.charges).toHaveLength(0);
  });

  it("bills the current Singapore month at that month's rate", async () => {
    vi.stubEnv("CRON_SECRET", "s3cret");
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(new Date("2026-09-30T16:30:00Z")); // 1 Oct in Singapore
    const res = await cron(request({ authorization: "Bearer s3cret" }));
    const body = await res.json();
    expect(res.status).toBe(200);
    expect(body.month).toBe("2026-10");
    expect(body.generated).toBe(2); // September and October, each once
    expect(db.tables.charges.map((c) => [c.period_start, c.exchange_rate, c.total_cny])).toEqual([
      ["2026-09", 5.3, 53],
      ["2026-10", 5.3, 53],
    ]);
    const asked = db.requests.filter((r) => r.path === "/api/exchange-rate").map((r) => r.params.get("date"));
    expect(asked).toEqual(["2026-09-01", "2026-10-01"]);
  });

  it("bills nothing more when it runs again the same month -- what makes the retries on the 2nd and 3rd safe", async () => {
    vi.stubEnv("CRON_SECRET", "s3cret");
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(new Date("2026-10-01T00:00:00Z"));
    expect((await (await cron(request({ authorization: "Bearer s3cret" }))).json()).generated).toBe(2);
    for (const day of ["2026-10-02T00:00:00Z", "2026-10-03T00:00:00Z"]) {
      vi.setSystemTime(new Date(day));
      const again = await (await cron(request({ authorization: "Bearer s3cret" }))).json();
      expect(again.generated).toBe(0);
    }
    expect(db.tables.charges).toHaveLength(2);
  });

  it("catches up on the 2nd when the 1st never ran", async () => {
    vi.stubEnv("CRON_SECRET", "s3cret");
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(new Date("2026-10-02T00:00:00Z"));
    const body = await (await cron(request({ authorization: "Bearer s3cret" }))).json();
    expect(body.month).toBe("2026-10");
    expect(db.tables.charges.map((c) => c.period_start)).toEqual(["2026-09", "2026-10"]);
  });
});

describe("vercel.json", () => {
  it("runs billing on the 1st, and again on the 2nd and 3rd in case the 1st failed", () => {
    // Twice in 2026 a single missed run on the 1st left a month unbilled for
    // days. The later runs fill only what is missing, per the test above.
    const { crons } = JSON.parse(readFileSync("vercel.json", "utf8"));
    expect(crons).toContainEqual({ path: "/api/cron/bill", schedule: "0 0 1-3 * *" });
  });
});
