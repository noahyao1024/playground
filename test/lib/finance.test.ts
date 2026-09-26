import { describe, expect, it } from "vitest";
import {
  addMonths, changeBetween, displayName, draftFor, historyOf, isCategory, isLongTerm, lastBalances, latestOn,
  days360, loanSchedule, loanStatus, loanTermsOf, positionOn, sortAccounts, summarize, valueOf, weightOf, withAccount, withBalances,
  type FinanceAccount, type FinanceBalance, type Lens, type LoanTerms, type Position,
} from "@/lib/finance";

const account = (id: string, extra: Partial<FinanceAccount> = {}): FinanceAccount => ({
  id, name: id, institution: null, region: "SG", currency: "SGD", kind: "asset", category: "cash",
  note: null, sort_order: 0, archived_at: null, created_at: "2026-01-01T00:00:00Z", ...extra,
});

let n = 0;
const balance = (account_id: string, as_of: string, amount: number, cny_rate: number, sgd_rate: number): FinanceBalance => ({
  id: `b${++n}`, account_id, as_of, currency: "?", amount, cny_rate, sgd_rate, rate_date: as_of,
  note: null, created_at: `${as_of}T00:00:00Z`, updated_at: null,
});

describe("valueOf", () => {
  it("prices a balance at the rates stored with it, and takes numerics as strings too", () => {
    expect(valueOf({ amount: 100, cny_rate: 5.3, sgd_rate: 1 })).toEqual({ cny: 530, sgd: 100 });
    expect(valueOf({ amount: "100" as unknown as number, cny_rate: "5.3" as unknown as number, sgd_rate: 1 }).cny).toBe(530);
  });
});

describe("latestOn", () => {
  const accounts = [account("dbs"), account("icbc", { region: "CN", currency: "CNY" })];
  const balances = [
    balance("dbs", "2026-08-31", 100, 5.3, 1),
    balance("dbs", "2026-09-30", 120, 5.2, 1),
    balance("icbc", "2026-08-31", 1000, 1, 0.19),
  ];

  it("carries an account's last balance forward to days it was not recorded", () => {
    const on = latestOn(accounts, balances, "2026-09-30");
    expect(on.get("dbs")!.amount).toBe(120);
    expect(on.get("icbc")!.amount).toBe(1000);
  });

  it("does not look ahead of the day asked for", () => {
    expect(latestOn(accounts, balances, "2026-09-15").get("dbs")!.amount).toBe(100);
    expect(latestOn(accounts, balances, "2026-08-30").size).toBe(0);
  });

  it("stops counting an archived account the day after it was archived, in Singapore", () => {
    // 20:00 UTC on the 15th is 04:00 on the 16th in Singapore.
    const closed = [account("dbs", { archived_at: "2026-09-15T20:00:00Z" })];
    const b = [balance("dbs", "2026-08-31", 100, 5.3, 1)];
    expect(latestOn(closed, b, "2026-09-16").size).toBe(1);
    expect(latestOn(closed, b, "2026-09-17").size).toBe(0);
  });
});

describe("positionOn", () => {
  it("adds assets, subtracts what is owed, and splits both by region and category", () => {
    const accounts = [
      account("dbs", { region: "SG", currency: "SGD", category: "cash" }),
      account("cpf", { region: "SG", currency: "SGD", category: "retirement" }),
      account("icbc", { region: "CN", currency: "CNY", category: "deposit" }),
      account("card", { region: "SG", currency: "SGD", kind: "liability", category: "credit_card" }),
    ];
    const balances = [
      balance("dbs", "2026-09-30", 1000, 5.3, 1),
      balance("cpf", "2026-09-30", 2000, 5.3, 1),
      balance("icbc", "2026-09-30", 10000, 1, 0.19),
      balance("card", "2026-09-30", 500, 5.3, 1),
    ];
    const p = positionOn(accounts, balances, "2026-09-30");
    expect(p.assets.cny).toBeCloseTo(1000 * 5.3 + 2000 * 5.3 + 10000);
    expect(p.liabilities.sgd).toBeCloseTo(500);
    expect(p.net.cny).toBeCloseTo(p.assets.cny - p.liabilities.cny);
    expect(p.net.sgd).toBeCloseTo(1000 + 2000 + 1900 - 500);
    expect(p.byRegion.SG.assets.sgd).toBeCloseTo(1000 + 2000);
    expect(p.byRegion.SG.liabilities.sgd).toBeCloseTo(500);
    expect(p.byRegion.SG.net.sgd).toBeCloseTo(1000 + 2000 - 500);
    expect(p.byRegion.CN.net.cny).toBeCloseTo(10000);
    expect(p.byRegion.OTHER.net).toEqual({ cny: 0, sgd: 0 });
    expect(p.byCategory["asset:retirement"].sgd).toBeCloseTo(2000);
    expect(p.byCategory["liability:credit_card"].sgd).toBeCloseTo(500);
  });
});

describe("historyOf", () => {
  it("has a point for every day anything was recorded, each carrying the rest forward", () => {
    const accounts = [account("a"), account("b")];
    const balances = [
      balance("a", "2026-09-30", 100, 5, 1),
      balance("b", "2026-08-31", 10, 5, 1),
      balance("a", "2026-08-31", 50, 5, 1),
      balance("b", "2026-10-31", 20, 5, 1),
    ];
    const points = historyOf(accounts, balances);
    expect(points.map((p) => [p.day, p.net.sgd])).toEqual([
      ["2026-08-31", 60],
      ["2026-09-30", 110],
      ["2026-10-31", 120],
    ]);
  });

  it("keeps each point at its own day's rates", () => {
    const accounts = [account("a")];
    const balances = [balance("a", "2026-08-31", 100, 5.2, 1), balance("a", "2026-09-30", 100, 5.4, 1)];
    expect(historyOf(accounts, balances).map((p) => p.net.cny)).toEqual([520, 540]);
  });
});

describe("changeBetween", () => {
  it("gives the change in the unit asked for, and its share of where it started", () => {
    expect(changeBetween({ cny: 1000, sgd: 190 }, { cny: 1100, sgd: 200 }, "cny")).toEqual({ amount: 100, ratio: 0.1 });
    expect(changeBetween({ cny: -1000, sgd: -190 }, { cny: -500, sgd: -95 }, "cny")!.ratio).toBe(0.5);
    expect(changeBetween({ cny: 0, sgd: 0 }, { cny: 5, sgd: 1 }, "cny")!.ratio).toBeNull();
    expect(changeBetween(undefined, { cny: 5, sgd: 1 }, "cny")).toBeNull();
  });

  it("can rise in one currency and fall in the other, when the rate moves more than the money", () => {
    const from = { cny: 5300, sgd: 1000 }, to = { cny: 5350, sgd: 990 };
    expect(changeBetween(from, to, "cny")!.amount).toBeGreaterThan(0);
    expect(changeBetween(from, to, "sgd")).toEqual({ amount: -10, ratio: -0.01 });
  });
});

