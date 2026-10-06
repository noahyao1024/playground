import { cpfHousingLimit, leaseFactor, parseGuidance, remainingLease, salaryOa, type HousingGuidance } from "@/lib/housing-guidance";
import { addMonths } from "@/lib/dates";
import { loanSchedule, type LoanRateChangeTerms } from "@/lib/finance";

/** /housing's arithmetic, shared by the page and the server: quarters, the
 *  market's figures as the page reads them, Singapore's stamp duties and
 *  property tax, and what renting and buying come to over the years. */

// ---------------------------------------------------------------------------
// Quarters
// ---------------------------------------------------------------------------

/** A quarter as the sources write it: 2026-Q2. */
const QUARTER = /^(\d{4})-Q([1-4])$/;

/** A quarter's first day, 2026-Q2 → 2026-04-01; null for anything else. */
export function quarterStart(quarter: string): string | null {
  const m = QUARTER.exec(quarter);
  return m ? `${m[1]}-${String((Number(m[2]) - 1) * 3 + 1).padStart(2, "0")}-01` : null;
}

/** The quarter a day falls in, 2026-04-01 → 2026-Q2. */
export function quarterOfDay(day: string): string {
  return `${day.slice(0, 4)}-Q${Math.floor((Number(day.slice(5, 7)) - 1) / 3) + 1}`;
}

/** Quarters counted from year 0, for arithmetic: one apart are 1 apart. */
export function quarterNumber(quarter: string): number {
  return Number(quarter.slice(0, 4)) * 4 + Number(quarter.slice(6)) - 1;
}

export function quarterFromNumber(n: number): string {
  return `${Math.floor(n / 4)}-Q${(n % 4) + 1}`;
}

export const nextQuarter = (quarter: string) => quarterFromNumber(quarterNumber(quarter) + 1);

/** Q2 2026. */
export const quarterLabel = (quarter: string) => `${quarter.slice(5)} ${quarter.slice(0, 4)}`;

/** Where a quarter sits on a time axis, in years: 2026-Q2 is 2026.25. */
export const quarterYear = (quarter: string) => quarterNumber(quarter) / 4;

// ---------------------------------------------------------------------------
// The market
// ---------------------------------------------------------------------------

/** What is kept, by series: HDB's median resale prices and rents, by town and
 *  flat type, in dollars; HDB's resale price index, 2009 Q1 = 100; URA's price
 *  and rental indices for private homes, 2009 Q1 = 100. And what the growth
 *  model reads besides, each quarter as it ended: 3-month compounded SORA and
 *  Singapore government securities' yields (1y, 2y, 5y, 10y), in percent; the
 *  consumer price index; and the S&P 500 with dividends reinvested, in
 *  Singapore dollars. */
export const SERIES = ["hdb_resale", "hdb_rent", "hdb_rpi", "ura_ppi", "ura_rri", "sora", "sgs", "cpi", "equity"] as const;
export type Series = (typeof SERIES)[number];
/** The segment the equity series is kept under. */
export const EQUITY_SEGMENT = "sp500-sgd";

/** A series for one place and kind of home: its quarters run on from `start`,
 *  one value each, null where none was published. */
export type MarketSeries = { series: Series; area: string; segment: string; start: string; values: Array<number | null> };
export type MarketData = { series: MarketSeries[]; refreshed_at: string | null };
export type Point = { quarter: string; value: number };

export const HDB_FLAT_TYPES = ["1-room", "2-room", "3-room", "4-room", "5-room", "executive"] as const;
export const FLAT_TYPE_LABELS: Record<string, string> = {
  "1-room": "1-room", "2-room": "2-room", "3-room": "3-room", "4-room": "4-room", "5-room": "5-room", executive: "Executive",
};

/** Private homes as URA's indices divide them: a kind island-wide, or flats
 *  by region. Every one has both a price and a rental index. */
export const PRIVATE_SEGMENTS = [
  { key: "ALL:all", area: "ALL", segment: "all", label: "All private homes", short: "All private", noun: "private homes" },
  { key: "ALL:landed", area: "ALL", segment: "landed", label: "Landed", short: "Landed", noun: "landed homes" },
  { key: "ALL:non-landed", area: "ALL", segment: "non-landed", label: "Condos and apartments", short: "Condos, all", noun: "condos and apartments" },
  { key: "CCR:non-landed", area: "CCR", segment: "non-landed", label: "Condos, core central (CCR)", short: "Condos, CCR", noun: "condos in the core central region" },
  { key: "RCR:non-landed", area: "RCR", segment: "non-landed", label: "Condos, rest of central (RCR)", short: "Condos, RCR", noun: "condos in the rest of central" },
  { key: "OCR:non-landed", area: "OCR", segment: "non-landed", label: "Condos, outside central (OCR)", short: "Condos, OCR", noun: "condos outside central" },
] as const;
export type PrivateMarket = (typeof PRIVATE_SEGMENTS)[number]["key"];
export const PRIVATE_MARKETS: readonly PrivateMarket[] = PRIVATE_SEGMENTS.map((s) => s.key);

