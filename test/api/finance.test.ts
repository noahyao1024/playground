import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";
import { calls, startPostgrest, type Row, type StandIn } from "../helpers/postgrest";

const session = vi.hoisted(() => ({ current: null as { user: { email: string } } | null }));
vi.mock("@/lib/auth", () => ({ auth: async () => session.current }));

const { GET, POST } = await import("@/app/api/finance/route");

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

async function post(payload: Row) {
  const res = await POST(new NextRequest("http://localhost/api/finance", { method: "POST", body: JSON.stringify(payload) }));
  return { status: res.status, body: await res.json(), headers: res.headers };
}

describe("who may see it", () => {
  it("answers no one but the owner -- not the signed-out, not the split bill's other allowed address", async () => {
    for (const who of [null, { user: { email: "nicholasyao.sg@gmail.com" } }, { user: { email: "someone@else.com" } }]) {
      session.current = who;
      expect((await GET()).status).toBe(401);
      expect((await post({ action: "createAccount", account: {} })).status).toBe(401);
    }
    expect(db.requests).toHaveLength(0);
  });

  it("hands the owner everything, uncacheable, with balances paged", async () => {
    db.tables.finance_balances.push({ id: "b1", account_id: DBS, as_of: "2026-08-31", currency: "SGD", amount: 100, cny_rate: 5.3, sgd_rate: 1, rate_date: "2026-08-31" });
    const res = await GET();
    const body = await res.json();
    expect(res.status).toBe(200);
    expect(res.headers.get("cache-control")).toBe("private, no-store");
    expect(body.accounts).toHaveLength(3);
    expect(body.balances).toHaveLength(1);
    expect(calls(db, "finance_balances")).toEqual(["GET order=as_of.asc,id.asc&offset=0&limit=1000"]);
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
