import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";
import { calls, startPostgrest, type Options, type Row, type StandIn } from "../helpers/postgrest";

const session = vi.hoisted(() => ({ current: null as { user: { email: string } } | null }));
vi.mock("@/lib/auth", () => ({ auth: async () => session.current }));

const { GET, POST } = await import("@/app/api/finance/route");
const { GET: SUMMARY } = await import("@/app/api/finance/summary/route");
const { GET: RSU } = await import("@/app/api/finance/rsu/route");

const OWNER = { user: { email: "hi@noahyao.me" } };
const CASH = "00000000-0000-0000-0000-0000000000a1";
const EQUITY = "00000000-0000-0000-0000-0000000000e1";
const NOWHERE = "00000000-0000-0000-0000-00000000dead";

// A made-up plan and grants: the owner's real ones live in the database only.
const rules = {
  currency: "USD",
  windows: { months: [3, 9], cutoff_day: 15 },
  profiles: { standard: { label: "Standard", rates: [40, 50, 60] }, full: { rates: [100] } },
  verified_through: "2027-03-15",
};
const account = (id: string, extra: Row = {}): Row => ({
  id, name: id, institution: null, region: "SG", currency: "SGD", kind: "asset", category: "investment",
  note: null, sort_order: 0, archived_at: null, created_at: "2026-01-01T00:00:00Z", ...extra,
});
const grant = (id: string, grant_no: string, profile: string, tranches: Array<[string, number]>, signed = true): Row => ({
  id, account_id: EQUITY, grant_no, label: null, profile, granted_on: null, vest_start: null, signed,
  tranches: tranches.map(([vests_on, shares]) => ({ vests_on, shares })), note: null, created_at: "2026-01-01T00:00:00Z",
});
const G1 = "00000000-0000-0000-0000-0000000000b1";
const G2 = "00000000-0000-0000-0000-0000000000b2";
const G3 = "00000000-0000-0000-0000-0000000000b3";

let db: StandIn;

async function standIn(options: Options = {}, tables: Record<string, Row[]> = {}) {
  db = await startPostgrest({
    finance_accounts: [account(CASH, { category: "cash" }), account(EQUITY, { name: "Equity", rsu_plan: "tiktok", rsu_rules: rules })],
    finance_balances: [],
    finance_rsu_grants: [
      grant(G1, "G1", "standard", [["2025-03-15", 100], ["2025-09-16", 30], ["2026-03-14", 7]]),
      grant(G2, "G2", "full", [["2025-05-20", 12]]),
      grant(G3, "G3", "standard", [["2025-09-15", 20]], false),
    ],
    finance_rsu_sales: [],
    ...tables,
  }, options);
  vi.stubEnv("NEXT_PUBLIC_SUPABASE_URL", db.url);
}

beforeEach(async () => {
  session.current = OWNER;
  vi.stubEnv("SUPABASE_SERVICE_ROLE_KEY", "stand-in");
  await standIn();
});

afterEach(async () => {
  vi.unstubAllEnvs();
  vi.useRealTimers();
  await db.close();
});

const request = (path: string) => new NextRequest(`http://localhost${path}`);
async function post(payload: Row) {
  const res = await POST(new NextRequest("http://localhost/api/finance", { method: "POST", body: JSON.stringify(payload) }));
  return { status: res.status, body: await res.json() };
}
async function rsu(query: string) {
  const res = await RSU(request(`/api/finance/rsu${query}`));
  return { status: res.status, cache: res.headers.get("cache-control"), body: await res.json() };
}
const on = (day: string) => {
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(new Date(`${day}T04:00:00Z`));
};

