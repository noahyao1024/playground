import { NextRequest, NextResponse } from "next/server";
import { getServerSupabase } from "@/lib/billing";
import { cronRefusal } from "@/lib/cron";
import { mailConfig, sendMail } from "@/lib/mail";
import { fetchAllRows } from "@/lib/paginate";
import { alertMail, overThreshold, testMail, type Person, type UnpaidCharge } from "@/lib/unpaid";

/** The daily job: it emails the owner who owes more than UNPAID_THRESHOLD_CNY,
 *  and its reads keep the free-tier Supabase project awake. The Daily jobs
 *  workflow calls it and judges the answer (scripts/daily-jobs.mjs), so each
 *  run is on record and a failed one reaches the owner; Vercel Cron keeps only
 *  a bare keepalive (/api/cron/keepalive), since two callers here would mean
 *  two mails.
 *
 *  Mail goes out only when SMTP is configured in Vercel; until then the run
 *  answers with the report and sends nothing. `?test=1` mails even when nobody
 *  is over the line, to check the setup end to end. */
export const dynamic = "force-dynamic";

const LINK = "https://playground.noahyao.me/split-bill";

const reason = (err: unknown) =>
  err instanceof Error ? err.message : typeof err === "object" && err !== null && "message" in err ? String((err as { message: unknown }).message) : JSON.stringify(err);

export async function GET(req: NextRequest) {
  const refused = cronRefusal(req);
  if (refused) return refused;
  const db = getServerSupabase();
  if (!db) return NextResponse.json({ error: "Supabase not configured" }, { status: 500 });

  const threshold = Number(process.env.UNPAID_THRESHOLD_CNY || 500);
  let charges: UnpaidCharge[], people: Person[];
  try {
    [charges, people] = await Promise.all([
      fetchAllRows<UnpaidCharge>((from, to) => db.from("charges")
        .select("subscriber_id,total_cny,period_start").eq("paid", false).is("deleted_at", null)
        .order("id").range(from, to)),
      fetchAllRows<Person>((from, to) => db.from("subscribers").select("id,name").order("id").range(from, to)),
    ]);
  } catch (err) {
    return NextResponse.json({ error: reason(err) }, { status: 500 });
  }

  const over = overThreshold(charges, people, threshold);
  const report = { checked_at: new Date().toISOString(), threshold, over };
  const test = req.nextUrl.searchParams.get("test") === "1";
  if (over.length === 0 && !test) return NextResponse.json({ ...report, email: "not needed" });
  const config = mailConfig();
  if (!config) return NextResponse.json({ ...report, email: "not configured" });
  try {
    await sendMail(config, over.length ? alertMail(over, threshold, LINK) : testMail(threshold, LINK));
    return NextResponse.json({ ...report, email: "sent" });
  } catch (err) {
    // The check and the keepalive happened; the mail did not, and the answer
    // says so in its status as well as its body.
    return NextResponse.json({ ...report, email: "failed", error: reason(err) }, { status: 502 });
  }
}
