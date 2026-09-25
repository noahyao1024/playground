import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { calls, startPostgrest, type Row, type StandIn } from "../helpers/postgrest";
import { fetchExchangeRates, generateChargesForMonth, getServerSupabase, monthlyRates } from "@/lib/billing";

const ANN = "p-ann", BEA = "p-bea";
const SVC = "s-svc";

const ratesByMonth: Record<string, Record<string, number>> = {
  "2026-01": { SGD: 5.3, USD: 7.2 },
  "2026-02": { SGD: 5.25, USD: 7.1 },
  "2026-03": { SGD: 5.2, USD: 7.0 },
};
const ratesFor = async (month: string) => ratesByMonth[month] ?? {};

function tables(extra: { charges?: Row[]; subscriptions?: Row[]; services?: Row[] } = {}) {
  return {
    subscribers: [{ id: ANN, name: "Ann" }, { id: BEA, name: "Bea" }],
    services: [{ id: SVC, name: "Svc", monthly_cost: 10, currency: "SGD" }, ...(extra.services ?? [])],
    subscriptions: extra.subscriptions ?? [
      { id: "sub-ann", subscriber_id: ANN, service_id: SVC, start_date: "2026-01-31", active: true },
    ],
    charges: extra.charges ?? [],
  };
}

let db: StandIn;
async function start(t: ReturnType<typeof tables>) {
  db = await startPostgrest(t);
  vi.stubEnv("NEXT_PUBLIC_SUPABASE_URL", db.url);
  vi.stubEnv("SUPABASE_SERVICE_ROLE_KEY", "stand-in");
  return getServerSupabase()!;
}

afterEach(async () => {
  vi.unstubAllEnvs();
  await db?.close();
});

describe("generateChargesForMonth", () => {
  it("bills every month from the start to the target, each at its own rate, on the start day clamped to the month", async () => {
    const supabase = await start(tables());
    const result = await generateChargesForMonth(supabase, "2026-03", ratesFor);

    expect(result.generated).toBe(3);
    const written = db.tables.charges.map((c) => [c.period_start, c.billing_date, c.exchange_rate, c.total_cny]);
    expect(written).toEqual([
      ["2026-01", "2026-01-31", 5.3, 53],
      ["2026-02", "2026-02-28", 5.25, 52.5],
      ["2026-03", "2026-03-31", 5.2, 52],
    ]);
    expect(db.tables.charges.every((c) => c.origin === "auto" && c.paid === false)).toBe(true);
    // One insert for the whole run.
    expect(calls(db, "charges").filter((c) => c.startsWith("POST"))).toHaveLength(1);
  });

  it("does not bill a month again, even one whose charge was deleted", async () => {
    const supabase = await start(tables({
      charges: [{ id: "old", subscriber_id: ANN, service_id: SVC, period_start: "2026-02", deleted_at: "2026-02-10T00:00:00Z" }],
    }));
    const result = await generateChargesForMonth(supabase, "2026-03", ratesFor);
    expect(result.generated).toBe(2);
    expect(db.tables.charges.filter((c) => c.period_start === "2026-02")).toHaveLength(1);
  });

  it("sees charges past the first 1000 rows, so a billed month stays billed", async () => {
    // 1200 other charges sort ahead of Ann's January one by id, pushing it onto
    // the second page. Read in one request, it would be past PostgREST's cap and
    // January would be billed twice.
    const others = Array.from({ length: 1200 }, (_, i) => ({
      id: `a${String(i).padStart(5, "0")}`, subscriber_id: BEA, service_id: `svc-${i}`, period_start: "2025-12",
    }));
    const supabase = await start(tables({
      // First in, so it is last whether a read sorts by id or not at all.
      charges: [{ id: "z-ann-jan", subscriber_id: ANN, service_id: SVC, period_start: "2026-01" }, ...others],
    }));
    const result = await generateChargesForMonth(supabase, "2026-03", ratesFor);

    expect(result.generated).toBe(2);
    expect(db.tables.charges.filter((c) => c.subscriber_id === ANN).map((c) => c.period_start).sort())
      .toEqual(["2026-01", "2026-02", "2026-03"]);
    const reads = calls(db, "charges").filter((c) => c.startsWith("GET"));
    expect(reads).toEqual([
      "GET order=id.asc&offset=0&limit=1000",
      "GET order=id.asc&offset=1000&limit=1000",
    ]);
  });

  it("skips a currency it has no rate for, and reports it instead of substituting another", async () => {
    const supabase = await start(tables({
      services: [{ id: "s-eur", name: "Euro thing", monthly_cost: 10, currency: "EUR" }],
      subscriptions: [{ id: "sub-eur", subscriber_id: ANN, service_id: "s-eur", start_date: "2026-03-01", active: true }],
    }));
    const result = await generateChargesForMonth(supabase, "2026-03", ratesFor);
    expect(result.generated).toBe(0);
    expect(result.skipped).toEqual([{ subscriber: "Ann", service: "Euro thing", month: "2026-03", currency: "EUR" }]);
    expect(db.tables.charges).toHaveLength(0);
  });

  it("bills only the subscriber it is given, and never an inactive subscription", async () => {
    const supabase = await start(tables({
      subscriptions: [
        { id: "sub-ann", subscriber_id: ANN, service_id: SVC, start_date: "2026-03-01", active: true },
        { id: "sub-bea", subscriber_id: BEA, service_id: SVC, start_date: "2026-03-01", active: true },
        { id: "sub-off", subscriber_id: ANN, service_id: "s-other", start_date: "2026-03-01", active: false },
      ],
    }));
    const result = await generateChargesForMonth(supabase, "2026-03", ratesFor, ANN);
    expect(result.generated).toBe(1);
    expect(db.tables.charges.map((c) => c.subscriber_id)).toEqual([ANN]);
    expect(calls(db, "subscriptions")).toEqual([`GET active=eq.true&subscriber_id=eq.${ANN}`]);
  });
});