describe("an RSU account", () => {
  it("is an asset with a plan and its rules, and is refused anything else, saying why", async () => {
    const valid = { name: "Equity 2", region: "SG", currency: "SGD", kind: "asset", category: "investment" };
    const { status, body } = await post({ action: "createAccount", account: { ...valid, rsu_plan: "tiktok", rsu_rules: rules } });
    expect(status).toBe(200);
    expect(body).toMatchObject({ rsu_plan: "tiktok", rsu_rules: { ...rules, prices: [] }, rsu_grants: [], rsu_sales: [] });

    const bad: Array<[Row, RegExp]> = [
      [{ ...valid, kind: "liability", category: "loan", rsu_plan: "tiktok" }, /Only an asset holds RSUs/],
      [{ ...valid, rsu_rules: rules }, /rsu_rules belong to an RSU plan/],
      [{ ...valid, rsu_plan: "acme" }, /rsu_plan must be tiktok or null/],
      [{ ...valid, rsu_plan: "tiktok", rsu_rules: { ...rules, windows: { months: [13], cutoff_day: 1 } } }, /rsu_rules.windows.months/],
    ];
    for (const [a, message] of bad) {
      const res = await post({ action: "createAccount", account: a });
      expect(res.status, JSON.stringify(a)).toBe(400);
      expect(res.body.error).toMatch(message);
    }
  });

  it("keeps its rules to the profiles its grants follow", async () => {
    const res = await post({ action: "updateAccount", id: EQUITY, updates: { rsu_rules: { ...rules, profiles: { standard: rules.profiles.standard } } } });
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/G2 follows the profile full, which these rules do not have/);
    // Moving a rate is fine, and the account comes back with its grants.
    const moved = await post({ action: "updateAccount", id: EQUITY, updates: { rsu_rules: { ...rules, profiles: { ...rules.profiles, full: { rates: [90] } } } } });
    expect(moved.status).toBe(200);
    expect(moved.body.rsu_grants).toHaveLength(3);
  });

  it("is written without the RSU columns while they are empty, as before their migration", async () => {
    await post({ action: "createAccount", account: { name: "Cash", region: "SG", currency: "SGD", kind: "asset", category: "cash", rsu_plan: null } });
    const inserted = db.requests.filter((r) => r.table === "finance_accounts" && r.method === "POST").at(-1)!.body as Row;
    expect(inserted).not.toHaveProperty("rsu_plan");
    expect(inserted).not.toHaveProperty("rsu_rules");
  });
});

