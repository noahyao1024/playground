import { NextResponse } from "next/server";
import { getServerSupabase } from "@/lib/billing";

// Mid-market is a reference, not a price anyone transacts at. Settling a bill at
// it means eating the offshore/onshore CNY gap, the card's FX spread and the
// transfer fee — a quiet subsidy from whoever fronts the payment. FX_MARKUP
// covers that; set it from a real statement rather than trusting this default.
const MARKUP = Number(process.env.FX_MARKUP ?? 1.01);

// Last resort only, and only when both the live source and the recorded history
// are unreachable. Deliberately close to the real market: the previous constants
// (7.25 / 5.39) drifted 8% and 1.7% above it, and fourteen charges were billed
// at them when the API was down.
const LAST_RESORT: Record<string, number> = { USD: 6.72, SGD: 5.30 };

const TTL = 10 * 60 * 1000;
let cache: { mid: Record<string, number>; ts: number } | null = null;

const round4 = (n: number) => Math.round(n * 10000) / 10000;

/** Rates actually used on the most recent charge in each currency. Better than a
 *  constant when the live source is down, because it tracks reality on its own. */
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

async function midRates(): Promise<{ mid: Record<string, number>; source: string }> {
  if (cache && Date.now() - cache.ts < TTL) return { mid: cache.mid, source: "live" };
  try {
    const res = await fetch("https://open.er-api.com/v6/latest/CNY", { next: { revalidate: 600 } });
    if (!res.ok) throw new Error(`API returned ${res.status}`);
    const data = await res.json();
    const mid: Record<string, number> = {};
    // The source is CNY-based (1 CNY = X foreign), so invert for foreign → CNY.
    if (data.rates?.USD) mid.USD = round4(1 / data.rates.USD);
    if (data.rates?.SGD) mid.SGD = round4(1 / data.rates.SGD);
    if (Object.keys(mid).length === 0) throw new Error("no usable rates");
    cache = { mid, ts: Date.now() };
    return { mid, source: "live" };
  } catch {
    if (cache) return { mid: cache.mid, source: "stale-cache" };
    const recorded = await recordedRates();
    if (Object.keys(recorded).length > 0) return { mid: recorded, source: "last-recorded" };
    return { mid: LAST_RESORT, source: "last-resort" };
  }
}

export async function GET() {
  const { mid, source } = await midRates();
  const rates: Record<string, number> = {};
  for (const [cur, value] of Object.entries(mid)) rates[cur] = round4(value * MARKUP);
  // rates is what to settle at; mid is what it was derived from, so the markup is
  // visible rather than baked in silently.
  return NextResponse.json({ rates, mid, markup: MARKUP, source });
}
