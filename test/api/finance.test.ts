import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";
import { calls, startPostgrest, type Row, type StandIn } from "../helpers/postgrest";

const session = vi.hoisted(() => ({ current: null as { user: { email: string } } | null }));
vi.mock("@/lib/auth", () => ({ auth: async () => session.current }));

const { GET, POST } = await import("@/app/api/finance/route");
const { GET: SUMMARY } = await import("@/app/api/finance/summary/route");
const { FINANCE_ACTIONS } = await import("@/lib/finance-openapi");

const OWNER = { user: { email: "hi@noahyao.me" } };
const DBS = "00000000-0000-0000-0000-0000000000a1";
const ICBC = "00000000-0000-0000-0000-0000000000a2";
const OLD = "00000000-0000-0000-0000-0000000000a3";

const account = (id: string, extra: Row = {}): Row => ({
  id, name: id, institution: null, region: "SG", currency: "SGD", kind: "asset", category: "cash",
  note: null, sort_order: 0, archived_at: null, created_at: "2026-01-01T00:00:00Z", ...extra,
});

let db: StandIn;
let fxAsked: string[];
let fxAnswer: { status: number; body: unknown };

beforeEach(async () => {
  session.current = OWNER;
  db = await startPostgrest({
    finance_accounts: [
      account(DBS),
      account(ICBC, { region: "CN", currency: "CNY", category: "deposit" }),
      account(OLD, { archived_at: "2026-06-01T00:00:00Z" }),
    ],
    finance_balances: [],
  });
  vi.stubEnv("NEXT_PUBLIC_SUPABASE_URL", db.url);
  vi.stubEnv("SUPABASE_SERVICE_ROLE_KEY", "stand-in");
  // Frankfurter is answered here; everything else -- the stand-in database --
  // goes through untouched.
  fxAsked = [];
  fxAnswer = { status: 200, body: { date: "2026-09-30", rates: { SGD: 0.18 } } };
  const realFetch = globalThis.fetch;
  vi.stubGlobal("fetch", async (url: string | URL | Request, init?: RequestInit) => {
    const href = String(url instanceof Request ? url.url : url);
    if (!href.startsWith("https://api.frankfurter.dev/")) return realFetch(url, init);
    fxAsked.push(href);
    return new Response(JSON.stringify(fxAnswer.body), { status: fxAnswer.status });
  });
});

afterEach(async () => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
  vi.useRealTimers();
  await db.close();
});

const get = (headers: Record<string, string> = {}, path = "/api/finance") => new NextRequest(`http://localhost${path}`, { headers });

async function post(payload: Row, headers: Record<string, string> = {}) {
  const res = await POST(new NextRequest("http://localhost/api/finance", { method: "POST", body: JSON.stringify(payload), headers }));
  return { status: res.status, body: await res.json(), headers: res.headers };
}

describe("who may see it", () => {
  it("answers no one but the owner -- not the signed-out, not the split bill's other allowed address", async () => {
    for (const who of [null, { user: { email: "nicholasyao.sg@gmail.com" } }, { user: { email: "someone@else.com" } }]) {
      session.current = who;
      expect((await GET(get())).status).toBe(401);
      expect((await SUMMARY(get({}, "/api/finance/summary"))).status).toBe(401);
      expect((await post({ action: "createAccount", account: {} })).status).toBe(401);
    }
    expect(db.requests).toHaveLength(0);
  });

  it("hands the owner everything, uncacheable, with balances paged", async () => {
    db.tables.finance_balances.push({ id: "b1", account_id: DBS, as_of: "2026-08-31", currency: "SGD", amount: 100, cny_rate: 5.3, sgd_rate: 1, rate_date: "2026-08-31" });
    const res = await GET(get());
    const body = await res.json();
    expect(res.status).toBe(200);
    expect(res.headers.get("cache-control")).toBe("private, no-store");
    expect(body.accounts).toHaveLength(3);
    expect(body.balances).toHaveLength(1);
    expect(calls(db, "finance_balances")).toEqual(["GET order=as_of.asc,id.asc&offset=0&limit=1000"]);
  });
});

