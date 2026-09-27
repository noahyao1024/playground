import { NextRequest, NextResponse } from "next/server";
import { cronRefusal } from "@/lib/cron";
import { financeDatabase, reason } from "@/lib/finance-server";
import { revalueStocks } from "@/lib/stocks-server";

/** Every day: the stock accounts valued at the day's prices and their balances
 *  recorded, so the history moves with the market whether or not the page is
 *  opened. Counts only in the answer: the Daily jobs log is public, and what
 *  is held is not. */
export const dynamic = "force-dynamic";
// Pricing a few dozen positions takes seconds; a slow quote source, longer.
export const maxDuration = 60;

export async function GET(req: NextRequest) {
  const refused = await cronRefusal(req);
  if (refused) return refused;
  const db = financeDatabase();
  if (!db) return NextResponse.json({ error: "Supabase not configured" }, { status: 500 });
  try {
    const r = await revalueStocks(db);
    // Every price failing is the source being down, not a symbol being wrong:
    // a 5xx has the daily job ask again in a minute.
    const down = r.failures.length > 0 && r.priced === 0;
    return NextResponse.json({
      valued_at: new Date().toISOString(),
      accounts: r.recorded.length,
      positions: r.priced,
      failed: r.failures.length,
      skipped: r.skipped.length,
    }, { status: down ? 503 : 200 });
  } catch (err) {
    return NextResponse.json({ error: reason(err) }, { status: 500 });
  }
}
