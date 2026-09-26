import { createHash, randomBytes, timingSafeEqual } from "node:crypto";
import { NextResponse } from "next/server";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { auth } from "@/lib/auth";
import { isFinanceOwner } from "@/lib/access";
import { fetchAllRows, pagesOf } from "@/lib/paginate";
import type { FinanceAccount, FinanceBalance, LoanPrepayment, LoanRateChange } from "@/lib/finance";

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

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
/** Whether an id could be one: checked before a query, which Postgres would
 *  otherwise fail as a server error. */
export const isUuid = (value: unknown): value is string => typeof value === "string" && UUID.test(value);

/** The service role only. Elsewhere the anon key is a fallback; here it would
 *  read nothing, since the finance tables grant it nothing. */
export function financeDatabase(): SupabaseClient | null {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  return url && key ? createClient(url, key, { auth: { persistSession: false } }) : null;
}

/** How PostgREST says a table is not there: Postgres's own code, or its own
 *  when the table is missing from its schema cache. */
const MISSING_TABLE = new Set(["42P01", "PGRST205"]);

/** A table's rows for loans, oldest first -- every account's, or one account's.
 *  Before its migration is applied the table is not there, and there are none:
 *  the loans are scheduled on their terms alone. */
function readLoanRows<T>(db: SupabaseClient, table: string, day: string, accountId?: string): Promise<T[]> {
  return fetchAllRows<T>(async (from, to) => {
    let query = db.from(table).select("*");
    if (accountId) query = query.eq("account_id", accountId);
    const page = await query.order("account_id").order(day).range(from, to);
    return page.error && MISSING_TABLE.has(page.error.code) ? { data: [], error: null } : page;
  });
}

/** What has happened to loans since their terms: rate changes and prepayments. */
export type LoanEvents = { rateChanges: LoanRateChange[]; prepayments: LoanPrepayment[] };

export async function readLoanEvents(db: SupabaseClient, accountId?: string): Promise<LoanEvents> {
  const [rateChanges, prepayments] = await Promise.all([
    readLoanRows<LoanRateChange>(db, "finance_loan_rate_changes", "effective_date", accountId),
    readLoanRows<LoanPrepayment>(db, "finance_loan_prepayments", "paid_on", accountId),
  ]);
  return { rateChanges, prepayments };
}

function byAccount<T extends { account_id: string }>(rows: T[]): Map<string, T[]> {
  const map = new Map<string, T[]>();
  for (const row of rows) {
    const list = map.get(row.account_id);
    if (list) list.push(row);
    else map.set(row.account_id, [row]);
  }
  return map;
}

/** Accounts with each one's rate changes and prepayments on it, as the API
 *  hands them out. */
export function withLoanEvents<T extends FinanceAccount>(accounts: T[], events: LoanEvents): T[] {
  const changes = byAccount(events.rateChanges), prepayments = byAccount(events.prepayments);
  return accounts.map((a) => ({ ...a, rate_changes: changes.get(a.id) ?? [], prepayments: prepayments.get(a.id) ?? [] }));
}

/** Every account, with its rate changes and prepayments. A family's are few,
 *  but a read that trusted one request to return them all would lose some
 *  silently past PostgREST's row cap. */
export async function readAccounts(db: SupabaseClient): Promise<FinanceAccount[]> {
  const [accounts, events] = await Promise.all([
    fetchAllRows<FinanceAccount>((from, to) =>
      db.from("finance_accounts").select("*").order("created_at").order("id").range(from, to)),
    readLoanEvents(db),
  ]);
  return withLoanEvents(accounts, events);
}

/** One account as the API hands it out, with its rate changes and
 *  prepayments; null if there is no such account. */
export async function readAccount(db: SupabaseClient, id: string): Promise<FinanceAccount | null> {
  const [{ data, error }, events] = await Promise.all([
    db.from("finance_accounts").select("*").eq("id", id).maybeSingle(),
    readLoanEvents(db, id),
  ]);
  if (error) throw error;
  return data ? withLoanEvents([data as FinanceAccount], events)[0] : null;
}

/** Every balance, a page at a time, oldest first. They grow by a row per
 *  account per record, forever: paged on a unique order, several pages in
 *  flight at once. */
export function balancePages(db: SupabaseClient): AsyncGenerator<FinanceBalance[]> {
  return pagesOf<FinanceBalance>((from, to, count) =>
    db.from("finance_balances").select("*", count ? { count: "exact" } : undefined).order("as_of").order("id").range(from, to));
}