describe("lastBalances", () => {
  it("finds each account's newest balance, archived or not", () => {
    const last = lastBalances([
      balance("a", "2026-09-30", 2, 1, 1),
      balance("a", "2026-08-31", 1, 1, 1),
      balance("b", "2026-07-31", 9, 1, 1),
    ]);
    expect(last.get("a")!.amount).toBe(2);
    expect(last.get("b")!.amount).toBe(9);
  });
});

describe("draftFor", () => {
  const accounts = [
    account("dbs"),
    account("icbc", { region: "CN", currency: "CNY" }),
    account("new"),
    account("closed", { archived_at: "2026-09-01T00:00:00Z" }),
  ];
  const balances = [
    balance("dbs", "2026-08-31", 100, 5.3, 1),
    balance("dbs", "2026-09-30", 120, 5.2, 1),
    balance("icbc", "2026-08-31", 1000, 1, 0.19),
    balance("closed", "2026-08-31", 7, 5.3, 1),
  ];

  it("starts a new day from what each open account would carry forward to it", () => {
    const d = draftFor(accounts, balances, "2026-10-31");
    expect(d.get("dbs")).toEqual({ amount: 120, from: "2026-09-30" });
    expect(d.get("icbc")).toEqual({ amount: 1000, from: "2026-08-31" });
  });

  it("starts a day already recorded from what was recorded for it, so saving edits it", () => {
    expect(draftFor(accounts, balances, "2026-09-30").get("dbs")).toEqual({ amount: 120, from: "2026-09-30" });
    expect(draftFor(accounts, balances, "2026-09-15").get("dbs")).toEqual({ amount: 100, from: "2026-08-31" });
  });

  it("leaves out an account never recorded, and one that is archived", () => {
    const d = draftFor(accounts, balances, "2026-10-31");
    expect(d.has("new")).toBe(false);
    expect(d.has("closed")).toBe(false);
  });
});

describe("sortAccounts and isCategory", () => {
  it("puts assets first, then China, Singapore, elsewhere, then the owner's order", () => {
    const sorted = sortAccounts([
      account("loan", { kind: "liability", region: "CN", category: "loan" }),
      account("dbs", { region: "SG", sort_order: 2 }),
      account("ocbc", { region: "SG", sort_order: 1 }),
      account("icbc", { region: "CN" }),
      account("ibkr", { region: "OTHER" }),
    ]);
    expect(sorted.map((a) => a.id)).toEqual(["icbc", "ocbc", "dbs", "ibkr", "loan"]);
  });

  it("knows which categories belong to which kind", () => {
    expect(isCategory("asset", "retirement")).toBe(true);
    expect(isCategory("liability", "retirement")).toBe(false);
    expect(isCategory("liability", "mortgage")).toBe(true);
    expect(isCategory("asset", "toString")).toBe(false);
  });
});

describe("displayName", () => {
  it("says an account the way it would be said: institution then name, spaced only between words that use spaces", () => {
    expect(displayName({ name: "余额", institution: "微信" })).toBe("微信余额");
    expect(displayName({ name: "Multiplier", institution: "DBS" })).toBe("DBS Multiplier");
    expect(displayName({ name: "储蓄卡", institution: "招商银行" })).toBe("招商银行储蓄卡");
    expect(displayName({ name: "OA", institution: "CPF" })).toBe("CPF OA");
  });

  it("does not repeat an institution the name already carries, and does without one", () => {
    expect(displayName({ name: "DBS Multiplier", institution: "dbs" })).toBe("DBS Multiplier");
    expect(displayName({ name: "微信零钱", institution: "微信" })).toBe("微信零钱");
    expect(displayName({ name: "  Cash  ", institution: null })).toBe("Cash");
    expect(displayName({ name: "Cash", institution: "  " })).toBe("Cash");
  });
});

describe("lenses", () => {
  const accounts = [
    account("salary", { owner: "Noah", region: "SG" }),
    account("wechat", { owner: "Daisy", region: "CN", currency: "CNY" }),
    account("stocks", { owner: "Noah", category: "investment", liquidity: 0.6 }),
    account("joint", { owner: null }),
    account("home", { kind: "liability", category: "mortgage", region: "CN", currency: "CNY" }),
    account("car", { kind: "liability", category: "loan", long_term: true }),
    account("card", { kind: "liability", category: "credit_card", owner: "Daisy" }),
  ];
  const day = "2026-09-30";
  const balances = [
    balance("salary", day, 1000, 5, 1),
    balance("wechat", day, 5000, 1, 0.2),
    balance("stocks", day, 2000, 5, 1),
    balance("joint", day, 100, 5, 1),
    balance("home", day, 50000, 1, 0.2),
    balance("car", day, 300, 5, 1),
    balance("card", day, 50, 5, 1),
  ];

  it("counts everything by default", () => {
    const p = positionOn(accounts, balances, day);
    expect(p.assets.sgd).toBeCloseTo(1000 + 1000 + 2000 + 100);
    expect(p.liabilities.sgd).toBeCloseTo(10000 + 300 + 50);
  });

  it("leaves out long-term debt: a mortgage by its category, anything else by its mark", () => {
    expect(isLongTerm(accounts[4])).toBe(true);
    expect(isLongTerm(accounts[5])).toBe(true);
    expect(isLongTerm(accounts[6])).toBe(false);
    expect(isLongTerm(account("paid-down", { kind: "liability", category: "mortgage", long_term: false }))).toBe(false);
    const p = positionOn(accounts, balances, day, { excludeLongTerm: true });
    expect(p.liabilities.sgd).toBeCloseTo(50);
    expect(p.assets.sgd).toBeCloseTo(4100);
    expect(p.byCategory["liability:mortgage"]).toBeUndefined();
  });

  it("counts only the share of each asset that could be spent now, and every debt in full", () => {
    const p = positionOn(accounts, balances, day, { liquidOnly: true });
    expect(p.assets.sgd).toBeCloseTo(1000 + 1000 + 2000 * 0.6 + 100);
    expect(p.liabilities.sgd).toBeCloseTo(10350);
    expect(weightOf(account("cd", { liquidity: 0 }), { liquidOnly: true })).toBe(0);
    // Unmarked, CPF / 公积金 and property are locked away and the rest is not.
    expect(weightOf(account("cpf", { category: "retirement" }), { liquidOnly: true })).toBe(0);
    expect(weightOf(account("flat", { category: "property" }), { liquidOnly: true })).toBe(0);
    expect(weightOf(account("cpf", { category: "retirement", liquidity: 0.2 }), { liquidOnly: true })).toBe(0.2);
    expect(weightOf(account("bank", { category: "deposit" }), { liquidOnly: true })).toBe(1);
    // Liquidity says nothing about a debt.
    expect(weightOf(account("x", { kind: "liability", category: "loan", liquidity: 0 }), { liquidOnly: true })).toBe(1);
  });

  it("keeps one person's accounts, or those nobody in particular holds", () => {
    expect(positionOn(accounts, balances, day, { owner: "Daisy" }).net.sgd).toBeCloseTo(1000 - 50);
    expect(positionOn(accounts, balances, day, { owner: "" }).net.sgd).toBeCloseTo(100 - 10000 - 300);
    expect(positionOn(accounts, balances, day, { owner: null }).net.sgd).toBeCloseTo(positionOn(accounts, balances, day).net.sgd);
  });

  it("carries the same lens through the history", () => {
    const later = [...balances, balance("stocks", "2026-10-31", 3000, 5, 1)];
    expect(historyOf(accounts, later, { liquidOnly: true, excludeLongTerm: true }).map((p) => p.assets.sgd))
      .toEqual([1000 + 1000 + 1200 + 100, 1000 + 1000 + 1800 + 100]);
  });
});

