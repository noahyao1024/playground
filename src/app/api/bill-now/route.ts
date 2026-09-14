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

  // Accept optional month and exchangeRates params
  let month: string;
  let exchangeRates: Record<string, number> | undefined;
  try {
    const body = await req.json();
    month = body.month;
    if (body.exchangeRates && typeof body.exchangeRates === "object") {
      exchangeRates = body.exchangeRates;
    } else if (body.exchangeRate) {
      // Legacy: single rate treated as USD
      exchangeRates = { USD: Number(body.exchangeRate) };
    }
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
  const ratesFor = monthlyRates(`${proto}://${host}`, exchangeRates);

  try {
    const result = await generateChargesForMonth(supabase, month, ratesFor);
    return NextResponse.json({ message: `Generated ${result.generated} charge(s)`, month, ...result });
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : typeof err === "object" && err !== null && "message" in err ? (err as { message: string }).message : JSON.stringify(err);
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
