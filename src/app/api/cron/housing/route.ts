import { NextRequest, NextResponse } from "next/server";
import { cronRefusal } from "@/lib/cron";
import { financeDatabase, reason } from "@/lib/finance-server";
import { DATASETS, refreshMarket } from "@/lib/housing-data";

/** Every day: the housing market's figures brought up to date -- from
 *  data.gov.sg, whose datasets move monthly or quarterly, so most days this
 *  reads their catalogue entries and nothing more, and the shares' history
 *  from Yahoo. The figures are public, but the answer keeps to counts and
 *  dataset ids all the same: the Daily jobs log is. */
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
    // Every one of data.gov.sg's datasets failing is data.gov.sg being down,
    // not a dataset gone: a 5xx has the daily job ask again in a minute.
    const down = DATASETS.every((d) => r.failures.some((f) => f.dataset === d.id));
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