describe("loans", () => {
  // One million over thirty years at 4.9%: the textbook mortgage.
  const terms = (method: LoanTerms["method"]): LoanTerms =>
    ({ principal: 1_000_000, rate: 4.9, start: "2020-01-15", months: 360, method });

  it("pays 5,307.27 a month under 等额本息, the last repayment settling what the cents moved", () => {
    const s = loanStatus(terms("annuity"), "2019-12-31");
    expect(s).toMatchObject({ payment: 5307.27, rate: 4.9, payments_made: 0, principal_left: 1_000_000 });
    // An online calculator's closed form says 910,616.19: it never rounds the
    // payment. A bank pays 5,307.27 and lets the last repayment, 5,305.19, clear
    // what is left.
    expect(s.total_interest).toBe(910_615.12);
    expect(s.total_left).toBe(1_910_615.12);
    expect(loanSchedule(terms("annuity")).periods.at(-1)).toMatchObject({ n: 360, payment: 5305.19, balance: 0 });
  });

  it("starts at 6,861.11 under 等额本金 and falls, repaying 2,777.78 of principal a month", () => {
    const first = loanStatus(terms("equal_principal"), "2019-12-31");
    expect(first.payment).toBe(6861.11);
    expect(first.total_interest).toBe(737_041.08);
    const later = loanStatus(terms("equal_principal"), "2020-02-15");
    expect(later.payments_made).toBe(2);
    expect(later.principal_left).toBe(1_000_000 - 2 * 2777.78);
    expect(later.payment).toBeLessThan(first.payment);
    // 1,000,000 / 360 rounds up to 2,777.78, so the last repayment has 0.80 less to clear.
    expect(loanSchedule(terms("equal_principal")).periods.at(-1)).toMatchObject({ principal: 2776.98, balance: 0 });
  });

  it("works each month the long way round, as a bank statement does: a month's interest on, a payment off", () => {
    const [first, second] = loanSchedule(terms("annuity")).periods;
    // 1,000,000 × 4.9% / 12 = 4,083.333… → 4,083.33; 998,776.06 × 4.9% / 12 = 4,078.3439… → 4,078.34.
    expect(first).toEqual({ n: 1, date: "2020-01-15", rate: 4.9, payment: 5307.27, principal: 1223.94, interest: 4083.33, balance: 998_776.06 });
    expect(second).toEqual({ n: 2, date: "2020-02-15", rate: 4.9, payment: 5307.27, principal: 1228.93, interest: 4078.34, balance: 997_547.13 });
  });

  it("owes, after a year, what the repayments so far leave owing, and the rest to come", () => {
    const s = loanStatus(terms("annuity"), "2020-12-15");
    expect(s).toMatchObject({ payments_made: 12, payments_left: 348, principal_left: 984_978.39, next_payment: "2021-01-15", last_payment: "2049-12-15" });
    expect(s.total_left).toBeCloseTo(347 * 5307.27 + 5305.19, 6);
    const { periods, totals } = loanSchedule(terms("annuity"));
    expect(periods[11].balance).toBe(s.principal_left);
    expect(totals).toEqual({ payment: 1_910_615.12, principal: 1_000_000, interest: 910_615.12 });
  });

  it("is repaid at the end, to the cent", () => {
    for (const method of ["annuity", "equal_principal"] as const) {
      const s = loanStatus(terms(method), "2050-01-01");
      expect(s).toMatchObject({ payment: 0, payments_left: 0, principal_left: 0, interest_left: 0, total_left: 0, next_payment: null });
    }
  });

  it("handles a loan at no interest", () => {
    const s = loanStatus({ principal: 1200, rate: 0, start: "2026-01-01", months: 12, method: "annuity" }, "2026-03-01");
    expect(s).toMatchObject({ payment: 100, payments_made: 3, principal_left: 900, interest_left: 0 });
  });

  it("ends early when a stated payment repays it early, the last repayment only what is left", () => {
    const t: LoanTerms = { principal: 1200, rate: 0, start: "2026-01-01", months: 12, method: "annuity", payment: 500 };
    expect(loanSchedule(t).periods.map((p) => [p.date, p.payment, p.balance])).toEqual([
      ["2026-01-01", 500, 700], ["2026-02-01", 500, 200], ["2026-03-01", 200, 0],
    ]);
    expect(loanStatus(t, "2026-02-15")).toMatchObject({ payments_made: 2, payments_left: 1, payment: 200, next_payment: "2026-03-01", last_payment: "2026-03-01" });
    expect(loanStatus(t, "2026-12-31")).toMatchObject({ payments_made: 3, payments_left: 0, payment: 0, principal_left: 0, next_payment: null });
  });

  it("rounds half a cent of interest up, where floating point would land a hair under and round it down", () => {
    // 500,040.00 × 4.35% / 12 is exactly 1,812.645; as a float, 181,264.49999999997 cents.
    const [only] = loanSchedule({ principal: 500_040, rate: 4.35, start: "2026-01-01", months: 1, method: "annuity" }).periods;
    expect(only.interest).toBe(1812.65);
  });

  it("counts a payment as made on its day, a month's last day standing in for a missing one", () => {
    const t = { principal: 1200, rate: 1, start: "2026-01-31", months: 12, method: "annuity" as const };
    const made = (day: string) => loanStatus(t, day).payments_made;
    expect(made("2026-01-30")).toBe(0);
    expect(made("2026-01-31")).toBe(1);
    expect(made("2026-02-27")).toBe(1);
    expect(made("2026-02-28")).toBe(2);
    expect(addMonths("2026-01-31", 1)).toBe("2026-02-28");
    expect(addMonths("2023-11-30", 3)).toBe("2024-02-29");
    expect(addMonths("2026-12-15", 1)).toBe("2027-01-15");
  });

  /** The closed form loanStatus worked out before it kept a schedule in cents,
   *  counting as it counted: the yardstick for a loan given only its terms. */
  function closedForm(t: LoanTerms, day: string) {
    const [sy, sm, sd] = t.start.split("-").map(Number), [y, m, d] = day.split("-").map(Number);
    const monthEnd = new Date(Date.UTC(y, m, 0)).getUTCDate();
    const k = Math.max(0, Math.min(t.months, (y - sy) * 12 + (m - sm) + (d >= Math.min(sd, monthEnd) ? 1 : 0)));
    const i = t.rate / 1200, n = t.months;
    if (t.method === "annuity") {
      const growth = (1 + i) ** n, grown = (1 + i) ** k;
      const level = i === 0 ? t.principal / n : (t.principal * i * growth) / (growth - 1);
      const left = i === 0 ? t.principal - level * k : t.principal * grown - (level * (grown - 1)) / i;
      return { made: k, payment: k < n ? level : 0, principal_left: left, total_interest: level * n - t.principal };
    }
    const part = t.principal / n, left = t.principal - part * k;
    return { made: k, payment: k < n ? part + left * i : 0, principal_left: left, total_interest: (i * part * n * (n + 1)) / 2 };
  }

  it("keeps a loan given only its terms where it was: the same payment, counts and dates, balances within a cent a repayment", () => {
    const days = ["2019-12-31", "2020-02-15", "2020-12-15", "2026-09-30", "2035-06-15", "2049-11-15", "2049-12-15", "2050-01-01"];
    for (const method of ["annuity", "equal_principal"] as const) {
      for (const day of days) {
        const s = loanStatus(terms(method), day), was = closedForm(terms(method), day);
        const why = `${method} on ${day}`;
        expect(s.payments_made, why).toBe(was.made);
        expect(s.payments_left, why).toBe(360 - s.payments_made);
        expect(s.next_payment, why).toBe(s.payments_made < 360 ? addMonths("2020-01-15", s.payments_made) : null);
        expect(s.last_payment, why).toBe("2049-12-15");
        // The formula's payment to the cent -- all but the last, which clears what is left.
        if (s.payments_left !== 1) expect(Math.abs(s.payment - was.payment), why).toBeLessThanOrEqual(0.005 + 1e-9);
        // Each repayment moves the balance by whole cents, where the formula moved it by fractions of one.
        expect(Math.abs(s.principal_left - was.principal_left), why).toBeLessThanOrEqual(0.01 * s.payments_made);
        expect(Math.abs(s.total_interest - was.total_interest), why).toBeLessThanOrEqual(0.01 * 360);
      }
    }
  });

  it("reads the same off an account without the new fields as off one with them empty", () => {
    const loan = account("home", {
      kind: "liability", category: "mortgage", currency: "CNY",
      loan_principal: 1_000_000, loan_rate: 4.9, loan_start: "2020-01-15", loan_term_months: 360, loan_method: "annuity",
    });
    // As the database hands it over before 20260926_finance_loan_schedule, and after.
    const empty = { ...loan, loan_payment: null, loan_first_interest: null, loan_maturity: null, rate_changes: [] };
    for (const day of ["2019-12-31", "2026-09-30", "2050-01-01"]) {
      expect(loanStatus(loanTermsOf(loan)!, day)).toEqual(loanStatus(loanTermsOf(empty)!, day));
      expect(loanStatus(loanTermsOf(loan)!, day)).toEqual(loanStatus(terms("annuity"), day));
    }
  });
});

