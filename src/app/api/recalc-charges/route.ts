import { NextRequest, NextResponse } from "next/server";
import { auth, isAllowedEmail } from "@/lib/auth";
import { getServerSupabase, fetchExchangeRates } from "@/lib/billing";

/**
 * One-time endpoint to recalculate all charges with correct per-currency exchange rates.
 * Fixes charges that were created with the wrong rate (e.g. SGD charges using USD rate).
 */
export async function POST(req: NextRequest) {
  const session = await auth();
  if (!session?.user || !isAllowedEmail(session.user.email)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const supabase = getServerSupabase();
  if (!supabase) {
    return NextResponse.json({ error: "Supabase not configured" }, { status: 500 });
  }

  // Fetch live rates
  const proto = req.headers.get("x-forwarded-proto") ?? "https";
  const host = req.headers.get("host") ?? "localhost:3000";
  const rates = await fetchExchangeRates(`${proto}://${host}`);

  // Get all charges with their service info
  const { data: charges, error: chargesErr } = await supabase.from("charges").select("*");
  if (chargesErr) return NextResponse.json({ error: chargesErr.message }, { status: 500 });

  let updated = 0;
  for (const charge of charges ?? []) {
    const currency = charge.currency ?? "USD";
    const correctRate = rates[currency] ?? rates.USD ?? 7.25;
    const currentRate = Number(charge.exchange_rate);

    // Skip if rate is already correct (within small tolerance)
    if (Math.abs(currentRate - correctRate) < 0.01) continue;

    const monthlyCost = Number(charge.monthly_cost);
    const months = Number(charge.months) || 1;
    const newTotal = Number((monthlyCost * months * correctRate).toFixed(2));

    const { error } = await supabase.from("charges").update({
      exchange_rate: correctRate,
      total_cny: newTotal,
    }).eq("id", charge.id);

    if (!error) updated++;
  }

  return NextResponse.json({
    message: `Recalculated ${updated} charge(s)`,
    rates,
    total: (charges ?? []).length,
    updated,
  });
}