/** A town in the case people write it: KALLANG/WHAMPOA → Kallang/Whampoa. */
export function townLabel(town: string): string {
  return town.toLowerCase().replace(/(^|[\s/-])([a-z])/g, (_, sep: string, c: string) => sep + c.toUpperCase());
}

export function findSeries(data: MarketData, series: Series, area: string, segment: string): MarketSeries | undefined {
  return data.series.find((s) => s.series === series && s.area === area && s.segment === segment);
}

/** A series' published values, in order. */
export function pointsOf(s: MarketSeries | undefined): Point[] {
  if (!s) return [];
  const out: Point[] = [];
  const first = quarterNumber(s.start);
  s.values.forEach((value, i) => { if (value != null) out.push({ quarter: quarterFromNumber(first + i), value }); });
  return out;
}

/** A series' value in a quarter, or null. */
export function valueIn(s: MarketSeries | undefined, quarter: string): number | null {
  if (!s) return null;
  return s.values[quarterNumber(quarter) - quarterNumber(s.start)] ?? null;
}

/** The last value published, and when. */
export function latestPoint(s: MarketSeries | undefined): Point | null {
  return pointsOf(s).at(-1) ?? null;
}

/** How far a series moved over the `years` before its latest value, as a
 *  ratio: 0.25 is up a quarter. Measured from the value then, or failing one
 *  that quarter, the last before it within half a year; null without one. */
export function changeOver(s: MarketSeries | undefined, years: number, until?: string): number | null {
  const points = pointsOf(s).filter((p) => !until || p.quarter <= until);
  const last = points.at(-1);
  if (!last) return null;
  const target = quarterNumber(last.quarter) - Math.round(years * 4);
  const from = points.filter((p) => quarterNumber(p.quarter) <= target && quarterNumber(p.quarter) >= target - 2).at(-1);
  return from ? last.value / from.value - 1 : null;
}

/** That move as a yearly rate: 0.03 is 3% a year. */
export function yearlyGrowth(s: MarketSeries | undefined, years: number, until?: string): number | null {
  const change = changeOver(s, years, until);
  return change === null ? null : (1 + change) ** (1 / years) - 1;
}

/** A year's rent as a share of the price: the gross rental yield. */
export const grossYield = (price: number, monthlyRent: number) => (monthlyRent * 12) / price;

/** Two series' values in the quarters both have, from `from` on. */
export function paired(a: MarketSeries | undefined, b: MarketSeries | undefined, from?: string): Array<{ quarter: string; a: number; b: number }> {
  const bs = new Map(pointsOf(b).map((p) => [p.quarter, p.value]));
  return pointsOf(a)
    .filter((p) => (!from || p.quarter >= from) && bs.has(p.quarter))
    .map((p) => ({ quarter: p.quarter, a: p.value, b: bs.get(p.quarter)! }));
}

/** The HDB towns with figures for a flat type, by name. */
export function hdbTowns(data: MarketData, flatType?: string): string[] {
  const towns = new Set(data.series
    .filter((s) => (s.series === "hdb_resale" || s.series === "hdb_rent") && (!flatType || s.segment === flatType) && s.values.some((v) => v != null))
    .map((s) => s.area));
  return [...towns].sort();
}

export type TownRow = {
  town: string;
  /** The quarter the price and rent are both from: the latest with both. */
  quarter: string | null;
  price: number | null;
  rent: number | null;
  yield: number | null;
  priceChange: number | null;
  rentChange: number | null;
};

/** Every town for a flat type, side by side: its median price and rent in the
 *  latest quarter that has both -- no older than a year before the newest
 *  figure, so a stale pair is not ranked beside today's -- and how each moved
 *  over `years`. */
export function townTable(data: MarketData, flatType: string, years = 5): TownRow[] {
  const newest = Math.max(...data.series.filter((s) => s.series === "hdb_resale" && s.segment === flatType)
    .map((s) => latestPoint(s)).filter((p): p is Point => !!p).map((p) => quarterNumber(p.quarter)));
  return hdbTowns(data, flatType).map((town) => {
    const price = findSeries(data, "hdb_resale", town, flatType);
    const rent = findSeries(data, "hdb_rent", town, flatType);
    const both = paired(price, rent).at(-1);
    const fresh = both && Number.isFinite(newest) && quarterNumber(both.quarter) >= newest - 4 ? both : undefined;
    return {
      town,
      quarter: fresh?.quarter ?? null,
      price: fresh?.a ?? null,
      rent: fresh?.b ?? null,
      yield: fresh ? grossYield(fresh.a, fresh.b) : null,
      priceChange: changeOver(price, years),
      rentChange: changeOver(rent, years),
    };
  });
}

// ---------------------------------------------------------------------------
// Stamp duties and property tax, as IRAS publishes them (read 5 Oct 2026)
// ---------------------------------------------------------------------------

/** Tax in bands: each slice of the amount at its own rate. */
function banded(amount: number, bands: ReadonlyArray<readonly [number, number]>): number {
  let left = Math.max(0, amount), tax = 0;
  for (const [width, rate] of bands) {
    const slice = Math.min(left, width);
    tax += slice * rate;
    left -= slice;
    if (left <= 0) break;
  }
  return tax;
}

