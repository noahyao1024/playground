import { NextResponse } from "next/server";
import { auth, isAllowedEmail } from "@/lib/auth";
import { getServerSupabase } from "@/lib/billing";

export async function POST() {
  const session = await auth();
  if (!session?.user || !isAllowedEmail(session.user.email)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const supabase = getServerSupabase();
  if (!supabase) {
    return NextResponse.json({ error: "Supabase not configured" }, { status: 500 });
  }

  // Marked, not removed. A hard delete here would orphan every wallet entry that
  // settled one of these — the balance would still count the payment while the
  // thing it paid for no longer existed.
  const { data, error } = await supabase
    .from("charges")
    .update({ deleted_at: new Date().toISOString() })
    .is("deleted_at", null)
    .select("id");
  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  return NextResponse.json({ message: "All charges cleared", count: data?.length ?? 0 });
}
