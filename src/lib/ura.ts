import type { SupabaseClient } from "@supabase/supabase-js";
import { MISSING_TABLE, fetchAllRows } from "@/lib/paginate";
import { quarterFromNumber, quarterLabel, quarterNumber, quarterOfDay } from "@/lib/housing";
import {
  projectName, quarterDay, type Project, type ProjectRent, type ProjectSale, type SaleType, type Segment,
} from "@/lib/housing-projects";

/** URA's Data Service: every private home sale caveated in the last five years,
 *  and every rental contract, Singapore whole -- read with the owner's access
 *  key (URA_ACCESS_KEY, set on Vercel and nowhere else; the repository is
 *  public). A key gets a token a day; the token reads the files. Sales come in
 *  four files by postal district, rental contracts in one file a quarter.
 *
 *  URA's firewall turns away an address that asks for tokens too often, so a
 *  run asks for one, spaces its requests, and reads a development again only a
 *  week after it last did. Only the developments followed are kept.
 *
 *  Server-side only. */

const URA = "https://eservice.ura.gov.sg/uraDataService";
/** Rental contracts are read for this many quarters, the one running included. */
export const RENT_QUARTERS = 4;
/** A development is read again once it was last read this long ago. */
const WEEK_MS = 7 * 24 * 3600 * 1000;
const TIMEOUT_MS = 40_000;
const WRITE_BATCH = 1000;

/** Why URA could not be read. */
export class UraError extends Error {}

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));
const reasonOf = (err: unknown) =>
  err instanceof Error ? err.message : typeof err === "object" && err && "message" in err ? String(err.message) : String(err);

/** URA's name for a quarter: 26q3. */
export const refPeriod = (quarter: string) => `${quarter.slice(2, 4)}q${quarter.slice(6)}`;

/** Which of URA's four files of sales holds a postal district: 01-07, 08-14, 15-21, 22-28. */
export const batchOf = (district: string) => Math.min(4, Math.max(1, Math.ceil(Number(district) / 7)));

export type UraOptions = {
  key: string;
  fetcher?: typeof fetch;
  /** Milliseconds between requests. */
  spacing?: number;
};

/** URA's Data Service for a key: one token for the client's life, asked for
 *  only when a file is, and every request spaced from the last. */
export function uraClient({ key, fetcher = fetch, spacing = 1_500 }: UraOptions) {
  let last = 0;
  let token: Promise<string> | null = null;

  async function call(url: string, headers: Record<string, string>): Promise<unknown> {
    const wait = last + spacing - Date.now();
    if (wait > 0) await sleep(wait);
    last = Date.now();
    let res: Response;
    try {
      res = await fetcher(url, {
        headers: { ...headers, "user-agent": "Mozilla/5.0", accept: "application/json" },
        cache: "no-store",
        signal: AbortSignal.timeout(TIMEOUT_MS),
      });
    } catch (err) {
      throw new UraError(`no answer: ${reasonOf(err)}`);
    }
    if (!res.ok) throw new UraError(`HTTP ${res.status}`);
    let body: { Status?: unknown; Message?: unknown; Result?: unknown };
    try {
      body = await res.json();
    } catch {
      throw new UraError("an answer that is not JSON");
    }
    if (body?.Status !== "Success") throw new UraError(`refused: ${typeof body?.Message === "string" && body.Message ? body.Message : "no reason given"}`);
    return body.Result;
  }

  const authorized = async () => {
    token ??= call(`${URA}/insertNewToken/v1`, { AccessKey: key }).then((t) => {
      if (typeof t !== "string" || !t) throw new UraError("no token in the answer");
      return t;
    });
    return { AccessKey: key, Token: await token };
  };

  return {
    /** Every sale in a file of postal districts, 1 to 4. */
    transactions: async (batch: number) => call(`${URA}/invokeUraDS/v1?service=PMI_Resi_Transaction&batch=${batch}`, await authorized()),
    /** Every rental contract of a quarter, 2026-Q3. */
    rentals: async (quarter: string) => call(`${URA}/invokeUraDS/v1?service=PMI_Resi_Rental&refPeriod=${refPeriod(quarter)}`, await authorized()),
  };
}

