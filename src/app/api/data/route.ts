import { NextRequest, NextResponse } from "next/server";
import { auth, isAllowedEmail } from "@/lib/auth";
import { getServerSupabase } from "@/lib/billing";

// What has to be empty before a row may be deleted. payment_methods is absent on
// purpose: its foreign keys are ON DELETE SET NULL, so removing a card unlinks it
// instead of destroying anything.
const DELETE_GUARDS: Record<string, Array<{ table: string; column: string; label: string }>> = {
  services: [
    { table: "subscriptions", column: "service_id", label: "subscription" },
    { table: "charges", column: "service_id", label: "charge" },
  ],
  subscribers: [
    { table: "subscriptions", column: "subscriber_id", label: "subscription" },
    { table: "charges", column: "subscriber_id", label: "charge" },
  ],
};

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
    const validTables = ["services", "subscribers", "subscriptions", "charges", "payment_methods"];
    if (!validTables.includes(table)) {
      return NextResponse.json({ error: "Invalid table" }, { status: 400 });
    }

    switch (action) {
      case "insert": {
        const { data: result, error } = await supabase.from(table).insert(data).select().single();
        if (error) throw error;
        return NextResponse.json(result);
      }
      case "update": {
        if (id === "__all__") {
          // Bulk update all rows (used for clearing is_default on payment_methods)
          const { error } = await supabase.from(table).update(updates).neq("id", "");
          if (error) throw error;
          return NextResponse.json({ ok: true });
        }
        const { error } = await supabase.from(table).update(updates).eq("id", id);
        if (error) throw error;
        return NextResponse.json({ ok: true });
      }
      case "delete": {
        // Postgres refuses these deletes (the foreign keys are ON DELETE
        // RESTRICT), but its error names a constraint rather than the thing the
        // user is looking at. Count first so the message can.
        const guard = DELETE_GUARDS[table];
        if (guard) {
          const counts = await Promise.all(
            guard.map(async ({ table: child, column, label }) => {
              const { count, error } = await supabase
                .from(child)
                .select("id", { count: "exact", head: true })
                .eq(column, id);
              if (error) throw error;
              return { label, count: count ?? 0 };
            }),
          );
          const used = counts.filter((c) => c.count > 0);
          if (used.length > 0) {
            const detail = used.map((c) => `${c.count} ${c.label}${c.count === 1 ? "" : "s"}`).join(" and ");
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
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
