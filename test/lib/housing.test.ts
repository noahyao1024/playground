import { describe, expect, it } from "vitest";
import { loanSchedule } from "@/lib/finance";
import {
  DEFAULT_INPUTS, InputError, additionalBuyerStampDuty, buyerStampDuty, changeOver, clampInputs, grossYield, hdbTowns, inputsFromMarket, latestPoint,
  nextQuarter, notesOn, ownerOccupierTax, paired, parseInputs, pointsOf, quarterLabel, quarterNumber, quarterOfDay, quarterStart, quarterYear, readInputs,
  bankRateChanges, rentOrBuy, sellerStampDuty, steadyEconomy, townLabel, townTable, valueIn, withinLimits, yearlyGrowth,
  type Economy, type MarketData, type MarketSeries, type ScenarioInputs,
} from "@/lib/housing";

describe("quarters", () => {
  it("turns a quarter into its first day and back, and nothing else into one", () => {
    expect(quarterStart("2026-Q2")).toBe("2026-04-01");
    expect(quarterStart("2026-Q4")).toBe("2026-10-01");
    expect(quarterStart("2026-Q1")).toBe("2026-01-01");
    for (const bad of ["2026-Q5", "2026-Q0", "2026Q2", "26-Q2", "2026-q2", ""]) expect(quarterStart(bad), bad).toBeNull();
    for (const day of ["2026-01-01", "2026-03-31", "2026-04-01", "2026-12-31"]) {
      expect(quarterStart(quarterOfDay(day))! <= day).toBe(true);
    }
    expect(quarterOfDay("2026-12-31")).toBe("2026-Q4");
  });

  it("counts on across a year, and places a quarter on a time axis", () => {
    expect(nextQuarter("2025-Q4")).toBe("2026-Q1");
    expect(nextQuarter("2026-Q1")).toBe("2026-Q2");
    expect(quarterNumber("2026-Q1") - quarterNumber("2025-Q4")).toBe(1);
    expect(quarterYear("2026-Q2")).toBe(2026.25);
    expect(quarterLabel("2026-Q2")).toBe("Q2 2026");
  });
});

/** A series from `start`, a value a quarter, null for none. */
const series = (s: MarketSeries["series"], area: string, segment: string, start: string, values: Array<number | null>): MarketSeries =>
  ({ series: s, area, segment, start, values });
/** `n` quarters growing from `from` by `step` each. */
const rising = (n: number, from: number, step: number) => Array.from({ length: n }, (_, i) => from + i * step);