/** Buyer's stamp duty on a home, from 15 Feb 2023. */
const BSD_BANDS = [[180_000, 0.01], [180_000, 0.02], [640_000, 0.03], [500_000, 0.04], [1_500_000, 0.05], [Infinity, 0.06]] as const;

/** BSD on the price, rounded down to the dollar. */
export function buyerStampDuty(price: number): number {
  return Math.floor(banded(price, BSD_BANDS) + 1e-9);
}

export const RESIDENCIES = ["citizen", "pr", "foreigner"] as const;
export type Residency = (typeof RESIDENCIES)[number];
export const RESIDENCY_LABELS: Record<Residency, string> = { citizen: "Citizen", pr: "PR", foreigner: "Foreigner" };

/** Additional buyer's stamp duty from 27 Apr 2023, by who buys and which home
 *  of theirs it is: the first, the second, the third or later. */
export const ABSD_RATES: Record<Residency, readonly [number, number, number]> = {
  citizen: [0, 0.2, 0.3],
  pr: [0.05, 0.3, 0.35],
  foreigner: [0.6, 0.6, 0.6],
};

/** ABSD on the price, rounded down to the dollar. */
export function additionalBuyerStampDuty(price: number, residency: Residency, nth: number): number {
  return Math.floor(price * ABSD_RATES[residency][Math.min(3, Math.max(1, Math.round(nth))) - 1] + 1e-9);
}

/** Seller's stamp duty on a home bought from 4 Jul 2025 and sold within four
 *  years: 16% in the first, then 12%, 8% and 4%. A year held to the day is
 *  still that year. */
export function sellerStampDuty(price: number, yearsHeld: number): number {
  const rate = yearsHeld <= 1 ? 0.16 : yearsHeld <= 2 ? 0.12 : yearsHeld <= 3 ? 0.08 : yearsHeld <= 4 ? 0.04 : 0;
  return Math.floor(price * rate + 1e-9);
}

/** Property tax on a home its owner lives in, from 1 Jan 2025, on its annual
 *  value: the rent IRAS reckons it would fetch in a year. */
const OWNER_OCCUPIER_BANDS = [
  [12_000, 0], [28_000, 0.04], [10_000, 0.06], [25_000, 0.1], [10_000, 0.14], [15_000, 0.2], [40_000, 0.26], [Infinity, 0.32],
] as const;

export function ownerOccupierTax(annualValue: number): number {
  return Math.round(banded(annualValue, OWNER_OCCUPIER_BANDS) * 100) / 100;
}

// ---------------------------------------------------------------------------
// Rent or buy
// ---------------------------------------------------------------------------

export const HOME_KINDS = ["hdb", "private"] as const;
export type HomeKind = (typeof HOME_KINDS)[number];
export const LOAN_TYPES = ["hdb", "bank"] as const;
export type LoanType = (typeof LOAN_TYPES)[number];

/** The inputs the market's history can set (housing-model.ts). Left to it,
 *  one takes the live estimate, and its own number stands in only while there
 *  is none. */
export const ESTIMATED = ["loan_rate", "growth", "rent_growth", "cost_growth", "invest_return"] as const;
export type Estimated = (typeof ESTIMATED)[number];

/** What a comparison takes. Money in Singapore dollars; rates in percent a
 *  year. Kept whole, as JSON, in housing_scenarios.inputs. */
export type ScenarioInputs = {
  residency: Residency;
  /** Which home of the buyer's this would be: 1, 2, or 3 for the third or later. */
  nth: number;
  kind: HomeKind;
  /** For a private home, the market it is in, as URA's indices divide them:
   *  the estimates and the simulated futures follow its prices and rents. */
  market: PrivateMarket;
  price: number;
  /** HDB's loan, which CPF may fund whole; or a bank's, which wants 5% of the price in cash. */
  loan_type: LoanType;
  /** The share of the price borrowed, in percent. */
  loan_share: number;
  /** An HDB loan's rate; a bank loan's while it is fixed. */
  loan_rate: number;
  loan_years: number;
  /** A bank loan: how many years its rate is fixed for, and after that, what
   *  it pays over 3-month compounded SORA, reset every three months. */
  lock_years: number;
  spread: number;
  /** Paid once on buying, besides the stamp duties: legal fees, valuation. */
  buy_costs: number;
  renovation: number;
  /** Service and conservancy charges, or a condo's maintenance fund: a month. */
  maintenance: number;
  /** Repairs and insurance: a year. */
  upkeep: number;
  /** How fast S&CC or maintenance and repairs grow: prices in general. */
  cost_growth: number;
  /** The home's annual value for property tax, now; it moves with rents. */
  annual_value: number;
  /** How fast the home's price grows. */
  growth: number;
  /** Agent and legal fees on selling, in percent of the price. */
  sell_costs: number;
  /** The rent of a comparable home, a month. */
  rent: number;
  rent_growth: number;
  /** Agent fees and the lease's stamp duty: a year. */
  rent_costs: number;
  /** What money not spent on the home earns. */
  invest_return: number;
  /** CPF Ordinary Account: what is in it now, what goes in each month, and its rate. */
  cpf_balance: number;
  cpf_monthly: number;
  cpf_rate: number;
  /** How many years to look ahead. */
  years: number;
  /** The inputs left to the market's live estimates. */
  auto: Estimated[];
  guidance?: HousingGuidance;
};

