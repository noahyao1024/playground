import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";
import { startPostgrest, type Row, type StandIn } from "../helpers/postgrest";

const session = vi.hoisted(() => ({ current: null as { user: { email: string } } | null }));
vi.mock("@/lib/auth", () => ({ auth: async () => session.current }));
// The routes refresh as in production, but without spacing their requests to
// data.gov.sg's rate limit: the stand-in has none. The spacing has its own tests.
vi.mock("@/lib/housing-data", async (importOriginal) => {
  const real = await importOriginal<typeof import("@/lib/housing-data")>();
  return { ...real, refreshMarket: (db: Parameters<typeof real.refreshMarket>[0], options = {}) => real.refreshMarket(db, { spacing: 0, backoff: 0, ...options }) };
});
// URA likewise, read without the spacing its firewall wants.
vi.mock("@/lib/ura", async (importOriginal) => {
  const real = await importOriginal<typeof import("@/lib/ura")>();
  return { ...real, refreshProjects: (db: Parameters<typeof real.refreshProjects>[0], options = {}) => real.refreshProjects(db, { spacing: 0, ...options }) };
});

const { GET, POST } = await import("@/app/api/housing/route");
const { GET: CRON } = await import("@/app/api/cron/housing/route");
const { GET: PROJECTS_CRON } = await import("@/app/api/cron/projects/route");
const { DATASETS } = await import("@/lib/housing-data");
const { DEFAULT_INPUTS } = await import("@/lib/housing");

const OWNER = { user: { email: "hi@noahyao.me" } };
const KEPT = "00000000-0000-0000-0000-0000000000a1";
const OLDER = "00000000-0000-0000-0000-0000000000a2";
const NOWHERE = "00000000-0000-0000-0000-00000000dead";

let db: StandIn;
/** data.gov.sg's answer to a catalogue request: a status, or a time. */
let catalogue: number | string;
let asked: string[];

beforeEach(async () => {
  session.current = OWNER;
  db = await startPostgrest({
    housing_market: [],
    housing_sources: [],
    housing_scenarios: [
      { id: OLDER, name: "Older", inputs: { price: 700_000 }, created_at: "2026-10-01T00:00:00Z", updated_at: "2026-10-01T00:00:00Z" },
      { id: KEPT, name: "Bedok 4-room", inputs: { ...DEFAULT_INPUTS, rent: 3_100 }, created_at: "2026-10-02T00:00:00Z", updated_at: "2026-10-03T00:00:00Z" },
    ],
  });
  vi.stubEnv("NEXT_PUBLIC_SUPABASE_URL", db.url);
  vi.stubEnv("SUPABASE_SERVICE_ROLE_KEY", "stand-in");
  vi.stubEnv("CRON_SECRET", "cron-secret");
  catalogue = "2026-07-24T11:43:21+08:00";
  asked = [];
  // data.gov.sg is answered here: one figure a dataset, a quarter's index.
  const realFetch = globalThis.fetch;
  vi.stubGlobal("fetch", async (url: string | URL | Request, init?: RequestInit) => {
    const href = String(url instanceof Request ? url.url : url);
    if (href.startsWith("https://api-production.data.gov.sg/")) {
      asked.push(href);
      if (typeof catalogue === "number") return new Response("{}", { status: catalogue });
      return new Response(JSON.stringify({ code: 0, data: { lastUpdatedAt: catalogue } }));
    }
    if (href.startsWith("https://eservice.ura.gov.sg/")) {
      asked.push(href);
      // URA: a token, one development's sales in file 3, a lease a quarter.
      if (href.endsWith("/insertNewToken/v1")) return Response.json({ Status: "Success", Message: "", Result: "token" });
      const params = new URL(href).searchParams;
      const result = params.get("service") === "PMI_Resi_Transaction"
        ? (params.get("batch") === "3" ? [{ project: "WATERTOWN", street: "PUNGGOL CENTRAL", marketSegment: "OCR", transaction: [{ area: "98", floorRange: "06-10", noOfUnits: "1", contractDate: "0826", typeOfSale: "3", price: "1550000", propertyType: "Condominium", district: "19" }] }] : [])
        : [{ project: "WATERTOWN", street: "PUNGGOL CENTRAL", rental: [{ leaseDate: "0826", areaSqft: "1000-1100", noOfBedRoom: "3", rent: 4500, district: "19" }] }];
      return Response.json({ Status: "Success", Message: "", Result: result });
    }
    if (href.startsWith("https://query1.finance.yahoo.com/")) {
      asked.push(href);
      // One month-end close, the first of September 2026 in New York.
      return new Response(JSON.stringify({ chart: { result: [{ timestamp: [1788235200], indicators: { quote: [{ close: [href.includes("SGD") ? 1.25 : 100] }] } }] } }));
    }
    if (href.startsWith("https://data.gov.sg/")) {
      asked.push(href);
      const id = new URL(href).searchParams.get("resource_id");
      const record = {
        [DATASETS[0].id]: { quarter: "2026-Q2", town: "BEDOK", flat_type: "4-room", price: "600000" },
        [DATASETS[1].id]: { quarter: "2026-Q2", town: "BEDOK", flat_type: "4-RM", median_rent: "3000" },
        [DATASETS[2].id]: { quarter: "2026-Q2", index: "202.8" },
        [DATASETS[3].id]: { quarter: "2026-Q2", property_type: "Non-Landed", index: "210.6" },
        [DATASETS[4].id]: { quarter: "2026-Q2", market_segment: "Outside Central Region", price_index: "271.1" },
        [DATASETS[5].id]: { quarter: "2026-Q2", property_type: "Non-Landed", locality: "Outside Central Region", index: "169" },
        [DATASETS[6].id]: { DataSeries: "Compounded Singapore Overnight Rate Average (SORA) - 3 Month", "2026Jul": "1.1354" },
        [DATASETS[7].id]: { DataSeries: "All Items", "2026Aug": "103.334" },
      }[id!];
      return new Response(JSON.stringify({ success: true, result: { records: record ? [{ _id: 1, ...record }] : [], total: record ? 1 : 0 } }));
    }
    return realFetch(url, init);
  });
});