describe("a bank's repayment plan, to the cent", () => {
  // A 建设银行 plan: what was owed at a rate reset, lent on over the rest of the
  // term at the bank's stated payment, its first repayment's interest as
  // charged, and the contract ending on the 16th while repayments fall on the 1st.
  const ccb: LoanTerms = {
    principal: 1_439_520.79, rate: 3.2, start: "2026-11-01", months: 195, method: "annuity",
    payment: 9476.9, firstInterest: 3836.22, maturity: "2043-01-16",
  };
  const plan = loanSchedule(ccb);
  const at = (n: number) => plan.periods[n - 1];

  it("matches its first three repayments line by line", () => {
    expect(plan.periods.slice(0, 3)).toEqual([
      { n: 1, date: "2026-11-01", rate: 3.2, payment: 9476.9, principal: 5640.68, interest: 3836.22, balance: 1_433_880.11 },
      { n: 2, date: "2026-12-01", rate: 3.2, payment: 9476.9, principal: 5653.22, interest: 3823.68, balance: 1_428_226.89 },
      { n: 3, date: "2027-01-01", rate: 3.2, payment: 9476.9, principal: 5668.29, interest: 3808.61, balance: 1_422_558.6 },
    ]);
    expect(loanStatus(ccb, "2027-01-01")).toMatchObject({ payments_made: 3, principal_left: 1_422_558.6, payment: 9476.9, next_payment: "2027-02-01" });
  });

  it("matches the principal and interest of each of its last monthly repayments, 189 to 194", () => {
    expect(plan.periods.slice(188, 194).map((p) => [p.n, p.date, p.principal, p.interest])).toEqual([
      [189, "2042-07-01", 9301.99, 174.91],
      [190, "2042-08-01", 9326.79, 150.11],
      [191, "2042-09-01", 9351.67, 125.23],
      [192, "2042-10-01", 9376.6, 100.3],
      [193, "2042-11-01", 9401.61, 75.29],
      [194, "2042-12-01", 9426.68, 50.22],
    ]);
  });

  it("falls due last on the contract's end date, charged by the day: 45 days, 30/360, from 1 December", () => {
    const last = at(195);
    expect(plan.periods).toHaveLength(195);
    expect(last).toMatchObject({ n: 195, date: "2043-01-16", interest: 37.63, principal: at(194).balance, balance: 0 });
    // 9,406.40 × 3.2% / 360 × 45 = 37.6256 → 37.63. A plain month's would be 25.08.
    expect(days360("2042-12-01", "2043-01-16")).toBe(45);
    expect(loanSchedule({ ...ccb, maturity: null }).periods.at(-1)).toMatchObject({ date: "2043-01-01", interest: 25.08 });
    // Made only on the day itself.
    expect(loanStatus(ccb, "2043-01-10")).toMatchObject({ payments_made: 194, next_payment: "2043-01-16", payment: last.payment });
    expect(loanStatus(ccb, "2043-01-16")).toMatchObject({ payments_made: 195, next_payment: null, last_payment: "2043-01-16" });
  });

  // The bank's balances from 189 on run 0.06 above these: its plan rounds one
  // month's interest 6 fen higher somewhere in 4 to 188, lines not in hand, which
  // no rounding rule tried reproduces. Every principal and interest seen matches
  // to the cent, so the 0.06 rides along in the balance to the last repayment and
  // the totals. Held to within 0.10 rather than exactly, until those lines are in.
  const near = (got: number, bank: number) => expect(Math.abs(got - bank), `${got} against the bank's ${bank}`).toBeLessThanOrEqual(0.1);

  it("comes within 0.10 of the bank's balances from 189 on, its last repayment, and its totals", () => {
    const bank = [56_289.81, 46_963.02, 37_611.35, 28_234.75, 18_833.14, 9406.46];
    plan.periods.slice(188, 194).forEach((p, i) => near(p.balance, bank[i]));
    near(at(195).payment, 9444.09);
    near(plan.totals.payment, 1_847_962.69);
    near(plan.totals.interest, 408_441.9);
    expect(plan.totals.principal).toBe(1_439_520.79);
  });

  it("is off from the first repayment without the stated payment and first interest: what the formula alone gives", () => {
    const [first] = loanSchedule({ ...ccb, payment: null, firstInterest: null }).periods;
    // 9,476.74 and 3,838.72: 0.16 a month short of the bank, and 2.66 owed too much after one repayment.
    expect(first).toMatchObject({ payment: 9476.74, interest: 3838.72, balance: 1_433_882.77 });
  });
});