export const DEFAULT_INPUTS: ScenarioInputs = {
  residency: "pr",
  nth: 1,
  kind: "hdb",
  market: "ALL:non-landed",
  price: 600_000,
  loan_type: "hdb",
  loan_share: 75,
  loan_rate: 2.6,
  loan_years: 25,
  lock_years: 2,
  // After a lock-in, banks' spreads over 3M SORA settle at 0.65-0.75.
  spread: 0.7,
  buy_costs: 5_000,
  renovation: 30_000,
  maintenance: 90,
  upkeep: 1_000,
  cost_growth: 2.5,
  annual_value: 30_000,
  growth: 3,
  sell_costs: 2,
  rent: 3_000,
  rent_growth: 2,
  rent_costs: 0,
  invest_return: 5,
  cpf_balance: 0,
  cpf_monthly: 0,
  cpf_rate: 2.5,
  years: 15,
  // Kept before there were estimates, a scenario keeps its own numbers.
  auto: [],
};

/** What each number may be, and whether it is whole. */
export const INPUT_LIMITS: Record<Exclude<keyof ScenarioInputs, "residency" | "kind" | "loan_type" | "market" | "auto" | "guidance">, [number, number, boolean?]> = {
  nth: [1, 3, true],
  price: [10_000, 100_000_000],
  loan_share: [0, 90],
  loan_rate: [0, 20],
  loan_years: [1, 35, true],
  lock_years: [0, 10, true],
  spread: [0, 10],
  buy_costs: [0, 10_000_000],
  renovation: [0, 10_000_000],
  maintenance: [0, 100_000],
  upkeep: [0, 1_000_000],
  cost_growth: [-10, 20],
  annual_value: [0, 10_000_000],
  growth: [-20, 30],
  sell_costs: [0, 20],
  rent: [0, 1_000_000],
  rent_growth: [-20, 30],
  rent_costs: [0, 1_000_000],
  invest_return: [-20, 30],
  cpf_balance: [0, 10_000_000],
  cpf_monthly: [0, 100_000],
  cpf_rate: [0, 10],
  years: [1, 99, true],
};

export class InputError extends Error {}

/** A scenario's inputs, checked: every number within reason, every choice one
 *  of its own. Anything missing takes its default, so a scenario kept before
 *  an input existed still opens. */
export function parseInputs(raw: unknown): ScenarioInputs {
  if (typeof raw !== "object" || raw === null || Array.isArray(raw)) throw new InputError("inputs must be an object");
  const given = raw as Record<string, unknown>;
  const out = { ...DEFAULT_INPUTS };
  const choice = <T extends string>(key: "residency" | "kind" | "loan_type" | "market", options: readonly T[]) => {
    const v = given[key];
    if (v === undefined) return;
    if (typeof v !== "string" || !options.includes(v as T)) throw new InputError(`${key} must be one of ${options.join(", ")}`);
    (out as Record<string, unknown>)[key] = v;
  };
  choice("residency", RESIDENCIES);
  choice("kind", HOME_KINDS);
  choice("loan_type", LOAN_TYPES);
  choice("market", PRIVATE_MARKETS);
  if (given.auto !== undefined) {
    const auto = given.auto;
    if (!Array.isArray(auto) || auto.some((k) => !ESTIMATED.includes(k))) throw new InputError(`auto must list some of ${ESTIMATED.join(", ")}`);
    out.auto = ESTIMATED.filter((k) => auto.includes(k));
  }
  for (const [key, [min, max, whole]] of Object.entries(INPUT_LIMITS)) {
    const v = given[key];
    if (v === undefined) continue;
    if (typeof v !== "number" || !Number.isFinite(v)) throw new InputError(`${key} must be a number`);
    if (v < min || v > max) throw new InputError(`${key} must be between ${min} and ${max}`);
    if (whole && !Number.isInteger(v)) throw new InputError(`${key} must be a whole number`);
    (out as Record<string, unknown>)[key] = v;
  }
  if (given.guidance !== undefined) {
    try { out.guidance = parseGuidance(given.guidance); }
    catch (err) { throw new InputError(err instanceof Error ? err.message : "Invalid guidance"); }
  }
  return out;
}

/** Required facts are separate from numerical defaults used while typing. */
export function comparisonReady(i: ScenarioInputs): boolean {
  try { parseInputs(i); } catch { return false; }
  const g = i.guidance;
  if (!g) return true; // already saved legacy scenarios
  if (!g.confirmed || (i.years > 35 && g.tenure === "unknown")) return false;
  if (g.tenure === "leasehold" && (g.lease_start === null || (remainingLease(g) ?? 0) <= 0)) return false;
  if (g.cpf_mode === "salary" && (!g.cpf_eligible || i.residency === "foreigner" || g.salary === null || g.age === null || g.retirement_age < g.age)) return false;
  return true;
}

