import { NextRequest, NextResponse } from "next/server";
import { auth, isAllowedEmail } from "@/lib/auth";
import { monthInSG } from "@/lib/dates";
import { getServerSupabase, generateChargesForMonth, monthlyRates } from "@/lib/billing";

export async function POST(req: NextRequest) {
  // Check auth + whitelist
  const session = await auth();
  if (!session?.user || !isAllowedEmail(session.user.email)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const supabase = getServerSupabase();
  if (!supabase) {
    return NextResponse.json({ error: "Supabase not configured" }, { status: 500 });
  }

  // Optional month, and an optional person to restrict the run to.
  let month: string;
  let subscriberId: string | undefined;
  try {
    const body = await req.json();
    month = body.month;
    if (typeof body.subscriberId === "string" && body.subscriberId) subscriberId = body.subscriberId;
  } catch {
    month = monthInSG();
  }

  if (!month || !/^\d{4}-\d{2}$/.test(month)) {
    month = monthInSG();
  }

  const proto = req.headers.get("x-forwarded-proto") ?? "https";
  const host = req.headers.get("host") ?? "localhost:3000";
  // A run can span months it never billed; each gets its own rate. Rates supplied
  // in the body override that for every month, which is what an explicit rate means.
  // No rate override: a run can span months it never billed, and each must be
  // priced at its own. Passing one figure for all of them is the bug this drops.
  const ratesFor = monthlyRates(`${proto}://${host}`);

  try {
    const result = await generateChargesForMonth(supabase, month, ratesFor, subscriberId);
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
