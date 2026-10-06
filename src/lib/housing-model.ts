import {
  EQUITY_SEGMENT, INPUT_LIMITS, PRIVATE_SEGMENTS, findSeries, quarterFromNumber, quarterLabel, quarterNumber, rentOrBuy, steadyEconomy,
  type Economy, type Estimated, type MarketData, type MarketSeries, type ScenarioInputs,
} from "@/lib/housing";

/** The growth model.
 *
 *  What the comparison assumes of the years ahead is read off the market's own
 *  history as it stands, every time the figures are read again, and said with
 *  its reason; the inputs left to the market take these estimates. Returns are
 *  taken conservatively -- the home's price growth and the investments' alike
 *  at the lower quartile of their ten-year spans, so neither side is flattered
 *  -- and costs as they usually go, at the median. SORA is expected to follow
 *  what government bond yields say of it.
 *
 *  The years ahead are then drawn many times over from that history, a quarter
 *  at a time in runs of two years taken across every series together, so that
 *  prices, rents, costs, shares and SORA move as they have moved together --
 *  rents up while rates rose, shares down while they fell -- but around the
 *  inputs' rates rather than history's own. */

/** Years a span of history is measured over. */
const SPAN_YEARS = 10;
/** Fewer ten-year spans than this make no estimate. */
const MIN_SPANS = 8;
/** Quarters every series moved in, together, that futures need to be drawn from. */
const MIN_HISTORY = 20;
/** Quarters drawn together: long enough to keep a run's momentum. */
const BLOCK = 8;
/** Quarters missing from a series that are bridged rather than break it. */
const MAX_GAP = 2;
/** HDB medians, across towns and flat types, a quarter's rents need to count. */
const MIN_MEDIANS = 5;
/** Futures drawn. */
export const PATHS = 500;
/** What a Singapore investor gives up a year of the index's return, in
 *  percentage points: the index reinvests dividends whole, but the US withholds
 *  15% of them (about 1.3% a year) from an Irish-domiciled index fund, and the
 *  fund's fees are some 0.07%. */
export const INVEST_COSTS = 0.3;
/** What banks ask over the SORA expected while a rate is fixed, in percentage
 *  points: two-year fixed packages were 1.65% in September 2026, when SORA was
 *  expected to average about 1.35% over them. When their pricing moves, move
 *  this and its test's figures with it. */
export const FIXED_MARGIN = 0.3;
/** The longest look ahead futures are drawn for. Past it the history they
 *  replay is too short to say how often buying comes out ahead, and a
 *  comparison shows its central projection and assumptions only. */
export const SIMULATED_YEARS = 35;
/** The longest look ahead, in quarters. */
const MAX_QUARTERS = INPUT_LIMITS.years[1] * 4;
/** HDB's concessionary rate: 0.1% over the CPF Ordinary Account's 2.5%. */
const HDB_RATE = 2.6;

const mean = (values: readonly number[]) => values.reduce((a, b) => a + b, 0) / values.length;
const pct = (rate: number) => `${(rate * 100).toFixed(1)}%`;
const points = (rate: number) => `${rate.toFixed(2)}%`;
/** A rate as an input takes it: percent, to a tenth. */
const percent = (rate: number) => Math.round(rate * 1000) / 10;

/** A series' values by quarter number. */
function byQuarter(s: MarketSeries | undefined): Map<number, number> {
  const out = new Map<number, number>();
  if (!s) return out;
  const first = quarterNumber(s.start);
  s.values.forEach((v, k) => { if (v != null) out.set(first + k, v); });
  return out;
}

/** Each quarter's change from the one before, in logs. A quarter or two
 *  missing between two with values are taken to have moved evenly between
 *  them -- HDB published no rents for the last quarter of 2019 -- and a longer
 *  gap is left a gap. */
function changesOf(values: Map<number, number>): Map<number, number> {
  const out = new Map<number, number>();
  const quarters = [...values.keys()].sort((a, b) => a - b);
  for (let k = 1; k < quarters.length; k++) {
    const from = quarters[k - 1], to = quarters[k];
    const a = values.get(from)!, b = values.get(to)!;
    if (to - from > MAX_GAP + 1 || a <= 0 || b <= 0) continue;
    const step = Math.log(b / a) / (to - from);
    for (let q = from + 1; q <= to; q++) out.set(q, step);
  }
  return out;
}

