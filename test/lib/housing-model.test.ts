import { describe, expect, it } from "vitest";
import {
  DEFAULT_INPUTS, EQUITY_SEGMENT, quarterFromNumber, quarterNumber, rentOrBuy, steadyEconomy,
  type MarketData, type MarketSeries, type ScenarioInputs,
} from "@/lib/housing";
import {
  PATHS, drawEconomy, estimatesFor, expectedEconomy, hdbRentChanges, marketModel, quantile, randomStream, simulate, stressed, summarize,
  withEstimates, type Model, type Outcome, type SoraOutlook, type Step,
} from "@/lib/housing-model";

/** A series from `start`, its value each quarter `from` grown by `rate(k)` --
 *  a fraction -- into the k-th quarter after. */
function grown(s: MarketSeries["series"], area: string, segment: string, start: string, n: number, rate: (k: number) => number, from = 100): MarketSeries {
  const values = [from];
  for (let k = 1; k < n; k++) values.push(values[k - 1] * (1 + rate(k)));
  return { series: s, area, segment, start, values };
}
/** A series of the values given, from `start`. */
const series = (s: MarketSeries["series"], area: string, segment: string, start: string, values: Array<number | null>): MarketSeries =>
  ({ series: s, area, segment, start, values });
/** A yearly rate as a quarter's: 0.02 a year is about 0.005 a quarter. */
const quarterly = (yearly: number) => (1 + yearly) ** 0.25 - 1;
const at = (start: string, k: number) => quarterFromNumber(quarterNumber(start) + k);

describe("quantile", () => {
  it("reads between neighbours, and is nothing without values", () => {
    expect([0, 0.1, 0.25, 0.5, 1].map((p) => quantile([1, 2, 3, 4, 5], p))).toEqual([1, 1.4, 2, 3, 5]);
    expect(quantile([7], 0.9)).toBe(7);
    expect(quantile([], 0.5)).toBeNaN();
  });
});