describe("the market's figures", () => {
  // Bedok: 41 quarters from 2016 Q2 to 2026 Q2. Yishun: prices only. Clementi:
  // both, but the last pair two years before anyone else's.
  const market: MarketData = {
    refreshed_at: null,
    series: [
      series("hdb_resale", "BEDOK", "4-room", "2016-Q2", rising(41, 400_000, 5_000)),
      series("hdb_rent", "BEDOK", "4-room", "2016-Q2", [...rising(40, 2_000, 25), 3_000]),
      series("hdb_resale", "YISHUN", "4-room", "2024-Q1", [450_000, null, 470_000]),
      series("hdb_resale", "CLEMENTI", "4-room", "2023-Q1", [600_000, 610_000]),
      series("hdb_rent", "CLEMENTI", "4-room", "2023-Q1", [2_800, 2_900]),
      series("hdb_resale", "TAMPINES", "5-room", "2025-Q1", [700_000]),
      series("hdb_rpi", "ALL", "all", "2016-Q2", rising(41, 100, 2.5)),
      series("ura_ppi", "OCR", "non-landed", "2016-Q2", rising(41, 100, 5)),
      series("ura_rri", "OCR", "non-landed", "2016-Q2", rising(41, 100, 2)),
    ],
  };
  const find = (s: string, area: string, segment: string) => market.series.find((x) => x.series === s && x.area === area && x.segment === segment);

  it("reads a series' values by quarter, passing over the gaps", () => {
    const yishun = find("hdb_resale", "YISHUN", "4-room");
    expect(pointsOf(yishun)).toEqual([{ quarter: "2024-Q1", value: 450_000 }, { quarter: "2024-Q3", value: 470_000 }]);
    expect(valueIn(yishun, "2024-Q2")).toBeNull();
    expect(valueIn(yishun, "2024-Q3")).toBe(470_000);
    expect(valueIn(yishun, "2030-Q1")).toBeNull();
    expect(latestPoint(yishun)).toEqual({ quarter: "2024-Q3", value: 470_000 });
    expect(latestPoint(undefined)).toBeNull();
  });

  it("measures a move from the value years back, or the last before it within half a year", () => {
    const rpi = find("hdb_rpi", "ALL", "all");
    // 2016 Q2 at 100 to 2026 Q2 at 200.
    expect(changeOver(rpi, 10)).toBeCloseTo(1, 10);
    expect(yearlyGrowth(rpi, 10)).toBeCloseTo(2 ** 0.1 - 1, 10);
    const gappy = series("hdb_rpi", "ALL", "all", "2016-Q1", [100, null, ...Array(39).fill(null), 150]);
    // Ten years before 2026 Q2 is 2016 Q2, missing; 2016 Q1 is a quarter earlier.
    expect(changeOver(gappy, 10)).toBeCloseTo(0.5, 10);
    // Further back than that, there is nothing to measure from.
    expect(changeOver(series("hdb_rpi", "ALL", "all", "2016-Q1", [100, ...Array(42).fill(null), 150]), 10)).toBeNull();
    expect(changeOver(find("hdb_resale", "YISHUN", "4-room"), 5)).toBeNull();
  });

  it("pairs prices with rents only where a quarter has both, and works the yield out of them", () => {
    const bedok = paired(find("hdb_resale", "BEDOK", "4-room"), find("hdb_rent", "BEDOK", "4-room"));
    expect(bedok).toHaveLength(41);
    expect(bedok.at(-1)).toEqual({ quarter: "2026-Q2", a: 600_000, b: 3_000 });
    expect(paired(find("hdb_resale", "BEDOK", "4-room"), find("hdb_rent", "BEDOK", "4-room"), "2026-Q1").map((p) => p.quarter)).toEqual(["2026-Q1", "2026-Q2"]);
    expect(grossYield(600_000, 3_000)).toBeCloseTo(0.06, 12);
  });

  it("lists the towns with figures for a flat type, and ranks a pair only while it is fresh", () => {
    expect(hdbTowns(market, "4-room")).toEqual(["BEDOK", "CLEMENTI", "YISHUN"]);
    expect(hdbTowns(market)).toEqual(["BEDOK", "CLEMENTI", "TAMPINES", "YISHUN"]);
    const rows = townTable(market, "4-room");
    expect(rows.find((r) => r.town === "BEDOK")).toMatchObject({ quarter: "2026-Q2", price: 600_000, rent: 3_000, yield: 0.06 });
    // A price and no rent: nothing to rank by.
    expect(rows.find((r) => r.town === "YISHUN")).toMatchObject({ quarter: null, yield: null });
    // Both, but two years older than the newest price anywhere: not set beside today's.
    expect(rows.find((r) => r.town === "CLEMENTI")).toMatchObject({ quarter: null, price: null, rent: null, yield: null });
    expect(rows.find((r) => r.town === "BEDOK")!.priceChange).toBeCloseTo(600_000 / 500_000 - 1, 12);
  });

  it("fills a comparison in from a town's medians and their growth, or from URA's indices", () => {
    expect(inputsFromMarket(market, { kind: "hdb", town: "BEDOK", flatType: "4-room" })).toEqual({
      kind: "hdb",
      price: 600_000,
      rent: 3_000,
      annual_value: 36_000,
      // 400,000 to 600,000 over ten years, and 2,000 to 3,000.
      growth: 4.1,
      rent_growth: 4.1,
    });
    // Clementi's own series are too short for ten years: HDB's index stands in
    // for the price, and the rent's growth is left alone.
    expect(inputsFromMarket(market, { kind: "hdb", town: "CLEMENTI", flatType: "4-room" })).toEqual({
      kind: "hdb", price: 610_000, rent: 2_900, annual_value: 34_800, growth: 7.2,
    });
    expect(inputsFromMarket(market, { kind: "private", area: "OCR", segment: "non-landed" })).toEqual({
      // 100 to 300 and 100 to 180 over ten years.
      kind: "private", market: "OCR:non-landed", loan_type: "bank", growth: 11.6, rent_growth: 6.1,
    });
    // A market URA's indices do not divide homes into is no market.
    expect(inputsFromMarket(market, { kind: "private", area: "OCR", segment: "landed" })).toEqual({ kind: "private", loan_type: "bank" });
  });

  it("writes a town as people do", () => {
    expect(townLabel("KALLANG/WHAMPOA")).toBe("Kallang/Whampoa");
    expect(townLabel("ANG MO KIO")).toBe("Ang Mo Kio");
    expect(townLabel("CENTRAL")).toBe("Central");
  });
});