describe("a contract's end date", () => {
  const t: LoanTerms = { principal: 1_000_000, rate: 4.9, start: "2020-01-15", months: 360, method: "annuity" };

  it("counts days as a bank counts a broken period: every month thirty, a 31st as the 30th", () => {
    expect(days360("2042-12-01", "2043-01-16")).toBe(45);
    expect(days360("2026-01-15", "2026-02-15")).toBe(30);
    expect(days360("2026-01-31", "2026-03-01")).toBe(31);
    expect(days360("2026-02-28", "2026-03-31")).toBe(32);
  });

  it("changes nothing when it falls on the last monthly day, or before", () => {
    const plain = loanSchedule(t);
    expect(loanSchedule({ ...t, maturity: "2049-12-15" })).toEqual(plain);
    expect(loanSchedule({ ...t, maturity: "2049-06-01" })).toEqual(plain);
  });

  it("moves 等额本金's last repayment too, which clears what is left with the days' interest", () => {
    const ep: LoanTerms = { ...t, method: "equal_principal", maturity: "2049-12-31" };
    const [before, last] = loanSchedule(ep).periods.slice(-2);
    // 15 November to 31 December, 30/360: 45 days on what is left.
    expect(last).toMatchObject({ date: "2049-12-31", principal: before.balance, balance: 0 });
    expect(last.interest).toBe(Math.round((before.balance * 4.9 * 45) / 360) / 100);
  });
});

describe("rate changes", () => {
  const ccb: LoanTerms = {
    principal: 1_439_520.79, rate: 3.2, start: "2026-11-01", months: 195, method: "annuity", payment: 9476.9, firstInterest: 3836.22,
  };
  const at3 = (effective_date: string, payment: number | null = null) => ({ effective_date, rate: 3, payment });

  it("re-amortizes what is owed over the repayments left, and leaves the months before as they were", () => {
    const before = loanSchedule(ccb).periods;
    const after = loanSchedule({ ...ccb, rateChanges: [at3("2027-01-01")] }).periods;
    expect(after.slice(0, 2)).toEqual(before.slice(0, 2));
    // 1,428,226.89 over the 193 repayments left at 3%: P·i(1+i)^n / ((1+i)^n − 1) = 9,337.5047 → 9,337.50.
    expect(after[2]).toEqual({ n: 3, date: "2027-01-01", rate: 3, payment: 9337.5, principal: 5766.93, interest: 3570.57, balance: 1_422_459.96 });
    expect(after[3]).toMatchObject({ rate: 3, payment: 9337.5, interest: 3556.15 });
    // Spread over exactly the repayments left: the last comes out level with
    // the rest, but for the cents the rounding moved.
    expect(after).toHaveLength(195);
    expect(Math.abs(after.at(-1)!.payment - 9337.5)).toBeLessThan(2);
    expect(after.at(-1)!.balance).toBe(0);
  });

  it("takes the payment the bank states instead, when there is one", () => {
    const after = loanSchedule({ ...ccb, rateChanges: [at3("2027-01-01", 9300)] }).periods;
    expect(after[2]).toEqual({ n: 3, date: "2027-01-01", rate: 3, payment: 9300, principal: 5729.43, interest: 3570.57, balance: 1_422_497.46 });
    expect(after.slice(3, -1).every((p) => p.payment === 9300)).toBe(true);
  });

  it("starts at the first repayment on or after its date; of several in force, the latest decides", () => {
    const onTheDay = loanSchedule({ ...ccb, rateChanges: [at3("2027-01-01")] });
    // Mid-month, and in whatever order they come.
    expect(loanSchedule({ ...ccb, rateChanges: [at3("2026-12-02")] })).toEqual(onTheDay);
    const two = loanSchedule({ ...ccb, rateChanges: [{ effective_date: "2027-06-01", rate: 2.8, payment: null }, at3("2027-01-01")] }).periods;
    expect(two.map((p) => p.rate).slice(1, 9)).toEqual([3.2, 3, 3, 3, 3, 3, 2.8, 2.8]);
    expect(loanStatus({ ...ccb, rateChanges: [at3("2027-01-01")] }, "2026-12-15")).toMatchObject({ rate: 3, payments_made: 2 });
  });

  it("under 等额本金, keeps the principal level and charges the new rate's interest on what is left", () => {
    const t: LoanTerms = { principal: 1_000_000, rate: 4.9, start: "2020-01-15", months: 360, method: "equal_principal" };
    const before = loanSchedule(t).periods;
    // A stated payment means nothing here: the payment falls every month regardless.
    const after = loanSchedule({ ...t, rateChanges: [{ effective_date: "2021-01-15", rate: 4.2, payment: 9999 }] }).periods;
    expect(after.slice(0, 12)).toEqual(before.slice(0, 12));
    // 966,666.64 × 4.2% / 12 = 3,383.33324 → 3,383.33.
    expect(after[12]).toEqual({ n: 13, date: "2021-01-15", rate: 4.2, payment: 6161.11, principal: 2777.78, interest: 3383.33, balance: 963_888.86 });
    expect(after.slice(0, -1).every((p) => p.principal === 2777.78)).toBe(true);
  });
});

