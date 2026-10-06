import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createClient } from "@supabase/supabase-js";
import { startPostgrest, type Row, type StandIn } from "../helpers/postgrest";
import { RENT_QUARTERS, UraError, bandOf, batchOf, monthOf, readProjects, refPeriod, refreshProjects, rentsIn, salesIn, uraClient } from "@/lib/ura";

const KEY = "test-access-key";
const NOW = new Date("2026-10-05T06:00:00Z");
const DAY = 24 * 3600 * 1000;

/** A development as URA's sales file lists it. */
const watertownSales = (price = "1550000") => ({
  project: "WATERTOWN", street: "PUNGGOL CENTRAL", marketSegment: "OCR", x: "35671.1", y: "42069.8",
  transaction: [
    { area: "98", floorRange: "06-10", noOfUnits: "1", contractDate: "0826", typeOfSale: "3", price, propertyType: "Condominium", district: "19", typeOfArea: "Strata", tenure: "99 yrs lease commencing from 2013" },
    { area: 70, floorRange: "11-15", noOfUnits: 1, contractDate: "0526", typeOfSale: "2", price: 1100000, propertyType: "Condominium", district: "19" },
    // Missing its area: passed over.
    { area: "", floorRange: "01-05", noOfUnits: "1", contractDate: "0426", typeOfSale: "3", price: "1000000", district: "19" },
  ],
});
const otherSales = { project: "WATERWOODS", street: "PUNGGOL FIELD", marketSegment: "OCR", transaction: [{ area: "90", contractDate: "0826", price: "1200000", typeOfSale: "3", district: "19" }] };
/** A quarter's file of rental contracts, Watertown's and a neighbour's. */
const rentalFile = (rent: number) => [
  {
    project: "WATERTOWN", street: "PUNGGOL CENTRAL", x: "1", y: "2",
    rental: [
      { leaseDate: "0826", propertyType: "Non-landed Properties", district: "19", areaSqm: "90-100", areaSqft: "1000-1100", noOfBedRoom: "3", rent },
      { leaseDate: "0726", propertyType: "Non-landed Properties", district: "19", areaSqm: "60-70", areaSqft: "700-800", noOfBedRoom: "NA", rent: "3,300" },
    ],
  },
  { project: "WATERWOODS", rental: [{ leaseDate: "0826", areaSqft: "900-1000", noOfBedRoom: "3", rent: 4000 }] },
];

/** URA's Data Service, as it answers: a token for the key, then files for the token. */
function fakeUra() {
  const asked: Array<{ url: string; headers: Record<string, string> }> = [];
  const state = {
    broken: null as number | null,
    brokenQuarter: null as string | null,
    batches: { 1: [] as unknown[], 2: [] as unknown[], 3: [watertownSales(), otherSales] as unknown[], 4: [] as unknown[] } as Record<number, unknown[]>,
    rent: 4_500,
  };
  const fetcher = (async (input: string | URL | Request, init?: RequestInit) => {
    const url = String(input instanceof Request ? input.url : input);
    const headers = Object.fromEntries(Object.entries((init?.headers ?? {}) as Record<string, string>));
    asked.push({ url, headers });
    if (state.broken) return new Response("<!DOCTYPE html><html>blocked</html>", { status: state.broken, headers: { "content-type": "text/html" } });
    if (url.endsWith("/insertNewToken/v1")) {
      return Response.json(headers.AccessKey === KEY ? { Status: "Success", Message: "", Result: "token-1" } : { Status: "Failed", Message: "Invalid access key", Result: "" });
    }
    if (headers.Token !== "token-1" || headers.AccessKey !== KEY) return Response.json({ Status: "Failed", Message: "Invalid token" });
    const params = new URL(url).searchParams;
    if (params.get("service") === "PMI_Resi_Transaction") return Response.json({ Status: "Success", Message: "", Result: state.batches[Number(params.get("batch"))] ?? [] });
    if (params.get("service") === "PMI_Resi_Rental") {
      const ref = params.get("refPeriod")!;
      if (ref === state.brokenQuarter) return new Response("upstream", { status: 502 });
      return Response.json({ Status: "Success", Message: "", Result: rentalFile(state.rent) });
    }
    return Response.json({ Status: "Failed", Message: "Unknown service" });
  }) as typeof fetch;
  return { fetcher, asked, state };
}