describe("grants", () => {
  it("are added with their tranches in order, and the account comes back with them", async () => {
    const { status, body } = await post({
      action: "addRsuGrant", account_id: EQUITY, grant_no: "G4", label: "Refresher", profile: "standard", signed: false,
      tranches: [{ vests_on: "2027-03-01", shares: 6 }, { vests_on: "2026-12-01", shares: 5 }],
    });
    expect(status).toBe(200);
    const added = body.rsu_grants.find((g: Row) => g.grant_no === "G4");
    expect(added).toMatchObject({ label: "Refresher", profile: "standard", signed: false });
    expect(added.tranches).toEqual([{ vests_on: "2026-12-01", shares: 5 }, { vests_on: "2027-03-01", shares: 6 }]);
    // Read in a unique order, one account's only.
    expect(calls(db, "finance_rsu_grants").at(-1)).toBe(`GET account_id=eq.${EQUITY}&order=account_id.asc,grant_no.asc&offset=0&limit=1000`);
  });

  it("are signed, corrected and removed", async () => {
    expect((await post({ action: "updateRsuGrant", id: G3, updates: { signed: true } })).body.rsu_grants.find((g: Row) => g.id === G3).signed).toBe(true);
    const corrected = await post({ action: "updateRsuGrant", id: G2, updates: { tranches: [{ vests_on: "2025-05-20", shares: 11 }] } });
    expect(corrected.body.rsu_grants.find((g: Row) => g.id === G2).tranches).toEqual([{ vests_on: "2025-05-20", shares: 11 }]);
    const left = await post({ action: "deleteRsuGrant", id: G2 });
    expect(left.status).toBe(200);
    expect(left.body.rsu_grants.map((g: Row) => g.grant_no)).toEqual(["G1", "G3"]);
    expect((await post({ action: "deleteRsuGrant", id: G2 })).status).toBe(404);
    expect((await post({ action: "updateRsuGrant", id: NOWHERE, updates: { signed: true } })).status).toBe(404);
  });

  it("are refused where they make no sense, saying why", async () => {
    const valid = { action: "addRsuGrant", account_id: EQUITY, grant_no: "G9", profile: "standard", tranches: [{ vests_on: "2026-01-01", shares: 1 }] };
    const bad: Array<[Row, number, RegExp]> = [
      [{ ...valid, grant_no: "G1" }, 409, /already a grant G1/],
      [{ ...valid, profile: "gold" }, 400, /profile must be one of the account's: standard, full/],
      [{ ...valid, tranches: [] }, 400, /tranches must list/],
      [{ ...valid, tranches: [{ vests_on: "2026-02-30", shares: 1 }] }, 400, /each tranche/],
      [{ ...valid, grant_no: " " }, 400, /grant_no is required/],
      [{ ...valid, signed: "yes" }, 400, /signed must be true or false/],
      [{ ...valid, account_id: CASH }, 400, /no RSU plan/],
      [{ ...valid, account_id: NOWHERE }, 404, /No such account/],
    ];
    for (const [payload, status, message] of bad) {
      const res = await post(payload);
      expect(res.status, JSON.stringify(payload)).toBe(status);
      expect(res.body.error).toMatch(message);
    }
    expect((await post({ action: "updateRsuGrant", id: G1, updates: {} })).body.error).toMatch(/Nothing to change/);
    expect((await post({ action: "updateRsuGrant", id: G1, updates: { grant_no: "G2" } })).status).toBe(409);
  });
});

describe("sales", () => {
  it("are kept by window, and later windows are net of them", async () => {
    const { status, body } = await post({ action: "addRsuSale", account_id: EQUITY, window_cutoff: "2025-09-15", shares: 40, price: 150.5, tax: 1200 });
    expect(status).toBe(200);
    expect(body.rsu_sales).toEqual([expect.objectContaining({ window_cutoff: "2025-09-15", shares: 40, price: 150.5, tax: 1200 })]);
    const w = (await rsu(`?id=${EQUITY}&window=2026-03-15`)).body.window;
    expect(w).toMatchObject({ cumulative: 76, sold_before: 40, quota: 36, remaining: 36 });
    expect((await post({ action: "deleteRsuSale", id: body.rsu_sales[0].id })).body.rsu_sales).toEqual([]);
    expect((await post({ action: "deleteRsuSale", id: NOWHERE })).status).toBe(404);
  });

  it("are refused where they make no sense, saying why", async () => {
    await post({ action: "addRsuSale", account_id: EQUITY, window_cutoff: "2025-09-15", shares: 40 });
    const valid = { action: "addRsuSale", account_id: EQUITY, window_cutoff: "2026-03-15", shares: 1 };
    const bad: Array<[Row, number, RegExp]> = [
      [{ ...valid, window_cutoff: "2026-03-01" }, 400, /window_cutoff must be a window's cutoff: day 15 of month 03, 09/],
      [{ ...valid, shares: 0 }, 400, /shares must be a whole number/],
      [{ ...valid, shares: 2.5 }, 400, /shares must be a whole number/],
      // 149 vested by March 2026, 40 of them sold in September.
      [{ ...valid, shares: 110 }, 400, /more than the 109 shares vested by 2026-03-15 and not sold/],
      [{ ...valid, price: 0 }, 400, /price/],
      [{ ...valid, tax: -1 }, 400, /tax/],
      [{ ...valid, window_cutoff: "2025-09-15" }, 409, /already a sale in the 2025-09-15 window/],
      [{ ...valid, account_id: CASH }, 400, /no RSU plan/],
    ];
    for (const [payload, status, message] of bad) {
      const res = await post(payload);
      expect(res.status, JSON.stringify(payload)).toBe(status);
      expect(res.body.error).toMatch(message);
    }
    expect((await post({ ...valid, shares: 109 })).status).toBe(200);
  });
});

describe("GET /api/finance/rsu", () => {
  it("works a window out tranche by tranche, prices it, and gives what the unsigned grant would add", async () => {
    on("2025-12-31");
    const { status, cache, body } = await rsu(`?id=${EQUITY}&price=150&tax_rate=0.2`);
    expect(status).toBe(200);
    expect(cache).toBe("private, no-store");
    expect(body).toMatchObject({ account_id: EQUITY, plan: "tiktok", currency: "USD" });
    expect(body.position).toEqual({ as_of: "2025-12-31", granted: 149, vested: 142, unvested: 7, sold: 0, held: 142, proposed: 20 });
    // The next window is March's: 100 × 50% + 12 + 30 × 40% + 7 × 40% = 76.8 → 76.
    expect(body.window).toMatchObject({ cutoff: "2026-03-15", cumulative: 76, quota: 76, remaining: 76, projected: false });
    expect(body.window.lines).toHaveLength(4);
    // The unsigned grant's 20 at 40% add 8.
    expect(body.with_proposed).toEqual({ vested: 169, cumulative: 84, quota: 84, remaining: 84 });
    expect(body.proceeds).toEqual({ price: 150, price_effective_date: null, tax_rate: 0.2, gross: 11400, tax: 2280, net: 9120 });
    // March 2027: 100 × 60% + 12 + 30 × 50% + 7 × 50% = 90.5; March 2028: 60 + 12 + 18 + 4.2 = 94.2.
    expect(body.outlook.map((w: Row) => [w.cutoff, w.if_sold_in_full])).toEqual([
      ["2026-03-15", 76], ["2026-09-15", 0], ["2027-03-15", 14], ["2027-09-15", 0], ["2028-03-15", 4], ["2028-09-15", 0], ["2029-03-15", 0], ["2029-09-15", 0],
    ]);
    expect(body.outlook_with_proposed[0].if_sold_in_full).toBe(84);
  });

  it("prices a window at the plan's price in effect by its cutoff, unless one is given", async () => {
    on("2025-12-31");
    const prices = [{ effective_date: "2025-09-01", price: 100 }, { effective_date: "2026-03-01", price: 110.5 }];
    await standIn({}, { finance_accounts: [account(EQUITY, { name: "Equity", rsu_plan: "tiktok", rsu_rules: { ...rules, prices } })] });
    const plan = (await rsu(`?id=${EQUITY}`)).body;
    // March's window at the price from 1 March: 76 × 110.50.
    expect(plan.proceeds).toEqual({ price: 110.5, price_effective_date: "2026-03-01", tax_rate: null, gross: 8398, tax: null, net: null });
    expect(plan.outlook.map((w: Row) => w.price)).toEqual(Array(8).fill(110.5));
    // September's, at the one before.
    expect((await rsu(`?id=${EQUITY}&window=2025-09-15`)).body.proceeds).toMatchObject({ price: 100, price_effective_date: "2025-09-01", gross: 5200 });
    const given = (await rsu(`?id=${EQUITY}&price=150`)).body;
    expect(given.proceeds).toMatchObject({ price: 150, price_effective_date: null, gross: 11_400 });
    expect(given.outlook[0].price).toBe(150);

    const summary = await (await SUMMARY(request("/api/finance/summary"))).json();
    expect(summary.accounts.find((a: Row) => a.id === EQUITY).rsu).toMatchObject({
      price: { effective_date: "2025-09-01", price: 100 },
      value: 14_200,
      liquid: { within_months: 3, window: "2026-03-15", shares: 76 },
    });
  });

  it("keeps a price trend given as the plan writes it, prices as numbers, in order", async () => {
    const prices = [{ effective_date: "2026-03-01", price: "110.50" }, { effective_date: "2025-09-01", price: "100.00" }];
    const { status, body } = await post({ action: "updateAccount", id: EQUITY, updates: { rsu_rules: { ...rules, prices } } });
    expect(status).toBe(200);
    expect(body.rsu_rules.prices).toEqual([{ effective_date: "2025-09-01", price: 100 }, { effective_date: "2026-03-01", price: 110.5 }]);
    const bad = await post({ action: "updateAccount", id: EQUITY, updates: { rsu_rules: { ...rules, prices: [{ effective_date: "2026-03-01", price: "n/a" }] } } });
    expect(bad.status).toBe(400);
    expect(bad.body.error).toMatch(/rsu_rules.prices/);
  });

  it("works a window it is asked for, and leaves the price out when none is given", async () => {
    const { body } = await rsu(`?id=${EQUITY}&window=2025-09-15`);
    expect(body.window).toMatchObject({ cutoff: "2025-09-15", cumulative: 52 });
    expect(body.proceeds).toBeNull();
  });

  it("is refused where it makes no sense", async () => {
    expect((await rsu("")).status).toBe(400);
    expect((await rsu(`?id=${EQUITY}&window=2026-03-16`)).status).toBe(400);
    expect((await rsu(`?id=${EQUITY}&price=0`)).status).toBe(400);
    expect((await rsu(`?id=${EQUITY}&tax_rate=1`)).status).toBe(400);
    expect((await rsu(`?id=${CASH}`)).status).toBe(404);
    expect((await rsu(`?id=${NOWHERE}`)).status).toBe(404);
    session.current = null;
    expect((await rsu(`?id=${EQUITY}`)).status).toBe(401);
  });
});

describe("the summary and the page's read", () => {
  it("carry each account's grants and sales, and the RSU account's status and liquidity", async () => {
    on("2025-12-31");
    await standIn({}, {
      finance_balances: [{ id: "b1", account_id: EQUITY, as_of: "2025-12-31", currency: "SGD", amount: 28_400, cny_rate: 5.3, sgd_rate: 1, rate_date: "2025-12-31" }],
    });
    const everything = await (await GET(request("/api/finance"))).json();
    expect(everything.accounts.find((a: Row) => a.id === EQUITY).rsu_grants).toHaveLength(3);
    expect(everything.accounts.find((a: Row) => a.id === CASH)).toMatchObject({ rsu_grants: [], rsu_sales: [] });

    const summary = await (await SUMMARY(request("/api/finance/summary?liquid_only=1"))).json();
    const equity = summary.accounts.find((a: Row) => a.id === EQUITY);
    expect(equity.rsu).toMatchObject({ plan: "tiktok", position: { held: 142 }, next_window: { cutoff: "2026-03-15", remaining: 76 } });
    // No liquidity set by hand: what March may buy of the 142 held, 76 / 142.
    expect(equity.weight).toBeCloseTo(76 / 142, 12);
    expect(summary.assets.sgd).toBe(15_200);
    expect(summary.accounts.find((a: Row) => a.id === CASH).rsu).toBeNull();
  });

  it("counts each day of the history as liquid as the windows within three months of it allowed", async () => {
    on("2025-12-31");
    const balance = (id: string, as_of: string, amount: number): Row => ({
      id, account_id: EQUITY, as_of, currency: "SGD", amount, cny_rate: 5.3, sgd_rate: 1, rate_date: as_of,
    });
    await standIn({}, {
      finance_balances: [balance("b0", "2025-09-01", 11_200), balance("b1", "2025-10-01", 12_000), balance("b2", "2025-12-31", 28_400)],
    });
    const summary = await (await SUMMARY(request("/api/finance/summary?liquid_only=1"))).json();
    // 1 September: 112 held, of which September's window may buy 52. 1 October:
    // the next window is March's, five and a half months off: none. 31 December:
    // 142 held, of which March's may buy 76.
    expect(summary.history.map((p: Row) => [p.day, (p.assets as Row).sgd])).toEqual([["2025-09-01", 5_200], ["2025-10-01", 0], ["2025-12-31", 15_200]]);
  });

  it("reads no RSUs before their tables exist", async () => {
    await standIn({
      intercept: (req) => (req.table.startsWith("finance_rsu_") ? { status: 404, body: { code: "PGRST205", message: "not in the schema cache" } } : undefined),
    });
    const everything = await (await GET(request("/api/finance"))).json();
    expect(everything.accounts.find((a: Row) => a.id === EQUITY)).toMatchObject({ rsu_grants: [], rsu_sales: [] });
    expect((await rsu(`?id=${EQUITY}`)).status).toBe(404);
  });
});
