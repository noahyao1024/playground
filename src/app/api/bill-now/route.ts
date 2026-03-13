import { NextRequest, NextResponse } from "next/server";
import { auth, isAllowedEmail } from "@/lib/auth";
import { getServerSupabase, generateChargesForMonth, fetchExchangeRates } from "@/lib/billing";

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
    const now = new Date();
    month = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}`;
  }

  if (!month || !/^\d{4}-\d{2}$/.test(month)) {
    const now = new Date();
    month = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}`;
  }

  // Fetch live rates if not provided
  if (!exchangeRates) {
    const proto = req.headers.get("x-forwarded-proto") ?? "https";
    const host = req.headers.get("host") ?? "localhost:3000";
    exchangeRates = await fetchExchangeRates(`${proto}://${host}`);
  }

  try {
    const result = await generateChargesForMonth(supabase, month, exchangeRates);
    return NextResponse.json({ message: `Generated ${result.generated} charge(s)`, month, exchangeRates, ...result });
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : typeof err === "object" && err !== null && "message" in err ? (err as { message: string }).message : JSON.stringify(err);
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