describe("reading URA's formats", () => {
  it("reads a month as MMYY, a band of square feet, a quarter's name and a district's file", () => {
    expect(monthOf("0826")).toBe("2026-08-01");
    expect(monthOf(" 1225 ")).toBe("2025-12-01");
    for (const bad of ["1326", "0026", "826", "abcd", null, undefined]) expect(monthOf(bad), String(bad)).toBeNull();
    expect(bandOf("1000-1100")).toEqual({ low: 1000, high: 1100 });
    expect(bandOf("1000 - 1100")).toEqual({ low: 1000, high: 1100 });
    expect([bandOf(">3000"), bandOf(">=3000"), bandOf("<=300"), bandOf("<300")]).toEqual([
      { low: 3000, high: null }, { low: 3000, high: null }, { low: null, high: 300 }, { low: null, high: 300 },
    ]);
    for (const bad of ["1100-1000", "NA", "", null]) expect(bandOf(bad)).toBeNull();
    expect(refPeriod("2026-Q3")).toBe("26q3");
    expect(["01", "07", "08", "14", "15", "19", "21", "22", "28"].map(batchOf)).toEqual([1, 1, 2, 2, 3, 3, 3, 4, 4]);
  });

  it("takes the followed developments' sales from a file, and where each development is", () => {
    const { sales, places } = salesIn([watertownSales(), otherSales], new Set(["WATERTOWN"]));
    expect([...sales.keys()]).toEqual(["WATERTOWN"]);
    expect(sales.get("WATERTOWN")).toEqual([
      { month: "2026-08-01", price: 1550000, area_sqm: 98, floor_range: "06-10", sale_type: "resale", property_type: "Condominium", units: 1 },
      { month: "2026-05-01", price: 1100000, area_sqm: 70, floor_range: "11-15", sale_type: "sub", property_type: "Condominium", units: 1 },
    ]);
    expect(places.get("WATERTOWN")).toEqual({ street: "PUNGGOL CENTRAL", district: "19", segment: "OCR" });
    // A landed home's floor range is a dash: none.
    const landed = salesIn([{ project: "Some Terraces", marketSegment: "ocr", transaction: [{ area: "200", floorRange: "-", contractDate: "0126", price: "3000000", typeOfSale: "1", district: "5" }] }], new Set(["SOME TERRACES"]));
    expect(landed.sales.get("SOME TERRACES")![0]).toMatchObject({ floor_range: null, sale_type: "new" });
    expect(landed.places.get("SOME TERRACES")).toEqual({ street: null, district: "05", segment: "OCR" });
    expect(() => salesIn({ error: "no" }, new Set())).toThrow(UraError);
  });

  it("takes the followed developments' rental contracts from a quarter's file", () => {
    const { rents } = rentsIn(rentalFile(4500), new Set(["WATERTOWN"]), "2026-Q3");
    expect(rents.get("WATERTOWN")).toEqual([
      { quarter: "2026-07-01", month: "2026-08-01", rent: 4500, sqft_low: 1000, sqft_high: 1100, bedrooms: 3 },
      { quarter: "2026-07-01", month: "2026-07-01", rent: 3300, sqft_low: 700, sqft_high: 800, bedrooms: null },
    ]);
  });
});