/** Inputs as kept somewhere they may have gone stale -- a scenario saved under
 *  limits since narrowed, a draft saved mid-keystroke: each input that still
 *  passes kept, each that does not at its default, rather than all of it lost. */
export function readInputs(raw: unknown): ScenarioInputs {
  try {
    return parseInputs(raw);
  } catch {
    const given = typeof raw === "object" && raw !== null && !Array.isArray(raw) ? (raw as Record<string, unknown>) : {};
    const out: ScenarioInputs = { ...DEFAULT_INPUTS };
    for (const key of [...Object.keys(DEFAULT_INPUTS), "guidance"] as Array<keyof ScenarioInputs>) {
      try {
        (out as Record<string, unknown>)[key] = parseInputs({ [key]: given[key] })[key];
      } catch { /* this one stays at its default */ }
    }
    return out;
  }
}

/** Whether a number is one its input may take. */
export function withinLimits(key: keyof typeof INPUT_LIMITS, value: number): boolean {
  const [min, max, whole] = INPUT_LIMITS[key];
  return Number.isFinite(value) && value >= min && value <= max && (!whole || Number.isInteger(value));
}

/** Inputs brought within reason, as a form half filled in may not be: each
 *  number held to its limits and whole where it must be, anything not a number
 *  at its default. What the page works out while the owner is still typing. */
export function clampInputs(inputs: ScenarioInputs): ScenarioInputs {
  const out = { ...inputs };
  for (const [key, [min, max, whole]] of Object.entries(INPUT_LIMITS) as Array<[keyof typeof INPUT_LIMITS, [number, number, boolean?]]>) {
    const v = Number(inputs[key]);
    const n = Number.isFinite(v) ? Math.min(max, Math.max(min, v)) : DEFAULT_INPUTS[key];
    out[key] = whole ? Math.round(n) : n;
  }
  return out;
}

/** A year of the comparison: where each choice stands at its end -- the home
 *  as though sold then -- and what each costs a month during it. */
export type ProjectionYear = {
  year: number;
  home_value: number;
  loan_balance: number;
  /** The loan's rate at the year's end, % a year; null once it is repaid, or without one. */
  loan_rate: number | null;
  /** Selling it then: agent and legal fees, and seller's stamp duty within four years. */
  sale_costs: number;
  /** Everything, buying: the home's value less the loan and the costs of
   *  selling it, the investments, and the CPF account. */
  buy_net_worth: number;
  /** Everything, renting: the investments and the CPF account. */
  rent_net_worth: number;
  /** A month, in the year, of owning -- the instalment, maintenance, property
   *  tax and upkeep -- and of renting, CPF and cash together. */
  own_monthly: number;
  rent_monthly: number;
  /** Spent and gone since the start, owning: stamp duties, fees, renovation,
   *  interest, maintenance, tax, upkeep. Repaid principal is not among it. */
  own_spent: number;
  rent_spent: number;
  /** CPF used for the home, with the interest it would have earned: what a
   *  sale returns to the account before anything else. */
  cpf_refund: number;
};

/** A month of a year, on average, owning taken apart: what goes out, and what
 *  of it is a cost. Principal is not: it is still yours, in the home. */
export type OwningMonth = {
  year: number;
  /** Out of pocket, CPF and cash: the instalment, S&CC or maintenance,
   *  property tax, repairs and insurance. */
  paid: number;
  /** Repaid off the loan, and so into the home. */
  principal: number;
  interest: number;
  /** S&CC or maintenance, property tax, repairs and insurance. */
  running: number;
  /** The stamp duties, fees and renovation paid on buying, and the costs of
   *  selling at the end, spread over every month looked at. */
  one_off: number;
  /** What the money in the home -- all paid on buying, and the principal
   *  since -- would have earned invested instead: cash at the investment
   *  return, CPF at its own rate. */
  opportunity: number;
  /** The home's rise in value: a gain, set against the costs. */
  appreciation: number;
  /** What owning costs: interest, running costs, one-off costs and the
   *  opportunity, less the rise in value. */
  net: number;
  /** A month of renting: the rent and its fees. */
  rent: number;
};

export type Projection = {
  upfront: {
    down_payment: number;
    loan: number;
    bsd: number;
    absd: number;
    buy_costs: number;
    renovation: number;
    total: number;
    from_cpf: number;
    from_cash: number;
  };
  /** The first month's instalment. */
  instalment: number;
  years: ProjectionYear[];
  /** Each year's average month, owning taken apart, from the first year on.
   *  Summed over the years, with nothing earning, owning's costs less rent
   *  come to the gap between the two at the end; with returns, the net worth
   *  compounds and this does not, so the gap is the one to go by. */
  monthly: OwningMonth[];
  /** The first year whose end finds buying ahead, or null within the years looked at. */
  break_even: number | null;
  notes: string[];
};

const round = (n: number) => Math.round(n * 100) / 100;
const monthly = (yearlyPercent: number) => (1 + yearlyPercent / 100) ** (1 / 12) - 1;