afterEach(async () => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
  await db.close();
});

const get = (headers: Record<string, string> = {}) => new NextRequest("http://localhost/api/housing", { headers });
async function post(payload: Row, headers: Record<string, string> = {}) {
  const res = await POST(new NextRequest("http://localhost/api/housing", { method: "POST", body: JSON.stringify(payload), headers }));
  return { status: res.status, body: await res.json() };
}

describe("who may see it", () => {
  it("answers no one but the owner of /finance, and asks the database nothing for anyone else", async () => {
    for (const who of [null, { user: { email: "nicholasyao.sg@gmail.com" } }, { user: { email: "someone@else.com" } }]) {
      session.current = who;
      expect((await GET(get())).status).toBe(401);
      expect((await post({ action: "refresh" })).status).toBe(401);
      expect((await post({ action: "saveScenario", name: "x", inputs: {} })).status).toBe(401);
    }
    expect(db.requests).toHaveLength(0);
    expect(asked).toHaveLength(0);
  });

  it("answers the owner's agents with the finance token, as /api/finance does", async () => {
    session.current = null;
    const token = "3f9a0c1e7b2d4a6f8e0c2b4d6f8a0c1e3b5d7f9a1c3e5b7d9f1a3c5e7b9d1f3a";
    vi.stubEnv("FINANCE_API_TOKEN", token);
    expect((await GET(get({ authorization: `Bearer ${token}` }))).status).toBe(200);
    expect((await GET(get({ authorization: `Bearer ${token.slice(1)}0` }))).status).toBe(401);
  });
});