describe("an agent's token", () => {
  // 64 characters, as `openssl rand -hex 32` makes them.
  const TOKEN = "3f9a0c1e7b2d4a6f8e0c2b4d6f8a0c1e3b5d7f9a1c3e5b7d9f1a3c5e7b9d1f3a";
  const bearer = (token: string) => ({ authorization: `Bearer ${token}` });
  const valid = { name: "CPF OA", region: "SG", currency: "SGD", kind: "asset", category: "retirement" };

  beforeEach(() => { session.current = null; });

  it("acts as the owner with FINANCE_API_TOKEN and no session at all: reads, writes, and the summary", async () => {
    vi.stubEnv("FINANCE_API_TOKEN", TOKEN);
    const res = await GET(get(bearer(TOKEN)));
    expect(res.status).toBe(200);
    expect(res.headers.get("cache-control")).toBe("private, no-store");
    expect((await post({ action: "createAccount", account: valid }, bearer(TOKEN))).status).toBe(200);
    expect(db.tables.finance_accounts).toHaveLength(4);
    expect((await SUMMARY(get(bearer(TOKEN), "/api/finance/summary"))).status).toBe(200);
  });

  it("refuses a wrong token, one not sent as a bearer, and a truncated one", async () => {
    vi.stubEnv("FINANCE_API_TOKEN", TOKEN);
    for (const headers of [
      bearer(TOKEN.replace(/.$/, "0")),
      bearer(TOKEN.slice(0, 32)),
      bearer(`${TOKEN}${TOKEN}`),
      { authorization: TOKEN },
      { authorization: `Basic ${TOKEN}` },
      { "x-api-key": TOKEN },
    ]) {
      expect((await GET(get(headers))).status, JSON.stringify(headers)).toBe(401);
      expect((await post({ action: "createAccount", account: valid }, headers)).status).toBe(401);
    }
    expect(db.tables.finance_accounts).toHaveLength(3);
  });

  it("is closed while FINANCE_API_TOKEN is unset, empty, or too short to be safe", async () => {
    for (const configured of [undefined, "", "   ", "short-but-set", "x".repeat(31)]) {
      if (configured === undefined) vi.stubEnv("FINANCE_API_TOKEN", undefined);
      else vi.stubEnv("FINANCE_API_TOKEN", configured);
      const offered = (configured ?? "").trim() || "anything";
      expect((await GET(get(bearer(offered)))).status, JSON.stringify(configured)).toBe(401);
    }
    expect(db.requests).toHaveLength(0);
  });

  it("forgives the newline a dashboard paste leaves on the configured value", async () => {
    vi.stubEnv("FINANCE_API_TOKEN", `${TOKEN}\n`);
    expect((await GET(get(bearer(TOKEN)))).status).toBe(200);
  });

  it("takes the scheme in any case, as HTTP says it may be sent", async () => {
    vi.stubEnv("FINANCE_API_TOKEN", TOKEN);
    expect((await GET(get({ authorization: `bearer ${TOKEN}` }))).status).toBe(200);
  });
});

describe("the actions the OpenAPI description promises", () => {
  it("are each handled by the route, and nothing else is", async () => {
    for (const action of FINANCE_ACTIONS) {
      const { status, body } = await post({ action });
      expect(body.error, action).not.toBe("Invalid action");
      expect(status, action).toBe(400);
    }
    expect((await post({ action: "dropEverything" })).body.error).toBe("Invalid action");
  });
});