describe("the estimates, from ten-year spans", () => {
  // 49 quarters: the first 8 grow at 10% a year, the 40 after at 2%. Its nine
  // ten-year spans, least first, hold 0, 1, ... 8 of the fast quarters: the
  // lower quartile is the third, with 2; the middle one the fifth, with 4.
  const two = Math.log(1.02) / 4, ten = Math.log(1.1) / 4;
  const span = (fast: number) => Math.exp((fast * ten + (40 - fast) * two) / 10) - 1;
  const rate = (k: number) => (k <= 8 ? 0.1 : 0.02);
  const shares = grown("equity", "ALL", EQUITY_SEGMENT, "2003-Q4", 49, (k) => quarterly(rate(k)));
  const ppi = grown("ura_ppi", "OCR", "non-landed", "2004-Q1", 49, (k) => quarterly(rate(k)));
  const rri = grown("ura_rri", "OCR", "non-landed", "2004-Q1", 49, (k) => quarterly(rate(k)));
  const cpi = grown("cpi", "ALL", "all", "1990-Q1", 49, (k) => quarterly(rate(k)));
  const market: MarketData = { series: [shares, ppi, rri, cpi], refreshed_at: null };
  const pct = (r: number) => Math.round(r * 1000) / 10;
  /** The investments' estimate: the index's, less 0.3% a year for holding it. */
  const net = (r: number) => Math.round((pct(r) - 0.3) * 10) / 10;

  it("takes the investments and the home's price at the lower quartile, and says why", () => {
    const { estimates } = marketModel(market, { kind: "private", market: "OCR:non-landed" });
    expect(estimates.invest_return!.value).toBe(net(span(2)));
    expect(estimates.growth!.value).toBe(pct(span(2)));
    expect(span(2)).not.toBeCloseTo(span(4), 3);
    expect(estimates.invest_return!.reason).toBe(
      `The S&P 500 with dividends, in Singapore dollars, earned more than ${(span(2) * 100).toFixed(1)}% a year in three of every four ten-year spans since 2003, ${(span(4) * 100).toFixed(1)}% in the middle one. The lower figure is taken, to be conservative: the years ahead need not be as kind. Less 0.3% a year for holding it: the US tax withheld on its dividends and an index fund's fees.`,
    );
    expect(estimates.growth!.reason).toMatch(/^URA's price index for condos outside central grew more than 2\.4% a year .* since 2004, 2\.8% in the middle one\. The lower figure is taken, as the investments' is/);
  });

  it("takes rents and costs at the middle span", () => {
    const { estimates } = marketModel(market, { kind: "private", market: "OCR:non-landed" });
    expect(estimates.rent_growth!.value).toBe(pct(span(4)));
    expect(estimates.cost_growth!.value).toBe(pct(span(4)));
    expect(estimates.rent_growth!.reason).toBe(`URA's rental index for condos outside central grew ${(span(4) * 100).toFixed(1)}% a year over the middle ten-year span since 2004.`);
    expect(estimates.cost_growth!.reason).toMatch(/^Consumer prices rose 2\.8% a year over the middle ten-year span since 1990;/);
  });

  it("makes none from fewer than eight spans", () => {
    const short = { series: [{ ...shares, values: shares.values.slice(0, 47) }], refreshed_at: null };
    expect(marketModel(short, { kind: "hdb", market: "ALL:non-landed" }).estimates).toEqual({});
    const enough = { series: [{ ...shares, values: shares.values.slice(0, 48) }], refreshed_at: null };
    expect(marketModel(enough, { kind: "hdb", market: "ALL:non-landed" }).estimates.invest_return).toBeDefined();
  });

  it("bridges a quarter or two missing, and lets a longer gap break the spans", () => {
    const holed = (gap: number) => ({ series: [{ ...shares, values: shares.values.map((v, k) => (k >= 20 && k < 20 + gap ? null : v)) }], refreshed_at: null });
    // Moving evenly over the hole changes no span that spans it: the same nine.
    expect(marketModel(holed(2), { kind: "hdb", market: "ALL:non-landed" }).estimates.invest_return!.value).toBe(net(span(2)));
    expect(marketModel(holed(3), { kind: "hdb", market: "ALL:non-landed" }).estimates.invest_return).toBeUndefined();
  });

  it("reads a private market's rents island-wide where URA no longer publishes its own", () => {
    const stale = series("ura_rri", "ALL", "all", "2004-Q1", rri.values.slice(0, 40));
    const island = { ...rri, area: "ALL", segment: "non-landed" };
    const all = { ...ppi, area: "ALL", segment: "all" };
    const { estimates } = marketModel({ series: [all, stale, island], refreshed_at: null }, { kind: "private", market: "ALL:all" });
    expect(estimates.growth!.reason).toMatch(/^URA's price index for private homes/);
    expect(estimates.rent_growth!.reason).toMatch(/^URA's rental index for condos and apartments grew/);
  });
});

describe("HDB rents island-wide", () => {
  it("averages every median's change, in quarters with five or more of them", () => {
    // Four towns from 2010, a fifth from 2011; each grows at its own rate.
    const towns = [0.01, 0.02, 0.03, 0.04, 0.05].map((g, k) =>
      grown("hdb_rent", `TOWN ${k}`, "4-room", k < 4 ? "2010-Q1" : "2011-Q1", k < 4 ? 12 : 8, () => g, 2_000));
    const changes = hdbRentChanges({ series: towns, refreshed_at: null });
    const quarters = [...changes.keys()].sort((a, b) => a - b).map(quarterFromNumber);
    expect(quarters[0]).toBe("2011-Q2");
    expect(quarters.at(-1)).toBe("2012-Q4");
    const average = [0.01, 0.02, 0.03, 0.04, 0.05].reduce((a, g) => a + Math.log(1 + g), 0) / 5;
    for (const c of changes.values()) expect(c).toBeCloseTo(average, 12);
  });

  it("spreads a change over a quarter none of them published", () => {
    const towns = [0, 1, 2, 3, 4].map((k) => series("hdb_rent", `TOWN ${k}`, "3-room", "2019-Q2", [2_000, 2_000, null, 2_420]));
    const changes = hdbRentChanges({ series: towns, refreshed_at: null });
    expect(changes.get(quarterNumber("2019-Q4"))).toBeCloseTo(Math.log(1.1), 12);
    expect(changes.get(quarterNumber("2020-Q1"))).toBeCloseTo(Math.log(1.1), 12);
  });
});

describe("SORA's outlook", () => {
  // 40 quarters of SORA falling back toward 1% by a tenth of the way each
  // quarter, and every yield at a fixed premium over it -- but for the last
  // quarter, when the yields are up 0.4, 0.8, 2 and 4 points.
  const start = "2016-Q4";
  const sora = Array.from({ length: 40 }, (_, k) => 1 + 3 * 0.9 ** k);
  const premia = { 1: 0.2, 2: 0.3, 5: 0.6, 10: 1 } as const;
  const bump = { 1: 0.4, 2: 0.8, 5: 2, 10: 4 } as const;
  const yields = ([1, 2, 5, 10] as const).map((t) =>
    series("sgs", "ALL", `${t}y`, start, sora.map((s, k) => s + premia[t] + (k === 39 ? bump[t] : 0))));
  const market: MarketData = { series: [series("sora", "ALL", "3m", start, sora), ...yields], refreshed_at: null };
  const outlook = () => marketModel(market, { kind: "hdb", market: "ALL:non-landed" }).sora!;

  it("expects what the yields say, less the premium each has paid over SORA", () => {
    const s = outlook();
    const now = sora[39];
    expect(s.latest).toEqual({ quarter: at(start, 39), value: now });
    // Each premium takes in the last quarter's bump, a fortieth of it: SORA is
    // expected to average its level now and 0.975 of each bump until each term.
    const [f1, f2, f5, f10] = s.forwards.map((f) => f.rate);
    expect(f1).toBeCloseTo(now + 0.39, 10);
    expect(f2).toBeCloseTo(now + 1.17, 10);
    expect(f5).toBeCloseTo(now + 2.73, 10);
    expect(f10).toBeCloseTo(now + 5.85, 10);
    expect(s.forwards.map((f) => [f.from, f.to])).toEqual([[0, 1], [1, 2], [2, 5], [5, 10]]);
  });

  it("runs from SORA now through each span's rate at its middle, and holds the last", () => {
    const s = outlook();
    const [f1, f2, f5, f10] = s.forwards.map((f) => f.rate);
    expect(s.expected[0]).toBe(sora[39]);
    expect(s.expected[1]).toBeCloseTo((sora[39] + f1) / 2, 10);
    expect(s.expected[2]).toBeCloseTo(f1, 10);
    expect(s.expected[4]).toBeCloseTo((f1 + f2) / 2, 10);
    expect(s.expected[6]).toBeCloseTo(f2, 10);
    expect(s.expected[14]).toBeCloseTo(f5, 10);
    expect(s.expected[30]).toBeCloseTo(f10, 10);
    expect(s.expected[140]).toBeCloseTo(f10, 10);
    expect(s.expected).toHaveLength(397);
  });

  it("never expects less than nothing", () => {
    const low = yields.map((y) => ({ ...y, values: y.values.map((v, k) => (k === 39 ? 0.01 : v)) }));
    const s = marketModel({ series: [market.series[0], ...low], refreshed_at: null }, { kind: "hdb", market: "ALL:non-landed" }).sora!;
    expect(s.forwards.every((f) => f.rate >= 0)).toBe(true);
    expect(s.expected.every((v) => v >= 0)).toBe(true);
  });

  it("learns how SORA's departures fade from its own history, and how far a quarter moves it", () => {
    const s = outlook();
    expect(s.persistence).toBeCloseTo(0.9, 10);
    expect(s.shock).toBeCloseTo(0, 10);
    expect(s.since).toBe(2016);
    // A level that never comes back is taken to fade, if slowly.
    const climbing = series("sora", "ALL", "3m", start, sora.map((_, k) => 0.5 + 0.1 * k));
    expect(marketModel({ series: [climbing, ...yields], refreshed_at: null }, { kind: "hdb", market: "ALL:non-landed" }).sora!.persistence).toBe(0.99);
  });

  it("has nothing to say without twenty quarters, or a quarter the yields share", () => {
    const short = { series: [series("sora", "ALL", "3m", at(start, 21), sora.slice(21)), ...yields], refreshed_at: null };
    expect(marketModel(short, { kind: "hdb", market: "ALL:non-landed" }).sora).toBeNull();
    expect(marketModel({ series: [market.series[0]], refreshed_at: null }, { kind: "hdb", market: "ALL:non-landed" }).sora).toBeNull();
  });
});

/** A model by hand: every quarter of its history the same unless given, and
 *  SORA expected flat at 1%. */
function model(steps: Array<Partial<Step>>, sora: Partial<SoraOutlook> | null = {}): Model {
  const history = steps.map((s, k) => ({ quarter: at("2006-Q1", k), price: 0.02, rent: 0.01, costs: 0.005, invest: 0.03, sora: 0, ...s }));
  const mean = (key: "price" | "rent" | "costs" | "invest") => history.reduce((a, s) => a + s[key], 0) / history.length;
  return {
    history,
    mean: { price: mean("price"), rent: mean("rent"), costs: mean("costs"), invest: mean("invest") },
    sora: sora && {
      latest: { quarter: "2026-Q3", value: 1 },
      forwards: [],
      expected: Array(141).fill(1),
      persistence: 0.9,
      shock: 0,
      since: 2005,
      ...sora,
    },
    estimates: {},
  };
}
const calm = (n = 40) => model(Array.from({ length: n }, () => ({})));

describe("estimatesFor and withEstimates", () => {
  const bank: ScenarioInputs = { ...DEFAULT_INPUTS, kind: "private", loan_type: "bank", lock_years: 2, spread: 0.6 };

  it("prices a bank's fixed rate at SORA's expected average over the lock-in and what banks ask over it, whatever the spread after", () => {
    const expected = Array.from({ length: 141 }, (_, j) => 1 + j * 0.1);
    const m = model([{}], { expected, latest: { quarter: "2026-Q3", value: 1 } });
    // Eight quarters, each the average of its ends: 1.4 on average, and 0.3 over it.
    expect(estimatesFor(m, bank).loan_rate).toEqual({
      value: 1.7,
      reason: "Fixed for 2 years, priced as banks price it: SORA is expected to average 1.40% over them, and banks ask 0.30% over that. After, SORA and the 0.60% spread.",
    });
    // The spread is what is charged after the lock-in: it does not price the fixed rate.
    expect(estimatesFor(m, { ...bank, spread: 1.2 }).loan_rate!.value).toBe(1.7);
    expect(estimatesFor(m, { ...bank, lock_years: 1 }).loan_rate!.value).toBe(1.5);
    expect(estimatesFor(m, { ...bank, lock_years: 0 }).loan_rate).toEqual({
      value: 1.6,
      reason: "Floating from the start: SORA, 1.00% in Q3 2026, and the 0.60% spread.",
    });
  });

  it("gives an HDB loan HDB's rate, and a bank's nothing without SORA", () => {
    expect(estimatesFor(null, { ...DEFAULT_INPUTS, loan_type: "hdb" }).loan_rate!.value).toBe(2.6);
    expect(estimatesFor(model([{}], null), bank).loan_rate).toBeUndefined();
    expect(estimatesFor(null, bank)).toEqual({});
  });

  it("puts each input left to the market at its estimate, and leaves the rest", () => {
    const i = { ...bank, growth: 3, rent_growth: 2, invest_return: 5, auto: ["growth" as const, "invest_return" as const] };
    const estimates = { growth: { value: 1.9, reason: "" }, rent_growth: { value: 4, reason: "" } };
    expect(withEstimates(i, estimates)).toEqual({ ...i, growth: 1.9 });
  });
});

describe("the future expected", () => {
  it("is the steady one, but for SORA along the bond market's path", () => {
    const i: ScenarioInputs = { ...DEFAULT_INPUTS, years: 3 };
    expect(expectedEconomy(i, null)).toEqual(steadyEconomy(i));
    expect(expectedEconomy(i, model([{}], null))).toEqual(steadyEconomy(i));
    const expected = Array.from({ length: 141 }, (_, j) => 1 + j * 0.3);
    const e = expectedEconomy(i, model([{}], { expected }));
    expect({ ...e, sora: [] }).toEqual({ ...steadyEconomy(i), sora: [] });
    expect(e.sora).toHaveLength(37);
    expect(e.sora[0]).toBe(1);
    expect(e.sora[1]).toBeCloseTo(1.1, 12);
    expect(e.sora[3]).toBeCloseTo(1.3, 12);
    expect(e.sora[36]).toBeCloseTo(4.6, 12);
  });
});

describe("a future drawn", () => {
  const i: ScenarioInputs = { ...DEFAULT_INPUTS, years: 5, growth: 3, rent_growth: 2, cost_growth: 2.5, invest_return: 6 };

  it("grows at the inputs' rates where history never varied, whatever history's own were", () => {
    const e = drawEconomy(i, calm(), randomStream(7));
    const steady = steadyEconomy(i);
    for (const key of ["price", "rent", "costs", "invest"] as const) {
      expect(e[key]).toHaveLength(61);
      e[key].forEach((v, m) => expect(v, `${key} ${m}`).toBeCloseTo(steady[key][m], 12));
    }
    expect(e.sora).toEqual(Array(61).fill(1));
  });

  it("draws history's quarters in runs of eight, every series from the same quarter, wrapping at its end", () => {
    // Quarter k's price moves by k thousandths and its rent by twice that.
    const m = model(Array.from({ length: 20 }, (_, k) => ({ price: k / 1000, rent: (2 * k) / 1000 })));
    const e = drawEconomy({ ...i, years: 12 }, m, randomStream(3));
    const drawn = (path: number[], mean: number, rate: number) => Array.from({ length: 48 }, (_, j) =>
      Math.round((Math.log(path[3 * j + 3] / path[3 * j]) - Math.log(1 + rate / 100) / 4 + mean) * 1000) || 0);
    const prices = drawn(e.price, m.mean.price, i.growth);
    expect(drawn(e.rent, m.mean.rent, i.rent_growth)).toEqual(prices.map((k) => 2 * k));
    for (let b = 0; b < 48; b += 8) {
      for (let k = 1; k < 8; k++) expect(prices[b + k], `run ${b / 8}`).toBe((prices[b] + k) % 20);
    }
    expect(new Set(prices.filter((_, j) => j % 8 === 0)).size).toBeGreaterThan(1);
  });

  it("lets SORA stray from its path by each quarter's surprise, the earlier ones fading, and never below nothing", () => {
    const up = drawEconomy({ ...i, years: 1 }, model(Array.from({ length: 20 }, () => ({ sora: 0.5 }))), randomStream(1));
    // A quarter on, half a point above; two on, 0.5 x 0.9 + 0.5.
    expect([up.sora[0], up.sora[3], up.sora[6], up.sora[9]]).toEqual([1, 1.5, 1.95, 1 + 0.5 * (1 + 0.9 + 0.81)]);
    const down = drawEconomy({ ...i, years: 1 }, model(Array.from({ length: 20 }, () => ({ sora: -0.6 }))), randomStream(1));
    expect([down.sora[3], down.sora[6]]).toEqual([0.4, 0]);
  });

  it("is the same future for the same seed, and another for another", () => {
    const m = model(Array.from({ length: 30 }, (_, k) => ({ price: Math.sin(k) / 20, invest: Math.cos(k) / 10, sora: Math.sin(2 * k) / 5 })));
    expect(drawEconomy(i, m, randomStream(11))).toEqual(drawEconomy(i, m, randomStream(11)));
    expect(drawEconomy(i, m, randomStream(11))).not.toEqual(drawEconomy(i, m, randomStream(12)));
  });
});

describe("stresses", () => {
  const e = steadyEconomy({ ...DEFAULT_INPUTS, years: 5, rent_growth: 12 });

  it("raises SORA two points from the twelfth month", () => {
    const s = stressed(e, "rates");
    expect(s.sora.slice(0, 12)).toEqual(e.sora.slice(0, 12));
    expect(s.sora.slice(12)).toEqual(e.sora.slice(12).map((v) => v + 2));
    expect({ ...s, sora: [] }).toEqual({ ...e, sora: [] });
  });

  it("holds rents for three years, then moves them on from there", () => {
    const s = stressed(e, "rents");
    expect(s.rent.slice(0, 37)).toEqual(Array(37).fill(1));
    expect(s.rent[48]).toBeCloseTo(1.12, 12);
    expect(s.rent[60]).toBeCloseTo(1.12 ** 2, 12);
  });

  it("takes 15% off the price through the second year, and keeps it off", () => {
    const s = stressed(e, "prices");
    expect(s.price.slice(0, 13)).toEqual(e.price.slice(0, 13));
    expect(s.price[18]).toBeCloseTo(e.price[18] * 0.925, 12);
    expect(s.price[24]).toBeCloseTo(e.price[24] * 0.85, 12);
    expect(s.price[60]).toBeCloseTo(e.price[60] * 0.85, 12);
    expect(stressed(e, "none")).toBe(e);
  });
});

describe("simulate and summarize", () => {
  const i: ScenarioInputs = { ...DEFAULT_INPUTS, kind: "private", loan_type: "bank", price: 1_000_000, rent: 3_500, years: 6, lock_years: 1, spread: 0.5, loan_rate: 1.6 };

  it("comes out as the future expected, in every future, where history never varied", () => {
    const m = calm();
    const central = rentOrBuy(i, expectedEconomy(i, m)).years.map((y) => y.buy_net_worth - y.rent_net_worth);
    const outcomes = simulate(i, m, { count: 5 });
    expect(outcomes).toHaveLength(5);
    for (const o of outcomes) o.gap.forEach((g, y) => expect(g, `year ${y}`).toBeCloseTo(central[y], 1));
    const sim = summarize(outcomes);
    expect(sim.years.map((y) => y.year)).toEqual([1, 2, 3, 4, 5, 6]);
    sim.years.forEach((y) => {
      expect(y.low).toBeCloseTo(central[y.year], 1);
      expect(y.high).toBeCloseTo(central[y.year], 1);
      expect(y.ahead).toBe(central[y.year] >= 0 ? 1 : 0);
      expect(y.sora).toEqual([1, 1, 1]);
    });
  });

  it("draws the same futures a few at a time as all at once", () => {
    const m = model(Array.from({ length: 30 }, (_, k) => ({ price: Math.sin(k) / 20, rent: Math.cos(k) / 30, invest: Math.cos(k) / 10, sora: Math.sin(2 * k) / 5 })));
    const all = simulate(i, m, { count: 12 });
    expect([...simulate(i, m, { first: 0, count: 5 }), ...simulate(i, m, { first: 5, count: 7 })]).toEqual(all);
    expect(simulate(i, m, { count: 12, seed: 2 })).not.toEqual(all);
    expect(new Set(all.map((o) => o.gap.at(-1))).size).toBeGreaterThan(1);
    expect(simulate(i, m)).toHaveLength(PATHS);
  });

  it("tries a stress on every future", () => {
    const m = calm();
    const [none] = simulate(i, m, { count: 1 });
    const [rates] = simulate(i, m, { count: 1, stress: "rates" });
    expect(rates.gap.at(-1)!).toBeLessThan(none.gap.at(-1)!);
    expect(rates.sora.slice(1)).toEqual(none.sora.slice(1).map((v) => v + 2));
  });

  it("draws nothing without a history", () => {
    expect(simulate(i, model([]))).toEqual([]);
  });

  it("sums the futures up: the spread of each year's gap, the share with buying ahead, and when it first pulls ahead", () => {
    const outcome = (gap: number[]): Outcome => ({ gap, sora: gap.map(() => 1) });
    // Level counts as ahead, as it does for the comparison's own break-even.
    const sim = summarize([
      outcome([-9, -5, 1, 2, 3]),
      outcome([-9, -4, -3, 5, 6]),
      outcome([-9, 0, -1, 4, 9]),
      outcome([-9, -8, -7, -6, -5]),
    ]);
    expect(sim.paths).toBe(4);
    expect(sim.years[0]).toEqual({ year: 1, low: quantile([-8, -5, -4, 0], 0.1), middle: -4.5, high: quantile([-8, -5, -4, 0], 0.9), ahead: 0.25, sora: [1, 1, 1] });
    expect(sim.years.map((y) => y.ahead)).toEqual([0.25, 0.25, 0.75, 0.75]);
    // First ahead in years 1, 2, 3 and never.
    expect(sim.breakEven).toEqual({ early: 1, middle: 2, late: 3, never: 0.25 });
    expect(summarize([outcome([-1, -1]), outcome([-1, -2])]).breakEven).toEqual({ early: null, middle: null, late: null, never: 1 });
  });
});

describe("the model of a market", () => {
  // Every series a quarter at a time from 2004 to 2026, but HDB's price index
  // missing four quarters in 2009 -- a gap too long to bridge.
  const n = 92;
  const wave = (k: number, f: number) => Math.sin(k * f) / 50;
  const market: MarketData = {
    series: [
      series("hdb_rpi", "ALL", "all", "2004-Q1", grown("hdb_rpi", "ALL", "all", "2004-Q1", n, (k) => 0.01 + wave(k, 1)).values.map((v, k) => (k >= 21 && k < 25 ? null : v))),
      ...[0, 1, 2, 3, 4].map((t) => grown("hdb_rent", `TOWN ${t}`, "4-room", "2004-Q1", n, (k) => 0.008 + wave(k + t, 0.7), 2_000)),
      grown("cpi", "ALL", "all", "2004-Q1", n, (k) => 0.005 + wave(k, 0.3) / 5),
      grown("equity", "ALL", EQUITY_SEGMENT, "2004-Q1", n, (k) => 0.02 + wave(k, 2) * 3),
      series("sora", "ALL", "3m", "2004-Q1", Array.from({ length: n }, (_, k) => 1.5 + Math.sin(k / 5))),
      ...[1, 2, 5, 10].map((t) => series("sgs", "ALL", `${t}y`, "2004-Q1", Array.from({ length: n }, (_, k) => 1.5 + Math.sin(k / 5) + t / 10))),
    ],
    refreshed_at: null,
  };

  it("draws from the longest run of quarters in which everything moved, and takes out each series' average", () => {
    const m = marketModel(market, { kind: "hdb", market: "ALL:non-landed" });
    // After the gap: from 2010 Q3, the first quarter HDB's index moved again, to 2026 Q4.
    expect(m.history[0].quarter).toBe("2010-Q3");
    expect(m.history.at(-1)!.quarter).toBe("2026-Q4");
    expect(m.history).toHaveLength(66);
    const rpi = market.series[0].values;
    expect(m.history[0].price).toBeCloseTo(Math.log(rpi[26]! / rpi[25]!), 12);
    expect(m.mean.price).toBeCloseTo(m.history.reduce((a, s) => a + s.price, 0) / 66, 12);
    expect(m.mean.invest).toBeCloseTo(m.history.reduce((a, s) => a + s.invest, 0) / 66, 12);
    // SORA's surprises are what its own persistence leaves unexplained.
    expect(m.history.some((s) => s.sora !== 0)).toBe(true);
    expect(Object.keys(m.estimates).sort()).toEqual(["cost_growth", "growth", "invest_return", "rent_growth"]);
  });

  it("draws nothing from fewer than twenty quarters together", () => {
    // Shares from 2021 Q3 or Q4 to 2026 Q3: twenty quarters' changes, or nineteen.
    const shares = (start: string) => ({ ...market, series: market.series.map((s) => (s.series === "equity" ? { ...s, start, values: s.values.slice(0, quarterNumber("2026-Q3") - quarterNumber(start) + 1) } : s)) });
    expect(marketModel(shares("2021-Q3"), { kind: "hdb", market: "ALL:non-landed" }).history).toHaveLength(20);
    expect(marketModel(shares("2021-Q4"), { kind: "hdb", market: "ALL:non-landed" }).history).toEqual([]);
  });
});
