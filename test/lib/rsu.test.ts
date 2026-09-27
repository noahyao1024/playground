import { describe, expect, it } from "vitest";
import {
  fullYears, nextWindow, parseRsuRules, parseTranches, rsuLiquidity, rsuOutlook, rsuPosition, rsuProceeds, rsuWindow,
  rulesFromText, tranchesFromText, windowCutoffs, type RsuGrant, type RsuRules, type RsuSale,
} from "@/lib/rsu";

// A made-up plan: windows in March and September, cut off on the 15th. Real
// rules and grants are the owner's and live in the database, never here.
const rules: RsuRules = {
  currency: "USD",
  windows: { months: [3, 9], cutoff_day: 15 },
  profiles: { standard: { label: "Standard", rates: [40, 50, 60] }, full: { rates: [100] }, odd: { rates: [29] } },
  verified_through: "2027-03-15",
};
const grant = (grant_no: string, profile: string, tranches: Array<[string, number]>, signed = true): RsuGrant => ({
  id: grant_no, account_id: "acct", grant_no, label: null, profile, granted_on: null, vest_start: null, signed,
  tranches: tranches.map(([vests_on, shares]) => ({ vests_on, shares })), note: null, created_at: "2026-01-01T00:00:00Z",
});
const grants = [
  // On a cutoff, the day after one, and the day before the next.
  grant("G1", "standard", [["2025-03-15", 100], ["2025-09-16", 30], ["2026-03-14", 7]]),
  grant("G2", "full", [["2025-05-20", 12]]),
  grant("G3", "standard", [["2025-09-15", 20]], false),
];
const sale = (window_cutoff: string, shares: number): RsuSale => ({
  id: window_cutoff, account_id: "acct", window_cutoff, shares, price: null, tax: null, note: null, created_at: "",
});

describe("counting time", () => {
  it("counts a full year on its anniversary, the day included", () => {
    expect(fullYears("2025-03-15", "2026-03-14")).toBe(0);
    expect(fullYears("2025-03-15", "2026-03-15")).toBe(1);
    expect(fullYears("2025-03-15", "2028-03-15")).toBe(3);
    // A 29 February's anniversary is 1 March in a common year.
    expect(fullYears("2024-02-29", "2025-02-28")).toBe(0);
    expect(fullYears("2024-02-29", "2025-03-01")).toBe(1);
    expect(fullYears("2026-01-01", "2025-06-01")).toBe(0);
  });

  it("lists the windows' cutoffs in order, and finds the next, a cutoff day being its own", () => {
    expect(windowCutoffs(rules, "2025-03-15", "2026-09-14")).toEqual(["2025-03-15", "2025-09-15", "2026-03-15"]);
    expect(nextWindow(rules, "2025-09-15")).toBe("2025-09-15");
    expect(nextWindow(rules, "2025-09-16")).toBe("2026-03-15");
    expect(nextWindow(rules, "2025-12-31")).toBe("2026-03-15");
  });
});

