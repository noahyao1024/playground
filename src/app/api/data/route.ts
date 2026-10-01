import { NextRequest, NextResponse } from "next/server";
import { auth, isAllowedEmail } from "@/lib/auth";
import { autoSettle, getServerSupabase } from "@/lib/billing";

// What has to be empty before a row may be deleted. payment_methods is absent on
// purpose: its foreign keys are ON DELETE SET NULL, so removing a card unlinks it
// instead of destroying anything.
const DELETE_GUARDS: Record<string, Array<{ table: string; column: string; label: string; labels?: string }>> = {
  services: [
    { table: "subscriptions", column: "service_id", label: "subscription" },
    { table: "charges", column: "service_id", label: "charge" },
  ],
  subscribers: [
    { table: "subscriptions", column: "subscriber_id", label: "subscription" },
    { table: "charges", column: "subscriber_id", label: "charge" },
    { table: "subscribers", column: "pays_from", label: "person paying from this wallet", labels: "people paying from this wallet" },
  ],
};

/** What only editors may read: the card details the public key is not granted
 *  (see 20260927_split_bill_public_key_reads_only). */
export async function GET(req: NextRequest) {
  const session = await auth();
  if (!session?.user || !isAllowedEmail(session.user.email)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  if (req.nextUrl.searchParams.get("details") !== "payment_methods") {
    return NextResponse.json({ error: "Only ?details=payment_methods" }, { status: 400 });
  }
  const supabase = getServerSupabase();
  if (!supabase) {
    return NextResponse.json({ error: "Supabase not configured" }, { status: 500 });
  }
  const { data, error } = await supabase.from("payment_methods").select("id, cardholder_name, expiry_month, expiry_year").order("created_at");
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ payment_methods: data }, { headers: { "Cache-Control": "private, no-store" } });
}

