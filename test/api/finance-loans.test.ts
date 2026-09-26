import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";
import { calls, startPostgrest, type Options, type Row, type StandIn } from "../helpers/postgrest";
import { loanSchedule, loanTermsOf, type FinanceAccount } from "@/lib/finance";
import { financeOpenApi } from "@/lib/finance-openapi";

const session = vi.hoisted(() => ({ current: null as { user: { email: string } } | null }));
vi.mock("@/lib/auth", () => ({ auth: async () => session.current }));

const { GET, POST } = await import("@/app/api/finance/route");
const { GET: SUMMARY } = await import("@/app/api/finance/summary/route");
const { GET: SCHEDULE } = await import("@/app/api/finance/loan-schedule/route");

const OWNER = { user: { email: "hi@noahyao.me" } };
const TOKEN = "3f9a0c1e7b2d4a6f8e0c2b4d6f8a0c1e3b5d7f9a1c3e5b7d9f1a3c5e7b9d1f3a";
const DBS = "00000000-0000-0000-0000-0000000000a1";
const LOAN = "00000000-0000-0000-0000-0000000000b1";
const NOWHERE = "00000000-0000-0000-0000-00000000dead";

const account = (id: string, extra: Row = {}): Row => ({
  id, name: id, institution: null, region: "SG", currency: "SGD", kind: "asset", category: "cash",
  note: null, sort_order: 0, archived_at: null, created_at: "2026-01-01T00:00:00Z", ...extra,
});
// A 建设银行 mortgage, as its repayment plan states it; its first repayment's
// interest as the bank carried it, to a fraction of a cent.
const terms = { loan_principal: 1_439_520.79, loan_rate: 3.2, loan_start: "2026-11-01", loan_term_months: 195, loan_method: "annuity" };
const stated = { loan_payment: 9476.9, loan_first_interest: 3836.2239, loan_maturity: "2043-01-16" };
const mortgage = { name: "房贷", institution: "建设银行", region: "CN", currency: "CNY", kind: "liability", category: "mortgage" };

let db: StandIn;