/** All accounts and all balances, in memory: for what has to see all of them
 *  at once, like the summary. The page's own read streams instead. */
export async function readFinance(db: SupabaseClient): Promise<{ accounts: FinanceAccount[]; balances: FinanceBalance[] }> {
  const collect = async () => {
    const balances: FinanceBalance[] = [];
    for await (const page of balancePages(db)) balances.push(...page);
    return balances;
  };
  const [accounts, balances] = await Promise.all([readAccounts(db), collect()]);
  return { accounts, balances };
}

/** Accounts and balances as one JSON document, written out as the pages
 *  arrive. Streaming lifts Vercel's 4.5 MB cap on a function's response, and
 *  the first bytes leave before the last page is read. Anything that fails
 *  before then is thrown here, while a proper error can still be sent; after,
 *  all a failure can do is cut the body short, which no JSON parser will take
 *  for a whole answer. */
export async function streamFinance(db: SupabaseClient): Promise<Response> {
  const [accounts, pages] = await Promise.all([readAccounts(db), balancePages(db)]);
  const first = await pages.next();
  const encoder = new TextEncoder();
  const body = new ReadableStream<Uint8Array>({
    async start(controller) {
      const send = (text: string) => controller.enqueue(encoder.encode(text));
      try {
        send(`{"accounts":${JSON.stringify(accounts)},"balances":[`);
        let separator = "";
        for (let page = first; !page.done; page = await pages.next()) {
          if (page.value.length === 0) continue;
          send(separator + page.value.map((row) => JSON.stringify(row)).join(","));
          separator = ",";
        }
        send("]}");
        controller.close();
      } catch (err) {
        controller.error(err);
      }
    },
  });
  return new Response(body, { headers: { "Content-Type": "application/json", ...NO_STORE } });
}

/** Shorter than this, FINANCE_API_TOKEN is ignored and only the owner's session
 *  gets in: a guessable token on someone's money is worse than none.
 *  `openssl rand -hex 32` gives 64 characters. */
export const MIN_TOKEN_LENGTH = 32;

const digest = (s: string) => createHash("sha256").update(s).digest();
const bearerOf = (req: Request) => /^Bearer\s+(\S+)\s*$/i.exec(req.headers.get("authorization") ?? "")?.[1];
export const sha256Hex = (s: string) => createHash("sha256").update(s).digest("hex");

/** Whether a request carries FINANCE_API_TOKEN as a bearer token -- how an agent
 *  or a script acts for the owner, reading and writing. Both sides are hashed
 *  before comparing, so the comparison takes the same time however much of the
 *  token matched. The configured value is trimmed: a newline pasted into the
 *  dashboard along with it would otherwise lock every caller out. */
export function hasFinanceToken(req: Request): boolean {
  const token = (process.env.FINANCE_API_TOKEN ?? "").trim();
  if (token.length < MIN_TOKEN_LENGTH) return false;
  const given = bearerOf(req);
  return given !== undefined && timingSafeEqual(digest(given), digest(token));
}

/** A new token for the owner's agents, made on the /finance page: 256 random
 *  bits, with a prefix that says what it is to anyone -- or any secret scanner --
 *  that finds one lying around. */
export const newFinanceToken = () => `pgf_${randomBytes(32).toString("base64url")}`;

/** Whether a request carries a token made on the /finance page. Only hashes are
 *  stored, so the one given is hashed and looked up. A lookup that fails -- the
 *  table not there yet, the database down -- lets nobody in by it. */
export async function hasStoredFinanceToken(req: Request): Promise<boolean> {
  const given = bearerOf(req);
  if (!given || given.length < MIN_TOKEN_LENGTH) return false;
  const db = financeDatabase();
  if (!db) return false;
  try {
    const { data, error } = await db.from("finance_api_tokens").select("id").eq("token_sha256", sha256Hex(given)).limit(1);
    return !error && (data?.length ?? 0) > 0;
  } catch {
    return false;
  }
}

/** Whether the owner is signed in, in a browser. Making and revoking tokens
 *  takes this rather than a token: one that could make tokens could outlive
 *  its own revoking. */
export async function isFinanceOwnerSession(): Promise<boolean> {
  const session = await auth();
  return isFinanceOwner(session?.user?.email);
}

/** Whether a request speaks for the owner: FINANCE_API_TOKEN, a token made on
 *  the /finance page, or their signed-in session. */
export async function isFinanceRequest(req: Request): Promise<boolean> {
  if (hasFinanceToken(req)) return true;
  if (await hasStoredFinanceToken(req)) return true;
  return isFinanceOwnerSession();
}
