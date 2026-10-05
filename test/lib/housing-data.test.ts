import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createClient } from "@supabase/supabase-js";
import { calls, startPostgrest, type StandIn } from "../helpers/postgrest";
import {
  DATASETS, amount, dataGovSg, hdbFlatType, hdbTown, readDataset, readMarket, refreshMarket,
} from "@/lib/housing-data";

const [PRICES, RENTS, RPI, PPI_TYPE, PPI_REGION, RRI] = DATASETS.map((d) => d.id);

describe("reading the sources' spellings", () => {
  it("takes a number written as text, and nothing where the source wrote none", () => {
    expect(amount("600000")).toBe(600_000);
    expect(amount(" 202.8 ")).toBe(202.8);
    expect(amount(7)).toBe(7);
    for (const none of ["-", "na", "NA                ", "", "  ", "0", "-5", null, undefined, {}]) expect(amount(none), String(none)).toBeNull();
  });

  it("writes a town one way, whatever case and spacing the year used, and the centre as CENTRAL", () => {
    expect(hdbTown("Ang Mo Kio")).toBe("ANG MO KIO");
    expect(hdbTown("QUEENSTOWN ")).toBe("QUEENSTOWN");
    expect(hdbTown("Kallang/Whampoa")).toBe("KALLANG/WHAMPOA");
    expect(hdbTown("CENTRAL AREA")).toBe("CENTRAL");
    expect(hdbTown("Central")).toBe("CENTRAL");
    for (const bad of ["", "  ", 12, null, "1 TOWN"]) expect(hdbTown(bad), String(bad)).toBeNull();
  });

  it("writes a flat type one way, the prices' and the rents' alike", () => {
    for (const raw of ["4-room", "4-RM", "4 ROOM", "4-Room"]) expect(hdbFlatType(raw), raw).toBe("4-room");
    for (const raw of ["EXEC", "Executive", "executive"]) expect(hdbFlatType(raw), raw).toBe("executive");
    for (const raw of ["MULTI-GENERATION", "6-room", "", null]) expect(hdbFlatType(raw), String(raw)).toBeNull();
  });
});

/** Records as data.gov.sg serves them, a few of each dataset. */
function sample(): Record<string, Array<Record<string, unknown>>> {
  return {
    [PRICES]: [
      { quarter: "2026-Q1", town: "Bedok", flat_type: "4-room", price: "590000" },
      { quarter: "2026-Q2", town: "BEDOK", flat_type: "4-room", price: "600000" },
      { quarter: "2026-Q2", town: "BEDOK ", flat_type: "5-room", price: "-" },
      { quarter: "2026-Q2", town: "CENTRAL AREA", flat_type: "Executive", price: "NA                " },
      { quarter: "2026-Q2", town: "Central", flat_type: "3-room", price: "450000" },
    ],
    [RENTS]: [
      { quarter: "2020-Q1", town: "BEDOK", flat_type: "4-RM", median_rent: "2100" },
      { quarter: "2026-Q2", town: "BEDOK", flat_type: "4-RM", median_rent: "3000" },
      // Published twice, as 2020 Q1 was: the later stands.
      { quarter: "2020-Q1", town: "BEDOK", flat_type: "4-RM", median_rent: "2000" },
      { quarter: "2026-Q2", town: "CENTRAL", flat_type: "EXEC", median_rent: "na" },
    ],
    [RPI]: [{ quarter: "2026-Q1", index: "203.4" }, { quarter: "2026-Q2", index: "202.8" }],
    [PPI_TYPE]: [
      { quarter: "2026-Q2", property_type: "All Residential", index: "219.4" },
      { quarter: "2026-Q2", property_type: "Landed", index: "258.4" },
      { quarter: "2026-Q2", property_type: "Non-Landed", index: "210.6" },
    ],
    [PPI_REGION]: [{ quarter: "2026-Q2", market_segment: "Core Central Region", price_index: "161.5" }],
    [RRI]: [
      { quarter: "2026-Q2", property_type: "Non-Landed", locality: "Whole Island", index: "170.0" },
      { quarter: "2026-Q2", property_type: "Non-Landed", locality: "Outside Central Region", index: "169.0" },
      { quarter: "2026-Q2", property_type: "Mystery", locality: "Whole Island", index: "1" },
    ],
  };
}