/** A month URA writes as MMYY, as its first day; null for anything else. */
export function monthOf(raw: unknown): string | null {
  const m = /^(\d{2})(\d{2})$/.exec(String(raw ?? "").trim());
  if (!m || Number(m[1]) < 1 || Number(m[1]) > 12) return null;
  return `20${m[2]}-${m[1]}-01`;
}

/** A positive number URA wrote as text or as a number. */
function positive(raw: unknown): number | null {
  const n = typeof raw === "number" ? raw : typeof raw === "string" && raw.trim() ? Number(raw.replace(/,/g, "").trim()) : NaN;
  return Number.isFinite(n) && n > 0 ? n : null;
}

/** A floor-area band as URA writes it -- 1000-1100, >3000, <=300 -- in
 *  whole square feet; null for anything else. */
export function bandOf(raw: unknown): { low: number | null; high: number | null } | null {
  const text = String(raw ?? "").replace(/\s+/g, "");
  let m = /^(\d+)-(\d+)$/.exec(text);
  if (m && Number(m[1]) < Number(m[2])) return { low: Number(m[1]), high: Number(m[2]) };
  m = /^>=?(\d+)$/.exec(text);
  if (m) return { low: Number(m[1]), high: null };
  m = /^<=?(\d+)$/.exec(text);
  if (m && Number(m[1]) > 0) return { low: null, high: Number(m[1]) };
  return null;
}

const SALE_TYPES: Record<string, SaleType> = { "1": "new", "2": "sub", "3": "resale" };
const SEGMENTS = new Set(["CCR", "RCR", "OCR"]);

/** Where URA puts a development. */
export type Place = { street: string | null; district: string | null; segment: Segment | null };

type UraProject = { project?: unknown; street?: unknown; marketSegment?: unknown; transaction?: unknown; rental?: unknown };

function projectsIn(result: unknown): UraProject[] {
  if (!Array.isArray(result)) throw new UraError("an answer without its list of developments");
  return result.filter((p): p is UraProject => typeof p === "object" && p !== null);
}

function placeOf(p: UraProject, district: unknown): Place {
  const segment = String(p.marketSegment ?? "").trim().toUpperCase();
  const d = String(district ?? "").trim();
  return {
    street: typeof p.street === "string" && p.street.trim() ? p.street.trim() : null,
    district: /^\d{1,2}$/.test(d) ? d.padStart(2, "0") : null,
    segment: SEGMENTS.has(segment) ? (segment as Segment) : null,
  };
}

/** The followed developments' sales in one of URA's files, and where each is.
 *  A sale missing its month, price or area is passed over. */
export function salesIn(result: unknown, followed: ReadonlySet<string>): { sales: Map<string, ProjectSale[]>; places: Map<string, Place> } {
  const sales = new Map<string, ProjectSale[]>(), places = new Map<string, Place>();
  for (const p of projectsIn(result)) {
    const name = projectName(p.project);
    if (!name || !followed.has(name)) continue;
    const list = sales.get(name) ?? [];
    for (const t of Array.isArray(p.transaction) ? p.transaction : []) {
      const month = monthOf(t?.contractDate), price = positive(t?.price), area = positive(t?.area);
      if (!month || !price || !area) continue;
      const floor = typeof t.floorRange === "string" && /\d/.test(t.floorRange) ? t.floorRange.trim() : null;
      list.push({
        month,
        price,
        area_sqm: area,
        floor_range: floor,
        sale_type: SALE_TYPES[String(t.typeOfSale ?? "").trim()] ?? null,
        property_type: typeof t.propertyType === "string" && t.propertyType.trim() ? t.propertyType.trim() : null,
        units: Math.max(1, Math.round(positive(t.noOfUnits) ?? 1)),
      });
      if (!places.has(name)) places.set(name, placeOf(p, t.district));
    }
    sales.set(name, list);
  }
  return { sales, places };
}

/** The followed developments' rental contracts in a quarter's file. A
 *  contract missing its month or rent is passed over; a bedroom count of NA
 *  is none. */