describe("accounts", () => {
  const valid = { name: "CPF OA", institution: "CPF Board", region: "SG", currency: "SGD", kind: "asset", category: "retirement" };

  it("creates an account", async () => {
    const { status, body } = await post({ action: "createAccount", account: valid });
    expect(status).toBe(200);
    expect(body).toMatchObject({ name: "CPF OA", category: "retirement" });
    expect(db.tables.finance_accounts).toHaveLength(4);
  });

  it("refuses an account that does not make sense", async () => {
    const bad: Row[] = [
      { ...valid, name: "  " },
      { ...valid, region: "US" },
      { ...valid, currency: "BTC" },
      { ...valid, kind: "debt" },
      { ...valid, kind: "liability", category: "retirement" },
      { ...valid, category: undefined },
    ];
    for (const account of bad) {
      expect((await post({ action: "createAccount", account })).status, JSON.stringify(account)).toBe(400);
    }
    expect(db.tables.finance_accounts).toHaveLength(3);
  });

  it("archives and restores", async () => {
    await post({ action: "updateAccount", id: DBS, updates: { archived: true } });
    expect(db.tables.finance_accounts[0].archived_at).toEqual(expect.any(String));
    await post({ action: "updateAccount", id: DBS, updates: { archived: false } });
    expect(db.tables.finance_accounts[0].archived_at).toBeNull();
  });

  it("will not re-denominate an account that already has balances, or delete one", async () => {
    db.tables.finance_balances.push({ id: "b1", account_id: DBS, as_of: "2026-08-31", currency: "SGD", amount: 100, cny_rate: 5.3, sgd_rate: 1, rate_date: "2026-08-31" });
    expect((await post({ action: "updateAccount", id: DBS, updates: { currency: "USD" } })).status).toBe(409);
    expect((await post({ action: "deleteAccount", id: DBS })).status).toBe(409);
    expect(db.tables.finance_accounts[0].currency).toBe("SGD");
    // Without balances, both are fine.
    expect((await post({ action: "updateAccount", id: ICBC, updates: { currency: "USD" } })).status).toBe(200);
    expect((await post({ action: "deleteAccount", id: ICBC })).status).toBe(200);
    expect(db.tables.finance_accounts.map((a) => a.id)).not.toContain(ICBC);
  });

  it("keeps whose it is, how liquid it is, and whether a debt is long-term", async () => {
    const { status, body } = await post({
      action: "createAccount",
      account: { ...valid, category: "investment", owner: " Daisy ", liquidity: 0.6 },
    });
    expect(status).toBe(200);
    expect(body).toMatchObject({ owner: "Daisy", liquidity: 0.6 });
    expect((await post({ action: "updateAccount", id: DBS, updates: { owner: "", long_term: true } })).status).toBe(200);
    expect(db.tables.finance_accounts[0]).toMatchObject({ owner: null, long_term: true });
  });

  const loan = { loan_principal: 1_000_000, loan_rate: 4.9, loan_start: "2020-01-15", loan_term_months: 360, loan_method: "annuity" };
  const mortgage = { ...valid, kind: "liability", category: "mortgage", currency: "CNY", region: "CN" };

  it("takes a loan's terms whole, on a liability", async () => {
    const { status, body } = await post({ action: "createAccount", account: { ...mortgage, ...loan } });
    expect(status).toBe(200);
    expect(body).toMatchObject(loan);
    // And takes them away whole.
    const cleared = Object.fromEntries(Object.keys(loan).map((k) => [k, null]));
    expect((await post({ action: "updateAccount", id: body.id, updates: cleared })).status).toBe(200);
    expect(db.tables.finance_accounts.at(-1)).toMatchObject(cleared);
  });

  it("refuses terms that do not make a loan, or a loan on an asset, and says what is wrong", async () => {
    const bad: Array<[Row, RegExp]> = [
      [{ ...mortgage, loan_principal: 1000 }, /missing loan_rate, loan_start, loan_term_months, loan_method/],
      [{ ...valid, ...loan }, /Only a liability/],
      [{ ...mortgage, ...loan, loan_rate: 120 }, /loan_rate/],
      [{ ...mortgage, ...loan, loan_term_months: 12.5 }, /loan_term_months/],
      [{ ...mortgage, ...loan, loan_method: "balloon" }, /loan_method/],
      [{ ...mortgage, ...loan, loan_start: "2020-02-30" }, /loan_start/],
      [{ ...mortgage, ...loan, loan_principal: -5 }, /loan_principal/],
      [{ ...valid, liquidity: 1.5 }, /liquidity/],
      [{ ...valid, liquidity: "0.5" }, /liquidity/],
      [{ ...mortgage, long_term: "yes" }, /long_term/],
    ];
    for (const [account, message] of bad) {
      const { status, body } = await post({ action: "createAccount", account });
      expect(status, JSON.stringify(account)).toBe(400);
      expect(body.error).toMatch(message);
    }
    expect(db.tables.finance_accounts).toHaveLength(3);
  });

  it("checks a loan's terms against what the account already has", async () => {
    const { body } = await post({ action: "createAccount", account: mortgage });
    // One term at a time does not make a loan.
    expect((await post({ action: "updateAccount", id: body.id, updates: { loan_rate: 3.1 } })).status).toBe(400);
    expect((await post({ action: "updateAccount", id: body.id, updates: loan })).status).toBe(200);
    // Now any one of them may change alone.
    expect((await post({ action: "updateAccount", id: body.id, updates: { loan_rate: 3.1 } })).status).toBe(200);
    // It cannot become an asset still carrying them.
    const toAsset = { kind: "asset", category: "property" };
    expect((await post({ action: "updateAccount", id: body.id, updates: toAsset })).body.error).toMatch(/Only a liability/);
  });

  it("asks for a new category when the kind changes and the old one does not fit", async () => {
    expect((await post({ action: "updateAccount", id: ICBC, updates: { kind: "liability" } })).status).toBe(400);
    expect((await post({ action: "updateAccount", id: ICBC, updates: { kind: "liability", category: "loan" } })).status).toBe(200);
    expect((await post({ action: "updateAccount", id: "nope", updates: { name: "x" } })).status).toBe(404);
  });
});