describe("stamp duties and property tax", () => {
  it("charges BSD in IRAS's bands, rounded down to the dollar", () => {
    expect(buyerStampDuty(600_000)).toBe(12_600);
    expect(buyerStampDuty(1_000_000)).toBe(24_600);
    expect(buyerStampDuty(1_500_000)).toBe(44_600);
    expect(buyerStampDuty(3_000_000)).toBe(119_600);
    expect(buyerStampDuty(4_000_000)).toBe(179_600);
    // 1,800 and 2% of 75: 1,801.50, rounded down.
    expect(buyerStampDuty(180_075)).toBe(1_801);
  });

  it("charges ABSD by who buys and which home of theirs it is", () => {
    const at = (residency: "citizen" | "pr" | "foreigner", nth: number) => additionalBuyerStampDuty(1_000_000, residency, nth);
    expect([at("citizen", 1), at("citizen", 2), at("citizen", 3)]).toEqual([0, 200_000, 300_000]);
    expect([at("pr", 1), at("pr", 2), at("pr", 3)]).toEqual([50_000, 300_000, 350_000]);
    expect([at("foreigner", 1), at("foreigner", 2), at("foreigner", 3)]).toEqual([600_000, 600_000, 600_000]);
    // A fifth home is a third or later.
    expect(at("pr", 5)).toBe(350_000);
  });

  it("charges SSD on a sale within four years of buying, a year to the day still that year", () => {
    const at = (years: number) => sellerStampDuty(1_000_000, years);
    expect([at(0), at(1), at(1.5), at(2), at(3), at(4), at(4.01), at(10)]).toEqual([160_000, 160_000, 120_000, 120_000, 80_000, 40_000, 0, 0]);
  });

  it("taxes a home its owner lives in at the 2025 owner-occupier rates", () => {
    // IRAS's own table: the tax payable at the top of each band.
    expect(ownerOccupierTax(12_000)).toBe(0);
    expect(ownerOccupierTax(40_000)).toBe(1_120);
    expect(ownerOccupierTax(50_000)).toBe(1_720);
    expect(ownerOccupierTax(75_000)).toBe(4_220);
    expect(ownerOccupierTax(85_000)).toBe(5_620);
    expect(ownerOccupierTax(100_000)).toBe(8_620);
    expect(ownerOccupierTax(140_000)).toBe(19_020);
    expect(ownerOccupierTax(150_000)).toBe(22_220);
    expect(ownerOccupierTax(0)).toBe(0);
  });
});

