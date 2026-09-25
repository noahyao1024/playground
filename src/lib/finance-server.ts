import { createHash, timingSafeEqual } from "node:crypto";
import { NextResponse } from "next/server";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { auth } from "@/lib/auth";
import { isFinanceOwner } from "@/lib/access";
import { fetchAllRows } from "@/lib/paginate";
import type { FinanceAccount, FinanceBalance } from "@/lib/finance";

/** The server side of /api/finance/*: who may ask, and where the answers come
 *  from. Server-only -- it reads the service-role key and node:crypto. */

/** Every answer is the owner's money: marked so nothing may keep it, not a CDN,
 *  a shared cache or the browser's back button. */
export const NO_STORE = { "Cache-Control": "private, no-store" };
export const financeJson = (body: unknown, status = 200) => NextResponse.json(body, { status, headers: NO_STORE });

/** A thrown value as a sentence. Supabase's errors are plain objects, not Errors. */
export function reason(err: unknown): string {
  if (err instanceof Error) return err.message;
  if (typeof err === "object" && err !== null && "message" in err) return String((err as { message: unknown }).message);
  return JSON.stringify(err);
}

/** The service role only. Elsewhere the anon key is a fallback; here it would
 *  read nothing, since the finance tables grant it nothing. */
export function financeDatabase(): SupabaseClient | null {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  return url && key ? createClient(url, key, { auth: { persistSession: false } }) : null;
}

/** All accounts and all balances. Balances grow by a row per account per
 *  record, forever: paged, on a unique order. */
export async function readFinance(db: SupabaseClient): Promise<{ accounts: FinanceAccount[]; balances: FinanceBalance[] }> {
  const [{ data: accounts, error }, balances] = await Promise.all([
    db.from("finance_accounts").select("*").order("created_at").order("id"),
    fetchAllRows<FinanceBalance>((from, to) =>
      db.from("finance_balances").select("*").order("as_of").order("id").range(from, to)),
  ]);
  if (error) throw error;
  return { accounts: (accounts ?? []) as FinanceAccount[], balances };
}

/** Shorter than this, FINANCE_API_TOKEN is ignored and only the owner's session
 *  gets in: a guessable token on someone's money is worse than none.
 *  `openssl rand -hex 32` gives 64 characters. */
export const MIN_TOKEN_LENGTH = 32;

const digest = (s: string) => createHash("sha256").update(s).digest();

/** Whether a request carries FINANCE_API_TOKEN as a bearer token -- how an agent
 *  or a script acts for the owner, reading and writing. Both sides are hashed
 *  before comparing, so the comparison takes the same time however much of the
 *  token matched. The configured value is trimmed: a newline pasted into the
 *  dashboard along with it would otherwise lock every caller out. */
export function hasFinanceToken(req: Request): boolean {
  const token = (process.env.FINANCE_API_TOKEN ?? "").trim();
  if (token.length < MIN_TOKEN_LENGTH) return false;
  const given = /^Bearer\s+(\S+)\s*$/i.exec(req.headers.get("authorization") ?? "")?.[1];
  return given !== undefined && timingSafeEqual(digest(given), digest(token));
}

/** Whether a request speaks for the owner: the token, or their signed-in session. */
export async function isFinanceRequest(req: Request): Promise<boolean> {
  if (hasFinanceToken(req)) return true;
  const session = await auth();
  return isFinanceOwner(session?.user?.email);
}
