import type { SupabaseClient } from "@supabase/supabase-js";
import { pagesOf } from "@/lib/paginate";
import { nextQuarter, quarterOfDay, quarterStart, type MarketData, type MarketSeries, type Series } from "@/lib/housing";

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
  /** A record as a figure, or null for one to pass over: a quarter with too
   *  few deals to publish a median comes as "-" or "na". */
  read: (record: Record<string, unknown>) => MarketRow | null;
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
];

const RECORDS = "https://data.gov.sg/api/action/datastore_search";
const CATALOGUE = "https://api-production.data.gov.sg/v2/public/api/datasets";
const PAGE = 5000;
const TIMEOUT_MS = 25_000;
/** A dataset's figures go in this many at a time. */
const WRITE_BATCH = 2000;

/** Why a dataset could not be read. */
export class SourceError extends Error {}

/** GET as JSON, asking again once on what may pass by itself: no answer, a
 *  5xx, or 429 when data.gov.sg asks callers to slow down. */
async function getJson(url: string, fetcher: typeof fetch): Promise<unknown> {
  let last = "no answer";
  for (let attempt = 1; attempt <= 2; attempt++) {
    try {
      const res = await fetcher(url, { headers: { accept: "application/json" }, cache: "no-store", signal: AbortSignal.timeout(TIMEOUT_MS) });
      if (res.ok) return await res.json();
      last = `HTTP ${res.status}`;
      if (res.status !== 429 && res.status < 500) break;
    } catch (err) {
      last = err instanceof Error ? err.message : String(err);
    }
    if (attempt === 1) await new Promise((resolve) => setTimeout(resolve, 2000));
  }
  throw new SourceError(last);
}

/** When data.gov.sg last changed a dataset, as its catalogue says. */
export async function lastUpdated(id: string, fetcher: typeof fetch = fetch): Promise<string> {
  const body = await getJson(`${CATALOGUE}/${id}/metadata`, fetcher) as { data?: { lastUpdatedAt?: unknown } };
  const at = body?.data?.lastUpdatedAt;
  if (typeof at !== "string" || Number.isNaN(Date.parse(at))) throw new SourceError("its catalogue entry has no update time");
  return new Date(at).toISOString();
}

/** Every record of a dataset, in the order it was published -- so of two
 *  records for the same figure, as the rents have for 2020 Q1, the later wins. */
export async function datasetRecords(id: string, fetcher: typeof fetch = fetch): Promise<Record<string, unknown>[]> {
  const out: Record<string, unknown>[] = [];
  for (let offset = 0; ; offset += PAGE) {
    const url = `${RECORDS}?resource_id=${id}&limit=${PAGE}&offset=${offset}&sort=${encodeURIComponent("_id asc")}`;
    const body = await getJson(url, fetcher) as { success?: boolean; result?: { records?: unknown; total?: unknown } };
    const records = body?.result?.records;
    if (body?.success !== true || !Array.isArray(records)) throw new SourceError("an answer without records");
    out.push(...(records as Record<string, unknown>[]));
    const total = Number(body.result?.total);
    if (records.length < PAGE || (Number.isFinite(total) && out.length >= total)) return out;
  }
}

/** A dataset's records as figures, one per series, place, kind and quarter. */
export function readDataset(dataset: Pick<Dataset, "read">, records: Record<string, unknown>[]): MarketRow[] {
  const figures = new Map<string, MarketRow>();
  for (const record of records) {
    const figure = dataset.read(record);
    if (figure) figures.set(`${figure.series}|${figure.area}|${figure.segment}|${figure.quarter}`, figure);
  }
  return [...figures.values()];
}

export type Refresh = {
  /** Datasets whose catalogue entry was read. */
  checked: number;
  /** Datasets read again, having changed or never been read. */
  refreshed: number;
  /** Figures written. */
  points: number;
  failures: Array<{ dataset: string; reason: string }>;
};

type SourceRow = { dataset: string; source_updated_at: string | null };

/** Brings the market figures up to date: each dataset whose catalogue entry
 *  has moved since it was last read -- or every one, with `force` -- read
 *  whole and written over what is kept. A dataset that fails is reported and
 *  left as it was; the others go on. Its record of being read is written
 *  last, so one cut short is read again next time. */
export async function refreshMarket(db: SupabaseClient, {
  fetcher = fetch,
  force = false,
  now = new Date(),
}: { fetcher?: typeof fetch; force?: boolean; now?: Date } = {}): Promise<Refresh> {
  const { data, error } = await db.from("housing_sources").select("dataset, source_updated_at");
  if (error) throw error;
  const known = new Map(((data ?? []) as SourceRow[]).map((s) => [s.dataset, s.source_updated_at ? new Date(s.source_updated_at).toISOString() : null]));
  const out: Refresh = { checked: 0, refreshed: 0, points: 0, failures: [] };

  await Promise.all(DATASETS.map(async (dataset) => {
    try {
      const updated = await lastUpdated(dataset.id, fetcher);
      out.checked++;
      if (!force && known.get(dataset.id) === updated) return;
      const figures = readDataset(dataset, await datasetRecords(dataset.id, fetcher));
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
      const reason = err instanceof Error ? err.message : typeof err === "object" && err && "message" in err ? String(err.message) : String(err);
      out.failures.push({ dataset: dataset.id, reason });
    }
  }));
  return out;
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