/** The value a share `p` of the sorted values fall below, between neighbours. */
export function quantile(sorted: readonly number[], p: number): number {
  if (sorted.length === 0) return NaN;
  const at = (sorted.length - 1) * p;
  const below = Math.floor(at);
  const above = Math.min(below + 1, sorted.length - 1);
  return sorted[below] + (sorted[above] - sorted[below]) * (at - below);
}

/** Every ten-year span's growth, a year -- 0.03 is 3% -- from each quarter
 *  whose next forty all have a change: a gap in the figures breaks a span.
 *  Sorted, least first. */
function spansOf(changes: Map<number, number>): number[] {
  const quarters = SPAN_YEARS * 4;
  const out: number[] = [];
  for (const start of changes.keys()) {
    let sum = 0, k = 0;
    for (; k < quarters; k++) {
      const c = changes.get(start + k);
      if (c === undefined) break;
      sum += c;
    }
    if (k === quarters) out.push(Math.exp(sum / SPAN_YEARS) - 1);
  }
  return out.sort((a, b) => a - b);
}

/** HDB rents island-wide, as a change a quarter: the average change of every
 *  town's and flat type's median with a figure in both quarters. One town's
 *  median jumps with whichever flats happened to let; across them the noise
 *  mostly cancels, and what is left moves as the market does. */
export function hdbRentChanges(data: MarketData): Map<number, number> {
  const sums = new Map<number, { sum: number; n: number }>();
  for (const s of data.series) {
    if (s.series !== "hdb_rent") continue;
    for (const [q, c] of changesOf(byQuarter(s))) {
      const at = sums.get(q) ?? { sum: 0, n: 0 };
      sums.set(q, { sum: at.sum + c, n: at.n + 1 });
    }
  }
  return new Map([...sums].filter(([, { n }]) => n >= MIN_MEDIANS).map(([q, { sum, n }]) => [q, sum / n]));
}

/** A series the model reads: its changes a quarter, and what to call it. */
type Source = { changes: Map<number, number>; name: string };

/** Where a home's prices and rents are read: HDB's own for a flat; for a
 *  private home, URA's indices for its market -- and where URA no longer
 *  publishes its rents, theirs for condos and apartments island-wide. */
function homeSources(data: MarketData, follow: Pick<ScenarioInputs, "kind" | "market">): { price: Source; rent: Source } {
  if (follow.kind === "hdb") {
    return {
      price: { changes: changesOf(byQuarter(findSeries(data, "hdb_rpi", "ALL", "all"))), name: "HDB's resale price index" },
      rent: { changes: hdbRentChanges(data), name: "HDB rents, every town's median taken together," },
    };
  }
  const island = PRIVATE_SEGMENTS.find((s) => s.key === "ALL:non-landed")!;
  const market = PRIVATE_SEGMENTS.find((s) => s.key === follow.market) ?? island;
  const prices = byQuarter(findSeries(data, "ura_ppi", market.area, market.segment));
  let rents = byQuarter(findSeries(data, "ura_rri", market.area, market.segment));
  let rentMarket: (typeof PRIVATE_SEGMENTS)[number] = market;
  if (rents.size === 0 || Math.max(...rents.keys()) < Math.max(...prices.keys()) - 4) {
    rentMarket = island;
    rents = byQuarter(findSeries(data, "ura_rri", island.area, island.segment));
  }
  return {
    price: { changes: changesOf(prices), name: `URA's price index for ${market.noun}` },
    rent: { changes: changesOf(rents), name: `URA's rental index for ${rentMarket.noun}` },
  };
}

/** What the market's history says an input should be, and why. */
export type Estimate = { value: number; reason: string };
export type Estimates = Partial<Record<Estimated, Estimate>>;

/** The year a source's figures start. */
const sinceOf = (s: Source) => Math.floor((Math.min(...s.changes.keys()) - 1) / 4);