describe("recording balances", () => {
  const record = (as_of: string, entries: Row[]) => post({ action: "recordBalances", as_of, entries });

  // The 30th has happened: it is already the 1st in Singapore.
  beforeEach(() => {
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(new Date("2026-10-01T04:00:00Z"));
  });

  it("stores each balance in its own currency, with that day's CNY and SGD rates", async () => {
    const { status, body } = await record("2026-09-30", [
      { account_id: DBS, amount: 1000 },
      { account_id: ICBC, amount: 50000, note: "after bonus" },
    ]);
    expect(status).toBe(200);
    expect(body.rate_date).toBe("2026-09-30");
    expect(fxAsked).toEqual(["https://api.frankfurter.dev/v1/2026-09-30?base=CNY&symbols=SGD"]);
    const [dbs, icbc] = db.tables.finance_balances;
    expect(dbs).toMatchObject({ account_id: DBS, as_of: "2026-09-30", currency: "SGD", amount: 1000, sgd_rate: 1, rate_date: "2026-09-30" });
    expect(dbs.cny_rate).toBeCloseTo(1 / 0.18, 8);
    expect(icbc).toMatchObject({ currency: "CNY", amount: 50000, cny_rate: 1, sgd_rate: 0.18, note: "after bonus" });
  });

  it("replaces a day recorded again instead of adding to it", async () => {
    await record("2026-09-30", [{ account_id: DBS, amount: 1000 }]);
    await record("2026-09-30", [{ account_id: DBS, amount: 1200 }]);
    expect(db.tables.finance_balances.map((b) => b.amount)).toEqual([1200]);
    expect(calls(db, "finance_balances").filter((c) => c.startsWith("POST"))[0]).toContain("on_conflict=account_id,as_of");
  });

  it("writes nothing when the rates cannot be had", async () => {
    fxAnswer = { status: 503, body: { message: "down" } };
    const { status, body } = await record("2026-09-30", [{ account_id: DBS, amount: 1000 }]);
    expect(status).toBe(502);
    expect(body.error).toMatch(/Nothing was recorded/);
    expect(db.tables.finance_balances).toHaveLength(0);
  });

  it("refuses a day that has not happened, a malformed one, and bad entries", async () => {
    vi.setSystemTime(new Date("2026-09-30T08:00:00Z"));
    const refused: Array<[string, Row[]]> = [
      ["2026-10-01", [{ account_id: DBS, amount: 1 }]],
      ["2026-02-30", [{ account_id: DBS, amount: 1 }]],
      ["30/09/2026", [{ account_id: DBS, amount: 1 }]],
      ["2026-09-30", []],
      ["2026-09-30", [{ account_id: DBS, amount: "1000" }]],
      ["2026-09-30", [{ account_id: DBS, amount: 1 }, { account_id: DBS, amount: 2 }]],
      ["2026-09-30", [{ account_id: "00000000-0000-0000-0000-00000000dead", amount: 1 }]],
      ["2026-09-30", [{ account_id: OLD, amount: 1 }]],
    ];
    for (const [day, entries] of refused) {
      expect((await record(day, entries)).status, `${day} ${JSON.stringify(entries)}`).toBe(400);
    }
    expect(db.tables.finance_balances).toHaveLength(0);
    expect(fxAsked).toHaveLength(0);
  });

  it("deletes a balance", async () => {
    await record("2026-09-30", [{ account_id: DBS, amount: 1000 }]);
    const id = db.tables.finance_balances[0].id;
    expect((await post({ action: "deleteBalance", id })).status).toBe(200);
    expect(db.tables.finance_balances).toHaveLength(0);
  });
});

