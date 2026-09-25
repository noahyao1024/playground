import { describe, expect, it } from "vitest";
import {
  changeBetween, draftFor, historyOf, isCategory, lastBalances, latestOn, positionOn, sortAccounts, valueOf,
  type FinanceAccount, type FinanceBalance,
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
