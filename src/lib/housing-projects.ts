import { quarterLabel, quarterNumber, quarterOfDay, quarterStart } from "@/lib/housing";

/** Private developments the owner follows, and what URA recorded of them:
 *  sales over five years and a year of rental contracts, read from URA's Data
 *  Service (src/lib/ura.ts) -- the records, and their middle and average by
 *  size and by quarter, which is what the page shows. */

export const SQFT_PER_SQM = 10.7639;
/** Developments that may be followed at once: each costs URA's files a read. */
export const MAX_PROJECTS = 10;

export type SaleType = "new" | "sub" | "resale";
export type Segment = "CCR" | "RCR" | "OCR";

/** A sale: a caveat lodged, as URA records it. */
export type ProjectSale = {
  /** The month of the contract, as its first day. */
  month: string;
  price: number;
  area_sqm: number;
  /** 06-10, or null for a landed home. */
  floor_range: string | null;
  sale_type: SaleType | null;
  property_type: string | null;
  units: number;
};

/** A rental contract, as URA records it: its floor area banded, in square feet. */
export type ProjectRent = {
  /** The quarter it was read for, and the month the lease began, as first days. */
  quarter: string;
  month: string;
  /** A month's rent. */
  rent: number;
  sqft_low: number | null;
  sqft_high: number | null;
  bedrooms: number | null;
};

export type Project = {
  name: string;
  street: string | null;
  district: string | null;
  segment: Segment | null;
  added_at: string;
  /** When URA was last read for it; null until it has been. */
  read_at: string | null;
  /** Whether URA had anything under its name; null until it has been read. */
  found: boolean | null;
  sales: ProjectSale[];
  rents: ProjectRent[];
};

/** A development's name as URA writes it: in capitals, one space between
 *  words. Null for nothing, or for more than eighty characters. */
export function projectName(raw: unknown): string | null {
  if (typeof raw !== "string") return null;
  const name = raw.replace(/\s+/g, " ").trim().toUpperCase();
  return name.length >= 1 && name.length <= 80 ? name : null;
}

/** Some figures summed up: how many, their quartiles, and their average. */
export type Summary = { count: number; p25: number; p50: number; p75: number; mean: number };

function quantile(sorted: readonly number[], p: number): number {
  const at = (sorted.length - 1) * p;
  const below = Math.floor(at);
  const above = Math.min(below + 1, sorted.length - 1);
  return sorted[below] + (sorted[above] - sorted[below]) * (at - below);
}

export function summarize(values: readonly number[]): Summary | null {
  if (values.length === 0) return null;
  const sorted = [...values].sort((a, b) => a - b);
  return {
    count: sorted.length,
    p25: quantile(sorted, 0.25),
    p50: quantile(sorted, 0.5),
    p75: quantile(sorted, 0.75),
    mean: sorted.reduce((a, b) => a + b, 0) / sorted.length,
  };
}

/** A sale's floor area in square feet, and its price a square foot. */
export const sqftOf = (s: ProjectSale) => s.area_sqm * SQFT_PER_SQM;
export const psfOf = (s: ProjectSale) => s.price / sqftOf(s);

/** A floor-area band in square feet; an open end is null. */
export type Band = { low: number | null; high: number | null };

export function bandLabel(b: Band): string {
  if (b.low === null) return `Up to ${b.high!.toLocaleString("en-SG")} sqft`;
  if (b.high === null) return `${b.low.toLocaleString("en-SG")} sqft and up`;
  return `${b.low.toLocaleString("en-SG")}–${b.high.toLocaleString("en-SG")} sqft`;
}

const bandKey = (b: Band) => `${b.low ?? ""}-${b.high ?? ""}`;
const inBand = (sqft: number, b: Band) => (b.low === null || sqft >= b.low) && (b.high === null || sqft < b.high);

/** The month a year before the latest of some months -- the start of the
 *  twelve months to it -- or null without any. */
function yearTo(months: readonly string[]): string | null {
  const latest = months.reduce<string | null>((a, m) => (a === null || m > a ? m : a), null);
  if (!latest) return null;
  const [y, m] = latest.split("-").map(Number);
  const back = new Date(Date.UTC(y, m - 1 - 11, 1));
  return back.toISOString().slice(0, 10);
}

/** The sales and the rental contracts of a development's latest twelve months
 *  of each: what its middles and averages are taken over. */
export function lastYear(p: Pick<Project, "sales" | "rents">): { sales: ProjectSale[]; rents: ProjectRent[]; salesFrom: string | null; rentsFrom: string | null } {
  const salesFrom = yearTo(p.sales.map((s) => s.month));
  const rentsFrom = yearTo(p.rents.map((r) => r.month));
  return {
    sales: salesFrom ? p.sales.filter((s) => s.month >= salesFrom) : [],
    rents: rentsFrom ? p.rents.filter((r) => r.month >= rentsFrom) : [],
    salesFrom,
    rentsFrom,
  };
}