/** How the world moves while a comparison plays out, month by month from month
 *  0: one future, steady or simulated. */
export type Economy = {
  /** The home's price, relative to the start: price[0] is 1. */
  price: number[];
  /** The market rent for the same home, relative to the start. A lease is
   *  renewed each year at the market rent then, and the annual value with it. */
  rent: number[];
  /** Prices in general, relative to the start: S&CC, maintenance and repairs
   *  move with them, set each year. */
  costs: number[];
  /** What investments earn in month m, from 1: 0.004 is 0.4%. */
  invest: number[];
  /** 3-month compounded SORA in month m, % a year: what a bank loan pays its
   *  spread over once its rate is no longer fixed. */
  sora: number[];
};

/** The steady future: every rate as the inputs set it, unmoving. SORA sits
 *  where it leaves a bank loan's rate unchanged after its lock-in. */
export function steadyEconomy(i: ScenarioInputs, months = i.years * 12): Economy {
  const path = (yearly: number) => Array.from({ length: months + 1 }, (_, m) => (1 + yearly / 100) ** (m / 12));
  const earn = monthly(i.invest_return);
  return {
    price: path(i.growth),
    rent: path(i.rent_growth),
    costs: path(i.cost_growth),
    invest: Array.from({ length: months + 1 }, (_, m) => (m === 0 ? 0 : earn)),
    sora: Array(months + 1).fill(Math.max(0, i.loan_rate - i.spread)),
  };
}

/** The day the schedule starts on: any will do, its repayments 30/360. */
const LOAN_START = "2026-01-01";

/** A bank loan's rate after its lock-in: SORA over the three months to each
 *  reset, plus the spread -- as the rate changes loanSchedule takes, each
 *  setting a new instalment that clears the loan over the months left. */
export function bankRateChanges(i: ScenarioInputs, sora: number[], loanMonths: number): LoanRateChangeTerms[] {
  if (i.loan_type !== "bank") return [];
  const changes: LoanRateChangeTerms[] = [];
  let rate = i.loan_rate;
  for (let k = i.lock_years * 12 + 1; k <= loanMonths; k += 3) {
    const next = Math.round(Math.max(0, (sora[Math.min(k, sora.length - 1)] ?? 0) + i.spread) * 10_000) / 10_000;
    if (next !== rate) changes.push({ effective_date: addMonths(LOAN_START, k - 1), rate: next, payment: null });
    rate = next;
  }
  return changes;
}

/** Buying against renting a comparable home, month by month.
 *
 *  Both start with the same money. The buyer pays the down payment, the
 *  stamp duties, the fees and the renovation, CPF first where CPF may pay --
 *  the down payment past the cash a bank loan wants, and BSD -- and the rest
 *  in cash; the renter invests that cash instead. Each month both have the
 *  same to spend, the dearer choice's outgoings: the other invests what it
 *  saves. CPF contributions pay the buyer's instalments first; the renter's
 *  stay in the account, as rent cannot be paid from it.
 *
 *  Each year ends with the home as though sold: its value grown at `growth`,
 *  less the loan and the costs of selling. What a sale returns to CPF moves
 *  money from the proceeds to the account, so it changes neither side's total
 *  and is shown, not deducted. The instalments are loanSchedule's, as the
 *  finance page schedules a bank's.
 *
 *  `economy` is how prices, rents, costs, returns and SORA move: steady at the
 *  inputs' rates unless a path is given, as the growth model gives one. */