describe("a window", () => {
  it("counts the tranches vested by its cutoff, the day included, each at its profile's rate for the years vested", () => {
    const w = rsuWindow({ rules, grants, sales: [] }, "2025-09-15");
    // 100 at 40% and 12 at 100%; the tranche of the 16th waits for the next window.
    expect(w.lines.map((l) => [l.grant_no, l.vests_on, l.full_years, l.rate, l.sellable])).toEqual([
      ["G1", "2025-03-15", 0, 40, 40],
      ["G2", "2025-05-20", 0, 100, 12],
    ]);
    expect(w).toMatchObject({ vested: 112, cumulative: 52, sold_before: 0, quota: 52, sold: 0, remaining: 52, projected: false });
  });

  it("rounds the sum down, not each tranche, and moves a tranche to the next rate on its anniversary", () => {
    const w = rsuWindow({ rules, grants, sales: [] }, "2026-03-15");
    // 100 × 50% (a year on the day) + 12 × 100% + 30 × 40% + 7 × 40% = 76.8.
    expect(w.lines.map((l) => l.rate)).toEqual([50, 100, 40, 40]);
    expect(w.lines.reduce((n, l) => n + l.sellable, 0)).toBeCloseTo(76.8, 10);
    expect(w.cumulative).toBe(76);
  });

  it("rounds down an exact sum: 100 shares at 29% are 29, which floating point makes 28.999…", () => {
    expect(Math.floor(100 * 0.29)).toBe(28);
    const w = rsuWindow({ rules, grants: [grant("G4", "odd", [["2025-01-01", 100]])], sales: [] }, "2025-03-15");
    expect(w.cumulative).toBe(29);
  });

  it("leaves a proposed grant out unless asked", () => {
    const terms = { rules, grants, sales: [] };
    expect(rsuWindow(terms, "2025-09-15").cumulative).toBe(52);
    const withProposed = rsuWindow(terms, "2025-09-15", { includeProposed: true });
    // 20 more at 40%.
    expect(withProposed).toMatchObject({ cumulative: 60, vested: 132 });
    expect(withProposed.lines.find((l) => l.grant_no === "G3")).toMatchObject({ signed: false, sellable: 8 });
  });

  it("takes off what earlier windows sold, and what this one already has", () => {
    const terms = { rules, grants, sales: [sale("2025-09-15", 40)] };
    expect(rsuWindow(terms, "2025-09-15")).toMatchObject({ cumulative: 52, sold_before: 0, quota: 52, sold: 40, remaining: 12 });
    expect(rsuWindow(terms, "2026-03-15")).toMatchObject({ cumulative: 76, sold_before: 40, quota: 36, sold: 0, remaining: 36 });
    // More sold than a window's cap comes to -- a special offer -- leaves nothing, not less.
    expect(rsuWindow({ rules, grants, sales: [sale("2025-09-15", 80)] }, "2026-03-15").quota).toBe(0);
  });

  it("is a projection past the checked range, or where a tranche outlives its profile's rates", () => {
    const terms = { rules, grants, sales: [] };
    // G2 follows [100]: a year vested by 2026-09-15 is past what the profile says.
    const w = rsuWindow(terms, "2026-09-15");
    expect(w.lines.find((l) => l.grant_no === "G2")).toMatchObject({ full_years: 1, rate: 100, extrapolated: true });
    expect(w.projected).toBe(true);
    expect(rsuWindow(terms, "2026-03-15").projected).toBe(false);
    expect(rsuWindow({ rules, grants: [grant("G5", "standard", [["2027-01-01", 10]])], sales: [] }, "2027-09-15").projected).toBe(true);
  });
});

describe("the outlook", () => {
  it("gives each window's cap, and what it could buy were every one before it sold in full", () => {
    const outlook = rsuOutlook({ rules, grants, sales: [] }, "2025-06-01", 4);
    // September 2026 adds nothing: no tranche vests and none reaches a year.
    // March 2027 moves three up a step: 100 × 60% + 30 × 50% + 7 × 50% + 12 = 90.5.
    expect(outlook.map((w) => [w.cutoff, w.cumulative, w.quota, w.if_sold_in_full])).toEqual([
      ["2025-09-15", 52, 52, 52],
      ["2026-03-15", 76, 76, 24],
      ["2026-09-15", 76, 76, 0],
      ["2027-03-15", 90, 90, 14],
    ]);
  });

  it("starts from what was really sold", () => {
    const outlook = rsuOutlook({ rules, grants, sales: [sale("2025-09-15", 20)] }, "2026-01-01", 2);
    expect(outlook.map((w) => [w.cutoff, w.quota, w.if_sold_in_full])).toEqual([["2026-03-15", 56, 56], ["2026-09-15", 56, 0]]);
  });
});

describe("where the shares stand", () => {
  it("counts signed grants, a proposed one apart, and holds what vested and is not sold", () => {
    expect(rsuPosition({ grants, sales: [sale("2025-09-15", 40)] }, "2025-12-31")).toEqual({
      as_of: "2025-12-31", granted: 149, vested: 142, unvested: 7, sold: 40, held: 102, proposed: 20,
    });
    // A sale counts from its window's cutoff.
    expect(rsuPosition({ grants, sales: [sale("2026-03-15", 5)] }, "2026-03-14").sold).toBe(0);
  });

  it("makes the next window's remaining quota a share of what is held today", () => {
    // Held on 2025-12-31: 142. The March window may buy 76.
    expect(rsuLiquidity({ plan: "tiktok", rules, grants, sales: [] }, "2025-12-31")).toBeCloseTo(76 / 142, 12);
    expect(rsuLiquidity({ plan: "tiktok", rules, grants: [], sales: [] }, "2025-12-31")).toBe(0);
  });

  it("prices a sale to the cent, before tax and after it when a rate is given", () => {
    expect(rsuProceeds(123, 161.17)).toEqual({ gross: 19823.91, tax: null, net: null });
    // 19,823.91 × 22% is 4,361.2602.
    expect(rsuProceeds(123, 161.17, 0.22)).toEqual({ gross: 19823.91, tax: 4361.26, net: 15462.65 });
  });
});