async function standIn(options: Options = {}, accounts: Row[] = [account(DBS), account(LOAN, { ...mortgage, ...terms, ...stated })]) {
  db = await startPostgrest({ finance_accounts: accounts, finance_balances: [], finance_loan_rate_changes: [] }, options);
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

const request = (path: string, headers: Record<string, string> = {}) => new NextRequest(`http://localhost${path}`, { headers });
async function post(payload: Row, headers: Record<string, string> = {}) {
  const res = await POST(new NextRequest("http://localhost/api/finance", { method: "POST", body: JSON.stringify(payload), headers }));
  return { status: res.status, body: await res.json() };
}
async function schedule(id: string, headers: Record<string, string> = {}) {
  const res = await SCHEDULE(request(`/api/finance/loan-schedule?id=${id}`, headers));
  return { status: res.status, cache: res.headers.get("cache-control"), body: await res.json() };
}
const change = (payload: Row, headers?: Record<string, string>) => post({ action: "addLoanRateChange", account_id: LOAN, ...payload }, headers);

describe("the bank's stated payment and first interest", () => {
  it("are kept with a loan's terms, and put its schedule on the bank's to the cent", async () => {
    const { status, body } = await post({ action: "createAccount", account: { ...mortgage, ...terms, ...stated } });
    expect(status).toBe(200);
    expect(body).toMatchObject({ ...terms, ...stated, rate_changes: [] });
    const { periods } = (await schedule(body.id)).body;
    expect(periods[0]).toEqual({ n: 1, date: "2026-11-01", rate: 3.2, payment: 9476.9, principal: 5640.68, interest: 3836.22, balance: 1_433_880.11 });
    expect(periods.at(-1)).toEqual({ n: 195, date: "2043-01-16", rate: 3.2, payment: 9444.09, principal: 9406.46, interest: 37.63, balance: 0 });
  });

  it("are each optional, and go on and off with the terms", async () => {
    expect((await post({ action: "updateAccount", id: LOAN, updates: { loan_first_interest: null } })).status).toBe(200);
    expect((await post({ action: "updateAccount", id: LOAN, updates: { loan_payment: 9500 } })).body).toMatchObject({ loan_payment: 9500, loan_first_interest: null });
    expect((await post({ action: "updateAccount", id: LOAN, updates: { loan_maturity: null } })).body).toMatchObject({ loan_maturity: null });
    const none = Object.fromEntries([...Object.keys(terms), ...Object.keys(stated)].map((k) => [k, null]));
    expect((await post({ action: "updateAccount", id: LOAN, updates: none })).status).toBe(200);
    expect(db.tables.finance_accounts[1]).toMatchObject(none);
  });

  it("are refused where they mean nothing, saying why", async () => {
    const bad: Array<[Row, RegExp]> = [
      [{ ...mortgage, ...terms, loan_method: "equal_principal", loan_payment: 6861.11 }, /only an annuity/],
      [{ ...mortgage, ...terms, loan_payment: 0 }, /loan_payment must be a positive amount/],
      [{ ...mortgage, ...terms, loan_payment: "9476.90" }, /loan_payment/],
      [{ ...mortgage, ...terms, loan_first_interest: -1 }, /loan_first_interest must be an amount of 0 or more/],
      [{ ...mortgage, ...terms, loan_first_interest: 3836.22388 }, /loan_first_interest must be an amount of 0 or more, to at most 4 decimal places/],
      [{ ...mortgage, ...terms, loan_method: "balloon" }, /loan_method must be annuity, equal_principal, flat, interest_only or null/],
      [{ ...mortgage, ...terms, loan_maturity: "2043-02-30" }, /loan_maturity must be a date/],
      // The last monthly repayment is 2043-01-01: the contract ends in the month from it.
      [{ ...mortgage, ...terms, loan_maturity: "2042-12-31" }, /from the last monthly one, 2043-01-01, to before 2043-02-01/],
      [{ ...mortgage, ...terms, loan_maturity: "2043-02-01" }, /from the last monthly one, 2043-01-01, to before 2043-02-01/],
      [{ ...mortgage, ...stated }, /loan_payment and loan_first_interest and loan_maturity belong to a loan's terms/],
    ];
    for (const [account, message] of bad) {
      const { status, body } = await post({ action: "createAccount", account });
      expect(status, JSON.stringify(account)).toBe(400);
      expect(body.error).toMatch(message);
    }
    // Against what the loan already has: its terms cannot go and leave them behind,
    // nor can it turn 等额本金 with a level payment still set.
    const bare = Object.fromEntries(Object.keys(terms).map((k) => [k, null]));
    expect((await post({ action: "updateAccount", id: LOAN, updates: bare })).body.error).toMatch(/belong to a loan's terms/);
    expect((await post({ action: "updateAccount", id: LOAN, updates: { loan_method: "equal_principal" } })).body.error).toMatch(/only an annuity/);
    // A shorter term leaves the end date past the month after its last repayment.
    expect((await post({ action: "updateAccount", id: LOAN, updates: { loan_term_months: 194 } })).body.error).toMatch(/loan_maturity/);
    expect(db.tables.finance_accounts[1]).toMatchObject({ ...terms, ...stated });
  });
});

describe("rate changes", () => {
  it("are kept on the loan, and its schedule and the summary follow them from their date", async () => {
    const { status, body } = await change({ effective_date: "2027-01-01", rate: 3 });
    expect(status).toBe(200);
    expect(body).toMatchObject({ id: LOAN, ...terms, ...stated });
    expect(body.rate_changes).toEqual([expect.objectContaining({ account_id: LOAN, effective_date: "2027-01-01", rate: 3, payment: null })]);

    // Everything that hands out accounts carries them.
    const everything = await (await GET(request("/api/finance"))).json();
    expect(everything.accounts.find((a: { id: string }) => a.id === LOAN).rate_changes).toHaveLength(1);
    expect(everything.accounts.find((a: { id: string }) => a.id === DBS).rate_changes).toEqual([]);

    const { periods } = (await schedule(LOAN)).body;
    expect(periods.slice(1, 3).map((p: Row) => [p.rate, p.payment])).toEqual([[3.2, 9476.9], [3, 9337.5]]);

    // Mid-March 2027, five repayments in: the next runs at 3%.
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(new Date("2027-03-15T04:00:00Z"));
    const summary = await (await SUMMARY(request("/api/finance/summary"))).json();
    expect(summary.accounts.find((a: { id: string }) => a.id === LOAN).loan)
      .toMatchObject({ rate: 3, payment: 9337.5, payments_made: 5, next_payment: "2027-04-01" });
  });

  it("take the bank's stated payment when there is one", async () => {
    await change({ effective_date: "2027-01-01", rate: 3, payment: 9300 });
    const { periods } = (await schedule(LOAN)).body;
    expect(periods[2]).toEqual({ n: 3, date: "2027-01-01", rate: 3, payment: 9300, principal: 5729.43, interest: 3570.57, balance: 1_422_497.46 });
  });

  it("are refused where they make no sense, saying why", async () => {
    await standIn({}, [
      account(DBS),
      account(LOAN, { ...mortgage, ...terms, ...stated }),
      account("00000000-0000-0000-0000-0000000000b2", { ...mortgage, ...terms, loan_method: "equal_principal" }),
    ]);
    await change({ effective_date: "2027-01-01", rate: 3 });
    const bad: Array<[Row, number, RegExp]> = [
      [{ account_id: DBS, effective_date: "2027-01-01", rate: 3 }, 400, /no loan terms/],
      [{ account_id: NOWHERE, effective_date: "2027-01-01", rate: 3 }, 404, /No such account/],
      [{ account_id: "not-an-id", effective_date: "2027-01-01", rate: 3 }, 400, /account_id/],
      [{ effective_date: "2026-11-01", rate: 3 }, 400, /after the first repayment, 2026-11-01/],
      // The last repayment is on the contract's end date, after the last monthly one.
      [{ effective_date: "2043-01-17", rate: 3 }, 400, /after the last repayment, 2043-01-16/],
      [{ effective_date: "2027-02-30", rate: 3 }, 400, /effective_date must be a date/],
      [{ effective_date: "2027-02-01", rate: 100 }, 400, /rate must be an annual percentage/],
      [{ effective_date: "2027-02-01", rate: "3" }, 400, /rate must be an annual percentage/],
      [{ effective_date: "2027-02-01", rate: 3, payment: 0 }, 400, /payment must be a positive amount/],
      [{ account_id: "00000000-0000-0000-0000-0000000000b2", effective_date: "2027-02-01", rate: 3, payment: 9000 }, 400, /only an annuity/],
      [{ effective_date: "2027-01-01", rate: 2.9 }, 409, /already a rate change on 2027-01-01/],
    ];
    for (const [payload, status, message] of bad) {
      const { status: got, body } = await change(payload);
      expect(got, JSON.stringify(payload)).toBe(status);
      expect(body.error).toMatch(message);
    }
    expect(db.tables.finance_loan_rate_changes).toHaveLength(1);
    // The last repayment's own day is still in time.
    expect((await change({ effective_date: "2043-01-16", rate: 3 })).status).toBe(200);
  });

  it("go when deleted, and the schedule runs as if they had never been", async () => {
    const before = (await schedule(LOAN)).body;
    const added = (await change({ effective_date: "2027-01-01", rate: 3 })).body.rate_changes[0];
    const { status, body } = await post({ action: "deleteLoanRateChange", id: added.id });
    expect(status).toBe(200);
    expect(body).toMatchObject({ id: LOAN, rate_changes: [] });
    expect((await schedule(LOAN)).body).toEqual(before);
    expect((await post({ action: "deleteLoanRateChange", id: added.id })).status).toBe(404);
    expect((await post({ action: "deleteLoanRateChange", id: "not-an-id" })).status).toBe(400);
  });
});

describe("more kinds of loan", () => {
  const car = { ...mortgage, category: "loan", region: "SG", currency: "SGD", name: "Car" };
  const flat = { loan_principal: 100_000, loan_rate: 2.78, loan_start: "2026-01-05", loan_term_months: 84, loan_method: "flat" };

  it("takes 等本等息 with the bank's instalment, 先息后本, and interest counted by the day", async () => {
    const { status, body } = await post({ action: "createAccount", account: { ...car, ...flat, loan_payment: 1422.14 } });
    expect(status).toBe(200);
    expect((await schedule(body.id)).body.periods[0]).toMatchObject({ payment: 1422.14, principal: 1190.47, interest: 231.67 });
    const io = { ...flat, loan_method: "interest_only", loan_rate: 3.65, loan_term_months: 12 };
    const bullet = (await post({ action: "createAccount", account: { ...car, ...io, loan_principal: 100_000 } })).body;
    expect((await schedule(bullet.id)).body.periods.at(-1)).toMatchObject({ payment: 100_304.17, principal: 100_000 });
    const home = { ...terms, loan_day_count: "actual/365" };
    const daily = (await post({ action: "createAccount", account: { ...mortgage, ...home } })).body;
    expect(daily.loan_day_count).toBe("actual/365");
    // 1 October to 1 November 2026: 31 days of 1,439,520.79 at 3.2%, a year of 365.
    expect((await schedule(daily.id)).body.periods[0].interest).toBe(Math.round(143_952_079 * 3.2 * 31 / 36_500) / 100);
  });

  it("refuses what does not fit, saying why", async () => {
    const bad: Array<[Row, RegExp]> = [
      [{ ...car, ...flat, loan_method: "interest_only", loan_payment: 1000 }, /only an annuity \(等额本息\) or flat \(等本等息\)/],
      [{ ...car, ...flat, loan_day_count: "daily" }, /loan_day_count must be 30\/360, actual\/365, actual\/360 or null/],
      [{ ...car, loan_day_count: "actual/365" }, /loan_day_count belong to a loan's terms/],
      [{ ...car, ...flat, loan_method: "balloon" }, /loan_method/],
    ];
    for (const [account, message] of bad) {
      const { status, body } = await post({ action: "createAccount", account });
      expect(status, JSON.stringify(account)).toBe(400);
      expect(body.error).toMatch(message);
    }
  });
});

describe("prepayments", () => {
  const prepay = (payload: Row, headers?: Record<string, string>) => post({ action: "addLoanPrepayment", account_id: LOAN, ...payload }, headers);

  it("come off what is owed on their day, and the schedule and the summary follow", async () => {
    const { status, body } = await prepay({ paid_on: "2027-01-01", amount: 100_000, mode: "reduce" });
    expect(status).toBe(200);
    expect(body.prepayments).toEqual([expect.objectContaining({ account_id: LOAN, paid_on: "2027-01-01", amount: 100_000, mode: "reduce", payment: null })]);
    const everything = await (await GET(request("/api/finance"))).json();
    expect(everything.accounts.find((a: { id: string }) => a.id === LOAN).prepayments).toHaveLength(1);

    const { periods } = (await schedule(LOAN)).body;
    // Paid with the third repayment: the fourth's interest runs on 1,322,558.60, and over the 192 left the payment falls.
    expect(periods[3]).toMatchObject({ n: 4, interest: 3526.82, prepaid: [{ paid_on: "2027-01-01", amount: 100_000 }] });
    expect(periods[3].payment).toBeLessThan(9476.9);
    expect(periods).toHaveLength(195);

    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(new Date("2027-01-15T04:00:00Z"));
    const summary = await (await SUMMARY(request("/api/finance/summary"))).json();
    expect(summary.accounts.find((a: { id: string }) => a.id === LOAN).loan).toMatchObject({ payments_made: 3, principal_left: 1_322_558.6 });
  });

  it("refuse what makes no sense, saying why", async () => {
    await standIn({}, [
      account(DBS),
      account(LOAN, { ...mortgage, ...terms, ...stated }),
      account("00000000-0000-0000-0000-0000000000b2", { ...mortgage, ...terms, loan_method: "equal_principal" }),
    ]);
    await prepay({ paid_on: "2027-01-01", amount: 1000, mode: "shorten" });
    const bad: Array<[Row, number, RegExp]> = [
      [{ account_id: DBS, paid_on: "2027-02-01", amount: 1000, mode: "shorten" }, 400, /no loan terms/],
      [{ account_id: NOWHERE, paid_on: "2027-02-01", amount: 1000, mode: "shorten" }, 404, /No such account/],
      [{ account_id: "not-an-id", paid_on: "2027-02-01", amount: 1000, mode: "shorten" }, 400, /account_id/],
      [{ paid_on: "2027-02-30", amount: 1000, mode: "shorten" }, 400, /paid_on must be a date/],
      [{ paid_on: "2043-01-17", amount: 1000, mode: "shorten" }, 400, /after the last repayment, 2043-01-16/],
      [{ paid_on: "2027-02-01", amount: 0, mode: "shorten" }, 400, /amount must be a positive amount/],
      [{ paid_on: "2027-02-01", amount: "1000", mode: "shorten" }, 400, /amount must be a positive amount/],
      [{ paid_on: "2027-02-01", amount: 1000, mode: "halve" }, 400, /mode must be shorten/],
      [{ paid_on: "2027-02-01", amount: 1000, mode: "shorten", payment: 9000 }, 400, /payment goes with reduce/],
      [{ account_id: "00000000-0000-0000-0000-0000000000b2", paid_on: "2027-02-01", amount: 1000, mode: "reduce", payment: 9000 }, 400, /only an annuity/],
      // After the second repayment, on 1 Dec, 1,428,226.89 is owed: the 1,000 prepaid on 1 Jan comes later.
      [{ paid_on: "2026-12-01", amount: 1_500_000, mode: "shorten" }, 400, /more than the 1428226.89 owed on 2026-12-01\. To clear the loan, prepay 1428226\.89/],
      [{ paid_on: "2027-01-01", amount: 2000, mode: "shorten" }, 409, /already a prepayment on 2027-01-01/],
    ];
    for (const [payload, status, message] of bad) {
      const { status: got, body } = await prepay(payload);
      expect(got, JSON.stringify(payload)).toBe(status);
      expect(body.error).toMatch(message);
    }
    expect(db.tables.finance_loan_prepayments).toHaveLength(1);
    // What is owed that day clears it exactly: the loan ends there, with nothing more to pay.
    expect((await prepay({ paid_on: "2026-12-01", amount: 1_428_226.89, mode: "shorten" })).status).toBe(200);
    const { periods } = (await schedule(LOAN)).body;
    expect(periods).toHaveLength(3);
    expect(periods[2]).toEqual({
      n: 3, date: "2026-12-01", rate: 3.2, payment: 0, principal: 0, interest: 0, balance: 0,
      prepaid: [{ paid_on: "2026-12-01", amount: 1_428_226.89 }],
    });
  });

  it("go when deleted, and the schedule runs as if they had never been", async () => {
    const before = (await schedule(LOAN)).body;
    const made = (await prepay({ paid_on: "2027-01-01", amount: 100_000, mode: "shorten" })).body.prepayments[0];
    const { status, body } = await post({ action: "deleteLoanPrepayment", id: made.id });
    expect(status).toBe(200);
    expect(body).toMatchObject({ id: LOAN, prepayments: [] });
    expect((await schedule(LOAN)).body).toEqual(before);
    expect((await post({ action: "deleteLoanPrepayment", id: made.id })).status).toBe(404);
    expect((await post({ action: "deleteLoanPrepayment", id: "not-an-id" })).status).toBe(400);
  });

  it("are the owner's alone", async () => {
    session.current = null;
    expect((await prepay({ paid_on: "2027-01-01", amount: 1000, mode: "shorten" })).status).toBe(401);
    expect((await post({ action: "deleteLoanPrepayment", id: NOWHERE })).status).toBe(401);
    expect(db.requests).toHaveLength(0);
    vi.stubEnv("FINANCE_API_TOKEN", TOKEN);
    expect((await prepay({ paid_on: "2027-01-01", amount: 1000, mode: "shorten" }, { authorization: `Bearer ${TOKEN}` })).status).toBe(200);
  });
});

describe("GET /api/finance/loan-schedule", () => {
  it("lists every repayment to the cent, with the totals, from the same schedule the summary reads", async () => {
    const { status, cache, body } = await schedule(LOAN);
    expect(status).toBe(200);
    expect(cache).toBe("private, no-store");
    expect(body).toMatchObject({ account_id: LOAN, currency: "CNY", method: "annuity" });
    expect(body.periods).toHaveLength(195);
    expect(body.periods.slice(0, 3).map((p: Row) => [p.principal, p.interest, p.balance])).toEqual([
      [5640.68, 3836.22, 1_433_880.11],
      [5653.22, 3823.68, 1_428_226.89],
      [5668.29, 3808.61, 1_422_558.6],
    ]);
    // The bank's, to the cent: see test/lib/finance.test.ts.
    expect(body.totals).toEqual({ payment: 1_847_962.69, principal: 1_439_520.79, interest: 408_441.9 });
    const loan = db.tables.finance_accounts[1] as unknown as FinanceAccount;
    expect(body).toEqual({ account_id: LOAN, currency: "CNY", method: "annuity", ...loanSchedule(loanTermsOf({ ...loan, rate_changes: [] })!) });
    // Only this loan's rate changes are read, on a unique order.
    expect(calls(db, "finance_loan_rate_changes")).toEqual([`GET account_id=eq.${LOAN}&order=account_id.asc,effective_date.asc&offset=0&limit=1000`]);
  });

  it("asks which loan, and says when there is none", async () => {
    expect((await SCHEDULE(request("/api/finance/loan-schedule"))).status).toBe(400);
    expect((await schedule("not-an-id")).status).toBe(400);
    expect(await schedule(NOWHERE)).toMatchObject({ status: 404, body: { error: "No such account" } });
    expect(await schedule(DBS)).toMatchObject({ status: 404, body: { error: "That account has no loan terms" } });
  });

  it("answers as the OpenAPI description says it does", async () => {
    const spec = financeOpenApi("https://playground.noahyao.me") as unknown as {
      components: { schemas: Record<string, { required: string[]; properties: Record<string, unknown> }> };
    };
    const { body } = await schedule(LOAN);
    const { LoanSchedule, LoanPeriod, Account } = spec.components.schemas;
    expect(Object.keys(body).sort()).toEqual([...LoanSchedule.required].sort());
    expect(Object.keys(body.periods[0]).sort()).toEqual([...LoanPeriod.required].sort());
    expect(Object.keys(Account.properties)).toEqual(expect.arrayContaining(["loan_payment", "loan_first_interest", "loan_maturity", "loan_day_count", "rate_changes", "prepayments"]));
  });
});

describe("the owner's alone", () => {
  it("answers no one else, and an agent's token as the owner", async () => {
    session.current = null;
    expect((await schedule(LOAN)).status).toBe(401);
    expect((await change({ effective_date: "2027-01-01", rate: 3 })).status).toBe(401);
    expect((await post({ action: "deleteLoanRateChange", id: NOWHERE })).status).toBe(401);
    expect(db.requests).toHaveLength(0);

    vi.stubEnv("FINANCE_API_TOKEN", TOKEN);
    const bearer = { authorization: `Bearer ${TOKEN}` };
    expect((await schedule(LOAN, bearer)).status).toBe(200);
    expect((await change({ effective_date: "2027-01-01", rate: 3 }, bearer)).status).toBe(200);
  });
});

describe("before 20260926_finance_loan_schedule is applied", () => {
  // As Supabase answers then: no such table, and no such columns to write.
  const unmigrated = (code: string): Options => ({
    intercept: (req) => {
      if (req.table === "finance_loan_rate_changes" || req.table === "finance_loan_prepayments") {
        return { status: 404, body: { code, message: `relation "public.${req.table}" does not exist` } };
      }
      const body = (Array.isArray(req.body) ? req.body[0] : req.body) as Row | undefined;
      const column = body && ["loan_payment", "loan_first_interest", "loan_maturity", "loan_day_count"].find((c) => c in body);
      if (req.table === "finance_accounts" && column) {
        return { status: 400, body: { code: "PGRST204", message: `Could not find the '${column}' column of 'finance_accounts' in the schema cache` } };
      }
      return undefined;
    },
  });

  for (const code of ["PGRST205", "42P01"]) {
    it(`reads, sums up, schedules and saves as before (${code})`, async () => {
      await standIn(unmigrated(code), [account(DBS), account(LOAN, { ...mortgage, ...terms })]);
      const everything = await (await GET(request("/api/finance"))).json();
      expect(everything.accounts.map((a: { rate_changes: unknown; prepayments: unknown }) => [a.rate_changes, a.prepayments])).toEqual([[[], []], [[], []]]);
      expect((await SUMMARY(request("/api/finance/summary"))).status).toBe(200);
      expect((await schedule(LOAN)).body.periods[0]).toMatchObject({ payment: 9476.74, interest: 3838.72 });
      // The page sends the new fields empty with every save.
      const empty = { loan_payment: null, loan_first_interest: null, loan_maturity: null, loan_day_count: null };
      expect((await post({ action: "createAccount", account: { ...mortgage, ...terms, ...empty } })).status).toBe(200);
      expect((await post({ action: "updateAccount", id: LOAN, updates: { name: "房贷", ...terms, ...empty } })).status).toBe(200);
      // What cannot be saved yet says so.
      const early = await post({ action: "updateAccount", id: LOAN, updates: { loan_payment: 9476.9 } });
      expect(early.status).toBe(500);
      expect(early.body.error).toMatch(/loan_payment/);
    });
  }
});