/** The growth inputs, from each source's ten-year spans. */
function growthEstimates(sources: Record<"price" | "rent" | "costs" | "invest", Source>): Estimates {
  const out: Estimates = {};
  const spans = (s: Source) => {
    const all = spansOf(s.changes);
    return all.length >= MIN_SPANS ? { low: quantile(all, 0.25), middle: quantile(all, 0.5), since: sinceOf(s) } : null;
  };
  const invest = spans(sources.invest);
  if (invest) {
    out.invest_return = {
      value: Math.round((percent(invest.low) - INVEST_COSTS) * 10) / 10,
      reason: `${sources.invest.name} earned more than ${pct(invest.low)} a year in three of every four ten-year spans since ${invest.since}, ${pct(invest.middle)} in the middle one. The lower figure is taken, to be conservative: the years ahead need not be as kind. Less ${INVEST_COSTS.toFixed(1)}% a year for holding it: the US tax withheld on its dividends and an index fund's fees.`,
    };
  }
  const price = spans(sources.price);
  if (price) {
    out.growth = {
      value: percent(price.low),
      reason: `${sources.price.name} grew more than ${pct(price.low)} a year in three of every four ten-year spans since ${price.since}, ${pct(price.middle)} in the middle one. The lower figure is taken, as the investments' is, so that neither side is flattered.`,
    };
  }
  const rent = spans(sources.rent);
  if (rent) {
    out.rent_growth = {
      value: percent(rent.middle),
      reason: `${sources.rent.name} grew ${pct(rent.middle)} a year over the middle ten-year span since ${rent.since}.`,
    };
  }
  const costs = spans(sources.costs);
  if (costs) {
    out.cost_growth = {
      value: percent(costs.middle),
      reason: `Consumer prices rose ${pct(costs.middle)} a year over the middle ten-year span since ${costs.since}; S&CC, maintenance and repairs are taken to rise with them.`,
    };
  }
  return out;
}

/** What is expected of 3-month compounded SORA, and how it strays. */
export type SoraOutlook = {
  /** As last published, % a year, with the yields beside it. */
  latest: { quarter: string; value: number };
  /** What it is expected to average over each span of years from now: each
   *  government securities' yield less the premium it has paid over SORA on
   *  average, and between two maturities, what is left of the longer. */
  forwards: Array<{ from: number; to: number; rate: number }>;
  /** Expected, a quarter at a time from now; [0] is the latest. Through each
   *  span's rate at its middle, in straight lines, the last one held. */
  expected: number[];
  /** How much of a departure from the expected path is left a quarter on. */
  persistence: number;
  /** A quarter's surprise, in points: its standard deviation. */
  shock: number;
  /** The year SORA's figures start. */
  since: number;
};

/** SORA's outlook from the yields, and each quarter's surprise in its history:
 *  how far it ended from where its level a quarter before pointed. */
function soraModel(data: MarketData): { outlook: SoraOutlook; shocks: Map<number, number> } | null {
  const sora = byQuarter(findSeries(data, "sora", "ALL", "3m"));
  const terms = [1, 2, 5, 10];
  const yields = terms.map((t) => byQuarter(findSeries(data, "sgs", "ALL", `${t}y`)));
  const quarters = [...sora.keys()].sort((a, b) => a - b);
  const now = quarters.filter((q) => yields.every((y) => y.has(q))).at(-1);
  if (quarters.length < MIN_HISTORY || now === undefined) return null;

  // The premium each maturity has paid over SORA, on average, quarter by quarter.
  const premia = yields.map((y) => mean(quarters.filter((q) => y.has(q)).map((q) => y.get(q)! - sora.get(q)!)));
  const average = yields.map((y, k) => y.get(now)! - premia[k]);
  const forwards = [
    { from: 0, to: 1, rate: average[0] },
    { from: 1, to: 2, rate: 2 * average[1] - average[0] },
    { from: 2, to: 5, rate: (5 * average[2] - 2 * average[1]) / 3 },
    { from: 5, to: 10, rate: (10 * average[3] - 5 * average[2]) / 5 },
  ].map((f) => ({ ...f, rate: Math.max(0, f.rate) }));
  const knots: Array<[number, number]> = [[0, sora.get(now)!], ...forwards.map((f): [number, number] => [(f.from + f.to) / 2, f.rate])];
  const expected = Array.from({ length: MAX_QUARTERS + 1 }, (_, j) => {
    const t = j / 4;
    const next = knots.findIndex(([x]) => x >= t);
    if (next === -1) return knots[knots.length - 1][1];
    if (next === 0) return knots[0][1];
    const [x0, y0] = knots[next - 1], [x1, y1] = knots[next];
    return y0 + ((y1 - y0) * (t - x0)) / (x1 - x0);
  });

  // How much of a quarter's level carries into the next, by least squares;
  // what it does not explain is the quarter's surprise.
  const pairs = quarters.filter((q) => sora.has(q - 1)).map((q) => ({ q, x: sora.get(q - 1)!, y: sora.get(q)! }));
  const mx = mean(pairs.map((p) => p.x)), my = mean(pairs.map((p) => p.y));
  const sxx = pairs.reduce((a, p) => a + (p.x - mx) ** 2, 0);
  const sxy = pairs.reduce((a, p) => a + (p.x - mx) * (p.y - my), 0);
  const persistence = Math.min(0.99, Math.max(0, sxx > 0 ? sxy / sxx : 0));
  const level = my - persistence * mx;
  const shocks = new Map(pairs.map((p) => [p.q, p.y - level - persistence * p.x]));
  const shock = Math.sqrt(mean([...shocks.values()].map((s) => s * s)));

  return {
    outlook: {
      latest: { quarter: quarterFromNumber(now), value: sora.get(now)! },
      forwards,
      expected,
      persistence,
      shock,
      since: Math.floor(quarters[0] / 4),
    },
    shocks,
  };
}

