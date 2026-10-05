import { NextRequest, NextResponse } from "next/server";
import { cronRefusal } from "@/lib/cron";
import { financeDatabase, reason } from "@/lib/finance-server";
import { refreshProjects } from "@/lib/ura";

/** Every day: the private developments the owner follows, read from URA's
 *  Data Service when one is due -- a week after it was last read -- so most
 *  days this asks URA nothing. The answer keeps to counts and states, never
 *  which developments: the Daily jobs log is public. */
export const dynamic = "force-dynamic";
// Reading URA is a token, a file of sales and four quarters of rental
// contracts, spaced: some tens of seconds.
export const maxDuration = 60;

export async function GET(req: NextRequest) {
  const refused = await cronRefusal(req);
  if (refused) return refused;
  const db = financeDatabase();
  if (!db) return NextResponse.json({ error: "Supabase not configured" }, { status: 500 });
  try {
    const r = await refreshProjects(db);
    return NextResponse.json({
      state: r.state,
      followed: r.followed,
      read: r.read,
      sales: r.sales,
      rents: r.rents,
      failed: r.failures.length,
      failures: r.failures,
    });
  } catch (err) {
    return NextResponse.json({ error: reason(err) }, { status: 500 });
  }
}
