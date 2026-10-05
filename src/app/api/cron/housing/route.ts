import { NextRequest, NextResponse } from "next/server";
import { cronRefusal } from "@/lib/cron";
import { financeDatabase, reason } from "@/lib/finance-server";
import { refreshMarket } from "@/lib/housing-data";

/** Every day: the housing market's figures brought up to date from
 *  data.gov.sg. Its datasets move once a quarter, so most days this reads six
 *  catalogue entries and nothing more. The figures are public, but the answer
 *  keeps to counts and dataset ids all the same: the Daily jobs log is. */
export const dynamic = "force-dynamic";
// A changed dataset is read whole: twelve thousand figures, in seconds.
export const maxDuration = 60;

export async function GET(req: NextRequest) {
  const refused = await cronRefusal(req);
  if (refused) return refused;
  const db = financeDatabase();
  if (!db) return NextResponse.json({ error: "Supabase not configured" }, { status: 500 });
  try {
    const r = await refreshMarket(db);
    // Not one catalogue entry read is data.gov.sg being down, not a dataset
    // gone: a 5xx has the daily job ask again in a minute.
    const down = r.checked === 0 && r.failures.length > 0;
    return NextResponse.json({
      ...(down ? { error: "data.gov.sg could not be reached" } : {}),
      checked: r.checked,
      refreshed: r.refreshed,
      points: r.points,
      failed: r.failures.length,
      failures: r.failures,
    }, { status: down ? 503 : 200 });
  } catch (err) {
    return NextResponse.json({ error: reason(err) }, { status: 500 });
  }
}
