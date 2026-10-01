import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";
import { calls, startPostgrest, type Row, type StandIn } from "../helpers/postgrest";

// Signed in as an allow-listed address unless a test says otherwise.
const session = vi.hoisted(() => ({ current: { user: { email: "hi@noahyao.me" } } as { user: { email: string } } | null }));
vi.mock("@/lib/auth", () => ({
  auth: async () => session.current,
  isAllowedEmail: (email: string | null | undefined) => email === "hi@noahyao.me",
}));

const { GET, POST } = await import("@/app/api/data/route");

const charge = { subscriber_id: "a", service_id: "s", period_start: "2026-08", period_end: "2026-08", months: 1, monthly_cost: 10, currency: "SGD", exchange_rate: 5.3, total_cny: 53 };

let db: StandIn;
/** Whom each auto_settle call was for, and what the next one answers. */
let settledFor: unknown[];
let settleReply: { status: number; body: unknown };
beforeEach(async () => {
  session.current = { user: { email: "hi@noahyao.me" } };
  settledFor = [];
  settleReply = { status: 200, body: [{ wallet: "a", settled: 1, total: 53, balance_left: 7 }] };
  db = await startPostgrest(
    {
      charges: [{ id: "c1", ...charge, paid: false, deleted_at: null }],
      subscribers: [{ id: "a", name: "Ann", pays_from: null }, { id: "w", name: "Wal", pays_from: null }, { id: "z", name: "Zed", pays_from: "w" }],
      payment_methods: [
        { id: "pm1", is_default: true, cardholder_name: "Ann Lee", expiry_month: 4, expiry_year: 2031, created_at: "2026-01-01" },
        { id: "pm2", is_default: false, cardholder_name: "Wal Tan", expiry_month: 9, expiry_year: 2029, created_at: "2026-02-01" },
      ],
      services: [{ id: "s-used" }, { id: "s-free" }],
      subscriptions: [{ id: "sub1", service_id: "s-used", subscriber_id: "a" }],
    },
    {
      // A second live charge for a service-month trips the unique index, and
      // Wal, whom Zed pays from, cannot pay from another wallet.
      intercept: (req) =>
        req.method === "POST" && req.table === "charges" && (req.body as Row).period_start === "2026-09"
          ? { status: 409, body: { code: "23505", message: 'duplicate key value violates unique constraint "charges_one_per_service_month"' } }
          : req.method === "PATCH" && req.table === "subscribers" && (req.body as Row).pays_from === "a"
            ? { status: 400, body: { code: "23514", message: "Others pay from Wal's wallet, so it cannot pay from another" } }
            : undefined,
      rpc: { auto_settle: (args) => { settledFor.push(args.p_people); return settleReply; } },
    },
  );
  vi.stubEnv("NEXT_PUBLIC_SUPABASE_URL", db.url);
  vi.stubEnv("SUPABASE_SERVICE_ROLE_KEY", "stand-in");
});
afterEach(async () => {
  vi.unstubAllEnvs();
  await db.close();
});

async function post(payload: Row) {
  const res = await POST(new NextRequest("http://localhost/api/data", { method: "POST", body: JSON.stringify(payload) }));
  return { status: res.status, body: await res.json() };
}

describe("GET /api/data", () => {
  const get = async (query = "?details=payment_methods") => {
    const res = await GET(new NextRequest(`http://localhost/api/data${query}`));
    return { status: res.status, cache: res.headers.get("cache-control"), body: await res.json() };
  };

  it("gives editors the card details the public key cannot read, and nothing more", async () => {
    const { status, cache, body } = await get();
    expect(status).toBe(200);
    expect(cache).toBe("private, no-store");
    expect(body.payment_methods).toMatchObject([
      { id: "pm1", cardholder_name: "Ann Lee", expiry_month: 4, expiry_year: 2031 },
      { id: "pm2", cardholder_name: "Wal Tan", expiry_month: 9, expiry_year: 2029 },
    ]);
    // Only the details are asked for; PostgREST returns what is selected.
    const asked = db.requests.filter((r) => r.table === "payment_methods").map((r) => new URLSearchParams(r.params).get("select"));
    expect(asked).toEqual(["id,cardholder_name,expiry_month,expiry_year"]);
  });

  it("refuses anyone not signed in with an allowed address, before asking the database", async () => {
    session.current = null;
    expect((await get()).status).toBe(401);
    session.current = { user: { email: "someone@else.com" } };
    expect((await get()).status).toBe(401);
    expect(db.requests).toHaveLength(0);
  });

  it("reads nothing else", async () => {
    expect((await get("?details=wallet_entries")).status).toBe(400);
    expect((await get("")).status).toBe(400);
    expect(db.requests).toHaveLength(0);
  });
});