describe("parseInputs", () => {
  it("takes what is given and the defaults for the rest", () => {
    expect(parseInputs({})).toEqual(DEFAULT_INPUTS);
    expect(parseInputs({ residency: "citizen", price: 1_200_000, years: 20 })).toEqual({ ...DEFAULT_INPUTS, residency: "citizen", price: 1_200_000, years: 20 });
  });

  it("refuses a choice not among its own, a number out of reason, and a fraction of a year", () => {
    for (const bad of [
      null, [], "inputs",
      { residency: "tourist" }, { kind: "hotel" }, { loan_type: "friend" },
      { price: "600000" }, { price: Number.NaN }, { price: 5_000 }, { loan_share: 95 }, { loan_rate: -1 },
      { years: 0 }, { years: 100 }, { years: 10.5 }, { nth: 1.5 }, { nth: 4 }, { growth: 50 },
      { market: "Punggol" }, { market: "OCR:landed" }, { auto: "growth" }, { auto: ["growth", "price"] }, { auto: [1] },
    ]) {
      expect(() => parseInputs(bad), JSON.stringify(bad)).toThrow(InputError);
    }
  });

  it("takes a private home's market, and the inputs left to the market's estimates, in their own order and once each", () => {
    expect(parseInputs({ kind: "private", market: "OCR:non-landed" })).toEqual({ ...DEFAULT_INPUTS, kind: "private", market: "OCR:non-landed" });
    expect(parseInputs({ auto: ["invest_return", "growth", "growth"] }).auto).toEqual(["growth", "invest_return"]);
    expect(parseInputs({ auto: [] }).auto).toEqual([]);
    // A scenario kept before the estimates keeps its own numbers.
    expect(DEFAULT_INPUTS.auto).toEqual([]);
  });
});

describe("readInputs", () => {
  it("keeps every input that passes and puts the rest at their defaults, where parseInputs would refuse the lot", () => {
    const half = { price: 900_000, years: 0, residency: "citizen", kind: "castle", rent: "3,000" };
    expect(() => parseInputs(half)).toThrow(InputError);
    expect(readInputs(half)).toEqual({ ...DEFAULT_INPUTS, price: 900_000, residency: "citizen" });
    for (const nothing of [null, "x", [], 42]) expect(readInputs(nothing)).toEqual(DEFAULT_INPUTS);
    expect(readInputs({ ...DEFAULT_INPUTS, rent: 4_000 })).toEqual({ ...DEFAULT_INPUTS, rent: 4_000 });
    expect(readInputs({ auto: ["growth", "nonsense"], market: "RCR:non-landed", price: 1 })).toEqual({ ...DEFAULT_INPUTS, market: "RCR:non-landed" });
  });
});

describe("clampInputs", () => {
  it("brings a form half filled in within reason, and leaves one already there alone", () => {
    expect(clampInputs(DEFAULT_INPUTS)).toEqual(DEFAULT_INPUTS);
    const typed = { ...DEFAULT_INPUTS, years: 0, loan_years: 12.6, price: 5, loan_share: 120, growth: Number.NaN, rent: -1 };
    expect(clampInputs(typed)).toEqual({ ...DEFAULT_INPUTS, years: 1, loan_years: 13, price: 10_000, loan_share: 90, growth: DEFAULT_INPUTS.growth, rent: 0 });
    // What is clamped passes the server's check.
    expect(parseInputs(clampInputs(typed))).toEqual(clampInputs(typed));
    expect([withinLimits("years", 0), withinLimits("years", 1), withinLimits("years", 1.5), withinLimits("growth", -20), withinLimits("price", Number.NaN)])
      .toEqual([false, true, false, true, false]);
  });
});