describe("readDataset", () => {
  it("reads each dataset's records as figures, passing over what was not published", () => {
    const records = sample();
    const read = (id: string) => readDataset(DATASETS.find((d) => d.id === id)!, records[id]);
    expect(read(PRICES)).toEqual([
      { series: "hdb_resale", area: "BEDOK", segment: "4-room", quarter: "2026-01-01", value: 590_000 },
      { series: "hdb_resale", area: "BEDOK", segment: "4-room", quarter: "2026-04-01", value: 600_000 },
      { series: "hdb_resale", area: "CENTRAL", segment: "3-room", quarter: "2026-04-01", value: 450_000 },
    ]);
    expect(read(RENTS)).toEqual([
      { series: "hdb_rent", area: "BEDOK", segment: "4-room", quarter: "2020-01-01", value: 2_000 },
      { series: "hdb_rent", area: "BEDOK", segment: "4-room", quarter: "2026-04-01", value: 3_000 },
    ]);
    expect(read(PPI_TYPE).map((f) => [f.area, f.segment, f.value])).toEqual([["ALL", "all", 219.4], ["ALL", "landed", 258.4], ["ALL", "non-landed", 210.6]]);
    expect(read(PPI_REGION)).toEqual([{ series: "ura_ppi", area: "CCR", segment: "non-landed", quarter: "2026-04-01", value: 161.5 }]);
    expect(read(RRI).map((f) => [f.series, f.area, f.segment, f.value])).toEqual([["ura_rri", "ALL", "non-landed", 170], ["ura_rri", "OCR", "non-landed", 169]]);
    expect(read(RPI).map((f) => [f.series, f.area, f.segment, f.quarter, f.value])).toEqual([
      ["hdb_rpi", "ALL", "all", "2026-01-01", 203.4], ["hdb_rpi", "ALL", "all", "2026-04-01", 202.8],
    ]);
  });
});

const CATALOGUE = "https://api-production.data.gov.sg/v2/public/api/datasets/";
const RECORDS = "https://data.gov.sg/api/action/datastore_search";

/** data.gov.sg, as far as the code uses it: each dataset's catalogue entry and
 *  its records a page at a time. `broken` answers a dataset's records with
 *  that status, `retryAfter` adding the header a 429 may carry; every request
 *  is noted, with its headers and when it came. */
function fakeDataGovSg(records = sample(), updated: Record<string, string> = {}) {
  const asked: string[] = [];
  const requests: Array<{ url: string; headers: Headers; at: number }> = [];
  const broken: Record<string, number> = {};
  const retryAfter: Record<string, string> = {};
  const fetcher = (async (input: string | URL | Request, init?: RequestInit) => {
    const url = new URL(String(input instanceof Request ? input.url : input));
    asked.push(url.toString());
    requests.push({ url: url.toString(), headers: new Headers(init?.headers), at: performance.now() });
    if (url.href.startsWith(CATALOGUE)) {
      const id = url.pathname.split("/").at(-2)!;
      return new Response(JSON.stringify({ code: 0, data: { datasetId: id, lastUpdatedAt: updated[id] ?? "2026-07-24T11:43:21+08:00" } }));
    }
    if (url.href.startsWith(RECORDS)) {
      const id = url.searchParams.get("resource_id")!;
      if (broken[id]) return new Response("{}", { status: broken[id], headers: retryAfter[id] ? { "retry-after": retryAfter[id] } : {} });
      const all = (records[id] ?? []).map((r, i) => ({ _id: i + 1, ...r }));
      const offset = Number(url.searchParams.get("offset")), limit = Number(url.searchParams.get("limit"));
      return new Response(JSON.stringify({ success: true, result: { records: all.slice(offset, offset + limit), total: all.length } }));
    }
    return new Response("not here", { status: 404 });
  }) as typeof fetch;
  return { fetcher, asked, requests, broken, retryAfter, records, updated };
}

/** The source over the fake, with no waiting unless a test asks for it. */
const quick = { spacing: 0, backoff: 0, apiKey: null };

