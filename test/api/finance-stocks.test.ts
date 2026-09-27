import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";
import { startPostgrest, type Options, type Row, type StandIn } from "../helpers/postgrest";

const session = vi.hoisted(() => ({ current: null as { user: { email: string } } | null }));
vi.mock("@/lib/auth", () => ({ auth: async () => session.current }));

const { GET, POST } = await import("@/app/api/finance/route");
const { GET: SUMMARY } = await import("@/app/api/finance/summary/route");
const { GET: CRON } = await import("@/app/api/cron/stocks/route");

const OWNER = { user: { email: "hi@noahyao.me" } };
const BROKER = "00000000-0000-0000-0000-0000000000b1";
const LOAN = "00000000-0000-0000-0000-0000000000c1";
const EQUITY = "00000000-0000-0000-0000-0000000000e1";
const NOWHERE = "00000000-0000-0000-0000-00000000dead";
const DAY = "2026-09-28";

// Made-up holdings and prices: the owner's live in the database only.
// A CNY buys 0.2 SGD, 0.125 USD and 1 HKD: a dollar is 1.6 SGD, a Hong Kong
// dollar 0.2.
const RATES = { SGD: 0.2, USD: 0.125, HKD: 1 };
let prices: Record<string, { price: number; currency: string; name?: string } | number>;
let quotesAsked: string[];

const account = (id: string, extra: Row = {}): Row => ({
  id, name: id, institution: null, owner: null, region: "SG", currency: "SGD", kind: "asset", category: "investment",
  note: null, sort_order: 0, liquidity: null, archived_at: null, created_at: "2026-01-01T00:00:00Z", ...extra,
});

let db: StandIn;
async function standIn(tables: Record<string, Row[]> = {}, options: Options = {}) {
  db = await startPostgrest({
    finance_accounts: [
      account(BROKER, { name: "Broker" }),
      account(LOAN, { kind: "liability", category: "loan" }),
      account(EQUITY, { rsu_plan: "tiktok", rsu_rules: { currency: "USD", windows: { months: [3, 9], cutoff_day: 15 }, profiles: { p: { rates: [50] } } } }),
    ],
    finance_balances: [],
    finance_stock_positions: [],
    ...tables,
  }, options);
  vi.stubEnv("NEXT_PUBLIC_SUPABASE_URL", db.url);
}

beforeEach(async () => {
  session.current = OWNER;
  vi.stubEnv("SUPABASE_SERVICE_ROLE_KEY", "stand-in");
  vi.stubEnv("CRON_SECRET", "cron-secret");
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(new Date(`${DAY}T04:00:00Z`));
  prices = {
    AAPL: { price: 200, currency: "USD", name: "Apple Inc." },
    MSFT: { price: 400, currency: "USD", name: "Microsoft Corporation" },
    "0700.HK": { price: 400, currency: "HKD", name: "Tencent Holdings Limited" },
    NVDA: { price: 100, currency: "USD", name: "NVIDIA Corporation" },
  };
  quotesAsked = [];
  const realFetch = globalThis.fetch;
  vi.stubGlobal("fetch", async (url: string | URL | Request, init?: RequestInit) => {
    const href = String(url instanceof Request ? url.url : url);
    if (href.startsWith("https://api.frankfurter.dev/")) {
      const wanted = new URL(href).searchParams.get("symbols")!.split(",");
      return new Response(JSON.stringify({ date: DAY, rates: Object.fromEntries(wanted.map((c) => [c, RATES[c as keyof typeof RATES]])) }));
    }
    if (href.includes("finance.yahoo.com")) {
      const symbol = decodeURIComponent(new URL(href).pathname.split("/").pop()!);
      quotesAsked.push(symbol);
      const q = prices[symbol];
      if (q === undefined) return new Response(JSON.stringify({ chart: { result: null, error: { code: "Not Found" } } }), { status: 404 });
      if (typeof q === "number") return new Response("down", { status: q });
      return new Response(JSON.stringify({ chart: { result: [{ meta: { ...q, regularMarketPrice: q.price, longName: q.name, regularMarketTime: 1790496000 } }] } }));
    }
    return realFetch(url, init);
  });
  await standIn();
});

afterEach(async () => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
  vi.useRealTimers();
  await db.close();
});

