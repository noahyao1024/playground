import { describe, expect, it } from "vitest";
import {
  addMonths, changeBetween, displayName, draftFor, historyOf, isCategory, isLongTerm, lastBalances, latestOn,
  loanStatus, paymentsMade, positionOn, sortAccounts, summarize, valueOf, weightOf,
  type FinanceAccount, type FinanceBalance, type LoanTerms,
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
  // One million over thirty years at 4.9%: the textbook mortgage, whose figures
  // any Chinese bank's calculator gives.
  const terms = (method: LoanTerms["method"]): LoanTerms =>
    ({ principal: 1_000_000, rate: 4.9, start: "2020-01-15", months: 360, method });

  it("pays 5,307.27 a month under 等额本息, 910,616 of interest over the loan", () => {
    const s = loanStatus(terms("annuity"), "2019-12-31");
    expect(s.payment).toBeCloseTo(5307.27, 2);
    expect(s.total_interest).toBeCloseTo(910_616.19, 0);
    expect(s.payments_made).toBe(0);
    expect(s.principal_left).toBeCloseTo(1_000_000, 6);
    expect(s.total_left).toBeCloseTo(1_910_616.19, 0);
  });

  it("starts at 6,861.11 under 等额本金 and falls, 737,041.67 of interest over the loan", () => {
    const first = loanStatus(terms("equal_principal"), "2019-12-31");
    expect(first.payment).toBeCloseTo(6861.11, 2);
    expect(first.total_interest).toBeCloseTo(737_041.67, 2);
    const later = loanStatus(terms("equal_principal"), "2020-02-15");
    expect(later.payments_made).toBe(2);
    expect(later.principal_left).toBeCloseTo(1_000_000 - 2 * (1_000_000 / 360), 6);
    expect(later.payment).toBeLessThan(first.payment);
  });

  it("owes, after a year, what paying it month by month leaves owing", () => {
    const s = loanStatus(terms("annuity"), "2020-12-15");
    expect(s.payments_made).toBe(12);
    expect(s.payments_left).toBe(348);
    // The long way round, as a bank statement would: a month's interest on, a payment off.
    let owed = 1_000_000;
    for (let month = 0; month < 12; month++) owed = owed * (1 + 0.049 / 12) - s.payment;
    expect(s.principal_left).toBeCloseTo(owed, 4);
    expect(s.principal_left).toBeCloseTo(984_978.41, 2);
    expect(s.principal_left + s.interest_left).toBeCloseTo(s.payment * 348, 4);
    expect(s.next_payment).toBe("2021-01-15");
    expect(s.last_payment).toBe("2049-12-15");
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

  it("counts a payment as made on its day, a month's last day standing in for a missing one", () => {
    const t = { principal: 1, rate: 1, start: "2026-01-31", months: 12, method: "annuity" as const };
    expect(paymentsMade(t, "2026-01-30")).toBe(0);
    expect(paymentsMade(t, "2026-01-31")).toBe(1);
    expect(paymentsMade(t, "2026-02-27")).toBe(1);
    expect(paymentsMade(t, "2026-02-28")).toBe(2);
    expect(addMonths("2026-01-31", 1)).toBe("2026-02-28");
    expect(addMonths("2023-11-30", 3)).toBe("2024-02-29");
    expect(addMonths("2026-12-15", 1)).toBe("2027-01-15");
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