/** Changes a quarter in the four series that grow. */
type Moves = { price: number; rent: number; costs: number; invest: number };
/** A quarter of history, every series' change in it together; SORA's as its surprise, in points. */
export type Step = Moves & { quarter: string; sora: number };

/** What the comparison's future is drawn from. */
export type Model = {
  /** The longest run of quarters in which every series moved, in order. */
  history: Step[];
  /** Each series' average change a quarter over it: taken out of every
   *  quarter drawn, so that futures grow at the inputs' rates instead. */
  mean: Moves;
  sora: SoraOutlook | null;
  /** The growth inputs' estimates; the loan's depends on the loan (estimatesFor). */
  estimates: Estimates;
};

/** The model for a kind of home and its market, from the figures as they stand. */
export function marketModel(data: MarketData, follow: Pick<ScenarioInputs, "kind" | "market">): Model {
  const home = homeSources(data, follow);
  const sources = {
    ...home,
    costs: { changes: changesOf(byQuarter(findSeries(data, "cpi", "ALL", "all"))), name: "Consumer prices" },
    invest: { changes: changesOf(byQuarter(findSeries(data, "equity", "ALL", EQUITY_SEGMENT))), name: "The S&P 500 with dividends, in Singapore dollars," },
  };
  const sora = soraModel(data);

  // Quarters in which everything moved; of them, the longest unbroken run,
  // the latest of equals, so that a run drawn is a run that happened.
  const moved = [...sources.price.changes.keys()]
    .filter((q) => sources.rent.changes.has(q) && sources.costs.changes.has(q) && sources.invest.changes.has(q) && (!sora || sora.shocks.has(q)))
    .sort((a, b) => a - b);
  let run: number[] = [], best: number[] = [];
  for (const q of moved) {
    run = run.length && run[run.length - 1] === q - 1 ? [...run, q] : [q];
    if (run.length >= best.length) best = run;
  }
  const history = best.length >= MIN_HISTORY
    ? best.map((q) => ({
      quarter: quarterFromNumber(q),
      price: sources.price.changes.get(q)!,
      rent: sources.rent.changes.get(q)!,
      costs: sources.costs.changes.get(q)!,
      invest: sources.invest.changes.get(q)!,
      sora: sora?.shocks.get(q) ?? 0,
    }))
    : [];
  const average = (key: keyof Moves) => (history.length ? mean(history.map((s) => s[key])) : 0);

  return {
    history,
    mean: { price: average("price"), rent: average("rent"), costs: average("costs"), invest: average("invest") },
    sora: sora?.outlook ?? null,
    estimates: growthEstimates(sources),
  };
}

/** A comparison's estimates: the model's, and its loan's rate -- HDB's, or for
 *  a bank's fixed rate, what SORA is expected to average while it is fixed and
 *  what banks ask over that (FIXED_MARGIN); floating from the start, SORA now
 *  and the spread. The spread is what is charged after a lock-in. */