describe("等本等息, a flat rate", () => {
  it("charges a card instalment's fee on the whole amount every month: 12,000 at 0.6% a month is 1,072 twelve times", () => {
    const { periods, totals } = loanSchedule({ principal: 12_000, rate: 7.2, start: "2026-01-10", months: 12, method: "flat" });
    expect(periods.every((p) => p.payment === 1072 && p.principal === 1000 && p.interest === 72)).toBe(true);
    expect(totals).toEqual({ payment: 12_864, principal: 12_000, interest: 864 });
  });

  it("does a Singapore car loan the same way: 100,000 at 2.78% flat over 7 years", () => {
    const t: LoanTerms = { principal: 100_000, rate: 2.78, start: "2026-01-05", months: 84, method: "flat" };
    const { periods, totals } = loanSchedule(t);
    // 100,000 × 2.78% / 12 = 231.666… → 231.67 a month, beside 100,000 / 84 = 1,190.48 of principal.
    expect(periods[0]).toMatchObject({ payment: 1422.15, principal: 1190.48, interest: 231.67 });
    expect(periods.at(-1)).toMatchObject({ n: 84, principal: 1190.16, interest: 231.67, balance: 0 });
    // 100,000 × 2.78% × 7 = 19,460, and 28 fen of monthly rounding.
    expect(totals.interest).toBe(19_460.28);
    // The bank's rounded instalment, stated: the principal is what the fixed interest leaves of it.
    const stated = loanSchedule({ ...t, payment: 1422.14 }).periods;
    expect(stated[0]).toMatchObject({ payment: 1422.14, principal: 1190.47, interest: 231.67 });
    expect(stated.at(-1)!.balance).toBe(0);
  });
});

describe("先息后本, interest only", () => {
  it("pays a month's interest each month and the principal with the last", () => {
    const { periods, totals } = loanSchedule({ principal: 100_000, rate: 3.65, start: "2026-01-20", months: 12, method: "interest_only" });
    expect(periods.slice(0, 11).every((p) => p.payment === 304.17 && p.principal === 0 && p.balance === 100_000)).toBe(true);
    expect(periods[11]).toMatchObject({ payment: 100_304.17, principal: 100_000, interest: 304.17, balance: 0 });
    expect(totals.interest).toBe(3650.04);
    expect(loanStatus({ principal: 100_000, rate: 3.65, start: "2026-01-20", months: 12, method: "interest_only" }, "2026-06-01"))
      .toMatchObject({ payments_made: 5, principal_left: 100_000, payment: 304.17 });
  });
});

describe("interest counted by the day", () => {
  // Interest for `days` on `balance` at `rate`% a year of `basis` days, the long way round.
  const byDay = (balance: number, rate: number, days: number, basis: number) => Math.round((balance * rate * days) / basis) / 100;

  it("charges a Singapore home loan on daily rest, actual/365: each month by its days", () => {
    const { periods } = loanSchedule({ principal: 500_000, rate: 3, start: "2026-02-01", months: 300, method: "annuity", dayCount: "actual/365" });
    // The installment is the usual one; what each month's days charge of it varies.
    expect(periods.slice(0, 3).map((p) => p.payment)).toEqual([2371.06, 2371.06, 2371.06]);
    expect(periods[0].interest).toBe(byDay(500_000, 3, 31, 365)); // January: 1,273.97
    expect(periods[1].interest).toBe(byDay(periods[0].balance, 3, 28, 365)); // February: 1,148.16
    expect(periods[2].interest).toBe(byDay(periods[1].balance, 3, 31, 365)); // March
    expect([periods[0].interest, periods[1].interest]).toEqual([1273.97, 1148.16]);
    expect(periods.at(-1)!.balance).toBe(0);
  });

  it("takes a year of 360 days where the rate is quoted by the day", () => {
    const { periods } = loanSchedule({ principal: 120_000, rate: 7.2, start: "2026-02-01", months: 12, method: "equal_principal", dayCount: "actual/360" });
    expect(periods.slice(0, 2).map((p) => [p.principal, p.interest])).toEqual([[10_000, 744], [10_000, 616]]);
  });

  it("changes nothing when counted by the month, the way it always was", () => {
    const t: LoanTerms = { principal: 1_000_000, rate: 4.9, start: "2020-01-15", months: 360, method: "annuity" };
    expect(loanSchedule({ ...t, dayCount: "30/360" })).toEqual(loanSchedule(t));
  });
});

