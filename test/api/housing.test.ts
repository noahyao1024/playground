import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";
import { startPostgrest, type Row, type StandIn } from "../helpers/postgrest";

const session = vi.hoisted(() => ({ current: null as { user: { email: string } } | null }));
vi.mock("@/lib/auth", () => ({ auth: async () => session.current }));

const { GET, POST } = await import("@/app/api/housing/route");
const { GET: CRON } = await import("@/app/api/cron/housing/route");
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

describe("refreshing", () => {
  it("reads data.gov.sg when the owner asks, and hands back the market as it now stands", async () => {
    const { status, body } = await post({ action: "refresh" });
    expect(status).toBe(200);
    expect(body.refresh).toEqual({ checked: 6, refreshed: 6, points: 6, failures: [] });
    expect(body.market.series.map((s: Row) => `${s.series}:${s.area}:${s.segment}`).sort()).toEqual([
      "hdb_rent:BEDOK:4-room", "hdb_resale:BEDOK:4-room", "hdb_rpi:ALL:all", "ura_ppi:ALL:non-landed", "ura_ppi:OCR:non-landed", "ura_rri:OCR:non-landed",
    ]);
    // Nothing has changed since: only the catalogue is read.
    asked.length = 0;
    expect((await post({ action: "refresh" })).body.refresh).toMatchObject({ checked: 6, refreshed: 0 });
    expect(asked.every((u) => u.startsWith("https://api-production.data.gov.sg/"))).toBe(true);
  });
});

describe("the daily job's call", () => {
  const cron = async (authorization = "Bearer cron-secret") => {
    const res = await CRON(new NextRequest("http://localhost/api/cron/housing", { headers: authorization ? { authorization } : {} }));
    return { status: res.status, body: await res.json() };
  };

  it("brings the figures up to date, answering in counts", async () => {
    expect(await cron()).toEqual({ status: 200, body: { checked: 6, refreshed: 6, points: 6, failed: 0, failures: [] } });
    expect(db.tables.housing_market).toHaveLength(6);
    expect(await cron()).toEqual({ status: 200, body: { checked: 6, refreshed: 0, points: 0, failed: 0, failures: [] } });
  });

  it("answers 503 when not one catalogue entry could be read, so the job asks again", async () => {
    catalogue = 404;
    const { status, body } = await cron();
    expect(status).toBe(503);
    expect(body).toMatchObject({ error: "data.gov.sg could not be reached", checked: 0, failed: 6 });
  });

  it("answers no one else", async () => {
    expect((await cron("Bearer wrong")).status).toBe(401);
    expect((await cron("")).status).toBe(401);
    expect(asked).toHaveLength(0);
  });
});