describe("rentOrBuy", () => {
  const base: ScenarioInputs = { ...DEFAULT_INPUTS, residency: "pr", kind: "private", loan_type: "bank", price: 1_000_000, renovation: 0, buy_costs: 0 };

  it("works out the money up front, CPF paying what it may: the down payment past a bank's 5% in cash, and BSD", () => {
    const bank = rentOrBuy({ ...base, cpf_balance: 300_000, buy_costs: 5_000, renovation: 30_000 }).upfront;
    expect(bank).toEqual({
      down_payment: 250_000, loan: 750_000, bsd: 24_600, absd: 50_000, buy_costs: 5_000, renovation: 30_000,
      total: 359_600, from_cpf: 224_600, from_cash: 135_000,
    });
    // HDB's loan wants no cash: CPF may pay the whole down payment.
    const hdb = rentOrBuy({ ...base, kind: "hdb", loan_type: "hdb", cpf_balance: 300_000, buy_costs: 5_000, renovation: 30_000 }).upfront;
    expect(hdb).toMatchObject({ from_cpf: 274_600, from_cash: 85_000 });
    // Less in CPF than it may pay: all of it goes in.
    expect(rentOrBuy({ ...base, cpf_balance: 10_000 }).upfront).toMatchObject({ from_cpf: 10_000, from_cash: 314_600 });
  });

  it("pays the loan as loanSchedule schedules it: a level instalment, to the cent", () => {
    const p = rentOrBuy({ ...base, price: 600_000, loan_share: 75, loan_rate: 2.6, loan_years: 25 });
    const r = 2.6 / 1200;
    expect(p.instalment).toBeCloseTo((450_000 * r) / (1 - (1 + r) ** -300), 2);
    // Paid off by the end of its term, and nothing owed after.
    const long = rentOrBuy({ ...base, loan_years: 10, years: 12 });
    expect(long.years[10].loan_balance).toBe(0);
    expect(long.years[11].own_monthly).toBeLessThan(long.years[10].own_monthly);
    // Year 12's months are the twelfth year's: rents, and so the annual value, grown eleven times.
    // Its running costs, as prices in general have grown eleven times too.
    expect(long.years[12].own_monthly).toBeCloseTo((base.maintenance + base.upkeep / 12) * 1.025 ** 11 + ownerOccupierTax(base.annual_value * 1.02 ** 11) / 12, 2);
  });

  it("keeps every dollar: with nothing earning and nothing growing, the gap is the rent paid less what owning has cost and the duty on selling", () => {
    const flat: ScenarioInputs = { ...base, growth: 0, invest_return: 0, sell_costs: 0, cpf_rate: 0, rent_growth: 3, buy_costs: 4_000, renovation: 20_000, years: 8 };
    const p = rentOrBuy(flat);
    for (const y of p.years) {
      const gap = y.buy_net_worth - y.rent_net_worth;
      expect(gap, `year ${y.year}`).toBeCloseTo(y.rent_spent - y.own_spent - sellerStampDuty(flat.price, y.year), 1);
    }
    // At the start, buying is behind by its duties, fees and the duty on selling at once.
    expect(p.years[0].buy_net_worth - p.years[0].rent_net_worth).toBeCloseTo(-(24_600 + 50_000 + 4_000 + 20_000 + 160_000), 6);
  });

  it("lets CPF pay the buyer's instalments, while the renter's stays in the account earning its rate", () => {
    // Rent above every month of owning, so the renter saves nothing and the
    // buyer the difference; no investment return, so only CPF grows.
    const i: ScenarioInputs = { ...base, invest_return: 0, growth: 0, maintenance: 0, upkeep: 0, annual_value: 0, rent: 5_000, rent_growth: 0, cpf_balance: 100_000, cpf_monthly: 4_000, years: 1 };
    const p = rentOrBuy(i);
    const year = p.years[1];
    // The renter: the cash the buyer put in, untouched, and CPF a year on --
    // 100,000 at 2.5% and 4,000 a month.
    const months = Array.from({ length: 12 }, (_, k) => 4_000 * 1.025 ** ((11 - k) / 12)).reduce((a, b) => a + b, 0);
    expect(year.rent_net_worth).toBeCloseTo(p.upfront.from_cash + 100_000 * 1.025 + months, 0);
    // The buyer: every instalment from CPF, so the rent's 5,000 a month saved
    // whole, and what CPF paid owed back to it on a sale, with the interest it
    // would have earned.
    const paid = 100_000 * 1.025 + 12 * p.instalment;
    expect(year.cpf_refund).toBeGreaterThan(paid);
    expect(year.cpf_refund).toBeLessThan(100_000 * 1.025 + 12 * p.instalment * 1.025);
    // Its cash: the 5,000 a month the renter spends, all of it saved. Its CPF:
    // each month's 4,000, less the instalment, left in the account to grow.
    let cpf = 0;
    for (let m = 0; m < 12; m++) {
      cpf = cpf * 1.025 ** (1 / 12) + 4_000;
      cpf -= Math.min(cpf, p.instalment);
    }
    expect(year.buy_net_worth).toBeCloseTo(i.price - year.loan_balance - year.sale_costs + 12 * 5_000 + cpf, 1);
  });

  it("finds the first year buying is ahead, or none", () => {
    const p = rentOrBuy({ ...DEFAULT_INPUTS, years: 20 });
    expect(p.break_even).not.toBeNull();
    const at = p.years[p.break_even!];
    const before = p.years[p.break_even! - 1];
    expect(at.buy_net_worth).toBeGreaterThanOrEqual(at.rent_net_worth);
    expect(before.buy_net_worth).toBeLessThan(before.rent_net_worth);
    // Cheap rent, a home that never gains and money that does: never.
    expect(rentOrBuy({ ...DEFAULT_INPUTS, rent: 800, growth: 0, invest_return: 6 }).break_even).toBeNull();
  });

  it("grows the rent, the home and its annual value a year at a time, and taxes the value", () => {
    const p = rentOrBuy({ ...base, rent: 4_000, rent_growth: 10, growth: 5, annual_value: 48_000, years: 3, loan_share: 0 });
    expect(p.years.map((y) => Math.round(y.rent_monthly))).toEqual([4_000, 4_000, 4_400, 4_840]);
    expect(p.years[3].home_value).toBeCloseTo(1_000_000 * 1.05 ** 3, 2);
    // No loan: a month of owning is the year's tax, and the running costs grown with prices twice.
    expect(p.years[3].own_monthly).toBeCloseTo(ownerOccupierTax(48_000 * 1.1 ** 2) / 12 + (base.upkeep / 12 + base.maintenance) * 1.025 ** 2, 2);
    expect(p.instalment).toBe(0);
  });
});