const request = (path: string, headers: Record<string, string> = {}) => new NextRequest(`http://localhost${path}`, { headers });
async function post(payload: Row) {
  const res = await POST(new NextRequest("http://localhost/api/finance", { method: "POST", body: JSON.stringify(payload) }));
  return { status: res.status, body: await res.json() };
}
const positions = () => db.tables.finance_stock_positions;
const balances = () => db.tables.finance_balances;
const held = [{ symbol: "AAPL", quantity: 10, cost: 150 }, { symbol: "US.MSFT", quantity: 5, cost: 380 }, { symbol: "00700", quantity: 100, cost: 300 }];
const importHeld = () => post({ action: "importStockPositions", account_id: BROKER, positions: held });

describe("importing positions", () => {
  it("prices each against the quote source, keeps the currency it trades in, and records today's balance from them", async () => {
    const { status, body } = await importHeld();
    expect(status).toBe(200);
    expect(quotesAsked.sort()).toEqual(["0700.HK", "AAPL", "MSFT"]);
    expect(positions().map((p) => [p.symbol, p.quantity, p.cost, p.currency, p.name, p.price, p.fx])).toEqual([
      ["AAPL", 10, 150, "USD", "Apple Inc.", 200, 1.6],
      ["MSFT", 5, 380, "USD", "Microsoft Corporation", 400, 1.6],
      ["0700.HK", 100, 300, "HKD", "Tencent Holdings Limited", 400, 0.2],
    ]);
    // 10 × 200 × 1.6 + 5 × 400 × 1.6 + 100 × 400 × 0.2 = 3,200 + 3,200 + 8,000.
    // Apple is up 33%, Tencent 33%, Microsoft 5%: 11,200 of it liquid.
    expect(body.balances).toEqual([expect.objectContaining({
      account_id: BROKER, as_of: DAY, currency: "SGD", amount: 14_400, cny_rate: 5, sgd_rate: 1, rate_date: DAY, liquid_share: 0.777778,
    })]);
    expect(body).toMatchObject({ recorded: [BROKER], priced: 3, failures: [], skipped: [] });
    expect(body.account.stock_positions.map((p: Row) => p.symbol)).toEqual(["0700.HK", "AAPL", "MSFT"]);
  });

  it("replaces what it held with what is listed, as a broker's statement would, keeping each position's row", async () => {
    await importHeld();
    const apple = positions().find((p) => p.symbol === "AAPL")!.id;
    const { status, body } = await post({ action: "importStockPositions", account_id: BROKER, positions: [{ symbol: "AAPL", quantity: 20, cost: 150 }] });
    expect(status).toBe(200);
    expect(positions().map((p) => [p.id, p.symbol, p.quantity])).toEqual([[apple, "AAPL", 20]]);
    expect(body.balances[0]).toMatchObject({ amount: 6_400, liquid_share: 1 });
    // Without replace, it adds and updates only.
    await post({ action: "importStockPositions", account_id: BROKER, positions: [{ symbol: "NVDA", quantity: 1, cost: 1 }], replace: false });
    expect(positions().map((p) => p.symbol).sort()).toEqual(["AAPL", "NVDA"]);
  });

  it("refuses the lot, writing nothing, for a symbol unknown, a currency wrong or a price not to be had -- saying which", async () => {
    const bad: Array<[Row[], number, RegExp]> = [
      [[...held, { symbol: "NOPE", quantity: 1, cost: 1 }], 400, /Nothing was imported: NOPE \(no such symbol\)/],
      [[{ symbol: "AAPL", quantity: 1, cost: 1, currency: "HKD" }], 400, /AAPL trades in USD, not HKD/],
      [[{ symbol: "AAPL", quantity: 0, cost: 1 }], 400, /quantity must be the shares held/],
      [[{ symbol: "AAPL", quantity: 1, cost: -1 }], 400, /cost must be the average cost/],
      [[{ symbol: "AA PL", quantity: 1, cost: 1 }], 400, /symbol must be as the market spells it/],
      [[{ symbol: "AAPL", quantity: 1, cost: 1 }, { symbol: "US.AAPL", quantity: 1, cost: 1 }], 400, /AAPL is listed twice/],
      [[], 400, /positions must list 1 to 200/],
    ];
    for (const [list, status, message] of bad) {
      const res = await post({ action: "importStockPositions", account_id: BROKER, positions: list });
      expect(res.status, JSON.stringify(list)).toBe(status);
      expect(res.body.error).toMatch(message);
    }
    prices.MSFT = 503;
    const down = await importHeld();
    expect(down.status).toBe(502);
    expect(down.body.error).toMatch(/no price for MSFT \(HTTP 503\)\. Try again/);
    expect(positions()).toEqual([]);
    expect(balances()).toEqual([]);
  });

  it("goes only into an open asset holding no RSUs", async () => {
    const into = (account_id: string) => post({ action: "importStockPositions", account_id, positions: held });
    expect((await into(LOAN)).body.error).toMatch(/Only an asset holds stocks/);
    expect((await into(EQUITY)).body.error).toMatch(/An RSU account holds grants, not stock positions/);
    expect((await into(NOWHERE)).status).toBe(404);
    session.current = null;
    expect((await into(BROKER)).status).toBe(401);
  });
});

