import { afterEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";
import { calls, startPostgrest, type Options, type Row, type StandIn } from "../helpers/postgrest";
import { GET } from "@/app/api/charges/today/route";

const ANN = "p-ann", BEA = "p-bea", CAL = "p-cal";

const charge = (id: string, item: string, extra: Row): Row => ({
  id, subscriber_id: ANN, service_id: `svc-${id}`, payment_method_id: null, monthly_cost: 10, currency: "SGD",
  total_cny: 0, paid: false, paid_date: null, paid_at: null, updated_at: null, billing_date: "2026-09-01",
  period_start: "2026-09", created_at: "2026-09-01T00:00:00Z", label: null, deleted_at: null,
  subscribers: { name: "Ann" }, services: { name: item }, ...extra,
});
const entry = (id: string, subscriber_id: string, charge_id: string, kind: string, created_at: string): Row =>
  ({ id, subscriber_id, charge_id, kind, created_at });

/** Four charges for September, and a ledger with `older` unrelated settlements
 *  ahead of the ones that matter. */
function tables(older = 0): Record<string, Row[]> {
  const wallet: Row[] = Array.from({ length: older }, (_, i) =>
    entry(`f${String(i).padStart(5, "0")}`, BEA, `old-${i}`, "charge", new Date(Date.UTC(2026, 0, 1, 0, 0, i)).toISOString()));
  wallet.push(
    entry("e1", BEA, "ch1", "charge", "2026-09-02T00:00:00.000Z"),     // Bea settles ch1
    entry("e2", BEA, "ch2", "charge", "2026-09-02T00:00:01.000Z"),     // Bea settles ch2
    entry("e3", ANN, "ch4", "charge", "2026-09-02T00:00:02.000Z"),     // Ann settles her own ch4
    entry("e4", BEA, "ch1", "adjustment", "2026-09-03T00:00:00.000Z"), // ch1 reversed
    entry("e5", BEA, "ch2", "adjustment", "2026-09-03T00:00:01.000Z"), // ch2 reversed
    entry("e6", CAL, "ch1", "charge", "2026-09-05T00:00:00.000Z"),     // Cal settles ch1
  );
  return {
    charges: [
      charge("ch1", "Re-settled by Cal", { paid: true, total_cny: 10 }),
      charge("ch2", "Reversed, now unpaid", { paid: false, total_cny: 20 }),
      charge("ch3", "Deleted", { paid: false, total_cny: 40, deleted_at: "2026-09-10T00:00:00Z" }),
      charge("ch4", "Paid from own wallet", { paid: true, total_cny: 30 }),
    ],
    subscriptions: [],
    payment_methods: [],
    subscribers: [{ id: ANN, name: "Ann" }, { id: BEA, name: "Bea" }, { id: CAL, name: "Cal" }],
    wallet_entries: wallet,
  };
}

let db: StandIn | undefined;
async function get(query: string, t: Record<string, Row[]>, headers: Record<string, string> = {}, intercept?: Options["intercept"]) {
  db = await startPostgrest(t, { intercept });
  vi.stubEnv("NEXT_PUBLIC_SUPABASE_URL", db.url);
  vi.stubEnv("SUPABASE_SERVICE_ROLE_KEY", "stand-in");
  const res = await GET(new NextRequest(`http://localhost/api/charges/today${query}`, { headers }));
  return { status: res.status, body: await res.json() };
}

afterEach(async () => {
  vi.unstubAllEnvs();
  await db?.close();
  db = undefined;
});

const payers = (body: { charges: Array<{ item: string; paid_by: string | null }> }) =>
  Object.fromEntries(body.charges.map((c) => [c.item, c.paid_by]));

describe("GET /api/charges/today", () => {
  it("leaves deleted charges out of the list and the total", async () => {
    const { status, body } = await get("?month=2026-09", tables());
    expect(status).toBe(200);
    expect(body.count).toBe(3);
    expect(body.total_cny).toBe(60);
    expect(body.charges.map((c: { item: string }) => c.item)).not.toContain("Deleted");
    expect(calls(db!, "charges")[0]).toContain("deleted_at=is.null");
  });

  it("names the last payer of a re-settled charge, and no payer once a settlement is reversed", async () => {
    const { body } = await get("?month=2026-09", tables());
    expect(payers(body)).toEqual({
      "Re-settled by Cal": "Cal",
      "Reversed, now unpaid": null,
      "Paid from own wallet": null,
    });
  });

  it("reads the whole ledger past PostgREST's 1000-row cap", async () => {
    const { body } = await get("?month=2026-09", tables(1500));
    expect(payers(body)["Re-settled by Cal"]).toBe("Cal");
    expect(calls(db!, "wallet_entries")).toEqual([
      "GET kind=eq.charge&order=created_at.asc,id.asc&offset=0&limit=1000",
      "GET kind=eq.charge&order=created_at.asc,id.asc&offset=1000&limit=1000",
    ]);
  });

  it("still answers with the charges when the ledger read fails, just without payers", async () => {
    const { status, body } = await get("?month=2026-09", tables(), {}, (req) =>
      req.table === "wallet_entries" ? { status: 500, body: { message: "down" } } : undefined);
    expect(status).toBe(200);
    expect(body.count).toBe(3);
    expect(Object.values(payers(body)).every((p) => p === null)).toBe(true);
  });

  it("filters to one day and to an amount", async () => {
    const t = tables();
    t.charges[0].billing_date = "2026-09-15";
    const byDay = await get("?date=2026-09-15", t);
    expect(byDay.body.charges.map((c: { item: string }) => c.item)).toEqual(["Re-settled by Cal"]);
    await db!.close();
    db = undefined;
    const byAmount = await get("?month=2026-09&amount=10", tables());
    expect(byAmount.body.count).toBe(3);
  });

  it("rejects a malformed month or date", async () => {
    expect((await get("?month=2026-9", tables())).status).toBe(400);
    await db!.close();
    db = undefined;
    expect((await get("?date=15-09-2026", tables())).status).toBe(400);
  });

  it("requires the bearer token once READONLY_TOKEN is set", async () => {
    vi.stubEnv("READONLY_TOKEN", "secret");
    expect((await get("?month=2026-09", tables())).status).toBe(401);
    await db!.close();
    db = undefined;
    vi.stubEnv("READONLY_TOKEN", "secret");
    expect((await get("?month=2026-09", tables(), { authorization: "Bearer secret" })).status).toBe(200);
  });
});