describe("rentOrBuy in a moving economy", () => {
  const base: ScenarioInputs = { ...DEFAULT_INPUTS, residency: "pr", kind: "private", loan_type: "bank", price: 1_000_000, loan_rate: 2, spread: 0.5, lock_years: 2, years: 6 };
  const months = base.years * 12;
  /** The steady economy, with some of its paths replaced. */
  const economy = (i: ScenarioInputs, change: Partial<Economy>): Economy => ({ ...steadyEconomy(i), ...change });
  const flat = (value: number) => Array(months + 1).fill(value);

  it("is the steady comparison when the economy is the steady one", () => {
    expect(rentOrBuy(base, steadyEconomy(base))).toEqual(rentOrBuy(base));
    expect(rentOrBuy(DEFAULT_INPUTS, steadyEconomy(DEFAULT_INPUTS))).toEqual(rentOrBuy(DEFAULT_INPUTS));
  });

  it("fixes a bank loan's rate for its lock-in, then charges SORA and the spread, resetting the instalment every three months", () => {
    // SORA at 1% for two years, then 3%, then 2% from the fourth year.
    const sora = Array.from({ length: months + 1 }, (_, m) => (m <= 24 ? 1 : m <= 36 ? 3 : 2));
    const p = rentOrBuy(base, economy(base, { sora }));
    expect(p.years.map((y) => y.loan_rate)).toEqual([2, 2, 2, 3.5, 2.5, 2.5, 2.5]);
    expect(bankRateChanges(base, sora, base.loan_years * 12).slice(0, 2)).toEqual([
      { effective_date: "2028-01-01", rate: 3.5, payment: null },
      { effective_date: "2029-01-01", rate: 2.5, payment: null },
    ]);
    // The instalment rises with the rate, and the loan still clears in its term.
    const periods = loanSchedule({ principal: 750_000, rate: 2, start: "2026-01-01", months: base.loan_years * 12, method: "annuity", rateChanges: bankRateChanges(base, sora, base.loan_years * 12) }).periods;
    expect(periods[24].payment).toBeGreaterThan(periods[23].payment);
    expect(periods.at(-1)!.balance).toBe(0);
    expect(periods).toHaveLength(base.loan_years * 12);
    // An HDB loan pays its own rate whatever SORA does.
    expect(rentOrBuy({ ...base, loan_type: "hdb", kind: "hdb", loan_rate: 2.6 }, economy(base, { sora })).years.map((y) => y.loan_rate)).toEqual(Array(7).fill(2.6));
  });

  it("renews the lease each year at the market rent then, and moves the annual value with it", () => {
    // The market jumps 20% halfway through the second year.
    const rent = Array.from({ length: months + 1 }, (_, m) => (m < 18 ? 1 : 1.2));
    const p = rentOrBuy({ ...base, rent_costs: 0 }, economy(base, { rent }));
    expect(p.monthly.map((m) => m.rent)).toEqual([3000, 3000, 3600, 3600, 3600, 3600]);
    expect(p.years[3].own_monthly - p.years[2].own_monthly).toBeCloseTo((ownerOccupierTax(base.annual_value * 1.2) - ownerOccupierTax(base.annual_value)) / 12 + (base.maintenance + base.upkeep / 12) * (1.025 ** 2 - 1.025), 2);
  });

  it("grows the running costs with prices in general, set each year", () => {
    // Rents held, so the property tax on the annual value stays put.
    const costs = Array.from({ length: months + 1 }, (_, m) => (m < 24 ? 1 : 1.5));
    const p = rentOrBuy({ ...base, loan_share: 0 }, economy(base, { costs, rent: flat(1) }));
    const running = base.maintenance + base.upkeep / 12;
    expect(p.monthly[1].running - p.monthly[0].running).toBeCloseTo(0, 6);
    expect(p.monthly[2].running - p.monthly[1].running).toBeCloseTo(running * 0.5, 2);
  });

  it("earns what the economy's investments earn, month by month", () => {
    // Nothing earned but 10% in the twelfth month; rent dear enough that the renter saves nothing.
    const invest = Array.from({ length: months + 1 }, (_, m) => (m === 12 ? 0.1 : 0));
    const i = { ...base, rent: 10_000, cpf_balance: 0 };
    const p = rentOrBuy(i, economy(i, { invest }));
    expect(p.years[1].rent_net_worth).toBeCloseTo(p.upfront.from_cash * 1.1, 2);
  });
});

