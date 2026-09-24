import { NextRequest, NextResponse } from "next/server";
import { monthInSG } from "@/lib/dates";
import { getServerSupabase, generateChargesForMonth, monthlyRates } from "@/lib/billing";

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
  // A catch-up run spans several months; each is priced at its own rate.
  const ratesFor = monthlyRates(`${proto}://${host}`);

  try {
    const result = await generateChargesForMonth(supabase, month, ratesFor);
    // A run that skipped everything would otherwise read as a clean success.
            const note = result.skipped.length
              ? ` (skipped ${result.skipped.length} with no rate for their currency)`
              : "";
            return NextResponse.json({ message: `Generated ${result.generated} charge(s)${note}`, month, ...result });
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : typeof err === "object" && err !== null && "message" in err ? (err as { message: string }).message : JSON.stringify(err);
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