describe("the summary", () => {
  const CNY_ACCOUNT = ICBC;
  const balance = (id: string, account_id: string, as_of: string, amount: number, cny_rate: number, sgd_rate: number, currency: string): Row => ({
    id, account_id, as_of, currency, amount, cny_rate, sgd_rate, rate_date: as_of, note: null, created_at: `${as_of}T10:00:00Z`, updated_at: null,
  });

  it("is where things stand on the latest record, carried forward and archived the way the page does it", async () => {
    db.tables.finance_balances.push(
      balance("b1", OLD, "2026-05-31", 10, 5.3, 1, "SGD"),
      balance("b2", DBS, "2026-08-31", 1000, 5.3, 1, "SGD"),
      balance("b3", CNY_ACCOUNT, "2026-08-31", 50000, 1, 0.19, "CNY"),
      // ICBC is not recorded on the 30th: it carries its August balance forward.
      balance("b4", DBS, "2026-09-30", 1200, 5.2, 1, "SGD"),
    );
    const res = await SUMMARY(get({}, "/api/finance/summary"));
    expect(res.status).toBe(200);
    expect(res.headers.get("cache-control")).toBe("private, no-store");
    const s = await res.json();

    expect(s.as_of).toBe("2026-09-30");
    expect(s.net.cny).toBe(1200 * 5.2 + 50000);
    expect(s.net.sgd).toBe(1200 + 9500);
    // Against the 31st of August, when DBS held 1000 at 5.3.
    expect(s.change).toEqual({
      since: "2026-08-31",
      assets: { cny: 940, sgd: 200 },
      liabilities: { cny: 0, sgd: 0 },
      net: { cny: 940, sgd: 200 },
    });
    expect(s.by_region.CN.net.cny).toBe(50000);
    expect(s.by_category["asset:deposit"].sgd).toBe(9500);
    expect(s.history.map((p: { day: string }) => p.day)).toEqual(["2026-05-31", "2026-08-31", "2026-09-30"]);

    const byId = Object.fromEntries(s.accounts.map((a: { id: string }) => [a.id, a]));
    expect(byId[DBS]).toMatchObject({ counted: true, latest: { as_of: "2026-09-30", amount: 1200, value: { cny: 6240, sgd: 1200 } } });
    expect(byId[CNY_ACCOUNT]).toMatchObject({ counted: true, latest: { as_of: "2026-08-31", amount: 50000 } });
    // Archived in June: its May balance is history, not part of today.
    expect(byId[OLD]).toMatchObject({ counted: false, latest: { as_of: "2026-05-31" } });
    expect(calls(db, "finance_balances")).toEqual(["GET order=as_of.asc,id.asc&offset=0&limit=1000"]);
  });

  it("says nothing has been recorded rather than inventing zeros for a day", async () => {
    const s = await (await SUMMARY(get({}, "/api/finance/summary"))).json();
    expect(s).toMatchObject({ as_of: null, change: null, history: [], net: { cny: 0, sgd: 0 } });
    expect(s.accounts.every((a: { latest: unknown; counted: boolean }) => a.latest === null && !a.counted)).toBe(true);
  });
});

describe("the summary's filters", () => {
  const balance = (id: string, account_id: string, amount: number, currency = "SGD"): Row => ({
    id, account_id, as_of: "2026-09-30", currency, amount, cny_rate: currency === "SGD" ? 5 : 1, sgd_rate: currency === "SGD" ? 1 : 0.2,
    rate_date: "2026-09-30", note: null, created_at: "2026-09-30T10:00:00Z", updated_at: null,
  });
  const summary = async (query: string) => (await SUMMARY(get({}, `/api/finance/summary${query}`))).json();

  beforeEach(() => {
    db.tables.finance_accounts.push(
      account("stocks", { owner: "Daisy", category: "investment", liquidity: 0.5 }),
      account("home", { kind: "liability", category: "mortgage", region: "CN", currency: "CNY" }),
    );
    db.tables.finance_accounts[0].owner = "Noah";
    db.tables.finance_balances.push(
      balance("b1", DBS, 1000),
      balance("b2", "stocks", 2000),
      balance("b3", "home", 5000, "CNY"),
    );
  });

  it("counts everything when asked nothing", async () => {
    const s = await summary("");
    expect(s.lens).toEqual({ exclude_long_term: false, liquid_only: false, owner: null });
    expect(s.net.sgd).toBe(1000 + 2000 - 1000);
  });

  it("leaves out long-term debt, counts liquid shares, and keeps one owner's accounts, as the page does", async () => {
    expect((await summary("?exclude_long_term=1")).net.sgd).toBe(3000);
    expect((await summary("?liquid_only=true")).net.sgd).toBe(1000 + 1000 - 1000);
    expect((await summary("?owner=Daisy")).net.sgd).toBe(2000);
    // Nobody in particular: the mortgage, with no owner.
    expect((await summary("?owner=")).net.sgd).toBe(-1000);
    const all = await summary("?exclude_long_term=1&liquid_only=1&owner=Daisy");
    expect(all.lens).toEqual({ exclude_long_term: true, liquid_only: true, owner: "Daisy" });
    expect(all.net.sgd).toBe(1000);
    expect(all.accounts.find((a: { id: string }) => a.id === "home")).toMatchObject({ is_long_term: true, weight: 0, counted: false });
  });
});