describe("a month of owning, taken apart", () => {
  const base: ScenarioInputs = { ...DEFAULT_INPUTS, residency: "pr", kind: "private", loan_type: "bank", price: 1_000_000, renovation: 20_000, buy_costs: 4_000 };

  it("splits what goes out into principal, interest and running costs, and the cost into all but the principal", () => {
    const p = rentOrBuy(base);
    expect(p.monthly.map((m) => m.year)).toEqual(Array.from({ length: base.years }, (_, k) => k + 1));
    for (const m of p.monthly) {
      expect(m.principal + m.interest + m.running, `year ${m.year}`).toBeCloseTo(m.paid, 1);
      expect(m.interest + m.running + m.one_off + m.opportunity - m.appreciation, `year ${m.year}`).toBeCloseTo(m.net, 1);
    }
    // Year one: the loan's first twelve repayments, a month on average.
    const periods = loanSchedule({ principal: 750_000, rate: base.loan_rate, start: "2026-01-01", months: base.loan_years * 12, method: "annuity" }).periods.slice(0, 12);
    expect(p.monthly[0].principal).toBeCloseTo(periods.reduce((a, x) => a + x.principal, 0) / 12, 2);
    expect(p.monthly[0].interest).toBeCloseTo(periods.reduce((a, x) => a + x.interest, 0) / 12, 2);
    expect(p.monthly[0].rent).toBe(base.rent);
  });

  it("adds up, with nothing earning, to the gap between the two at the end", () => {
    const i: ScenarioInputs = { ...base, invest_return: 0, cpf_rate: 0, cpf_balance: 60_000, cpf_monthly: 900, growth: 2.5, rent_growth: 3, rent_costs: 1_200, years: 12 };
    const p = rentOrBuy(i);
    const end = p.years[i.years];
    const gap = end.buy_net_worth - end.rent_net_worth;
    const months = p.monthly.reduce((sum, m) => sum + 12 * (m.rent - m.net), 0);
    expect(Math.abs(months - gap)).toBeLessThan(2);
  });

  it("spreads the one-off costs, selling's at the end with its stamp duty, over every month looked at", () => {
    const sold = (years: number) => {
      const value = base.price * (1 + base.growth / 100) ** years;
      return value * (base.sell_costs / 100) + sellerStampDuty(value, years);
    };
    for (const years of [3, 15]) {
      const p = rentOrBuy({ ...base, years });
      expect(p.monthly[0].one_off, `${years} years`).toBeCloseTo((24_600 + 50_000 + 4_000 + 20_000 + sold(years)) / (years * 12), 1);
    }
  });

  it("counts what the money in the home would have earned -- cash at the investment return, CPF at its own -- and the principal as it goes in", () => {
    const g = (rate: number) => (1 + rate / 100) ** (1 / 12) - 1;
    // No loan: the money in the home is all paid on buying, and stays put.
    const cash = rentOrBuy({ ...base, loan_share: 0, invest_return: 6 });
    expect(cash.monthly[0].opportunity).toBeCloseTo(cash.upfront.from_cash * g(6), 1);
    const cpf = rentOrBuy({ ...base, loan_share: 0, invest_return: 6, cpf_balance: 100_000, cpf_rate: 2.5 });
    expect(cpf.monthly[0].opportunity).toBeCloseTo(cpf.upfront.from_cash * g(6) + 100_000 * g(2.5), 1);
    // With a loan, each repayment's principal joins it; in cash here, none from CPF.
    const loaned = rentOrBuy({ ...base, invest_return: 6 });
    const periods = loanSchedule({ principal: 750_000, rate: base.loan_rate, start: "2026-01-01", months: base.loan_years * 12, method: "annuity" }).periods;
    let inHome = loaned.upfront.from_cash, earned = 0;
    for (const x of periods.slice(0, 12)) {
      earned += inHome * g(6);
      inHome += x.principal;
    }
    expect(loaned.monthly[0].opportunity).toBeCloseTo(earned / 12, 1);
  });

  it("sets the home's rise in value against the costs, a year's rise a month on average", () => {
    const p = rentOrBuy({ ...base, growth: 4 });
    expect(p.monthly[0].appreciation).toBeCloseTo((base.price * 0.04) / 12, 1);
    expect(p.monthly[1].appreciation).toBeCloseTo((base.price * 1.04 * 0.04) / 12, 1);
    expect(rentOrBuy({ ...base, growth: -2 }).monthly[0].appreciation).toBeLessThan(0);
  });
});

