import { NextRequest, NextResponse } from "next/server";
import { getServerSupabase } from "@/lib/billing";
import { cronRefusal } from "@/lib/cron";

/** Vercel Cron's daily backstop (vercel.json): one small read, which is all it
 *  takes to keep the free-tier Supabase project from pausing -- and a paused
 *  database is how this site goes down. The daily job proper runs from GitHub
 *  Actions, which stops scheduling in a public repository after 60 days without
 *  a commit; this keeps the site up if that ever happens. */
export const dynamic = "force-dynamic";

export async function GET(req: NextRequest) {
  const refused = cronRefusal(req);
  if (refused) return refused;
  const db = getServerSupabase();
  if (!db) return NextResponse.json({ error: "Supabase not configured" }, { status: 500 });
  const { error } = await db.from("subscribers").select("id").limit(1);
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ ok: true });
}
