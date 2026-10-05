import type { SupabaseClient } from "@supabase/supabase-js";
import { MISSING_TABLE, pagesOf } from "@/lib/paginate";
import {
  EQUITY_SEGMENT, nextQuarter, quarterFromNumber, quarterNumber, quarterOfDay, quarterStart, type MarketData, type MarketSeries, type Series,
} from "@/lib/housing";

/** Singapore's housing market, from data.gov.sg: the government's open data,
 *  free and keyless. HDB publishes each town's median resale price and median
 *  rent by flat type every quarter, and its resale price index; URA its price
 *  and rental indices for private homes, 2009 Q1 = 100. Each dataset is read
 *  whole, and only once its catalogue entry says it has changed: they move
 *  quarterly, and the daily job asks every day.
 *
 *  Server-side only. */

/** A figure as kept: one series' value for a quarter, `quarter` its first day. */
export type MarketRow = { series: Series; area: string; segment: string; quarter: string; value: number };

type Dataset = {
  id: string;
  /** What it is, for a reader of the code and of a failure. */
  name: string;
  /** Only the records whose fields hold these values: a dataset of two hundred
   *  series of which one is wanted. */
  filters?: Record<string, string>;
  /** A record as a figure -- or figures, from a record holding a series a
   *  column a month -- or null for one to pass over: a quarter with too few
   *  deals to publish a median comes as "-" or "na". */
  read: (record: Record<string, unknown>) => MarketRow | MarketRow[] | null;
};

/** A number the source wrote as text, or null where it wrote none. */
export function amount(raw: unknown): number | null {
  const n = typeof raw === "number" ? raw : typeof raw === "string" && raw.trim() !== "" ? Number(raw.trim()) : NaN;
  return Number.isFinite(n) && n > 0 ? n : null;
}

/** An HDB town as one spelling: the medians write the same town in capitals
 *  one year and title case the next, sometimes with a trailing space, and the
 *  centre both as CENTRAL and CENTRAL AREA. */