describe("notesOn", () => {
  it("says what the rules may not allow, and refuses nothing", () => {
    expect(notesOn({ ...DEFAULT_INPUTS, residency: "citizen" })).toEqual([]);
    expect(notesOn({ ...DEFAULT_INPUTS, residency: "foreigner" }).join(" ")).toMatch(/Foreigners cannot buy HDB flats/);
    expect(notesOn({ ...DEFAULT_INPUTS, residency: "pr" }).join(" ")).toMatch(/resale market only/);
    expect(notesOn({ ...DEFAULT_INPUTS, residency: "citizen", years: 3 }).join(" ")).toMatch(/minimum occupation period/);
    expect(notesOn({ ...DEFAULT_INPUTS, residency: "citizen", kind: "private" }).join(" ")).toMatch(/HDB lends only for HDB flats/);
    expect(notesOn({ ...DEFAULT_INPUTS, residency: "citizen", loan_share: 80 }).join(" ")).toMatch(/more than 75%/);
    expect(notesOn({ ...DEFAULT_INPUTS, residency: "citizen", loan_years: 30 }).join(" ")).toMatch(/at most 25 years/);
    expect(notesOn({ ...DEFAULT_INPUTS, residency: "foreigner", kind: "private", loan_type: "bank", cpf_monthly: 100 }).join(" ")).toMatch(/no CPF/);
    // The figures go ahead regardless.
    expect(rentOrBuy({ ...DEFAULT_INPUTS, residency: "foreigner" }).upfront.absd).toBe(360_000);
  });
});