/** A size of home in a development, over its latest year: what sold, at what
 *  price and price a square foot; what let, at what rent, with how many
 *  bedrooms most often; and the rent's year over the price, the gross yield,
 *  middle to middle. */
export type BandRow = {
  band: Band;
  label: string;
  prices: Summary | null;
  psf: Summary | null;
  rents: Summary | null;
  bedrooms: number | null;
  yield: number | null;
};

/** A development's latest year by size. The bands are the ones URA puts its
 *  rental contracts in; a sale falls in the one holding its floor area, or,
 *  where no contract was in a band that would hold it, a band of a hundred
 *  square feet of its own. Smallest first. */
export function byBand(p: Pick<Project, "sales" | "rents">): BandRow[] {
  const { sales, rents } = lastYear(p);
  const bands = new Map<string, Band>();
  for (const r of rents) {
    if (r.sqft_low === null && r.sqft_high === null) continue;
    const b = { low: r.sqft_low, high: r.sqft_high };
    bands.set(bandKey(b), b);
  }
  const known = [...bands.values()];
  const salesIn = new Map<string, ProjectSale[]>();
  for (const s of sales) {
    const sqft = sqftOf(s);
    const b = known.find((k) => inBand(sqft, k)) ?? { low: Math.floor(sqft / 100) * 100, high: Math.floor(sqft / 100) * 100 + 100 };
    bands.set(bandKey(b), b);
    const list = salesIn.get(bandKey(b)) ?? [];
    list.push(s);
    salesIn.set(bandKey(b), list);
  }
  return [...bands.values()]
    .sort((a, b) => (a.low ?? -1) - (b.low ?? -1) || (a.high ?? Infinity) - (b.high ?? Infinity))
    .map((band) => {
      const sold = salesIn.get(bandKey(band)) ?? [];
      const let_ = rents.filter((r) => r.sqft_low === band.low && r.sqft_high === band.high);
      const prices = summarize(sold.map((s) => s.price / s.units));
      const rentSummary = summarize(let_.map((r) => r.rent));
      const counts = new Map<number, number>();
      for (const r of let_) if (r.bedrooms !== null) counts.set(r.bedrooms, (counts.get(r.bedrooms) ?? 0) + 1);
      const bedrooms = [...counts].sort((a, b) => b[1] - a[1] || a[0] - b[0])[0]?.[0] ?? null;
      return {
        band,
        label: bandLabel(band),
        prices,
        psf: summarize(sold.map(psfOf)),
        rents: rentSummary,
        bedrooms,
        yield: prices && rentSummary ? (rentSummary.p50 * 12) / prices.p50 : null,
      };
    });
}

/** Rental contracts of the latest year by bedrooms: what each size of home lets for. */
export function byBedrooms(p: Pick<Project, "sales" | "rents">): Array<{ bedrooms: number | null; rents: Summary }> {
  const { rents } = lastYear(p);
  const keys = [...new Set(rents.map((r) => r.bedrooms))].sort((a, b) => (a ?? 99) - (b ?? 99));
  return keys.map((bedrooms) => ({ bedrooms, rents: summarize(rents.filter((r) => r.bedrooms === bedrooms).map((r) => r.rent))! }));
}

/** A quarter of a development's history: its sales' prices a square foot,
 *  and its rents, summed up. */
export type QuarterRow = { quarter: string; label: string; psf: Summary | null; rents: Summary | null };

/** Every quarter from the first with a record to the last, in order. */
export function byQuarter(p: Pick<Project, "sales" | "rents">): QuarterRow[] {
  const of = (month: string) => quarterOfDay(month);
  const quarters = [...p.sales.map((s) => of(s.month)), ...p.rents.map((r) => of(r.month))];
  if (!quarters.length) return [];
  const first = Math.min(...quarters.map(quarterNumber)), last = Math.max(...quarters.map(quarterNumber));
  const out: QuarterRow[] = [];
  for (let n = first; n <= last; n++) {
    const quarter = `${Math.floor(n / 4)}-Q${(n % 4) + 1}`;
    out.push({
      quarter,
      label: quarterLabel(quarter),
      psf: summarize(p.sales.filter((s) => of(s.month) === quarter).map(psfOf)),
      rents: summarize(p.rents.filter((r) => of(r.month) === quarter).map((r) => r.rent)),
    });
  }
  return out;
}

/** The quarter's first day, the way the tables keep it. */
export const quarterDay = (quarter: string) => quarterStart(quarter)!;