export function rentsIn(result: unknown, followed: ReadonlySet<string>, quarter: string): { rents: Map<string, ProjectRent[]>; places: Map<string, Place> } {
  const rents = new Map<string, ProjectRent[]>(), places = new Map<string, Place>();
  const day = quarterDay(quarter);
  for (const p of projectsIn(result)) {
    const name = projectName(p.project);
    if (!name || !followed.has(name)) continue;
    const list = rents.get(name) ?? [];
    for (const r of Array.isArray(p.rental) ? p.rental : []) {
      const month = monthOf(r?.leaseDate), rent = positive(r?.rent);
      if (!month || !rent) continue;
      const band = bandOf(r.areaSqft);
      const bedrooms = positive(r.noOfBedRoom);
      list.push({
        quarter: day,
        month,
        rent,
        sqft_low: band?.low ?? null,
        sqft_high: band?.high ?? null,
        bedrooms: bedrooms !== null && Number.isInteger(bedrooms) && bedrooms <= 20 ? bedrooms : null,
      });
      if (!places.has(name)) places.set(name, placeOf(p, r.district));
    }
    rents.set(name, list);
  }
  return { rents, places };
}

/** What a run of the refresh did, in counts and states: the Daily jobs log is
 *  public, and which developments the owner follows is the owner's business. */
export type ProjectsRefresh = {
  /** Why nothing was read, or "read". */
  state: "read" | "not due" | "no key" | "none followed" | "unavailable";
  followed: number;
  /** Developments read. */
  read: number;
  /** Sales and rental contracts written. */
  sales: number;
  rents: number;
  failures: Array<{ source: string; reason: string }>;
};

/** Reads URA for the followed developments due -- never read, or last read a
 *  week ago -- or for `only` now, whatever its last read: the files their
 *  districts' sales are in (all four for one not read before) and the last
 *  RENT_QUARTERS quarters of rental contracts. A development's sales are
 *  replaced whole and each quarter's contracts likewise; one is marked read
 *  only when everything for it was. */
export async function refreshProjects(db: SupabaseClient, {
  key = process.env.URA_ACCESS_KEY,
  now = new Date(),
  only,
  fetcher,
  spacing,
}: { key?: string; now?: Date; only?: string; fetcher?: typeof fetch; spacing?: number } = {}): Promise<ProjectsRefresh> {
  const out: ProjectsRefresh = { state: "read", followed: 0, read: 0, sales: 0, rents: 0, failures: [] };
  const { data, error } = await db.from("housing_projects").select("name, district, read_at").order("name");
  if (error) {
    if (MISSING_TABLE.has(error.code)) return { ...out, state: "unavailable" };
    throw error;
  }
  const projects = (data ?? []) as Array<{ name: string; district: string | null; read_at: string | null }>;
  out.followed = projects.length;
  if (!projects.length) return { ...out, state: "none followed" };
  if (!key) return { ...out, state: "no key" };
  const due = projects.filter((p) => (only !== undefined ? p.name === only : !p.read_at || now.getTime() - Date.parse(p.read_at) >= WEEK_MS));
  if (!due.length) return { ...out, state: "not due" };

  const ura = uraClient({ key, fetcher, spacing });
  const followed = new Set(due.map((p) => p.name));
  const places = new Map<string, Place>();
  const keepPlaces = (found: Map<string, Place>) => {
    for (const [name, place] of found) {
      const had = places.get(name);
      places.set(name, { street: had?.street ?? place.street, district: had?.district ?? place.district, segment: had?.segment ?? place.segment });
    }
  };

  // Sales: the files their districts are in, every file for one whose district is not known yet.
  const batches = [...new Set(due.flatMap((p) => (p.district ? [batchOf(p.district)] : [1, 2, 3, 4])))].sort();
  const sales = new Map<string, ProjectSale[]>();
  const batchesRead = new Set<number>();
  for (const batch of batches) {
    try {
      const found = salesIn(await ura.transactions(batch), followed);
      for (const [name, list] of found.sales) sales.set(name, [...(sales.get(name) ?? []), ...list]);
      keepPlaces(found.places);
      batchesRead.add(batch);
    } catch (err) {
      out.failures.push({ source: `sales, file ${batch}`, reason: reasonOf(err) });
    }
  }

  // Rental contracts: the quarter running and the ones before it.
  const current = quarterNumber(quarterOfDay(now.toISOString().slice(0, 10)));
  const quarters = Array.from({ length: RENT_QUARTERS }, (_, k) => quarterFromNumber(current - k));
  const rents = new Map<string, Map<string, ProjectRent[]>>();
  const quartersRead: string[] = [];
  for (const quarter of quarters) {
    try {
      const found = rentsIn(await ura.rentals(quarter), followed, quarter);
      for (const [name, list] of found.rents) {
        const byQuarter = rents.get(name) ?? new Map<string, ProjectRent[]>();
        byQuarter.set(quarter, list);
        rents.set(name, byQuarter);
      }
      keepPlaces(found.places);
      quartersRead.push(quarter);
    } catch (err) {
      out.failures.push({ source: `rents, ${quarterLabel(quarter)}`, reason: reasonOf(err) });
    }
  }

  // What was read is written, a development at a time.
  for (const p of due) {
    try {
      const allSales = p.district ? batchesRead.has(batchOf(p.district)) : batchesRead.size === 4;
      const mine = sales.get(p.name) ?? [];
      if (allSales) {
        const { error: cleared } = await db.from("housing_project_sales").delete().eq("project", p.name);
        if (cleared) throw cleared;
        for (let i = 0; i < mine.length; i += WRITE_BATCH) {
          const { error: written } = await db.from("housing_project_sales").insert(mine.slice(i, i + WRITE_BATCH).map((s) => ({ project: p.name, ...s })));
          if (written) throw written;
        }
        out.sales += mine.length;
      }
      let leases = 0;
      for (const quarter of quartersRead) {
        const rows = rents.get(p.name)?.get(quarter) ?? [];
        const { error: cleared } = await db.from("housing_project_rents").delete().eq("project", p.name).eq("quarter", quarterDay(quarter));
        if (cleared) throw cleared;
        if (rows.length) {
          const { error: written } = await db.from("housing_project_rents").insert(rows.map((r) => ({ project: p.name, ...r })));
          if (written) throw written;
        }
        leases += rows.length;
      }
      out.rents += leases;

      const complete = allSales && quartersRead.length === quarters.length;
      const place = places.get(p.name);
      const update: Record<string, unknown> = {};
      if (place?.street) update.street = place.street;
      if (place?.district) update.district = place.district;
      if (place?.segment) update.segment = place.segment;
      if (mine.length + leases > 0) update.found = true;
      else if (complete) update.found = false;
      if (complete) update.read_at = now.toISOString();
      if (Object.keys(update).length) {
        const { error: noted } = await db.from("housing_projects").update(update).eq("name", p.name);
        if (noted) throw noted;
      }
      if (complete) out.read++;
    } catch (err) {
      out.failures.push({ source: "writing a development's records", reason: reasonOf(err) });
    }
  }
  return out;
}