describe("changing positions", () => {
  it("adds one, but not one already held", async () => {
    await importHeld();
    const { status, body } = await post({ action: "addStockPosition", account_id: BROKER, symbol: "nvda", quantity: 10, cost: 50 });
    expect(status).toBe(200);
    // 14,400 + 10 × 100 × 1.6, and NVIDIA is up 100%.
    expect(body.balances[0]).toMatchObject({ amount: 16_000, liquid_share: 0.8 });
    const again = await post({ action: "addStockPosition", account_id: BROKER, symbol: "AAPL", quantity: 1, cost: 1 });
    expect(again.status).toBe(409);
    expect(again.body.error).toMatch(/AAPL is already held/);
  });

  it("changes shares or cost and values the account again at the prices kept, asking the source nothing", async () => {
    await importHeld();
    quotesAsked = [];
    const msft = positions().find((p) => p.symbol === "MSFT")!.id;
    const { status, body } = await post({ action: "updateStockPosition", id: msft, updates: { quantity: 10, cost: 300 } });
    expect(status).toBe(200);
    expect(quotesAsked).toEqual([]);
    // Microsoft now 6,400 and up 33%: all of 17,600 liquid.
    expect(body.balances[0]).toMatchObject({ amount: 17_600, liquid_share: 1 });
    expect((await post({ action: "updateStockPosition", id: msft, updates: {} })).body.error).toMatch(/Nothing to change/);
    expect((await post({ action: "updateStockPosition", id: msft, updates: { quantity: -1 } })).status).toBe(400);
    expect((await post({ action: "updateStockPosition", id: NOWHERE, updates: { quantity: 1 } })).status).toBe(404);
  });

  it("deletes one, and values the account at nothing once none is left", async () => {
    await importHeld();
    const ids = positions().map((p) => p.id as string);
    expect((await post({ action: "deleteStockPosition", id: ids[0] })).body.balances[0]).toMatchObject({ amount: 11_200 });
    await post({ action: "deleteStockPosition", id: ids[1] });
    const last = await post({ action: "deleteStockPosition", id: ids[2] });
    expect(last.status).toBe(200);
    expect(last.body.balances).toEqual([expect.objectContaining({ as_of: DAY, amount: 0, liquid_share: 0, note: "No positions left" })]);
    expect((await post({ action: "deleteStockPosition", id: ids[2] })).status).toBe(404);
  });
});

describe("valuing again", () => {
  it("prices every position anew and records the day's balances, keeping the last price of one the source will not give", async () => {
    await importHeld();
    prices.AAPL = { price: 300, currency: "USD" };
    prices["0700.HK"] = 503;
    const { status, body } = await post({ action: "revalueStocks" });
    expect(status).toBe(200);
    // Apple at 300 now; Tencent still at 400.
    expect(body.balances[0]).toMatchObject({ amount: 4_800 + 3_200 + 8_000 });
    expect(body).toMatchObject({ recorded: [BROKER], priced: 2, failures: [{ symbol: "0700.HK", reason: "HTTP 503" }], skipped: [] });
    expect(body.accounts.map((a: Row) => a.id)).toEqual([BROKER]);
    expect(positions().find((p) => p.symbol === "0700.HK")!.price).toBe(400);
  });

  it("values at the prices kept when asked, fetching nothing", async () => {
    await importHeld();
    quotesAsked = [];
    const { body } = await post({ action: "revalueStocks", account_id: BROKER, prices: "kept" });
    expect(quotesAsked).toEqual([]);
    expect(body.balances[0]).toMatchObject({ amount: 14_400 });
    expect((await post({ action: "revalueStocks", prices: "later" })).status).toBe(400);
  });

  it("records the liquid share again when the threshold moves", async () => {
    await importHeld();
    const { status, body } = await post({ action: "updateAccount", id: BROKER, updates: { liquid_min_gain: 40 } });
    expect(status).toBe(200);
    expect(body.liquid_min_gain).toBe(40);
    // Nothing is up more than 40%.
    expect(balances().find((b) => b.account_id === BROKER)).toMatchObject({ amount: 14_400, liquid_share: 0 });
    expect((await post({ action: "updateAccount", id: BROKER, updates: { liquid_min_gain: 20_000 } })).body.error).toMatch(/liquid_min_gain/);
  });
});