describe("prepayments", () => {
  // The textbook mortgage; after its 13th repayment, on 15 January 2021, 983,693.12 is owed.
  const t: LoanTerms = { principal: 1_000_000, rate: 4.9, start: "2020-01-15", months: 360, method: "annuity" };
  const prepay = (paid_on: string, amount: number, mode: "shorten" | "reduce", payment: number | null = null) =>
    ({ ...t, prepayments: [{ paid_on, amount, mode, payment }] });
  const owed13 = 983_693.12;

  it("keeps the payment and ends sooner, or keeps the end and pays less", () => {
    expect(loanSchedule(t).periods[12].balance).toBe(owed13);
    const shorter = loanSchedule(prepay("2021-01-15", 100_000, "shorten")).periods;
    // Paid with the 13th repayment: the 14th's interest runs on what is left, 883,693.12 × 4.9% / 12.
    expect(shorter[13]).toMatchObject({ payment: 5307.27, interest: 3608.41, prepaid: [{ paid_on: "2021-01-15", amount: 100_000 }] });
    expect(shorter).toHaveLength(293);
    const lower = loanSchedule(prepay("2021-01-15", 100_000, "reduce")).periods;
    // 883,693.12 over the 347 repayments left.
    const i = 0.049 / 12, g = (1 + i) ** 347;
    expect(lower[13].payment).toBe(Math.round(((owed13 - 100_000) * i * g) / (g - 1) * 100) / 100);
    expect(lower).toHaveLength(360);
    expect(Math.abs(lower.at(-1)!.payment - lower[13].payment)).toBeLessThan(2);
  });

  it("keeps a term it shortened when the rate changes later: the payment is worked out over what is left of it", () => {
    const shorter = prepay("2021-01-15", 100_000, "shorten");
    expect(loanSchedule(shorter).periods).toHaveLength(293);
    const later = loanSchedule({ ...shorter, rateChanges: [{ effective_date: "2022-01-15", rate: 4.2, payment: null }] }).periods;
    // Still 293: the balance on 15 January 2022 over the 269 repayments then left of the shortened term.
    expect(later).toHaveLength(293);
    const owed = later[23].balance, i = 0.042 / 12, g = (1 + i) ** 269;
    expect(later[24].payment).toBe(Math.round((owed * i * g) / (g - 1) * 100) / 100);
    expect(Math.abs(later.at(-1)!.payment - later[24].payment)).toBeLessThan(2);
    // And a prepayment that reduces the payment after it spreads over the shortened term too.
    const ep = loanSchedule({
      ...t, method: "equal_principal", prepayments: [
        { paid_on: "2021-01-15", amount: 100_000, mode: "shorten", payment: null },
        { paid_on: "2022-01-15", amount: 50_000, mode: "reduce", payment: null },
      ],
    }).periods;
    expect(ep).toHaveLength(324);
  });

  it("takes the bank's stated payment after it, where it reduces a level one", () => {
    expect(loanSchedule(prepay("2021-01-15", 100_000, "reduce", 4800)).periods[13].payment).toBe(4800);
  });

  it("charges interest on what was owed before it up to its day, and on what is left after", () => {
    // 30 January is 15 days, 30/360, after the 13th repayment.
    const mid = loanSchedule(prepay("2021-01-30", 100_000, "reduce")).periods[13];
    expect(mid.interest).toBe(Math.round(((owed13 * 15 + (owed13 - 100_000) * 15) * 100 * 4.9) / 36_000) / 100);
    expect(mid.interest).toBe(3812.58);
  });

  it("counts it as paid only from its day", () => {
    const mid = prepay("2021-01-30", 100_000, "reduce");
    expect(loanStatus(mid, "2021-01-29").principal_left).toBe(owed13);
    expect(loanStatus(mid, "2021-01-30").principal_left).toBe(owed13 - 100_000);
    expect(loanStatus(mid, "2021-01-30").payments_made).toBe(13);
  });

  it("clears a loan that it more than covers, on its day, with the interest owed up to it", () => {
    const { periods, totals } = loanSchedule(prepay("2021-01-30", 5_000_000, "shorten"));
    expect(periods).toHaveLength(14);
    expect(periods[13]).toEqual({
      n: 14, date: "2021-01-30", rate: 4.9, payment: 2008.37, principal: 0, interest: 2008.37, balance: 0,
      prepaid: [{ paid_on: "2021-01-30", amount: owed13 }],
    });
    expect(totals.principal).toBe(1_000_000);
    expect(loanStatus(prepay("2021-01-30", 5_000_000, "shorten"), "2021-01-30")).toMatchObject({ principal_left: 0, payments_left: 0, next_payment: null });
  });

  it("comes off the start when paid before the first repayment", () => {
    const [first] = loanSchedule(prepay("2019-12-31", 100_000, "reduce")).periods;
    // A month before the first repayment, 15 December, to the 31st: 15 days on the million, 15 on 900,000.
    expect(first).toMatchObject({ interest: 3879.17, payment: 4776.54 });
    // Earlier still, before that month began: the whole month on 900,000, × 4.9% / 12.
    expect(loanSchedule(prepay("2019-11-01", 100_000, "reduce")).periods[0]).toMatchObject({ interest: 3675, payment: 4776.54 });
  });

  it("under 等额本金, spreads what is left over the months left, or keeps the principal and ends sooner", () => {
    const ep: LoanTerms = { ...t, method: "equal_principal" };
    const lower = loanSchedule({ ...ep, prepayments: [{ paid_on: "2021-01-15", amount: 100_000, mode: "reduce", payment: null }] }).periods;
    // 1,000,000 − 13 × 2,777.78 − 100,000 = 863,888.86, over 347: 2,489.59.
    expect(lower[13].principal).toBe(2489.59);
    expect(lower).toHaveLength(360);
    const shorter = loanSchedule({ ...ep, prepayments: [{ paid_on: "2021-01-15", amount: 100_000, mode: "shorten", payment: null }] }).periods;
    expect(shorter[13].principal).toBe(2777.78);
    expect(shorter).toHaveLength(324);
  });

  it("under 等本等息, charges the flat interest on what is left after it", () => {
    const flat: LoanTerms = { principal: 100_000, rate: 2.78, start: "2026-01-05", months: 84, method: "flat" };
    const { periods } = loanSchedule({ ...flat, prepayments: [{ paid_on: "2027-01-05", amount: 20_000, mode: "reduce", payment: null }] });
    // 84,523.76 − 20,000 = 64,523.76: × 2.78% / 12 = 149.48 a month; over 71 months, 908.79 of principal.
    expect(periods[13]).toMatchObject({ interest: 149.48, principal: 908.79 });
    expect(periods.at(-1)!.balance).toBe(0);
  });

  it("under 先息后本, lowers the interest and the principal the last repayment clears", () => {
    const io: LoanTerms = { principal: 100_000, rate: 3.65, start: "2026-01-20", months: 12, method: "interest_only" };
    const { periods } = loanSchedule({ ...io, prepayments: [{ paid_on: "2026-06-20", amount: 40_000, mode: "shorten", payment: null }] });
    expect(periods[6]).toMatchObject({ interest: 182.5, principal: 0, balance: 60_000 });
    expect(periods[11]).toMatchObject({ payment: 60_182.5, principal: 60_000, balance: 0 });
  });

  it("adds up to what was borrowed, however much was prepaid", () => {
    const { totals } = loanSchedule({
      ...t, prepayments: [
        { paid_on: "2021-01-30", amount: 100_000, mode: "reduce", payment: null },
        { paid_on: "2024-06-01", amount: 50_000, mode: "shorten", payment: null },
      ],
    });
    expect(totals.principal).toBe(1_000_000);
    expect(totals.payment).toBeCloseTo(totals.principal + totals.interest, 6);
  });
});

