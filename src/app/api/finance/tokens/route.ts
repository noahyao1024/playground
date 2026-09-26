import { NextRequest } from "next/server";
import {
  financeDatabase, financeJson as json, isFinanceOwnerSession, isUuid, newFinanceToken, reason, sha256Hex,
} from "@/lib/finance-server";

/** The tokens the owner's agents use on /api/finance/*: listed, made and revoked
 *  by the owner signed in on the /finance page, never with a token. A new token
 *  is in the answer that makes it and nowhere else; only its hash is kept. */
export const dynamic = "force-dynamic";

const NAME_MAX = 60;
// What may be said about a token: never its hash, whatever the query asked for.
type Row = { id: string; name: string; created_at?: string };
const shown = ({ id, name, created_at }: Row) => ({ id, name, created_at });

export async function GET() {
  if (!(await isFinanceOwnerSession())) return json({ error: "Unauthorized" }, 401);
  const db = financeDatabase();
  if (!db) return json({ error: "Supabase not configured" }, 500);
  // A handful at most, made by hand; no paging needed.
  const { data, error } = await db.from("finance_api_tokens")
    .select("id,name,created_at").order("created_at", { ascending: false }).order("id").limit(100);
  if (error) return json({ error: reason(error) }, 500);
  return json({ tokens: (data as Row[]).map(shown) });
}

export async function POST(req: NextRequest) {
  if (!(await isFinanceOwnerSession())) return json({ error: "Unauthorized" }, 401);
  const db = financeDatabase();
  if (!db) return json({ error: "Supabase not configured" }, 500);
  const body = await req.json().catch(() => ({}));
  const name = typeof body?.name === "string" && body.name.trim() ? body.name.trim() : "Agent";
  if (name.length > NAME_MAX) return json({ error: `The name can be at most ${NAME_MAX} characters` }, 400);
  const token = newFinanceToken();
  const { data, error } = await db.from("finance_api_tokens")
    .insert({ name, token_sha256: sha256Hex(token) }).select("id,name,created_at").single();
  if (error) return json({ error: reason(error) }, 500);
  return json({ ...shown(data as Row), token }, 201);
}

export async function DELETE(req: NextRequest) {
  if (!(await isFinanceOwnerSession())) return json({ error: "Unauthorized" }, 401);
  const id = req.nextUrl.searchParams.get("id") ?? "";
  if (!isUuid(id)) return json({ error: "Which token? Give its id as ?id=" }, 400);
  const db = financeDatabase();
  if (!db) return json({ error: "Supabase not configured" }, 500);
  const { data, error } = await db.from("finance_api_tokens").delete().eq("id", id).select("id");
  if (error) return json({ error: reason(error) }, 500);
  if (!data?.length) return json({ error: "No such token" }, 404);
  return json({ revoked: id });
}