describe("uraClient", () => {
  it("asks for one token, only once a file is wanted, and sends the key with every request, spaced", async () => {
    const ura = fakeUra();
    const client = uraClient({ key: KEY, fetcher: ura.fetcher, spacing: 30 });
    expect(ura.asked).toHaveLength(0);
    const started = Date.now();
    await client.transactions(3);
    await client.rentals("2026-Q3");
    await client.rentals("2026-Q2");
    expect(Date.now() - started).toBeGreaterThanOrEqual(85);
    expect(ura.asked.map((a) => a.url.replace("https://eservice.ura.gov.sg/uraDataService", ""))).toEqual([
      "/insertNewToken/v1",
      "/invokeUraDS/v1?service=PMI_Resi_Transaction&batch=3",
      "/invokeUraDS/v1?service=PMI_Resi_Rental&refPeriod=26q3",
      "/invokeUraDS/v1?service=PMI_Resi_Rental&refPeriod=26q2",
    ]);
    expect(ura.asked.every((a) => a.headers.AccessKey === KEY)).toBe(true);
    expect(ura.asked.slice(1).every((a) => a.headers.Token === "token-1")).toBe(true);
  });

  it("says why URA would not answer: its firewall, a key it refused, an answer not JSON", async () => {
    const ura = fakeUra();
    ura.state.broken = 403;
    await expect(uraClient({ key: KEY, fetcher: ura.fetcher, spacing: 0 }).transactions(1)).rejects.toThrow("HTTP 403");
    const wrong = fakeUra();
    await expect(uraClient({ key: "not-it", fetcher: wrong.fetcher, spacing: 0 }).transactions(1)).rejects.toThrow("refused: Invalid access key");
    const garbled = (async () => new Response("<html>", { status: 200 })) as unknown as typeof fetch;
    await expect(uraClient({ key: KEY, fetcher: garbled, spacing: 0 }).transactions(1)).rejects.toThrow("an answer that is not JSON");
  });
});