export function rentOrBuy(inputs: ScenarioInputs, economy?: Economy): Projection {
  const i = inputs.guidance?.annual_value_auto
    ? { ...inputs, annual_value: Math.min(10_000_000, inputs.rent * 12) } : inputs;
  const e = economy ?? steadyEconomy(i);
  const loan = round(i.price * (i.loan_share / 100));
  const downPayment = round(i.price - loan);
  const bsd = buyerStampDuty(i.price);
  const absd = additionalBuyerStampDuty(i.price, i.residency, i.nth);

  // CPF pays what it may at the start: the down payment past a bank loan's 5%
  // in cash, and BSD.
  const cashDown = i.loan_type === "bank" && loan > 0 ? Math.min(downPayment, round(i.price * 0.05)) : 0;
  let cpfBuy = i.cpf_balance;
  const cpfLimit = i.guidance ? cpfHousingLimit(i.guidance, i.price) : Infinity;
  const fromCpf = Math.min(cpfBuy, downPayment - cashDown + bsd, cpfLimit);
  let cpfPrincipalUsed = fromCpf;
  cpfBuy -= fromCpf;
  const upfrontTotal = downPayment + bsd + absd + i.buy_costs + i.renovation;
  const fromCash = round(upfrontTotal - fromCpf);

  const months = i.years * 12;
  const loanMonths = i.loan_years * 12;
  const schedule = loan > 0
    ? loanSchedule({
      principal: loan, rate: i.loan_rate, start: LOAN_START, months: loanMonths, method: "annuity",
      rateChanges: bankRateChanges(i, e.sora, loanMonths),
    }).periods
    : [];

  const cpfGrow = monthly(i.cpf_rate);
  let cashBuy = 0, cashRent = fromCash, cpfRent = i.cpf_balance;
  let cpfUsed = fromCpf;
  let ownSpent = bsd + absd + i.buy_costs + i.renovation, rentSpent = 0;
  let balance = loan;
  const years: ProjectionYear[] = [];

  const yearEnd = (year: number, ownMonthly: number, rentMonthly: number) => {
    const value = i.price * e.price[year * 12] * leaseFactor(i.guidance, year * 12);
    const saleCosts = value * (i.sell_costs / 100) + sellerStampDuty(value, year);
    const rateThen = year === 0 ? schedule[0]?.rate : balance > 0 ? schedule[year * 12 - 1]?.rate : undefined;
    years.push({
      year,
      home_value: round(value),
      loan_balance: round(balance),
      loan_rate: rateThen ?? null,
      sale_costs: round(saleCosts),
      buy_net_worth: round(value - balance - saleCosts + cashBuy + cpfBuy),
      rent_net_worth: round(cashRent + cpfRent),
      own_monthly: round(ownMonthly),
      rent_monthly: round(rentMonthly),
      own_spent: round(ownSpent),
      rent_spent: round(rentSpent),
      cpf_refund: round(cpfUsed),
    });
  };
  const firstOwn = (schedule[0]?.payment ?? 0) + (i.maintenance + i.upkeep / 12) * e.costs[0] + ownerOccupierTax(i.annual_value * e.rent[0]) / 12;
  yearEnd(0, firstOwn, i.rent * e.rent[0] + i.rent_costs / 12);

  // Owning taken apart. The one-off costs are spread over every month looked
  // at, selling's at the end included; the money in the home is what was paid
  // on buying and the principal since, kept apart by where it came from.
  const valueAt = (month: number) => i.price * e.price[month] * leaseFactor(i.guidance, month);
  const endValue = valueAt(months);
  const oneOff = (bsd + absd + i.buy_costs + i.renovation + endValue * (i.sell_costs / 100) + sellerStampDuty(endValue, i.years)) / months;
  let inHomeCash = fromCash, inHomeCpf = fromCpf;
  const owning: OwningMonth[] = [];
  const blank = () => ({ paid: 0, principal: 0, interest: 0, running: 0, opportunity: 0, appreciation: 0, rent: 0 });
  let sum = blank();

  let ownMonthly = 0, rentMonthly = 0;
  for (let m = 1; m <= months; m++) {
    const year = Math.floor((m - 1) / 12);
    const period = schedule[m - 1];
    const instalment = period?.payment ?? 0;
    // The lease, the annual value and the running costs are set for the year
    // at its start, at the market then.
    const renewal = year * 12;
    const expired = leaseFactor(i.guidance, m - 1) === 0;
    const tax = expired ? 0 : ownerOccupierTax(i.annual_value * e.rent[renewal]) / 12;
    const rent = i.rent * e.rent[renewal];
    const running = expired ? 0 : (i.maintenance + i.upkeep / 12) * e.costs[renewal];
    const grow = e.invest[m];
    // What the money already in the home would have earned this month.
    sum.opportunity += inHomeCash * grow + inHomeCpf * cpfGrow;

    // The month's growth on what each holds, then the month's money.
    cashBuy *= 1 + grow;
    cashRent *= 1 + grow;
    const contribution = i.guidance?.cpf_mode === "none" ? 0 : i.guidance?.cpf_mode === "salary" ? salaryOa(i.guidance, m - 1) : i.cpf_monthly;
    cpfBuy = cpfBuy * (1 + cpfGrow) + contribution;
    cpfRent = cpfRent * (1 + cpfGrow) + contribution;
    cpfUsed *= 1 + cpfGrow;

    const byCpf = expired ? 0 : Math.min(cpfBuy, instalment, Math.max(0, cpfLimit - cpfPrincipalUsed));
    cpfPrincipalUsed += byCpf;
    cpfBuy -= byCpf;
    cpfUsed += byCpf;
    ownMonthly = instalment + running + tax + (expired ? rent + i.rent_costs / 12 : 0);
    rentMonthly = rent + i.rent_costs / 12;
    const ownCash = ownMonthly - byCpf;
    const budget = Math.max(ownCash, rentMonthly);
    cashBuy += budget - ownCash;
    cashRent += budget - rentMonthly;

    ownSpent += (period?.interest ?? 0) + running + tax + (expired ? rent + i.rent_costs / 12 : 0);
    rentSpent += rentMonthly;
    if (period) balance = period.balance;

    const principal = period?.principal ?? 0;
    // The principal goes into the home as the instalment was paid: CPF's
    // share of it from CPF, the rest in cash.
    const cpfShare = instalment > 0 ? byCpf / instalment : 0;
    inHomeCpf += principal * cpfShare;
    inHomeCash += principal * (1 - cpfShare);
    sum.paid += ownMonthly;
    sum.principal += principal;
    sum.interest += period?.interest ?? 0;
    sum.running += running + tax + (expired ? rent + i.rent_costs / 12 : 0);
    sum.appreciation += valueAt(m) - valueAt(m - 1);
    sum.rent += rentMonthly;

    if (m % 12 === 0) {
      yearEnd(m / 12, ownMonthly, rentMonthly);
      const net = (sum.interest + sum.running + sum.opportunity - sum.appreciation) / 12 + oneOff;
      owning.push({
        year: m / 12,
        paid: round(sum.paid / 12),
        principal: round(sum.principal / 12),
        interest: round(sum.interest / 12),
        running: round(sum.running / 12),
        one_off: round(oneOff),
        opportunity: round(sum.opportunity / 12),
        appreciation: round(sum.appreciation / 12),
        net: round(net),
        rent: round(sum.rent / 12),
      });
      sum = blank();
    }
  }

  const ahead = years.find((y) => y.year > 0 && y.buy_net_worth >= y.rent_net_worth);
  return {
    upfront: {
      down_payment: downPayment,
      loan,
      bsd,
      absd,
      buy_costs: i.buy_costs,
      renovation: i.renovation,
      total: round(upfrontTotal),
      from_cpf: round(fromCpf),
      from_cash: fromCash,
    },
    instalment: schedule[0]?.payment ?? 0,
    years,
    monthly: owning,
    break_even: ahead?.year ?? null,
    notes: notesOn(i),
  };
}