export function hdbTown(raw: unknown): string | null {
  if (typeof raw !== "string") return null;
  const town = raw.replace(/\s+/g, " ").trim().toUpperCase();
  if (!/^[A-Z][A-Z /&'.-]{0,39}$/.test(town)) return null;
  return town === "CENTRAL AREA" ? "CENTRAL" : town;
}

/** An HDB flat type as one spelling: the prices say "4-room" and "Executive",
 *  the rents "4-RM" and "EXEC". */
export function hdbFlatType(raw: unknown): string | null {
  if (typeof raw !== "string") return null;
  const type = raw.trim().toUpperCase();
  const rooms = /^([1-5])[- ]?(ROOM|RM)$/.exec(type);
  if (rooms) return `${rooms[1]}-room`;
  return type === "EXEC" || type === "EXECUTIVE" ? "executive" : null;
}

const URA_REGIONS: Record<string, string> = {
  "WHOLE ISLAND": "ALL",
  "CORE CENTRAL REGION": "CCR",
  "REST OF CENTRAL REGION": "RCR",
  "OUTSIDE CENTRAL REGION": "OCR",
};
const URA_TYPES: Record<string, string> = { "ALL RESIDENTIAL": "all", LANDED: "landed", "NON-LANDED": "non-landed" };
const upper = (raw: unknown) => (typeof raw === "string" ? raw.replace(/\s+/g, " ").trim().toUpperCase() : "");

function row(series: Series, area: string | null | undefined, segment: string | null | undefined, quarter: unknown, value: unknown): MarketRow | null {
  const start = typeof quarter === "string" ? quarterStart(quarter.trim()) : null;
  const n = amount(value);
  return area && segment && start && n !== null ? { series, area, segment, quarter: start, value: n } : null;
}

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

/** A record that holds a series a column a month, as SingStat's do -- "2026Jul"
 *  and so on -- as one figure a quarter: the last month it has, so each quarter
 *  is as it ended and the one still running as it stands. */
export function quarterlyFromMonths(record: Record<string, unknown>, series: Series, area: string, segment: string): MarketRow[] {
  const quarters = new Map<string, { month: number; value: number }>();
  for (const [key, raw] of Object.entries(record)) {
    const m = /^(\d{4})([A-Z][a-z]{2})$/.exec(key);
    const month = m ? MONTHS.indexOf(m[2]) : -1;
    const value = amount(raw);
    if (!m || month < 0 || value === null) continue;
    const quarter = `${m[1]}-Q${Math.floor(month / 3) + 1}`;
    const kept = quarters.get(quarter);
    if (!kept || month > kept.month) quarters.set(quarter, { month, value });
  }
  return [...quarters].map(([quarter, { value }]) => ({ series, area, segment, quarter: quarterStart(quarter)!, value }));
}

/** SingStat's interest rates, by the name of their series. */
const RATE_SERIES: Record<string, [Series, string]> = {
  "Compounded Singapore Overnight Rate Average (SORA) - 3 Month": ["sora", "3m"],
  "Government Securities - 1-Year Treasury Bills Yield": ["sgs", "1y"],
  "Government Securities - 2-Year Bond Yield": ["sgs", "2y"],
  "Government Securities - 5-Year Bond Yield": ["sgs", "5y"],
  "Government Securities - 10-Year Bond Yield": ["sgs", "10y"],
};

/** What is read, and how. The private indices come in two datasets, by kind of
 *  home island-wide and for flats by region, which share a series and never a
 *  figure. */
export const DATASETS: Dataset[] = [
  {
    id: "d_b51323a474ba789fb4cc3db58a3116d4",
    name: "HDB median resale prices by town and flat type",
    read: (r) => row("hdb_resale", hdbTown(r.town), hdbFlatType(r.flat_type), r.quarter, r.price),
  },
  {
    id: "d_23000a00c52996c55106084ed0339566",
    name: "HDB median rents by town and flat type",
    read: (r) => row("hdb_rent", hdbTown(r.town), hdbFlatType(r.flat_type), r.quarter, r.median_rent),
  },
  {
    id: "d_14f63e595975691e7c24a27ae4c07c79",
    name: "HDB resale price index",
    read: (r) => row("hdb_rpi", "ALL", "all", r.quarter, r.index),
  },
  {
    id: "d_97f8a2e995022d311c6c68cfda6d034c",
    name: "URA private residential price index by type",
    read: (r) => row("ura_ppi", "ALL", URA_TYPES[upper(r.property_type)], r.quarter, r.index),
  },
  {
    id: "d_f65e490a8ad430f60a9a3d9df2bff2a0",
    name: "URA non-landed price index by region",
    read: (r) => row("ura_ppi", URA_REGIONS[upper(r.market_segment)], "non-landed", r.quarter, r.price_index),
  },
  {
    id: "d_8e4c50283fb7052a391dfb746a05c853",
    name: "URA private residential rental index",
    read: (r) => row("ura_rri", URA_REGIONS[upper(r.locality)], URA_TYPES[upper(r.property_type)], r.quarter, r.index),
  },
  {
    id: "d_5fe5a4bb4a1ecc4d8a56a095832e2b24",
    name: "SingStat interest rates: SORA and government securities' yields",
    read: (r) => {
      const target = RATE_SERIES[String(r.DataSeries ?? "").trim()];
      return target ? quarterlyFromMonths(r, target[0], "ALL", target[1]) : null;
    },
  },
  {
    id: "d_bdaff844e3ef89d39fceb962ff8f0791",
    name: "SingStat consumer price index, all items",
    filters: { DataSeries: "All Items" },
    read: (r) => (String(r.DataSeries ?? "").trim() === "All Items" ? quarterlyFromMonths(r, "cpi", "ALL", "all") : null),
  },
];

const RECORDS = "https://data.gov.sg/api/action/datastore_search";
const CATALOGUE = "https://api-production.data.gov.sg/v2/public/api/datasets";
/** Records a request: more than any of these datasets holds, so each is read in one. */
const PAGE = 20_000;
const TIMEOUT_MS = 25_000;
/** A dataset's figures go in this many at a time. */
const WRITE_BATCH = 2000;
/** Tries a request gets, in all. */
const ATTEMPTS = 3;

/** Why a dataset could not be read. */
export class SourceError extends Error {}

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

export type SourceOptions = {
  fetcher?: typeof fetch;
  /** data.gov.sg's API key, which lifts its rate limits: DATA_GOV_SG_API_KEY unless given. */
  apiKey?: string | null;
  /** The least time between two requests for records. Without a key
   *  data.gov.sg answers four every ten seconds and turns away the rest with
   *  a 429 -- which is how the first backfill, asking for six datasets at once
   *  from Vercel, lost two of them. */
  spacing?: number;
  /** How long to wait before asking again after no answer, a 5xx, or a 429
   *  that does not say (its window is ten seconds). */
  backoff?: number;
};

/** data.gov.sg, as this reads it: a dataset's catalogue entry and its records.
 *  Requests for records are spaced to its rate limit; one turned away or not
 *  answered is asked again, up to three tries in all, after a pause -- the
 *  429's Retry-After where it gives one. Anything else is said at once. */
export function dataGovSg({
  fetcher = fetch,
  apiKey = process.env.DATA_GOV_SG_API_KEY?.trim() || null,
  spacing = 2_600,
  backoff = 10_000,
}: SourceOptions = {}) {
  const headers: Record<string, string> = { accept: "application/json", ...(apiKey ? { "x-api-key": apiKey } : {}) };
  let lastRecords = Number.NEGATIVE_INFINITY;

  async function get(url: string, records: boolean): Promise<unknown> {
    let reason = "no answer";
    for (let attempt = 1; attempt <= ATTEMPTS; attempt++) {
      if (records) {
        const wait = lastRecords + spacing - Date.now();
        if (wait > 0) await sleep(wait);
        lastRecords = Date.now();
      }
      let pause = backoff;
      try {
        const res = await fetcher(url, { headers, cache: "no-store", signal: AbortSignal.timeout(TIMEOUT_MS) });
        if (res.ok) return await res.json();
        reason = `HTTP ${res.status}`;
        if (res.status !== 429 && res.status < 500) break;
        const after = Number(res.headers.get("retry-after"));
        if (after > 0) pause = Math.min(after * 1000, 30_000);
      } catch (err) {
        reason = err instanceof Error ? err.message : String(err);
      }
      if (attempt < ATTEMPTS) await sleep(pause);
    }
    throw new SourceError(reason);
  }

  return {
    /** When data.gov.sg last changed a dataset, as its catalogue says. */
    async lastUpdated(id: string): Promise<string> {
      const body = await get(`${CATALOGUE}/${id}/metadata`, false) as { data?: { lastUpdatedAt?: unknown } };
      const at = body?.data?.lastUpdatedAt;
      if (typeof at !== "string" || Number.isNaN(Date.parse(at))) throw new SourceError("its catalogue entry has no update time");
      return new Date(at).toISOString();
    },

    /** Every record of a dataset -- or those `filters` names -- in the order
     *  it was published, so of two records for the same figure, as the rents
     *  have for 2020 Q1, the later wins. */
    async records(id: string, filters?: Record<string, string>): Promise<Record<string, unknown>[]> {
      const out: Record<string, unknown>[] = [];
      const only = filters ? `&filters=${encodeURIComponent(JSON.stringify(filters))}` : "";
      for (let offset = 0; ; offset += PAGE) {
        const url = `${RECORDS}?resource_id=${id}&limit=${PAGE}&offset=${offset}&sort=${encodeURIComponent("_id asc")}${only}`;
        const body = await get(url, true) as { success?: boolean; result?: { records?: unknown; total?: unknown } };
        const records = body?.result?.records;
        if (body?.success !== true || !Array.isArray(records)) throw new SourceError("an answer without records");
        out.push(...(records as Record<string, unknown>[]));
        const total = Number(body.result?.total);
        if (records.length < PAGE || (Number.isFinite(total) && out.length >= total)) return out;
      }
    },
  };
}

/** A dataset's records as figures, one per series, place, kind and quarter. */
export function readDataset(dataset: Pick<Dataset, "read">, records: Record<string, unknown>[]): MarketRow[] {
  const figures = new Map<string, MarketRow>();
  for (const record of records) {
    const read = dataset.read(record);
    for (const figure of Array.isArray(read) ? read : read ? [read] : []) {
      figures.set(`${figure.series}|${figure.area}|${figure.segment}|${figure.quarter}`, figure);
    }
  }
  return [...figures.values()];
}

/** Where the money not put into a home is taken to go: the S&P 500 with its
 *  dividends reinvested, in Singapore dollars -- the longest history of shares
 *  to be had without a key, from Yahoo Finance's chart endpoint, the one the
 *  stock prices come from. */
export const EQUITY = { symbol: "^SP500TR", fx: "SGD=X", segment: EQUITY_SEGMENT } as const;
const CHART = "https://query1.finance.yahoo.com/v8/finance/chart";

/** A chart answer's month-end values by month, YYYY-MM. Yahoo dates a monthly
 *  bar at midnight where it trades -- for London's FX, 23:00 UTC the day
 *  before in summer -- so twelve hours on puts every bar in its own month. */
export function monthlyCloses(body: unknown): Map<string, number> {
  const result = (body as { chart?: { result?: Array<Record<string, unknown>> } })?.chart?.result?.[0];
  const times = (result?.timestamp ?? []) as number[];
  const indicators = result?.indicators as { adjclose?: Array<{ adjclose?: Array<number | null> }>; quote?: Array<{ close?: Array<number | null> }> } | undefined;
  const closes = indicators?.adjclose?.[0]?.adjclose ?? indicators?.quote?.[0]?.close ?? [];
  const out = new Map<string, number>();
  times.forEach((t, i) => {
    const v = closes[i];
    if (typeof v !== "number" || !(v > 0)) return;
    out.set(new Date((t + 12 * 3600) * 1000).toISOString().slice(0, 7), v);
  });
  return new Map([...out].sort(([a], [b]) => (a < b ? -1 : 1)));
}

/** The index in Singapore dollars, a figure a quarter as it ended: each month's
 *  value times the dollar's price in Singapore dollars that month, or the last
 *  month's before it where Yahoo has none, as it has no October for years. */
export function equityInSgd(index: Map<string, number>, fx: Map<string, number>): MarketRow[] {
  const months = [...fx.keys()].sort();
  const quarters = new Map<string, number>();
  let rate: number | undefined, f = 0;
  for (const [month, value] of [...index].sort(([a], [b]) => (a < b ? -1 : 1))) {
    while (f < months.length && months[f] <= month) rate = fx.get(months[f++]);
    if (rate === undefined) continue;
    quarters.set(quarterOfDay(`${month}-01`), value * rate);
  }
  return [...quarters].map(([quarter, value]) => ({ series: "equity", area: "ALL", segment: EQUITY.segment, quarter: quarterStart(quarter)!, value }));
}

export type Refresh = {
  /** Datasets whose catalogue entry was read. */
  checked: number;
  /** Datasets read again, having changed or never been read. */
  refreshed: number;
  /** Figures written. */
  points: number;
  failures: Array<{ dataset: string; reason: string }>;
  /** The market as the page reads it, kept whole: built again, as it was, or
   *  not there to keep -- before its migration is applied. */
  snapshot: "built" | "kept" | "unavailable";
};

type SourceRow = { dataset: string; source_updated_at: string | null };

/** Brings the market figures up to date: each dataset whose catalogue entry
 *  has moved since it was last read -- or every one, with `force` -- read
 *  whole and written over what is kept, one dataset after another. A dataset
 *  that fails is reported and left as it was; the others go on. Its record of
 *  being read is written last, so one cut short -- by a failure, or by the
 *  function's time running out -- is read again next time. */
export async function refreshMarket(db: SupabaseClient, {
  force = false,
  now = new Date(),
  ...options
}: SourceOptions & { force?: boolean; now?: Date } = {}): Promise<Refresh> {
  const fetcher = options.fetcher ?? fetch;
  const { data, error } = await db.from("housing_sources").select("dataset, source_updated_at");
  if (error) throw error;
  const known = new Map(((data ?? []) as SourceRow[]).map((s) => [s.dataset, s.source_updated_at ? new Date(s.source_updated_at).toISOString() : null]));
  const out: Refresh = { checked: 0, refreshed: 0, points: 0, failures: [], snapshot: "unavailable" };
  const source = dataGovSg(options);

  for (const dataset of DATASETS) {
    try {
      const updated = await source.lastUpdated(dataset.id);
      out.checked++;
      if (!force && known.get(dataset.id) === updated) continue;
      const figures = readDataset(dataset, await source.records(dataset.id, dataset.filters));
      if (figures.length === 0) throw new SourceError("no figures in it");
      for (let i = 0; i < figures.length; i += WRITE_BATCH) {
        const { error: written } = await db.from("housing_market")
          .upsert(figures.slice(i, i + WRITE_BATCH), { onConflict: "series,area,segment,quarter" });
        if (written) throw written;
      }
      const { error: noted } = await db.from("housing_sources").upsert(
        { dataset: dataset.id, source_updated_at: updated, refreshed_at: now.toISOString(), points: figures.length },
        { onConflict: "dataset" },
      );
      if (noted) throw noted;
      out.refreshed++;
      out.points += figures.length;
    } catch (err) {
      out.failures.push({ dataset: dataset.id, reason: reasonOf(err) });
    }
  }

  // The shares' history, a figure a quarter as it ended. Yahoo has no
  // catalogue to ask, so the calendar is asked instead: it is read only once
  // a quarter has ended that is not kept yet, and the quarter still running is
  // never kept -- the estimates move when a quarter closes, not every day.
  try {
    const closed = quarterStart(quarterFromNumber(quarterNumber(quarterOfDay(now.toISOString().slice(0, 10))) - 1))!;
    const { data: kept, error: unread } = await db.from("housing_market").select("quarter, value")
      .eq("series", "equity").eq("area", "ALL").eq("segment", EQUITY.segment).limit(1000);
    if (unread) throw unread;
    const before = new Map(((kept ?? []) as Array<{ quarter: string; value: number | string }>).map((r) => [r.quarter, Number(r.value)]));
    if (!force && before.has(closed)) {
      out.checked++;
    } else {
      const rows = (await readEquity(fetcher)).filter((r) => r.quarter <= closed);
      out.checked++;
      const moved = rows.filter((r) => before.get(r.quarter) === undefined || Math.abs(before.get(r.quarter)! - r.value) > 1e-9 * r.value);
      if (moved.length) {
        const { error: written } = await db.from("housing_market").upsert(moved, { onConflict: "series,area,segment,quarter" });
        if (written) throw written;
        out.refreshed++;
        out.points += moved.length;
      }
    }
  } catch (err) {
    out.failures.push({ dataset: `yahoo:${EQUITY.symbol}`, reason: reasonOf(err) });
  }

  try {
    out.snapshot = await keepSnapshot(db, out.refreshed > 0 || force, now);
  } catch (err) {
    out.failures.push({ dataset: "snapshot", reason: reasonOf(err) });
  }
  return out;
}

/** The shape the snapshot is kept in. Change readMarket's answer and this
 *  changes with it: a snapshot in another shape is read past and built anew. */
export const SNAPSHOT_VERSION = 1;

/** The market kept whole, as the page reads it -- built again when a figure
 *  moved, or when there is none in this shape; left as it is otherwise. Before
 *  its migration is applied there is no table for it, and nothing to keep. */
async function keepSnapshot(db: SupabaseClient, changed: boolean, now: Date): Promise<Refresh["snapshot"]> {
  if (!changed) {
    const { data, error } = await db.from("housing_snapshot").select("version").eq("id", "market").maybeSingle();
    if (error) {
      if (MISSING_TABLE.has(error.code)) return "unavailable";
      throw error;
    }
    if ((data as { version: number } | null)?.version === SNAPSHOT_VERSION) return "kept";
  }
  const market = await readMarket(db);
  const { error } = await db.from("housing_snapshot").upsert(
    { id: "market", version: SNAPSHOT_VERSION, market, built_at: now.toISOString() },
    { onConflict: "id" },
  );
  if (error) {
    if (MISSING_TABLE.has(error.code)) return "unavailable";
    throw error;
  }
  return "built";
}

/** The market as the page reads it: the snapshot, in one query -- or, where
 *  there is none in this shape yet, every figure, as readMarket reads them. */
export async function marketOf(db: SupabaseClient): Promise<MarketData> {
  const { data, error } = await db.from("housing_snapshot").select("version, market").eq("id", "market").maybeSingle();
  const kept = data as { version: number; market: MarketData } | null;
  if (!error && kept?.version === SNAPSHOT_VERSION) return kept.market;
  if (error && !MISSING_TABLE.has(error.code)) throw error;
  return readMarket(db);
}

const reasonOf = (err: unknown) =>
  err instanceof Error ? err.message : typeof err === "object" && err && "message" in err ? String(err.message) : String(err);

/** The S&P 500 with dividends, in Singapore dollars, a figure a quarter, from
 *  Yahoo's charts of the index and of the dollar. A short user agent: Yahoo
 *  answers a browser's full one with 429, as the stock prices found. */
export async function readEquity(fetcher: typeof fetch = fetch): Promise<MarketRow[]> {
  const chart = async (symbol: string) => {
    const url = `${CHART}/${encodeURIComponent(symbol)}?interval=1mo&period1=0&period2=${Math.floor(Date.now() / 1000) + 86_400}`;
    let reason = "no answer";
    for (let attempt = 1; attempt <= 2; attempt++) {
      try {
        const res = await fetcher(url, { headers: { "user-agent": "Mozilla/5.0", accept: "application/json" }, cache: "no-store", signal: AbortSignal.timeout(TIMEOUT_MS) });
        if (res.ok) {
          const closes = monthlyCloses(await res.json());
          if (closes.size === 0) throw new SourceError(`${symbol}: no prices in the answer`);
          return closes;
        }
        reason = `${symbol}: HTTP ${res.status}`;
        if (res.status !== 429 && res.status < 500) break;
      } catch (err) {
        if (err instanceof SourceError) throw err;
        reason = `${symbol}: ${reasonOf(err)}`;
      }
      if (attempt < 2) await sleep(2_000);
    }
    throw new SourceError(reason);
  };
  const [index, fx] = [await chart(EQUITY.symbol), await chart(EQUITY.fx)];
  return equityInSgd(index, fx);
}

/** Every figure kept, as the page draws them: a series a place and kind, its
 *  quarters running on from the first, null where none was published. */
export async function readMarket(db: SupabaseClient): Promise<MarketData> {
  const byKey = new Map<string, { series: Series; area: string; segment: string; points: Map<string, number> }>();
  const pages = pagesOf<MarketRow>((from, to, count) =>
    db.from("housing_market").select("series, area, segment, quarter, value", count ? { count: "exact" } : undefined)
      .order("series").order("area").order("segment").order("quarter").range(from, to));
  for await (const page of pages) {
    for (const r of page) {
      const key = `${r.series}|${r.area}|${r.segment}`;
      let entry = byKey.get(key);
      if (!entry) byKey.set(key, (entry = { series: r.series, area: r.area, segment: r.segment, points: new Map() }));
      entry.points.set(quarterOfDay(r.quarter), Number(r.value));
    }
  }
  const series: MarketSeries[] = [...byKey.values()].map(({ points, ...rest }) => {
    const quarters = [...points.keys()].sort();
    const values: Array<number | null> = [];
    for (let q = quarters[0]; ; q = nextQuarter(q)) {
      values.push(points.get(q) ?? null);
      if (q === quarters[quarters.length - 1]) break;
    }
    return { ...rest, start: quarters[0], values };
  });
  const { data, error } = await db.from("housing_sources").select("refreshed_at");
  if (error) throw error;
  const refreshed = ((data ?? []) as Array<{ refreshed_at: string }>).map((s) => new Date(s.refreshed_at).toISOString()).sort().at(-1) ?? null;
  return { series, refreshed_at: refreshed };
}