describe("POST /api/data", () => {
  it("refuses anyone not signed in with an allowed address", async () => {
    session.current = null;
    expect((await post({ action: "insert", table: "services", data: {} })).status).toBe(401);
    session.current = { user: { email: "someone@else.com" } };
    expect((await post({ action: "insert", table: "services", data: {} })).status).toBe(401);
    expect(db.requests).toHaveLength(0);
  });

  it("refuses a table it does not manage", async () => {
    expect((await post({ action: "insert", table: "auth.users", data: {} })).status).toBe(400);
  });

  it("inserts an unpaid charge", async () => {
    const { status } = await post({ action: "insert", table: "charges", data: { ...charge, paid: false } });
    expect(status).toBe(200);
    expect(db.tables.charges).toHaveLength(2);
  });

  it("refuses a charge inserted with payment state, before it reaches the database", async () => {
    for (const extra of [{ paid: true }, { paid: false, paid_date: "2026-08-02" }, { paid: false, paid_at: "2026-08-02T00:00:00Z" }]) {
      const { status, body } = await post({ action: "insert", table: "charges", data: { ...charge, ...extra } });
      expect(status).toBe(400);
      expect(body.error).toMatch(/starts unpaid/);
    }
    expect(calls(db, "charges")).toHaveLength(0);
  });

  it("refuses payment state on an update too", async () => {
    const { status } = await post({ action: "update", table: "charges", id: "c1", updates: { paid: true } });
    expect(status).toBe(400);
    expect(db.tables.charges[0].paid).toBe(false);
  });

  it("says a duplicate service-month in words, not as a constraint name", async () => {
    const { status, body } = await post({ action: "insert", table: "charges", data: { ...charge, period_start: "2026-09", paid: false } });
    expect(status).toBe(409);
    expect(body.error).toBe("That person already has a charge for this service in that month.");
  });

  it("clears every default card with a filter a uuid column accepts", async () => {
    const { status } = await post({ action: "update", table: "payment_methods", id: "__all__", updates: { is_default: false } });
    expect(status).toBe(200);
    expect(calls(db, "payment_methods")).toEqual(["PATCH id=not.is.null"]);
    expect(db.tables.payment_methods.every((p) => p.is_default === false)).toBe(true);
  });

  it("allows the bulk update for that and nothing else", async () => {
    const refused = [
      { table: "payment_methods", updates: { is_default: true } },
      { table: "payment_methods", updates: { is_default: false, label: "x" } },
      { table: "subscriptions", updates: { active: false } },
      { table: "charges", updates: { deleted_at: "2026-09-25T00:00:00Z" } },
    ];
    for (const { table, updates } of refused) {
      expect((await post({ action: "update", table, id: "__all__", updates })).status).toBe(400);
    }
    expect(db.requests).toHaveLength(0);
  });

  it("detaches a card by sending null", async () => {
    db.tables.charges[0].payment_method_id = "pm1";
    expect((await post({ action: "update", table: "charges", id: "c1", updates: { payment_method_id: null } })).status).toBe(200);
    expect(db.tables.charges[0].payment_method_id).toBeNull();
  });

  it("refuses to remove a charge outright; charges are only marked deleted", async () => {
    const { status } = await post({ action: "delete", table: "charges", id: "c1" });
    expect(status).toBe(400);
    expect(db.tables.charges).toHaveLength(1);
  });

  it("refuses to delete a service history still points at, and says what holds it", async () => {
    const used = await post({ action: "delete", table: "services", id: "s-used" });
    expect(used.status).toBe(409);
    expect(used.body.error).toMatch(/^Still in use by 1 subscription\./);
    expect((await post({ action: "delete", table: "services", id: "s-free" })).status).toBe(200);
    expect(db.tables.services.map((s) => s.id)).toEqual(["s-used"]);
  });
});

