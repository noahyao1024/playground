import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";
import { calls, startPostgrest, type Row, type StandIn } from "../helpers/postgrest";

// Signed in as an allow-listed address unless a test says otherwise.
const session = vi.hoisted(() => ({ current: { user: { email: "hi@noahyao.me" } } as { user: { email: string } } | null }));
vi.mock("@/lib/auth", () => ({
  auth: async () => session.current,
  isAllowedEmail: (email: string | null | undefined) => email === "hi@noahyao.me",
}));

const { POST } = await import("@/app/api/data/route");

const charge = { subscriber_id: "a", service_id: "s", period_start: "2026-08", period_end: "2026-08", months: 1, monthly_cost: 10, currency: "SGD", exchange_rate: 5.3, total_cny: 53 };

let db: StandIn;
beforeEach(async () => {
  session.current = { user: { email: "hi@noahyao.me" } };
  db = await startPostgrest(
    {
      charges: [{ id: "c1", ...charge, paid: false, deleted_at: null }],
      payment_methods: [{ id: "pm1", is_default: true }, { id: "pm2", is_default: false }],
      services: [{ id: "s-used" }, { id: "s-free" }],
      subscriptions: [{ id: "sub1", service_id: "s-used", subscriber_id: "a" }],
    },
    {
      // A second live charge for a service-month trips the unique index.
      intercept: (req) =>
        req.method === "POST" && req.table === "charges" && (req.body as Row).period_start === "2026-09"
          ? { status: 409, body: { code: "23505", message: 'duplicate key value violates unique constraint "charges_one_per_service_month"' } }
          : undefined,
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