describe("rates", () => {
  let rates: StandIn;
  let answers: Record<string, { status: number; body?: unknown }>;
  beforeEach(async () => {
    answers = {};
    rates = await startPostgrest({}, {
      other: (req) => answers[req.params.get("date") ?? "latest"] ?? { status: 500, body: { error: "no" } },
    });
  });
  afterEach(async () => { await rates.close(); });

  it("asks for each month once, on its 1st, however many subscriptions need it", async () => {
    answers["2026-01-01"] = { status: 200, body: { rates: { SGD: 5.3 } } };
    answers["2026-02-01"] = { status: 200, body: { rates: { SGD: 5.25 } } };
    const forMonth = monthlyRates(rates.url);
    await forMonth("2026-01");
    await forMonth("2026-01");
    await forMonth("2026-02");
    expect((await forMonth("2026-01")).SGD).toBe(5.3);
    expect(rates.requests.map((r) => `${r.path}?${r.params}`)).toEqual([
      "/api/exchange-rate?date=2026-01-01",
      "/api/exchange-rate?date=2026-02-01",
    ]);
  });

  it("answers every month from an override without asking", async () => {
    const forMonth = monthlyRates(rates.url, { SGD: 9 });
    expect(await forMonth("2026-01")).toEqual({ SGD: 9 });
    expect(rates.requests).toHaveLength(0);
  });

  it("falls back to its defaults when the endpoint fails, and merges what it does return", async () => {
    expect(await fetchExchangeRates(rates.url, "2026-05")).toEqual({ USD: 6.79, SGD: 5.35, JPY: 0.0425 });
    answers["2026-06-01"] = { status: 200, body: { rates: { SGD: 5.4 } } };
    expect(await fetchExchangeRates(rates.url, "2026-06")).toEqual({ USD: 6.79, SGD: 5.4, JPY: 0.0425 });
  });
});