export function estimatesFor(model: Model | null, i: ScenarioInputs): Estimates {
  const out: Estimates = { ...model?.estimates };
  if (i.loan_type === "hdb") {
    out.loan_rate = { value: HDB_RATE, reason: "HDB charges 0.1% over the CPF Ordinary Account's interest, 2.5%." };
  } else if (model?.sora) {
    const s = model.sora;
    const quarters = i.lock_years * 4;
    // The path's average over the lock-in: each quarter's, between its ends.
    const expected = quarters === 0
      ? s.latest.value
      : mean(Array.from({ length: quarters }, (_, j) => (s.expected[j] + s.expected[j + 1]) / 2));
    const value = Math.round((expected + (quarters === 0 ? i.spread : FIXED_MARGIN)) * 100) / 100;
    out.loan_rate = {
      value,
      reason: quarters === 0
        ? `Floating from the start: SORA, ${points(s.latest.value)} in ${quarterLabel(s.latest.quarter)}, and the ${points(i.spread)} spread.`
        : `Fixed for ${i.lock_years} year${i.lock_years === 1 ? "" : "s"}, priced as banks price it: SORA is expected to average ${points(expected)} over them, and banks ask ${points(FIXED_MARGIN)} over that. After, SORA and the ${points(i.spread)} spread.`,
    };
  }
  return out;
}

/** The inputs as the comparison runs them: each left to the market at its
 *  estimate, where there is one. */
export function withEstimates(i: ScenarioInputs, estimates: Estimates): ScenarioInputs {
  const out = { ...i };
  for (const key of i.auto) {
    const e = estimates[key];
    if (e) out[key] = e.value;
  }
  return out;
}

/** A quarterly path a month at a time, in straight lines between quarters,
 *  the last quarter held. */
function monthlyPath(quarters: readonly number[], months: number): number[] {
  const at = (j: number) => quarters[Math.min(j, quarters.length - 1)];
  return Array.from({ length: months + 1 }, (_, m) => {
    const j = Math.floor(m / 3);
    return at(j) + ((at(j + 1) - at(j)) * (m % 3)) / 3;
  });
}

/** The future expected: prices, rents, costs and returns steady at the
 *  inputs' rates, and SORA along the path the bond market expects. */
export function expectedEconomy(i: ScenarioInputs, model: Model | null): Economy {
  const steady = steadyEconomy(i);
  return model?.sora ? { ...steady, sora: monthlyPath(model.sora.expected, i.years * 12) } : steady;
}

/** A seeded stream of numbers in [0, 1) -- mulberry32 -- so that the same
 *  futures are drawn each time and a change of input is all that moves them. */
