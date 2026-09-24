import { NextRequest, NextResponse } from "next/server";
import { getServerSupabase } from "@/lib/billing";

// Mid-market is a reference, not a price anyone transacts at. Settling at it means
// absorbing the offshore/onshore CNY gap, the card's FX spread and the transfer
// fee — a quiet subsidy from whoever fronts the payment. Set FX_MARKUP from a real
// statement rather than trusting this default.
const MARKUP = Number(process.env.FX_MARKUP ?? 1.01);

// One source for both live and historical, so a charge generated on the 1st and
// one backfilled for the same month later agree. ECB data, no key.
const FX = "https://api.frankfurter.dev/v1";

// Last resort only, when the source and the recorded history are both
// unreachable. The previous constants (7.25 / 5.39) sat 8% and 1.7% above the
// market and fourteen charges were billed at them.
const LAST_RESORT: Record<string, number> = { USD: 6.72, SGD: 5.30, JPY: 0.0425 };

const TTL = 10 * 60 * 1000;
let liveCache: { mid: Record<string, number>; ts: number } | null = null;
// Historical rates never change once published, so they are cached for the process's life.
const pastCache = new Map<string, Record<string, number>>();

/** Four decimals suits a rate near 1 and matches every rate recorded so far, so
 *  at or above 1 nothing changes. Below 1 it is not enough: JPY trades near
 *  0.042, where four decimals leaves three significant digits and puts a 12,000
 *  JPY subscription about 0.3 CNY out. Widen to six significant digits there. */
const roundRate = (n: number) => {
  if (!Number.isFinite(n) || n <= 0) return n;
  const magnitude = Math.floor(Math.log10(n));
  const decimals = magnitude >= 0 ? 4 : Math.min(5 - magnitude, 12);
  return Number(n.toFixed(decimals));
};

/** Rates actually used on the most recent charge in each currency — a better
 *  fallback than a constant, because it tracks reality on its own. */
async function recordedRates(): Promise<Record<string, number>> {
  const supabase = getServerSupabase();
  if (!supabase) return {};
  const { data, error } = await supabase
    .from("charges")
    .select("currency, exchange_rate, created_at")
    .order("created_at", { ascending: false })
    .limit(200);
  if (error || !data) return {};
  const seen: Record<string, number> = {};
  for (const row of data as Array<{ currency: string; exchange_rate: number }>) {
    if (row.currency && seen[row.currency] === undefined) seen[row.currency] = Number(row.exchange_rate);
  }
  return seen;
}

/** Ask for one day, or omit for the latest. The source answers a historical
 *  request with the nearest trading day at or before it, which is what a weekend
 *  or holiday should resolve to. */
async function fetchMid(day: string | null): Promise<{ mid: Record<string, number>; asOf: string } | null> {
  const res = await fetch(`${FX}/${day ?? "latest"}?base=USD&symbols=CNY,SGD,JPY`, { next: { revalidate: 600 } });
  if (!res.ok) return null;
  const data = await res.json();
  const cny = Number(data?.rates?.CNY);
  const sgd = Number(data?.rates?.SGD);
  if (!cny || !sgd) return null;
  // The source quotes per USD, so CNY per SGD is the ratio of the two.
  const mid: Record<string, number> = { USD: roundRate(cny), SGD: roundRate(cny / sgd) };
  // Added only when the source returned it. A currency missing upstream should
  // cost that currency its live rate, not take the other two down with it.
  const jpy = Number(data?.rates?.JPY);
  if (jpy) mid.JPY = roundRate(cny / jpy);
  return { mid, asOf: data.date ?? day ?? "" };
}

export async function GET(req: NextRequest) {
  const day = req.nextUrl.searchParams.get("date");
  if (day && !/^\d{4}-\d{2}-\d{2}$/.test(day)) {
    return NextResponse.json({ error: "date must be YYYY-MM-DD" }, { status: 400 });
  }

  let mid: Record<string, number> | null = null;
  let source = "live";
  let asOf = "";

  if (day) {
    const cached = pastCache.get(day);
    if (cached) {
      mid = cached;
      source = "historical";
      asOf = day;
    } else {
      const got = await fetchMid(day);
      if (got) {
        pastCache.set(day, got.mid);
        mid = got.mid;
        source = "historical";
        asOf = got.asOf;
      }
    }
  } else if (liveCache && Date.now() - liveCache.ts < TTL) {
    mid = liveCache.mid;
    asOf = "cached";
  } else {
    const got = await fetchMid(null);
    if (got) {
      liveCache = { mid: got.mid, ts: Date.now() };
      mid = got.mid;
      asOf = got.asOf;
    }
  }

  if (!mid) {
    if (liveCache) { mid = liveCache.mid; source = "stale-cache"; }
    else {
      const recorded = await recordedRates();
      if (Object.keys(recorded).length > 0) { mid = recorded; source = "last-recorded"; }
      else { mid = LAST_RESORT; source = "last-resort"; }
    }
  }

  const rates: Record<string, number> = {};
  for (const [cur, value] of Object.entries(mid)) rates[cur] = roundRate(value * MARKUP);
  // rates is what to settle at; mid is what it came from, so the markup stays visible.
  return NextResponse.json({ rates, mid, markup: MARKUP, source, asOf });
}
