import { NextRequest, NextResponse } from "next/server";
import { auth, isAllowedEmail } from "@/lib/auth";
import { getServerSupabase, generateChargesForMonth } from "@/lib/billing";

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

  // Accept optional month and exchangeRate params
  let month: string;
  let exchangeRate = 7.25;
  try {
    const body = await req.json();
    month = body.month;
    if (body.exchangeRate) exchangeRate = Number(body.exchangeRate);
  } catch {
    const now = new Date();
    month = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}`;
  }

  if (!month || !/^\d{4}-\d{2}$/.test(month)) {
    const now = new Date();
    month = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}`;
  }

  try {
    const result = await generateChargesForMonth(supabase, month, exchangeRate);
    return NextResponse.json({ message: `Generated ${result.generated} charge(s)`, month, ...result });
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : typeof err === "object" && err !== null && "message" in err ? (err as { message: string }).message : JSON.stringify(err);
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