export function randomStream(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** One future: history's quarters drawn in runs of BLOCK from random places,
 *  wrapping at its end, every series' change from the same quarter; each
 *  change less its series' average and plus the inputs' rate. SORA departs
 *  from its expected path by each quarter's surprise, its earlier departures
 *  fading as they have, and never falls below nothing. */
export function drawEconomy(i: ScenarioInputs, model: Model, random: () => number): Economy {
  const months = i.years * 12;
  const quarters = Math.ceil(months / 3);
  const n = model.history.length;
  const block = Math.min(BLOCK, n);
  const steps: Step[] = [];
  while (steps.length < quarters) {
    const start = Math.floor(random() * n);
    for (let k = 0; k < block && steps.length < quarters; k++) steps.push(model.history[(start + k) % n]);
  }

  const rate = (yearly: number) => Math.log(1 + yearly / 100) / 4;
  const g = { price: rate(i.growth), rent: rate(i.rent_growth), costs: rate(i.cost_growth), invest: rate(i.invest_return) };
  const move = (s: Step, key: keyof Moves) => (s[key] - model.mean[key] + g[key]) / 3;
  const price = [1], rent = [1], costs = [1], invest = [0];
  let p = 0, r = 0, c = 0;
  for (let m = 1; m <= months; m++) {
    const s = steps[Math.floor((m - 1) / 3)];
    price.push(Math.exp((p += move(s, "price"))));
    rent.push(Math.exp((r += move(s, "rent"))));
    costs.push(Math.exp((c += move(s, "costs"))));
    invest.push(Math.exp(move(s, "invest")) - 1);
  }

  const outlook = model.sora;
  if (!outlook) return { price, rent, costs, invest, sora: steadyEconomy(i, months).sora };
  const sora = [outlook.expected[0]];
  let away = 0;
  for (let j = 1; j <= quarters; j++) {
    away = outlook.persistence * away + steps[j - 1].sora;
    sora.push(Math.max(0, outlook.expected[Math.min(j, outlook.expected.length - 1)] + away));
  }
  return { price, rent, costs, invest, sora: monthlyPath(sora, months) };
}

/** What could go wrong, tried on any future. */
export const STRESSES = ["none", "rates", "rents", "prices"] as const;
export type Stress = (typeof STRESSES)[number];

/** A future with a stress applied: SORA two points higher from the twelfth
 *  month on; rents held where they start for three years, then moving as they
 *  would have from there; or the home's price falling 15% through the second
 *  year and staying that much below where it would have been. */
export function stressed(e: Economy, stress: Stress): Economy {
  switch (stress) {
    case "rates":
      return { ...e, sora: e.sora.map((v, m) => (m >= 12 ? v + 2 : v)) };
    case "rents": {
      const held = e.rent[Math.min(36, e.rent.length - 1)];
      return { ...e, rent: e.rent.map((v, m) => (m <= 36 ? e.rent[0] : (v * e.rent[0]) / held)) };
    }
    case "prices":
      return { ...e, price: e.price.map((v, m) => v * (1 - 0.15 * Math.min(1, Math.max(0, (m - 12) / 12)))) };
    default:
      return e;
  }
}

/** A future as it came out: what buying left ahead of renting at each year's
 *  end, and SORA then, from year 0. */
export type Outcome = { gap: number[]; sora: number[] };

/** Futures `first` to `first + count - 1` of the comparison: each its own
 *  draw, seeded by its number, so they can be drawn a few at a time. */
export function simulate(i: ScenarioInputs, model: Model, { first = 0, count = PATHS, seed = 1, stress = "none" }: { first?: number; count?: number; seed?: number; stress?: Stress } = {}): Outcome[] {
  const out: Outcome[] = [];
  if (model.history.length === 0) return out;
  // Browser batches need not divide 500. The final one stops at the same draw
  // as a full API request, so its percentiles and ahead share are identical.
  for (let k = first; k < Math.min(first + count, PATHS); k++) {
    const economy = stressed(drawEconomy(i, model, randomStream(Math.imul(seed, 0x9e3779b1) ^ Math.imul(k + 1, 0x85ebca77))), stress);
    const p = rentOrBuy(i, economy);
    out.push({ gap: p.years.map((y) => y.buy_net_worth - y.rent_net_worth), sora: p.years.map((y) => economy.sora[y.year * 12]) });
  }
  return out;
}

export type SimulationYear = {
  year: number;
  /** What buying leaves ahead of renting -- behind, below nothing -- across
   *  the futures: the 10th, 50th and 90th percentiles. */
  low: number;
  middle: number;
  high: number;
  /** The share of futures in which buying is ahead. */
  ahead: number;
  /** SORA at the year's end: its 10th, 50th and 90th percentiles. */
  sora: [number, number, number];
};

export type Simulation = {
  paths: number;
  /** From the first year on. */
  years: SimulationYear[];
  /** When buying first pulls ahead: the year by which it has in a quarter,
   *  half and three quarters of the futures, null if not within the years
   *  looked at; and the share in which it never does. */
  breakEven: { early: number | null; middle: number | null; late: number | null; never: number };
};

/** The futures, summed up. */
export function summarize(outcomes: readonly Outcome[]): Simulation {
  const n = outcomes.length;
  const last = n ? outcomes[0].gap.length - 1 : 0;
  const years: SimulationYear[] = [];
  for (let y = 1; y <= last; y++) {
    const gaps = outcomes.map((o) => o.gap[y]).sort((a, b) => a - b);
    const sora = outcomes.map((o) => o.sora[y]).sort((a, b) => a - b);
    years.push({
      year: y,
      low: quantile(gaps, 0.1),
      middle: quantile(gaps, 0.5),
      high: quantile(gaps, 0.9),
      ahead: gaps.filter((g) => g >= 0).length / n,
      sora: [quantile(sora, 0.1), quantile(sora, 0.5), quantile(sora, 0.9)],
    });
  }
  const firsts = outcomes.map((o) => o.gap.findIndex((g, y) => y > 0 && g >= 0)).map((y) => (y === -1 ? Infinity : y));
  const by = (share: number) => {
    for (let y = 1; y <= last; y++) if (firsts.filter((f) => f <= y).length >= share * n) return y;
    return null;
  };
  return {
    paths: n,
    years,
    breakEven: { early: by(0.25), middle: by(0.5), late: by(0.75), never: n ? firsts.filter((f) => f === Infinity).length / n : 0 },
  };
}
