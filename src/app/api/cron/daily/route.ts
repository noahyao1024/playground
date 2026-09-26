import { NextRequest, NextResponse } from "next/server";
import { getServerSupabase } from "@/lib/billing";
import { cronRefusal } from "@/lib/cron";
import { fetchAllRows } from "@/lib/paginate";
import { alertMail, overThreshold, testMail, type Person, type UnpaidCharge } from "@/lib/unpaid";

/** The daily check: who owes more than UNPAID_THRESHOLD_CNY, and the mail that
 *  says so. The Daily jobs workflow calls it and sends that mail through the
 *  SMTP account it already holds as GitHub secrets, so the site keeps no mail
 *  settings and there is one sender. Its reads keep the free-tier Supabase
 *  project awake.
 *
 *  `mail` is null when nobody is over the line. `?test=1` asks for one anyway,
 *  to check the mail setup end to end. */
export const dynamic = "force-dynamic";

const LINK = "https://playground.noahyao.me/split-bill";

const reason = (err: unknown) =>
  err instanceof Error ? err.message : typeof err === "object" && err !== null && "message" in err ? String((err as { message: unknown }).message) : JSON.stringify(err);

export async function GET(req: NextRequest) {
  const refused = await cronRefusal(req);
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
  const test = req.nextUrl.searchParams.get("test") === "1";
  const mail = over.length ? alertMail(over, threshold, LINK) : test ? testMail(threshold, LINK) : null;
  return NextResponse.json({ checked_at: new Date().toISOString(), threshold, over, mail });
}