describe("refreshProjects and readProjects", () => {
  let db: StandIn;
  const client = () => createClient(db.url, "stand-in", { auth: { persistSession: false } });
  const follow = (name: string, extra: Row = {}) => ({ name, street: null, district: null, segment: null, added_at: "2026-10-01T00:00:00Z", read_at: null, found: null, ...extra });
  const quick = (ura: ReturnType<typeof fakeUra>, now = NOW) => ({ key: KEY, fetcher: ura.fetcher, spacing: 0, now });

  beforeEach(async () => {
    db = await startPostgrest({ housing_projects: [follow("WATERTOWN")], housing_project_sales: [], housing_project_rents: [] });
  });
  afterEach(async () => { await db.close(); });

  it("reads a development never read in every file of sales and the quarters of leases holding a year to the latest, and keeps where it is", async () => {
    const ura = fakeUra();
    const r = await refreshProjects(client(), quick(ura));
    expect(r).toEqual({ state: "read", followed: 1, read: 1, sales: 2, rents: 2 * RENT_QUARTERS, failures: [] });
    // A token, its district not yet known so all four files of sales, and six
    // quarters: in October URA has yet to publish the quarter running, and the
    // year to its latest contract, August's, reaches back to 2025's third.
    expect(ura.asked.map((a) => new URL(a.url).searchParams.get("batch") ?? new URL(a.url).searchParams.get("refPeriod") ?? "token"))
      .toEqual(["token", "1", "2", "3", "4", "26q4", "26q3", "26q2", "26q1", "25q4", "25q3"]);
    expect(db.tables.housing_project_sales.map((s) => [s.project, s.month, s.price])).toEqual([["WATERTOWN", "2026-08-01", 1550000], ["WATERTOWN", "2026-05-01", 1100000]]);
    expect(db.tables.housing_project_rents.map((s) => s.quarter)).toEqual([
      "2026-10-01", "2026-10-01", "2026-07-01", "2026-07-01", "2026-04-01", "2026-04-01", "2026-01-01", "2026-01-01", "2025-10-01", "2025-10-01", "2025-07-01", "2025-07-01",
    ]);
    expect(db.tables.housing_projects[0]).toMatchObject({ street: "PUNGGOL CENTRAL", district: "19", segment: "OCR", found: true, read_at: NOW.toISOString() });
  });

  it("asks URA nothing again within the week, then reads only its district's file, replacing what it had", async () => {
    const ura = fakeUra();
    await refreshProjects(client(), quick(ura));
    ura.asked.length = 0;
    expect(await refreshProjects(client(), quick(ura, new Date(NOW.getTime() + 6 * DAY)))).toMatchObject({ state: "not due", read: 0 });
    expect(ura.asked).toHaveLength(0);

    ura.state.batches[3] = [watertownSales("1600000"), otherSales];
    ura.state.rent = 4_800;
    const later = new Date(NOW.getTime() + 7 * DAY);
    expect(await refreshProjects(client(), quick(ura, later))).toMatchObject({ state: "read", read: 1, sales: 2, rents: 12 });
    expect(ura.asked.map((a) => new URL(a.url).searchParams.get("batch")).filter(Boolean)).toEqual(["3"]);
    expect(db.tables.housing_project_sales.map((s) => s.price)).toEqual([1600000, 1100000]);
    expect(db.tables.housing_project_rents.filter((r) => r.bedrooms === 3).map((r) => r.rent)).toEqual([4800, 4800, 4800, 4800, 4800, 4800]);
    expect(db.tables.housing_project_rents).toHaveLength(12);
  });

  it("reads one development now when asked, whenever it was last read", async () => {
    db.tables.housing_projects = [follow("WATERTOWN", { district: "19", read_at: NOW.toISOString() }), follow("WATERWOODS", { district: "19", read_at: null })];
    const ura = fakeUra();
    expect(await refreshProjects(client(), { ...quick(ura), only: "WATERTOWN" })).toMatchObject({ state: "read", followed: 2, read: 1 });
    expect(new Set(db.tables.housing_project_sales.map((s) => s.project))).toEqual(new Set(["WATERTOWN"]));
  });

  it("marks a name URA has nothing under as not found, once everything was read", async () => {
    db.tables.housing_projects = [follow("NOWHERE")];
    const ura = fakeUra();
    expect(await refreshProjects(client(), quick(ura))).toMatchObject({ state: "read", read: 1, sales: 0, rents: 0 });
    expect(db.tables.housing_projects[0]).toMatchObject({ found: false, read_at: NOW.toISOString(), district: null });
  });

  it("writes nothing when URA turns it away, says why without naming a development, and tries again the next day", async () => {
    const ura = fakeUra();
    ura.state.broken = 403;
    const r = await refreshProjects(client(), quick(ura));
    expect(r).toMatchObject({ state: "read", read: 0, sales: 0, rents: 0 });
    expect(r.failures).toHaveLength(4 + RENT_QUARTERS);
    expect(r.failures[0]).toEqual({ source: "sales, file 1", reason: "HTTP 403" });
    expect(JSON.stringify(r.failures)).not.toContain("WATERTOWN");
    expect(db.tables.housing_project_sales).toHaveLength(0);
    expect(db.tables.housing_projects[0]).toMatchObject({ read_at: null, found: null });
  });

  it("keeps what it could read when a quarter fails, and is not marked read until everything is", async () => {
    const ura = fakeUra();
    ura.state.brokenQuarter = "26q2";
    const r = await refreshProjects(client(), quick(ura));
    expect(r).toMatchObject({ read: 0, sales: 2, rents: 10, failures: [{ source: "rents, Q2 2026", reason: "HTTP 502" }] });
    expect(db.tables.housing_projects[0]).toMatchObject({ found: true, read_at: null, district: "19" });
  });

  it("reads nothing without a key, without a development followed, or before its tables are there", async () => {
    const ura = fakeUra();
    expect(await refreshProjects(client(), { ...quick(ura), key: "" })).toMatchObject({ state: "no key", followed: 1 });
    db.tables.housing_projects = [];
    expect(await refreshProjects(client(), quick(ura))).toMatchObject({ state: "none followed", followed: 0 });
    expect(ura.asked).toHaveLength(0);
    await db.close();
    db = await startPostgrest({}, { intercept: (req) => (req.table.startsWith("housing_project") ? { status: 404, body: { code: "PGRST205", message: "Could not find the table" } } : undefined) });
    expect(await refreshProjects(client(), quick(ura))).toMatchObject({ state: "unavailable" });
    expect(await readProjects(client())).toEqual([]);
  });

  it("hands the page each development with its records, numbers as numbers", async () => {
    await refreshProjects(client(), quick(fakeUra()));
    db.tables.housing_project_sales[0].price = "1550000";
    db.tables.housing_project_rents[0].rent = "4500";
    const [p] = await readProjects(client());
    expect(p).toMatchObject({ name: "WATERTOWN", street: "PUNGGOL CENTRAL", district: "19", segment: "OCR", found: true });
    expect(p.sales[0]).toEqual({ month: "2026-05-01", price: 1100000, area_sqm: 70, floor_range: "11-15", sale_type: "sub", property_type: "Condominium", units: 1 });
    expect(p.sales[1].price).toBe(1550000);
    expect(p.rents).toHaveLength(12);
    expect(p.rents.every((r) => typeof r.rent === "number")).toBe(true);
  });
});
