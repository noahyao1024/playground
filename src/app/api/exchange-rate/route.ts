import { NextResponse } from "next/server";

// Cache rates for 10 minutes
let cache: { rates: Record<string, number>; ts: number } | null = null;
const TTL = 10 * 60 * 1000;

export async function GET() {
  if (cache && Date.now() - cache.ts < TTL) {
    return NextResponse.json(cache.rates);
  }

  try {
    const res = await fetch("https://open.er-api.com/v6/latest/CNY", {
      next: { revalidate: 600 },
    });
    if (!res.ok) throw new Error(`API returned ${res.status}`);
    const data = await res.json();

    // We need X_CNY (how many CNY per 1 unit of foreign currency)
    // The API gives CNY-based rates, so 1 CNY = X USD → invert to get USD→CNY
    const rates: Record<string, number> = {};
    if (data.rates?.USD) rates.USD = Math.round((1 / data.rates.USD) * 10000) / 10000;
    if (data.rates?.SGD) rates.SGD = Math.round((1 / data.rates.SGD) * 10000) / 10000;

    cache = { rates, ts: Date.now() };
    return NextResponse.json(rates);
  } catch (err) {
    // Return stale cache if available
    if (cache) return NextResponse.json(cache.rates);
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Failed to fetch rates" },
      { status: 502 }
    );
  }
}