describe("reading", () => {
  it("hands over the market and the scenarios, latest changed first, uncacheable", async () => {
    const res = await GET(get());
    expect(res.status).toBe(200);
    expect(res.headers.get("cache-control")).toBe("private, no-store");
    const body = await res.json();
    expect(body.market).toEqual({ series: [], refreshed_at: null });
    expect(body.scenarios.map((s: Row) => s.id)).toEqual([KEPT, OLDER]);
    // A scenario kept before an input existed opens with its default.
    expect(body.scenarios[1].inputs).toEqual({ ...DEFAULT_INPUTS, price: 700_000 });
  });

  it("opens a scenario kept under limits since narrowed with what still passes, the rest at their defaults", async () => {
    db.tables.housing_scenarios[0].inputs = { price: 700_000, years: 99, residency: "citizen" };
    const body = await (await GET(get())).json();
    expect(body.scenarios[1].inputs).toEqual({ ...DEFAULT_INPUTS, price: 700_000, residency: "citizen" });
  });
});

describe("saving and deleting a scenario", () => {
  it("keeps a new one under its name, with every input, defaults and all", async () => {
    const { status, body } = await post({ action: "saveScenario", name: "  Condo in Bishan ", inputs: { kind: "private", loan_type: "bank", price: 1_500_000 } });
    expect(status).toBe(200);
    expect(body.scenario).toMatchObject({ name: "Condo in Bishan", inputs: { ...DEFAULT_INPUTS, kind: "private", loan_type: "bank", price: 1_500_000 } });
    const row = db.tables.housing_scenarios.find((s) => s.id === body.scenario.id)!;
    expect(row.inputs).toEqual({ ...DEFAULT_INPUTS, kind: "private", loan_type: "bank", price: 1_500_000 });
  });

  it("keeps which inputs are left to the market's estimates, and a private home's market", async () => {
    const inputs = { kind: "private", market: "OCR:non-landed", loan_type: "bank", auto: ["invest_return", "loan_rate"] };
    const { status, body } = await post({ action: "saveScenario", name: "Watertown", inputs });
    expect(status).toBe(200);
    // In their own order, as the page lists them.
    expect(body.scenario.inputs).toEqual({ ...DEFAULT_INPUTS, ...inputs, auto: ["loan_rate", "invest_return"] });
    const row = db.tables.housing_scenarios.find((s) => s.id === body.scenario.id)!;
    expect(row.inputs).toMatchObject({ market: "OCR:non-landed", auto: ["loan_rate", "invest_return"] });
  });

  it("changes one kept, by id, and says so when there is no such one", async () => {
    const { status, body } = await post({ action: "saveScenario", id: KEPT, name: "Bedok, renting at 3,300", inputs: { ...DEFAULT_INPUTS, rent: 3_300 } });
    expect(status).toBe(200);
    expect(body.scenario).toMatchObject({ id: KEPT, name: "Bedok, renting at 3,300", inputs: { rent: 3_300 } });
    expect(db.tables.housing_scenarios.find((s) => s.id === KEPT)!.updated_at).not.toBe("2026-10-03T00:00:00Z");
    expect(await post({ action: "saveScenario", id: NOWHERE, name: "x", inputs: {} })).toMatchObject({ status: 404 });
  });

  it("refuses a scenario without a name, with a name too long, with inputs out of reason, or with an id that is not one", async () => {
    for (const [payload, message] of [
      [{ name: "", inputs: {} }, /needs a name/],
      [{ name: "   ", inputs: {} }, /needs a name/],
      [{ name: "x".repeat(81), inputs: {} }, /at most 80/],
      [{ name: "x", inputs: { price: "a lot" } }, /price must be a number/],
      [{ name: "x", inputs: { residency: "tourist" } }, /residency must be one of citizen, pr, foreigner/],
      [{ name: "x", inputs: { years: 50 } }, /years must be between 1 and 35/],
      [{ name: "x", inputs: "everything" }, /inputs must be an object/],
      [{ name: "x", inputs: { auto: ["price"] } }, /auto must list some of loan_rate, growth, rent_growth, cost_growth, invest_return/],
      [{ name: "x", inputs: { market: "Punggol" } }, /market must be one of ALL:all, ALL:landed/],
      [{ name: "x", inputs: {}, id: "42" }, /id must be a scenario's id/],
    ] as Array<[Row, RegExp]>) {
      const res = await post({ action: "saveScenario", ...payload });
      expect(res.status, JSON.stringify(payload)).toBe(400);
      expect(res.body.error).toMatch(message);
    }
    expect(db.tables.housing_scenarios).toHaveLength(2);
  });

  it("deletes one, once", async () => {
    expect(await post({ action: "deleteScenario", id: KEPT })).toEqual({ status: 200, body: { ok: true } });
    expect(db.tables.housing_scenarios.map((s) => s.id)).toEqual([OLDER]);
    expect((await post({ action: "deleteScenario", id: KEPT })).status).toBe(404);
    expect((await post({ action: "deleteScenario", id: "not-an-id" })).status).toBe(400);
  });

  it("turns away an action it does not know, and a body that is not JSON", async () => {
    expect((await post({ action: "sellEverything" })).status).toBe(400);
    const res = await POST(new NextRequest("http://localhost/api/housing", { method: "POST", body: "{" }));
    expect(res.status).toBe(400);
  });
});

describe("developments followed", () => {
  it("hands the page none at first, and whether URA's key is set -- never the key", async () => {
    const body = await (await GET(get())).json();
    expect(body.projects).toEqual([]);
    expect(body.ura).toBe(false);
    vi.stubEnv("URA_ACCESS_KEY", "secret-ura-key");
    const text = await (await GET(get())).text();
    expect(JSON.parse(text).ura).toBe(true);
    expect(text).not.toContain("secret-ura-key");
  });

  it("follows one by the name URA gives it and reads URA for it at once, its records handed back", async () => {
    vi.stubEnv("URA_ACCESS_KEY", "secret-ura-key");
    const { status, body } = await post({ action: "followProject", name: " watertown " });
    expect(status).toBe(200);
    expect(body.refresh).toMatchObject({ state: "read", followed: 1, read: 1, sales: 1, rents: 4, failures: [] });
    expect(body.project).toMatchObject({ name: "WATERTOWN", street: "PUNGGOL CENTRAL", district: "19", segment: "OCR", found: true });
    expect(body.project.sales).toHaveLength(1);
    expect(body.project.rents).toHaveLength(4);
    // Following it again reads it again, and keeps one of it.
    expect((await post({ action: "followProject", name: "WATERTOWN" })).body.refresh).toMatchObject({ read: 1 });
    expect(db.tables.housing_projects).toHaveLength(1);
    expect((await (await GET(get())).json()).projects.map((p: Row) => p.name)).toEqual(["WATERTOWN"]);
  });

  it("follows one without the key all the same, to be read once it is set", async () => {
    const { body } = await post({ action: "followProject", name: "WATERTOWN" });
    expect(body.refresh).toMatchObject({ state: "no key" });
    expect(body.project).toMatchObject({ name: "WATERTOWN", sales: [], rents: [] });
    // Not read: the stand-in keeps no column defaults, the table's is null.
    expect(body.project.read_at ?? null).toBeNull();
    expect(asked.some((u) => u.includes("ura.gov.sg"))).toBe(false);
  });

  it("refuses a name that is none, and more than ten at once", async () => {
    for (const name of ["", "  ", 42, "x".repeat(81)]) {
      expect((await post({ action: "followProject", name })).status, String(name)).toBe(400);
    }
    db.tables.housing_projects = Array.from({ length: 10 }, (_, k) => ({ name: `PROJECT ${k}`, added_at: "2026-10-01T00:00:00Z", read_at: null }));
    const { status, body } = await post({ action: "followProject", name: "WATERTOWN" });
    expect(status).toBe(400);
    expect(body.error).toMatch(/At most 10/);
  });

  it("stops following one, and says so when it was not followed", async () => {
    await post({ action: "followProject", name: "WATERTOWN" });
    expect(await post({ action: "unfollowProject", name: "watertown" })).toEqual({ status: 200, body: { ok: true } });
    expect(db.tables.housing_projects).toHaveLength(0);
    expect((await post({ action: "unfollowProject", name: "WATERTOWN" })).status).toBe(404);
  });

  it("is read by the daily job's call when due, answering in counts and states without a name", async () => {
    vi.stubEnv("URA_ACCESS_KEY", "secret-ura-key");
    db.tables.housing_projects = [{ name: "WATERTOWN", added_at: "2026-10-01T00:00:00Z", read_at: null, district: null }];
    const res = await PROJECTS_CRON(new NextRequest("http://localhost/api/cron/projects", { headers: { authorization: "Bearer cron-secret" } }));
    const text = await res.text();
    expect(res.status).toBe(200);
    expect(JSON.parse(text)).toEqual({ state: "read", followed: 1, read: 1, sales: 1, rents: 4, failed: 0, failures: [] });
    expect(text).not.toContain("WATERTOWN");
    // Read today: not due again tomorrow.
    const again = await (await PROJECTS_CRON(new NextRequest("http://localhost/api/cron/projects", { headers: { authorization: "Bearer cron-secret" } }))).json();
    expect(again).toMatchObject({ state: "not due", read: 0 });
    expect((await PROJECTS_CRON(new NextRequest("http://localhost/api/cron/projects"))).status).toBe(401);
  });
});

describe("refreshing", () => {
  it("reads data.gov.sg when the owner asks, and hands back the market as it now stands", async () => {
    const { status, body } = await post({ action: "refresh" });
    expect(status).toBe(200);
    expect(body.refresh).toEqual({ checked: 9, refreshed: 9, points: 9, failures: [], snapshot: "built" });
    expect(body.market.series.map((s: Row) => `${s.series}:${s.area}:${s.segment}`).sort()).toEqual([
      "cpi:ALL:all", "equity:ALL:sp500-sgd", "hdb_rent:BEDOK:4-room", "hdb_resale:BEDOK:4-room", "hdb_rpi:ALL:all", "sora:ALL:3m",
      "ura_ppi:ALL:non-landed", "ura_ppi:OCR:non-landed", "ura_rri:OCR:non-landed",
    ]);
    // Nothing has changed since: only the catalogue is read -- the shares'
    // last closed quarter is kept -- and the snapshot kept as it is.
    asked.length = 0;
    expect((await post({ action: "refresh" })).body.refresh).toMatchObject({ checked: 9, refreshed: 0, snapshot: "kept" });
    expect(asked.length).toBeGreaterThan(0);
    expect(asked.every((u) => u.startsWith("https://api-production.data.gov.sg/"))).toBe(true);
  });

  it("hands the page the market from its snapshot in one query once the daily job has kept one", async () => {
    await post({ action: "refresh" });
    db.requests.length = 0;
    const body = await (await GET(get())).json();
    expect(body.market.series).toHaveLength(9);
    expect(db.requests.map((r) => r.table).sort()).toEqual(["housing_projects", "housing_scenarios", "housing_snapshot"]);
  });
});

describe("the daily job's call", () => {
  const cron = async (authorization = "Bearer cron-secret") => {
    const res = await CRON(new NextRequest("http://localhost/api/cron/housing", { headers: authorization ? { authorization } : {} }));
    return { status: res.status, body: await res.json() };
  };

  it("brings the figures up to date, answering in counts", async () => {
    expect(await cron()).toEqual({ status: 200, body: { checked: 9, refreshed: 9, points: 9, failed: 0, failures: [], snapshot: "built" } });
    expect(db.tables.housing_market).toHaveLength(9);
    expect(await cron()).toEqual({ status: 200, body: { checked: 9, refreshed: 0, points: 0, failed: 0, failures: [], snapshot: "kept" } });
  });

  it("answers 503 when not one of data.gov.sg's datasets could be read, so the job asks again", async () => {
    catalogue = 404;
    const { status, body } = await cron();
    expect(status).toBe(503);
    // Yahoo's chart was read all the same.
    expect(body).toMatchObject({ error: "data.gov.sg could not be reached", checked: 1, failed: 8 });
  });

  it("answers no one else", async () => {
    expect((await cron("Bearer wrong")).status).toBe(401);
    expect((await cron("")).status).toBe(401);
    expect(asked).toHaveLength(0);
  });
});
