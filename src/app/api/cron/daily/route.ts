import { NextRequest, NextResponse } from "next/server";
import { getServerSupabase } from "@/lib/billing";
import { mailConfig, sendMail } from "@/lib/mail";
import { fetchAllRows } from "@/lib/paginate";
import { alertMail, overThreshold, type Person, type UnpaidCharge } from "@/lib/unpaid";

/** The daily job, run by Vercel Cron (vercel.json): it keeps the free-tier
 *  Supabase project awake and emails the owner who owes more than
 *  UNPAID_THRESHOLD_CNY. It took over from two GitHub workflows, which GitHub
 *  stops scheduling in a public repository after 60 days without a commit --
 *  and a paused database is how this site goes down.
 *
 *  The reads are the keepalive: any query resets the project's idle clock.
 *  Mail goes out only when SMTP is configured in Vercel; until then the run
 *  answers with the report and sends nothing. */
export const dynamic = "force-dynamic";

const LINK = "https://playground.noahyao.me/split-bill";

const reason = (err: unknown) =>
  err instanceof Error ? err.message : typeof err === "object" && err !== null && "message" in err ? String((err as { message: unknown }).message) : JSON.stringify(err);

export async function GET(req: NextRequest) {
  const cronSecret = process.env.CRON_SECRET;
  if (!cronSecret) return NextResponse.json({ error: "CRON_SECRET not configured" }, { status: 500 });
  if (req.headers.get("authorization") !== `Bearer ${cronSecret}`) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
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
  if (over.length === 0) return NextResponse.json({ ...report, email: "not needed" });
  const config = mailConfig();
  if (!config) return NextResponse.json({ ...report, email: "not configured" });
  try {
    await sendMail(config, alertMail(over, threshold, LINK));
    return NextResponse.json({ ...report, email: "sent" });
  } catch (err) {
    // The check and the keepalive happened; the mail did not. A failed run is
    // what shows in Vercel's cron log, so it answers as one.
    return NextResponse.json({ ...report, email: "failed", error: reason(err) }, { status: 502 });
  }
}