describe("POST /api/data and the wallets", () => {
  it("pays a new charge from the wallet when the wallet covers it, and says so", async () => {
    const { status, body } = await post({ action: "insert", table: "charges", data: { ...charge, paid: false } });
    expect(status).toBe(200);
    expect(body.auto_settled).toEqual({ settled: 1, total: 53 });
    expect(settledFor).toEqual([["a"]]);
  });

  it("pays what a top-up now can, and nothing for an entry taking money out", async () => {
    const topUp = await post({ action: "insert", table: "wallet_entries", data: { subscriber_id: "a", amount_cny: 100, kind: "topup" } });
    expect(topUp.body.auto_settled).toEqual({ settled: 1, total: 53 });
    const out = await post({ action: "insert", table: "wallet_entries", data: { subscriber_id: "a", amount_cny: -5, kind: "adjustment" } });
    expect(out.status).toBe(200);
    expect(out.body.auto_settled).toBeUndefined();
    expect(settledFor).toEqual([["a"]]);
  });

  it("pays from the wallet a person is moved to, and takes only an id or null for it", async () => {
    const moved = await post({ action: "update", table: "subscribers", id: "a", updates: { pays_from: "w" } });
    expect(moved.body).toEqual({ ok: true, auto_settled: { settled: 1, total: 53 } });
    expect(db.tables.subscribers.find((p) => p.id === "a")?.pays_from).toBe("w");
    expect((await post({ action: "update", table: "subscribers", id: "a", updates: { pays_from: null } })).status).toBe(200);
    expect((await post({ action: "update", table: "subscribers", id: "a", updates: { pays_from: 7 } })).status).toBe(400);
    // A rename settles nothing.
    expect((await post({ action: "update", table: "subscribers", id: "a", updates: { name: "Annie" } })).body).toEqual({ ok: true });
    expect(settledFor).toEqual([["a"], ["a"]]);
  });

  it("says in words why a wallet cannot pay from another", async () => {
    const { status, body } = await post({ action: "update", table: "subscribers", id: "w", updates: { pays_from: "a" } });
    expect(status).toBe(409);
    expect(body.error).toBe("Others pay from Wal's wallet, so it cannot pay from another");
  });

  it("pays a charge brought back from deleted, and not one being deleted", async () => {
    expect((await post({ action: "update", table: "charges", id: "c1", updates: { deleted_at: "2026-10-01T00:00:00Z" } })).body).toEqual({ ok: true });
    const back = await post({ action: "update", table: "charges", id: "c1", updates: { deleted_at: null } });
    expect(back.body).toEqual({ ok: true, auto_settled: { settled: 1, total: 53 } });
    expect(settledFor).toEqual([["a"]]);
  });

  it("keeps the write and reports the failure when paying from the wallet fails", async () => {
    settleReply = { status: 404, body: { message: "Could not find the function public.auto_settle(p_people)" } };
    const { status, body } = await post({ action: "insert", table: "charges", data: { ...charge, paid: false } });
    expect(status).toBe(200);
    expect(body.auto_settled).toEqual({ error: "Could not find the function public.auto_settle(p_people)" });
    expect(db.tables.charges).toHaveLength(2);
  });

  it("refuses to delete a person others pay from, and says who is in the way", async () => {
    const { status, body } = await post({ action: "delete", table: "subscribers", id: "w" });
    expect(status).toBe(409);
    expect(body.error).toMatch(/^Still in use by 1 person paying from this wallet\./);
    expect((await post({ action: "delete", table: "subscribers", id: "z" })).status).toBe(200);
  });
});