/** What the figures assume that the rules may not allow: said, never refused. */
export function notesOn(i: ScenarioInputs): string[] {
  const notes: string[] = [];
  if (i.guidance?.tenure === "leasehold") notes.push("地契按起始年份估算，价值采用 3% 折现的居住权衰减假设；到期价值为零，随后计入替代租金，不假设续期或集体出售。");
  if (i.years > 35) notes.push("超过 35 年的结果仅用于探索假设；历史样本不足以支持远期胜率预测。");
  if (i.guidance?.cpf_mode === "salary") notes.push("CPF 工资估算采用 2026 及已公布的 2027 年规则，之后沿用 2027 规则；月薪不变、每年增长一岁并在设定年龄停缴，不含奖金或退休账户溢出。");
  if (i.guidance && i.guidance.cpf_mode !== "none" && cpfHousingLimit(i.guidance, i.price) === 0) notes.push("CPF 买房额度未核实或剩余地契不足：暂按现金付款。请用 CPF 官方计算器确认额度后填写。");
  if (i.kind === "hdb" && i.residency === "foreigner") notes.push("Foreigners cannot buy HDB flats; the figures go ahead as though they could.");
  if (i.kind === "hdb" && i.residency === "pr") notes.push("A PR household buys HDB flats on the resale market only, and only after three years as PRs.");
  if (i.kind === "hdb" && i.years < 5) notes.push("An HDB flat cannot be sold within its five-year minimum occupation period.");
  if (i.kind === "private" && i.loan_type === "hdb") notes.push("HDB lends only for HDB flats.");
  if (i.loan_share > 75) notes.push("Neither HDB nor the banks lend more than 75% of the price on a first loan.");
  if (i.loan_type === "hdb" && i.loan_years > 25) notes.push("An HDB loan runs at most 25 years.");
  if (i.cpf_balance + i.cpf_monthly > 0 && i.residency === "foreigner") notes.push("Foreigners have no CPF account.");
  return notes;
}

/** Inputs from the market: an HDB town's median price and rent for a flat
 *  type, and how both have grown over ten years -- or, for a kind of private
 *  home, which market it is and how URA's indices have grown, prices and
 *  rents being the buyer's own. The growth stands in for the market's
 *  estimates where there are none. */
export function inputsFromMarket(data: MarketData, choice: { kind: "hdb"; town: string; flatType: string } | { kind: "private"; area: string; segment: string }): Partial<ScenarioInputs> {
  const pct = (g: number | null) => (g === null ? undefined : Math.round(g * 1000) / 10);
  if (choice.kind === "private") {
    const market = PRIVATE_MARKETS.find((k) => k === `${choice.area}:${choice.segment}`);
    return strip({
      kind: "private",
      market,
      loan_type: "bank",
      growth: pct(yearlyGrowth(findSeries(data, "ura_ppi", choice.area, choice.segment), 10)),
      rent_growth: pct(yearlyGrowth(findSeries(data, "ura_rri", choice.area, choice.segment), 10)),
    });
  }
  const price = findSeries(data, "hdb_resale", choice.town, choice.flatType);
  const rent = findSeries(data, "hdb_rent", choice.town, choice.flatType);
  const pair = paired(price, rent).at(-1);
  return strip({
    kind: "hdb",
    price: pair?.a,
    rent: pair?.b,
    annual_value: pair ? pair.b * 12 : undefined,
    growth: pct(yearlyGrowth(price, 10) ?? yearlyGrowth(findSeries(data, "hdb_rpi", "ALL", "all"), 10)),
    rent_growth: pct(yearlyGrowth(rent, 10)),
  });
}

function strip<T extends Record<string, unknown>>(o: T): Partial<T> {
  return Object.fromEntries(Object.entries(o).filter(([, v]) => v !== undefined)) as Partial<T>;
}
