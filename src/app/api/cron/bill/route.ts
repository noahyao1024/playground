import { NextRequest, NextResponse } from "next/server";
import { monthInSG } from "@/lib/dates";
import { getServerSupabase, generateChargesForMonth, fetchExchangeRates } from "@/lib/billing";

export async function GET(req: NextRequest) {
  // Verify the request is from Vercel Cron
  const cronSecret = process.env.CRON_SECRET;
  if (!cronSecret) {
    return NextResponse.json({ error: "CRON_SECRET not configured" }, { status: 500 });
  }
  const authHeader = req.headers.get("authorization");
  if (authHeader !== `Bearer ${cronSecret}`) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const supabase = getServerSupabase();
  if (!supabase) {
    return NextResponse.json({ error: "Supabase not configured" }, { status: 500 });
  }

  // Vercel functions run in UTC; between 16:00 and midnight there it is already
  // tomorrow in Singapore, which for the 1st of a month is a different month.
  const month = monthInSG();

  // Fetch live exchange rates
  const proto = req.headers.get("x-forwarded-proto") ?? "https";
  const host = req.headers.get("host") ?? "localhost:3000";
  const exchangeRates = await fetchExchangeRates(`${proto}://${host}`);

  try {
    const result = await generateChargesForMonth(supabase, month, exchangeRates);
    return NextResponse.json({ message: `Generated ${result.generated} charge(s)`, month, exchangeRates, ...result });
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : typeof err === "object" && err !== null && "message" in err ? (err as { message: string }).message : JSON.stringify(err);
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