describe("reading what is stored", () => {
  it("checks the rules and puts them in order", () => {
    const parsed = parseRsuRules({ ...rules, windows: { months: [9, 3], cutoff_day: 15 }, verified_through: undefined });
    expect(parsed).toEqual({ rules: { ...rules, windows: { months: [3, 9], cutoff_day: 15 }, verified_through: null } });
  });

  it("says what is wrong with rules that will not do", () => {
    const bad: Array<[unknown, RegExp]> = [
      [null, /must be an object/],
      [{ ...rules, currency: "XYZ" }, /currency/],
      [{ ...rules, windows: { months: [13], cutoff_day: 1 } }, /months/],
      [{ ...rules, windows: { months: [3, 3], cutoff_day: 1 } }, /each once/],
      [{ ...rules, windows: { months: [3], cutoff_day: 31 } }, /cutoff_day/],
      [{ ...rules, profiles: {} }, /at least one profile/],
      [{ ...rules, profiles: { "Bad Name": { rates: [50] } } }, /lowercase/],
      [{ ...rules, profiles: { p: { rates: [] } } }, /rates/],
      [{ ...rules, profiles: { p: { rates: [120] } } }, /rates/],
      [{ ...rules, profiles: { p: { rates: [50.123] } } }, /two decimal places/],
      [{ ...rules, verified_through: "2027-02-30" }, /verified_through/],
    ];
    for (const [value, message] of bad) {
      const parsed = parseRsuRules(value);
      expect("problem" in parsed && parsed.problem, JSON.stringify(value)).toMatch(message);
    }
  });

  it("reads rules typed as JSON, and says why when they will not do", () => {
    expect(rulesFromText(JSON.stringify(rules, null, 2))).toEqual({ rules });
    expect(rulesFromText("  \n")).toEqual({ problem: "Paste the plan's rules, as JSON" });
    expect(rulesFromText("{currency: USD}")).toEqual({ problem: "The rules are not JSON: check the brackets, quotes and commas" });
    expect(rulesFromText(JSON.stringify({ ...rules, profiles: {} }))).toEqual({ problem: "rsu_rules.profiles must name at least one profile" });
  });

  it("takes tranches in any order, and refuses a day twice or a share that is not whole", () => {
    expect(parseTranches([{ vests_on: "2026-04-10", shares: 6 }, { vests_on: "2026-01-10", shares: 5 }]))
      .toEqual({ tranches: [{ vests_on: "2026-01-10", shares: 5 }, { vests_on: "2026-04-10", shares: 6 }] });
    for (const bad of [[], [{ vests_on: "2026-02-30", shares: 1 }], [{ vests_on: "2026-01-01", shares: 1.5 }], [{ vests_on: "2026-01-01", shares: 0 }],
      [{ vests_on: "2026-01-01", shares: 1 }, { vests_on: "2026-01-01", shares: 2 }]]) {
      expect("problem" in parseTranches(bad), JSON.stringify(bad)).toBe(true);
    }
  });

  it("reads tranches as copied out of a page, a line each", () => {
    expect(tranchesFromText("2026-06-15  40\n\n2026-03-15\t1,050\n2026-09-15, 40\n")).toEqual({
      tranches: [{ vests_on: "2026-03-15", shares: 1050 }, { vests_on: "2026-06-15", shares: 40 }, { vests_on: "2026-09-15", shares: 40 }],
    });
    expect(tranchesFromText("2026-06-15 40\nlater 3")).toEqual({ problem: "Line 2: write the date and the shares, as 2026-06-15 40" });
  });
});