describe("what counts as liquid", () => {
  const balance = (id: string, as_of: string, amount: number, liquid_share: number | null, account_id = BROKER): Row => ({
    id, account_id, as_of, currency: "SGD", amount, cny_rate: 5, sgd_rate: 1, rate_date: as_of, liquid_share, note: null,
  });
  const summary = async (query = "?liquid_only=1") => (await SUMMARY(request(`/api/finance/summary${query}`))).json();

  it("is each day's own share, as the balance recorded it", async () => {
    await standIn({ finance_balances: [balance("b1", "2026-09-01", 10_000, 0.25), balance("b2", DAY, 12_000, 0.5)] });
    const s = await summary();
    expect(s.history.map((p: Row) => [p.day, (p.assets as Row).sgd])).toEqual([["2026-09-01", 2_500], [DAY, 6_000]]);
    expect(s.accounts.find((a: Row) => a.id === BROKER).weight).toBe(0.5);
  });

  it("is worked out from the positions at their last prices for a balance recorded by hand, and as set by hand when it is", async () => {
    const position = (symbol: string, cost: number, price: number): Row => ({
      id: symbol, account_id: BROKER, symbol, name: null, quantity: 10, cost, currency: "USD", price, fx: 1.6, priced_at: `${DAY}T03:00:00Z`, note: null,
      created_at: "2026-09-01T00:00:00Z",
    });
    const tables = { finance_balances: [balance("b1", DAY, 10_000, null)], finance_stock_positions: [position("UP", 100, 150), position("FLAT", 100, 100)] };
    await standIn(tables);
    const s = await summary();
    // 2,400 of the 4,000 they are worth is in the one up 50%.
    expect(s.accounts.find((a: Row) => a.id === BROKER).weight).toBe(0.6);
    expect(s.assets.sgd).toBe(6_000);
    expect(s.accounts.find((a: Row) => a.id === BROKER).stocks).toMatchObject({
      positions: 2, value: 4_000, cost: 3_200, gain: 0.25, liquid_value: 2_400, liquidity: 0.6, min_gain: 10, unpriced: [], priced_at: `${DAY}T03:00:00Z`,
    });
    await standIn({ ...tables, finance_accounts: [account(BROKER, { liquidity: 0.9 })] });
    expect((await summary()).accounts.find((a: Row) => a.id === BROKER).weight).toBe(0.9);
  });
});

describe("before the migration", () => {
  it("reads no positions, and values nothing", async () => {
    await standIn({}, {
      intercept: (req) => (req.table === "finance_stock_positions" ? { status: 404, body: { code: "PGRST205", message: "not in the schema cache" } } : undefined),
    });
    const everything = await (await GET(request("/api/finance"))).json();
    expect(everything.accounts.find((a: Row) => a.id === BROKER).stock_positions).toEqual([]);
    const { status, body } = await post({ action: "revalueStocks" });
    expect(status).toBe(200);
    expect(body).toMatchObject({ recorded: [], priced: 0, balances: [] });
  });
});

describe("the daily job's call", () => {
  const cron = async (auth = "Bearer cron-secret") => {
    const res = await CRON(request("/api/cron/stocks", auth ? { authorization: auth } : {}));
    return { status: res.status, body: await res.json() };
  };

  it("values every stock account, answering in counts only", async () => {
    await importHeld();
    prices.AAPL = { price: 250, currency: "USD" };
    const { status, body } = await cron();
    expect(status).toBe(200);
    expect(body).toEqual({ valued_at: `${DAY}T04:00:00.000Z`, accounts: 1, positions: 3, failed: 0, skipped: 0 });
    expect(JSON.stringify(body)).not.toMatch(/AAPL|MSFT|0700/);
    expect(balances().find((b) => b.account_id === BROKER)).toMatchObject({ amount: 4_000 + 3_200 + 8_000 });
  });

  it("answers 503 when no price could be had, so the job asks again", async () => {
    await importHeld();
    prices = { AAPL: 503, MSFT: 503, "0700.HK": 503 };
    expect(await cron()).toMatchObject({ status: 503, body: { accounts: 1, positions: 0, failed: 3 } });
  });

  it("answers no one else", async () => {
    expect((await cron("Bearer wrong")).status).toBe(401);
    expect((await cron("")).status).toBe(401);
  });
});