describe("summarize", () => {
  it("names each account, weighs it by the lens, and places each loan on its schedule", () => {
    const accounts = [
      account("wechat", { name: "余额", institution: "微信", owner: "Daisy", currency: "CNY" }),
      account("home", {
        kind: "liability", category: "mortgage", currency: "CNY",
        loan_principal: 1_000_000, loan_rate: 4.9, loan_start: "2020-01-15", loan_term_months: 360, loan_method: "annuity",
      }),
    ];
    const balances = [balance("wechat", "2026-09-30", 500, 1, 0.19), balance("home", "2026-09-30", 900_000, 1, 0.19)];
    const s = summarize(accounts, balances, { excludeLongTerm: true }, "2026-09-30");
    expect(s.lens).toEqual({ exclude_long_term: true, liquid_only: false, owner: null });
    expect(s.net.cny).toBe(500);
    const [wechat, home] = s.accounts;
    expect(wechat).toMatchObject({ display_name: "微信余额", owner: "Daisy", weight: 1, counted: true, loan: null });
    expect(home).toMatchObject({ is_long_term: true, weight: 0, counted: false });
    expect(home.loan).toMatchObject({ payment: 5307.27, payments_made: 81, payments_left: 279 });
  });
});

describe("historyOf, in one pass", () => {
  // A small deterministic generator: the same "random" families every run.
  function random(seed: number) {
    let x = seed;
    return () => ((x = (x * 16807) % 2147483647) / 2147483647);
  }
  const pick = <T,>(r: () => number, xs: readonly T[]) => xs[Math.floor(r() * xs.length)];

  function family(seed: number) {
    const r = random(seed);
    const days = Array.from({ length: 2 + Math.floor(r() * 12) }, (_, i) => addMonths("2025-01-31", i * (1 + Math.floor(r() * 2))));
    const accounts = Array.from({ length: 1 + Math.floor(r() * 8) }, (_, i) => account(`a${i}`, {
      kind: r() < 0.3 ? "liability" : "asset",
      category: pick(r, ["cash", "retirement", "property", "mortgage", "loan"]),
      region: pick(r, ["CN", "SG", "OTHER"] as const),
      owner: pick(r, ["Daisy", "Noah", null]),
      liquidity: r() < 0.5 ? null : Math.round(r() * 10) / 10,
      long_term: pick(r, [null, true, false]),
      archived_at: r() < 0.25 ? `${pick(r, days)}T${pick(r, ["03", "20"])}:00:00Z` : null,
    }));
    const balances: FinanceBalance[] = [];
    for (const day of days) {
      for (const a of accounts) if (r() < 0.7) balances.push(balance(a.id, day, Math.round(r() * 100000) / 100, 1 + r() * 5, 0.1 + r()));
      // Now and then, a balance whose account is gone from the list.
      if (r() < 0.1) balances.push(balance("stray", day, 1, 1, 1));
    }
    // Stored order is whatever the database gave; it must not matter.
    balances.sort(() => r() - 0.5);
    return { accounts, balances };
  }

  const close = (a: Position, b: Position) => {
    expect(a.day).toBe(b.day);
    for (const t of ["assets", "liabilities", "net"] as const) {
      expect(a[t].cny).toBeCloseTo(b[t].cny, 6);
      expect(a[t].sgd).toBeCloseTo(b[t].sgd, 6);
    }
    for (const region of ["CN", "SG", "OTHER"] as const) expect(a.byRegion[region].net.cny).toBeCloseTo(b.byRegion[region].net.cny, 6);
    expect(Object.keys(a.byCategory).sort()).toEqual(Object.keys(b.byCategory).sort());
    for (const k of Object.keys(a.byCategory)) expect(a.byCategory[k].sgd).toBeCloseTo(b.byCategory[k].sgd, 6);
  };

  it("gives, for 200 random families and every filter, exactly what positionOn gives each day", () => {
    const lenses: Lens[] = [{}, { excludeLongTerm: true }, { liquidOnly: true }, { owner: "Daisy" }, { owner: "" }, { excludeLongTerm: true, liquidOnly: true, owner: "Noah" }];
    for (let seed = 1; seed <= 200; seed++) {
      const { accounts, balances } = family(seed);
      const days = [...new Set(balances.map((b) => b.as_of))].sort();
      for (const lens of lenses) {
        const fast = historyOf(accounts, balances, lens);
        expect(fast.map((p) => p.day)).toEqual(days);
        fast.forEach((p, i) => close(p, positionOn(accounts, balances, days[i], lens)));
      }
    }
  });

  it("works through ten years of weekly records for 300 accounts in well under a second", () => {
    const accounts = Array.from({ length: 300 }, (_, i) => account(`a${i}`));
    const balances: FinanceBalance[] = [];
    for (let week = 0; week < 520; week++) {
      const day = new Date(Date.UTC(2020, 0, 1 + week * 7)).toISOString().slice(0, 10);
      for (const a of accounts) balances.push(balance(a.id, day, 1000 + week, 5, 1));
    }
    const started = performance.now();
    const history = historyOf(accounts, balances, { liquidOnly: true });
    const took = performance.now() - started;
    expect(history).toHaveLength(520);
    expect(history.at(-1)!.net.sgd).toBe(300 * (1000 + 519));
    // A scan of every balance for every day, as it was, takes seconds here.
    expect(took, `${took.toFixed(0)}ms for 156,000 balances`).toBeLessThan(1000);
  });
});

describe("merging a save into what is on screen", () => {
  it("replaces a balance for the same account and day, and adds the rest", () => {
    const before = [balance("a", "2026-09-30", 100, 1, 1), balance("b", "2026-09-30", 200, 1, 1), balance("a", "2026-08-31", 50, 1, 1)];
    const written = [{ ...balance("a", "2026-09-30", 150, 1, 1), id: before[0].id }, balance("c", "2026-09-30", 300, 1, 1)];
    const after = withBalances(before, written);
    expect(after.map((b) => `${b.account_id} ${b.as_of} ${b.amount}`).sort()).toEqual([
      "a 2026-08-31 50", "a 2026-09-30 150", "b 2026-09-30 200", "c 2026-09-30 300",
    ]);
  });

  it("adds a new account, and puts an edited one in its place", () => {
    const accounts = [account("a"), account("b")];
    expect(withAccount(accounts, account("c")).map((a) => a.id)).toEqual(["a", "b", "c"]);
    const renamed = withAccount(accounts, account("a", { name: "Renamed" }));
    expect(renamed.map((a) => a.name)).toEqual(["Renamed", "b"]);
  });
});