describe("the source", () => {
  it("reads when a dataset last changed from its catalogue entry", async () => {
    const fake = fakeDataGovSg(sample(), { [RPI]: "2026-07-24T11:36:15+08:00" });
    expect(await dataGovSg({ ...quick, fetcher: fake.fetcher }).lastUpdated(RPI)).toBe("2026-07-24T03:36:15.000Z");
  });

  it("reads every record, 20,000 a request, in the order they were published", async () => {
    const many = Array.from({ length: 20_001 }, (_, i) => ({ quarter: "2026-Q2", index: String(i + 1) }));
    const fake = fakeDataGovSg({ [RPI]: many });
    const records = await dataGovSg({ ...quick, fetcher: fake.fetcher }).records(RPI);
    expect(records).toHaveLength(20_001);
    expect(records.at(-1)).toMatchObject({ _id: 20_001, index: "20001" });
    expect(fake.asked.map((u) => new URL(u).searchParams.get("offset"))).toEqual(["0", "20000"]);
    expect(new URL(fake.asked[0]).searchParams.get("sort")).toBe("_id asc");
  });

  it("says why when the source will not answer, asking again twice after a 5xx, a 429 or no answer, and never after anything else", async () => {
    const fake = fakeDataGovSg();
    const source = dataGovSg({ ...quick, fetcher: fake.fetcher });
    fake.broken[RPI] = 404;
    await expect(source.records(RPI)).rejects.toThrow("HTTP 404");
    expect(fake.asked).toHaveLength(1);
    for (const status of [503, 429]) {
      fake.asked.length = 0;
      fake.broken[RPI] = status;
      await expect(source.records(RPI)).rejects.toThrow(`HTTP ${status}`);
      expect(fake.asked).toHaveLength(3);
    }
    // A later try that works is as good as a first.
    let tries = 0;
    const flaky = (async (input: string | URL | Request, init?: RequestInit) => {
      if (++tries < 3) throw new TypeError("fetch failed");
      delete fake.broken[RPI];
      return fake.fetcher(input, init);
    }) as typeof fetch;
    expect(await dataGovSg({ ...quick, fetcher: flaky }).records(RPI)).toHaveLength(2);
    expect(tries).toBe(3);
  });

  it("waits out a 429 as long as its Retry-After says, and its ten-second window when it says nothing", async () => {
    vi.useFakeTimers({ toFake: ["setTimeout"] });
    try {
      const fake = fakeDataGovSg();
      fake.broken[RPI] = 429;
      fake.retryAfter[RPI] = "4";
      const reading = dataGovSg({ fetcher: fake.fetcher, spacing: 0, apiKey: null }).records(RPI).catch((err) => err);
      await vi.advanceTimersByTimeAsync(3_999);
      expect(fake.asked).toHaveLength(1);
      await vi.advanceTimersByTimeAsync(1);
      expect(fake.asked).toHaveLength(2);
      delete fake.retryAfter[RPI];
      delete fake.broken[RPI];
      await vi.advanceTimersByTimeAsync(4_000);
      expect(await reading).toHaveLength(2);

      fake.asked.length = 0;
      fake.broken[RPI] = 429;
      const again = dataGovSg({ fetcher: fake.fetcher, spacing: 0, apiKey: null }).records(RPI).catch((err) => err);
      await vi.advanceTimersByTimeAsync(9_999);
      expect(fake.asked).toHaveLength(1);
      await vi.advanceTimersByTimeAsync(1);
      expect(fake.asked).toHaveLength(2);
      await vi.advanceTimersByTimeAsync(10_000);
      expect(String(await again)).toContain("HTTP 429");
    } finally {
      vi.useRealTimers();
    }
  });

  it("spaces its requests for records, and only those, to the rate limit", async () => {
    const fake = fakeDataGovSg();
    const source = dataGovSg({ fetcher: fake.fetcher, spacing: 60, backoff: 0, apiKey: null });
    for (const id of [RPI, PPI_TYPE, PPI_REGION]) await source.records(id);
    await Promise.all([RPI, PPI_TYPE, PPI_REGION].map((id) => source.lastUpdated(id)));
    const records = fake.requests.filter((r) => r.url.startsWith(RECORDS)).map((r) => r.at);
    expect(records[1] - records[0]).toBeGreaterThanOrEqual(55);
    expect(records[2] - records[1]).toBeGreaterThanOrEqual(55);
    const catalogue = fake.requests.filter((r) => r.url.startsWith(CATALOGUE)).map((r) => r.at);
    expect(catalogue[2] - catalogue[0]).toBeLessThan(55);
  });

  it("sends data.gov.sg's API key when there is one, DATA_GOV_SG_API_KEY by default", async () => {
    const fake = fakeDataGovSg();
    await dataGovSg({ ...quick, fetcher: fake.fetcher, apiKey: "key-from-options" }).records(RPI);
    expect(fake.requests[0].headers.get("x-api-key")).toBe("key-from-options");
    vi.stubEnv("DATA_GOV_SG_API_KEY", " key-from-env ");
    try {
      const source = dataGovSg({ fetcher: fake.fetcher, spacing: 0, backoff: 0 });
      await source.lastUpdated(RPI);
      await source.records(RPI);
      expect(fake.requests.slice(1).map((r) => r.headers.get("x-api-key"))).toEqual(["key-from-env", "key-from-env"]);
    } finally {
      vi.unstubAllEnvs();
    }
    await dataGovSg({ ...quick, fetcher: fake.fetcher }).records(RPI);
    expect(fake.requests.at(-1)!.headers.has("x-api-key")).toBe(false);
  });
});

