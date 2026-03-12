import { NextRequest, NextResponse } from "next/server";
import { auth, isAllowedEmail } from "@/lib/auth";
import { getServerSupabase } from "@/lib/billing";

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
    const validTables = ["services", "subscribers", "subscriptions", "charges"];
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
        const { error } = await supabase.from(table).update(updates).eq("id", id);
        if (error) throw error;
        return NextResponse.json({ ok: true });
      }
      case "delete": {
        const { error } = await supabase.from(table).delete().eq("id", id);
        if (error) throw error;
        return NextResponse.json({ ok: true });
      }
      default:
        return NextResponse.json({ error: "Invalid action" }, { status: 400 });
    }
  } catch (err) {
    return NextResponse.json({ error: String(err) }, { status: 500 });
  }
}
