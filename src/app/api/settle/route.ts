import { NextRequest, NextResponse } from "next/server";
import { auth, isAllowedEmail } from "@/lib/auth";
import { getServerSupabase } from "@/lib/billing";

/** Settling and un-settling run as database functions so the balance check, the
 *  ledger entry and the paid flag land in one transaction. Doing it here would
 *  let two requests both pass a check only one of them can afford. */
export async function POST(req: NextRequest) {
  const session = await auth();
  if (!session?.user || !isAllowedEmail(session.user.email)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const supabase = getServerSupabase();
  if (!supabase) {
    return NextResponse.json({ error: "Supabase not configured" }, { status: 500 });
  }

  // For settlePerson, chargeId carries the subscriber whose charges are being cleared.
  const { action, chargeId, walletOwnerId, note } = await req.json();
  if (!chargeId) return NextResponse.json({ error: "chargeId is required" }, { status: 400 });

  if (action === "settle") {
    if (!walletOwnerId) return NextResponse.json({ error: "walletOwnerId is required" }, { status: 400 });
    const { data, error } = await supabase.rpc("settle_charge", {
      p_charge_id: chargeId, p_wallet_owner: walletOwnerId, p_note: note ?? null,
    });
    // The function raises on an empty wallet, so its message is the useful one.
    if (error) return NextResponse.json({ error: error.message }, { status: 409 });
    return NextResponse.json({ ok: true, balance: Number(data) });
  }

  if (action === "settlePerson") {
    if (!walletOwnerId) return NextResponse.json({ error: "walletOwnerId is required" }, { status: 400 });
    const { data, error } = await supabase.rpc("settle_person", {
      p_subscriber: chargeId, p_wallet_owner: walletOwnerId, p_note: note ?? null,
    });
    if (error) return NextResponse.json({ error: error.message }, { status: 409 });
    const row = Array.isArray(data) ? data[0] : data;
    return NextResponse.json({
      ok: true,
      settled: Number(row?.settled ?? 0),
      total: Number(row?.total ?? 0),
      balance: Number(row?.balance_left ?? 0),
    });
  }

  if (action === "unsettle") {
    const { data, error } = await supabase.rpc("unsettle_charge", {
      p_charge_id: chargeId, p_note: note ?? null,
    });
    if (error) return NextResponse.json({ error: error.message }, { status: 409 });
    return NextResponse.json({ ok: true, balance: Number(data) });
  }

  return NextResponse.json({ error: "Invalid action" }, { status: 400 });
}