describe("refreshMarket and readMarket", () => {
  let db: StandIn;
  const client = () => createClient(db.url, "stand-in", { auth: { persistSession: false } });
  const NOW = new Date("2026-10-05T06:00:00Z");

  beforeEach(async () => { db = await startPostgrest({ housing_market: [], housing_sources: [] }); });
  afterEach(async () => { await db.close(); });

  it("reads every dataset the first time, keeping each figure and when each dataset was read", async () => {
    const source = fakeDataGovSg();
    const r = await refreshMarket(client(), { ...quick, fetcher: source.fetcher, now: NOW });
    expect(r).toEqual({ checked: 6, refreshed: 6, points: 13, failures: [] });
    expect(db.tables.housing_market).toHaveLength(13);
    expect(db.tables.housing_sources.map((s) => [s.dataset, s.points]).sort()).toEqual(
      [[PRICES, 3], [RENTS, 2], [RPI, 2], [PPI_TYPE, 3], [PPI_REGION, 1], [RRI, 2]].sort(),
    );
    expect(db.tables.housing_sources[0]).toMatchObject({ source_updated_at: "2026-07-24T03:43:21.000Z", refreshed_at: NOW.toISOString() });
  });

  it("reads nothing again while the catalogue says nothing changed -- every dataset, with force", async () => {
    const source = fakeDataGovSg();
    await refreshMarket(client(), { ...quick, fetcher: source.fetcher, now: NOW });
    db.requests.length = 0;
    source.asked.length = 0;
    expect(await refreshMarket(client(), { ...quick, fetcher: source.fetcher, now: NOW })).toEqual({ checked: 6, refreshed: 0, points: 0, failures: [] });
    expect(source.asked.every((u) => u.startsWith(CATALOGUE))).toBe(true);
    expect(calls(db, "housing_market")).toEqual([]);

    expect(await refreshMarket(client(), { ...quick, fetcher: source.fetcher, now: NOW, force: true })).toMatchObject({ refreshed: 6, points: 13 });
  });

  it("reads a dataset again once it has changed, writing over what it said before", async () => {
    const source = fakeDataGovSg();
    await refreshMarket(client(), { ...quick, fetcher: source.fetcher, now: NOW });
    source.records[RPI][1].index = "205.1";
    source.records[RPI].push({ quarter: "2026-Q3", index: "206" });
    source.updated[RPI] = "2026-10-24T11:00:00+08:00";
    expect(await refreshMarket(client(), { ...quick, fetcher: source.fetcher, now: NOW })).toEqual({ checked: 6, refreshed: 1, points: 3, failures: [] });
    const rpi = db.tables.housing_market.filter((f) => f.series === "hdb_rpi").map((f) => [f.quarter, f.value]);
    expect(rpi).toEqual([["2026-01-01", 203.4], ["2026-04-01", 205.1], ["2026-07-01", 206]]);
    expect(db.tables.housing_sources.find((s) => s.dataset === RPI)).toMatchObject({ source_updated_at: "2026-10-24T03:00:00.000Z", points: 3 });
  });

  it("goes on past a dataset it cannot read, and reads it again next time, its record of being read left as it was", async () => {
    const source = fakeDataGovSg();
    source.broken[PRICES] = 404;
    const r = await refreshMarket(client(), { ...quick, fetcher: source.fetcher, now: NOW });
    expect(r).toEqual({ checked: 6, refreshed: 5, points: 10, failures: [{ dataset: PRICES, reason: "HTTP 404" }] });
    expect(db.tables.housing_sources.some((s) => s.dataset === PRICES)).toBe(false);
    delete source.broken[PRICES];
    expect(await refreshMarket(client(), { ...quick, fetcher: source.fetcher, now: NOW })).toEqual({ checked: 6, refreshed: 1, points: 3, failures: [] });
  });

  it("reads one dataset after another, its requests for records spaced to the rate limit -- never a burst of six", async () => {
    const source = fakeDataGovSg();
    await refreshMarket(client(), { fetcher: source.fetcher, now: NOW, spacing: 40, backoff: 0, apiKey: null });
    const at = source.requests.filter((r) => r.url.startsWith(RECORDS)).map((r) => r.at);
    expect(at).toHaveLength(6);
    for (let i = 1; i < at.length; i++) expect(at[i] - at[i - 1], `request ${i}`).toBeGreaterThanOrEqual(35);
  });

  it("calls an answer with no figures in it a failure, rather than keep a dataset's place empty", async () => {
    const source = fakeDataGovSg({ ...sample(), [RPI]: [{ quarter: "2026-Q2", index: "-" }] });
    const r = await refreshMarket(client(), { ...quick, fetcher: source.fetcher, now: NOW });
    expect(r.failures).toEqual([{ dataset: RPI, reason: "no figures in it" }]);
  });

  it("hands the page each series from its first quarter on, a value a quarter, null where none was published", async () => {
    const source = fakeDataGovSg();
    await refreshMarket(client(), { ...quick, fetcher: source.fetcher, now: NOW });
    const market = await readMarket(client());
    expect(market.refreshed_at).toBe(NOW.toISOString());
    const rent = market.series.find((s) => s.series === "hdb_rent" && s.area === "BEDOK" && s.segment === "4-room")!;
    // 2020 Q1 to 2026 Q2: 26 quarters, all but the ends unpublished.
    expect(rent.start).toBe("2020-Q1");
    expect(rent.values).toHaveLength(26);
    expect([rent.values[0], rent.values[25], rent.values.filter((v) => v === null).length]).toEqual([2_000, 3_000, 24]);
    expect(market.series.map((s) => `${s.series}:${s.area}:${s.segment}`).sort()).toEqual([
      "hdb_rent:BEDOK:4-room", "hdb_resale:BEDOK:4-room", "hdb_resale:CENTRAL:3-room", "hdb_rpi:ALL:all",
      "ura_ppi:ALL:all", "ura_ppi:ALL:landed", "ura_ppi:ALL:non-landed", "ura_ppi:CCR:non-landed",
      "ura_rri:ALL:non-landed", "ura_rri:OCR:non-landed",
    ]);
  });

  it("reads past PostgREST's thousand rows a request", async () => {
    db.tables.housing_market = Array.from({ length: 2_500 }, (_, i) => ({
      series: "hdb_rpi", area: "ALL", segment: "all", quarter: `${1400 + Math.floor(i / 4)}-${String((i % 4) * 3 + 1).padStart(2, "0")}-01`, value: i + 1,
    }));
    const market = await readMarket(client());
    expect(market.series).toHaveLength(1);
    expect(market.series[0].values).toHaveLength(2_500);
    expect(market.series[0].values.at(-1)).toBe(2_500);
    expect(market.refreshed_at).toBeNull();
  });
});