type ProjectRow = Omit<Project, "sales" | "rents">;

/** Every development followed, with its records, as the page reads them. None
 *  before the tables' migration is applied. */
export async function readProjects(db: SupabaseClient): Promise<Project[]> {
  const { data, error } = await db.from("housing_projects").select("name, street, district, segment, added_at, read_at, found").order("added_at").order("name");
  if (error) {
    if (MISSING_TABLE.has(error.code)) return [];
    throw error;
  }
  const projects = (data ?? []) as ProjectRow[];
  if (!projects.length) return [];
  const [sales, rents] = await Promise.all([
    fetchAllRows<ProjectSale & { project: string }>((from, to) => db.from("housing_project_sales")
      .select("project, month, price, area_sqm, floor_range, sale_type, property_type, units").order("project").order("month").order("id").range(from, to)),
    fetchAllRows<ProjectRent & { project: string }>((from, to) => db.from("housing_project_rents")
      .select("project, quarter, month, rent, sqft_low, sqft_high, bedrooms").order("project").order("month").order("id").range(from, to)),
  ]);
  // Numeric columns may come as text; each record as the page takes it.
  return projects.map((p) => ({
    ...p,
    sales: sales.filter((s) => s.project === p.name).map((s) => ({
      month: s.month, price: Number(s.price), area_sqm: Number(s.area_sqm), floor_range: s.floor_range,
      sale_type: s.sale_type, property_type: s.property_type, units: Number(s.units),
    })),
    rents: rents.filter((r) => r.project === p.name).map((r) => ({
      quarter: r.quarter, month: r.month, rent: Number(r.rent), sqft_low: r.sqft_low, sqft_high: r.sqft_high, bedrooms: r.bedrooms,
    })),
  }));
}