export async function POST(req: NextRequest) {
  const session = await auth();
  if (!session?.user || !isAllowedEmail(session.user.email)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const supabase = getServerSupabase();
  if (!supabase) {
    return NextResponse.json({ error: "Supabase not configured" }, { status: 500 });
  }

  const { action, table, data, id, updates } = await req.json();

  try {
    const validTables = ["services", "subscribers", "subscriptions", "charges", "payment_methods", "wallet_entries"];
    if (!validTables.includes(table)) {
      return NextResponse.json({ error: "Invalid table" }, { status: 400 });
    }

    switch (action) {
      case "insert": {
        // A charge starts unpaid. Paying one is a ledger entry, which only
        // /api/settle writes; a row inserted as paid is money with no entry
        // behind it -- what the update guard below refuses, by the other door.
        const rows: Array<Record<string, unknown> | null> = Array.isArray(data) ? data : [data];
        if (table === "charges" && rows.some((r) => r?.paid === true || r?.paid_at != null || r?.paid_date != null)) {
          return NextResponse.json(
            { error: "A charge starts unpaid. Settle it against a wallet with /api/settle." },
            { status: 400 },
          );
        }
        const { data: result, error } = await supabase.from(table).insert(data).select().single();
        if (error) throw error;
        // A charge is paid from the wallet when the wallet holds enough, and a
        // top-up pays what it now can. The row stands either way; auto_settled
        // says what came of it.
        if (table === "charges" || (table === "wallet_entries" && Number(result.amount_cny) > 0)) {
          return NextResponse.json({ ...result, auto_settled: await autoSettle(supabase, [result.subscriber_id]) });
        }
        return NextResponse.json(result);
      }
      case "update": {
        // Payment state belongs to the ledger. Letting it be set here would move
        // money without an entry behind it, which is what /api/settle exists to
        // prevent — and what the removed Paid toggle used to do.
        if (table === "charges" && updates && ["paid", "paid_at", "paid_date"].some((k) => k in updates)) {
          return NextResponse.json(
            { error: "Payment state is set by settling against a wallet. Use /api/settle." },
            { status: 400 },
          );
        }
        if (id === "__all__") {
          // Bulk update all rows, which exists for one thing: clearing
          // is_default before another card takes it. Nothing else rewrites a
          // whole table from one request, so nothing else is accepted.
          const keys = updates && typeof updates === "object" ? Object.keys(updates) : [];
          if (table !== "payment_methods" || keys.length !== 1 || updates.is_default !== false) {
            return NextResponse.json({ error: "Bulk update only clears the default card" }, { status: 400 });
          }
          // Supabase refuses an update with no filter, so this one matches every
          // row. It used to be neq("id", ""), which a uuid column rejects as
          // invalid input: the old default was never cleared, and since the
          // caller swallowed errors, every card ever made default stayed marked so.
          const { error } = await supabase.from(table).update(updates).not("id", "is", null);
          if (error) throw error;
          return NextResponse.json({ ok: true });
        }
        if (table === "subscribers" && updates && "pays_from" in updates && updates.pays_from !== null && typeof updates.pays_from !== "string") {
          return NextResponse.json({ error: "pays_from is a person's id, or null for their own wallet" }, { status: 400 });
        }
        const { error } = await supabase.from(table).update(updates).eq("id", id);
        if (error) throw error;
        // Paying from another wallet, or a deleted charge back in place, may
        // leave something a wallet can pay now.
        if (table === "subscribers" && updates && "pays_from" in updates) {
          return NextResponse.json({ ok: true, auto_settled: await autoSettle(supabase, [id]) });
        }
        if (table === "charges" && updates && "deleted_at" in updates && updates.deleted_at === null) {
          const { data: restored } = await supabase.from("charges").select("subscriber_id").eq("id", id).maybeSingle();
          if (restored) return NextResponse.json({ ok: true, auto_settled: await autoSettle(supabase, [restored.subscriber_id]) });
        }
        return NextResponse.json({ ok: true });
      }
      case "delete": {
        // Charges are marked deleted, never removed: a removed one leaves any
        // wallet entry that settled it pointing at nothing while still counting
        // against a balance. The UI only ever marks; this refuses the other way.
        if (table === "charges") {
          return NextResponse.json(
            { error: "Charges are marked deleted, not removed. Set deleted_at instead." },
            { status: 400 },
          );
        }
        // Postgres refuses these deletes (the foreign keys are ON DELETE
        // RESTRICT), but its error names a constraint rather than the thing the
        // user is looking at. Count first so the message can.
        const guard = DELETE_GUARDS[table];
        if (guard) {
          const counts = await Promise.all(
            guard.map(async ({ table: child, column, label, labels }) => {
              const { count, error } = await supabase
                .from(child)
                .select("id", { count: "exact", head: true })
                .eq(column, id);
              if (error) throw error;
              return { label, labels: labels ?? `${label}s`, count: count ?? 0 };
            }),
          );
          const used = counts.filter((c) => c.count > 0);
          if (used.length > 0) {
            const detail = used.map((c) => `${c.count} ${c.count === 1 ? c.label : c.labels}`).join(" and ");
            return NextResponse.json(
              { error: `Still in use by ${detail}. Delete those first, or leave this in place — the history needs it.` },
              { status: 409 },
            );
          }
        }
        const { error } = await supabase.from(table).delete().eq("id", id);
        if (error) throw error;
        return NextResponse.json({ ok: true });
      }
      default:
        return NextResponse.json({ error: "Invalid action" }, { status: 400 });
    }
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : typeof err === "object" && err !== null && "message" in err ? (err as { message: string }).message : JSON.stringify(err);
    // A unique index names what it protects by constraint; say it the way the
    // screen would. The charge one also catches restoring a deleted charge into
    // a month that has since been billed again.
    const code = typeof err === "object" && err !== null && "code" in err ? String((err as { code: unknown }).code) : "";
    if (code === "23505" && msg.includes("charges_one_per_service_month")) {
      return NextResponse.json(
        { error: "That person already has a charge for this service in that month." },
        { status: 409 },
      );
    }
    // A wallet is paid from one level deep (20261001_auto_settle); the trigger's
    // words name who is in the way.
    if (code === "23514" && table === "subscribers") {
      return NextResponse.json({ error: msg }, { status: 409 });
    }
    if (code === "23505" && msg.includes("payment_methods_one_default")) {
      return NextResponse.json({ error: "Another card is already the default." }, { status: 409 });
    }
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
