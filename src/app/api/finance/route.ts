import { NextRequest, NextResponse } from "next/server";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { auth } from "@/lib/auth";
import { isFinanceOwner } from "@/lib/access";
import { todayInSG } from "@/lib/dates";
import { fetchAllRows } from "@/lib/paginate";
import { isFinanceCurrency, ratesOn } from "@/lib/fx";
import { isCategory, isKind, isRegion, type FinanceAccount, type FinanceBalance, type Kind } from "@/lib/finance";

/** The owner's money. Every request is checked against one address, and every
 *  answer is marked uncacheable: nothing here may be served to anyone else from a
 *  cache, a CDN or the browser's back button. */
export const dynamic = "force-dynamic";

const NO_STORE = { "Cache-Control": "private, no-store" };
const json = (body: unknown, status = 200) => NextResponse.json(body, { status, headers: NO_STORE });

/** The service role only. Elsewhere the anon key is a fallback; here it would
 *  read nothing, since the finance tables grant it nothing. */
function database(): SupabaseClient | null {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  return url && key ? createClient(url, key, { auth: { persistSession: false } }) : null;
}

async function isOwner() {
  const session = await auth();
  return isFinanceOwner(session?.user?.email);
}

function reason(err: unknown): string {
  if (err instanceof Error) return err.message;
  if (typeof err === "object" && err !== null && "message" in err) return String((err as { message: unknown }).message);
  return JSON.stringify(err);
}

class Invalid extends Error {}

/** Optional free text: absent stays absent, blank becomes null, anything else trimmed. */
function optionalText(value: unknown, field: string, max = 200): string | null | undefined {
  if (value === undefined) return undefined;
  if (value === null) return null;
  if (typeof value !== "string") throw new Invalid(`${field} must be text`);
  const trimmed = value.trim();
  if (trimmed.length > max) throw new Invalid(`${field} is longer than ${max} characters`);
  return trimmed || null;
}

const DAY = /^\d{4}-\d{2}-\d{2}$/;
function isRealDay(day: unknown): day is string {
  return typeof day === "string" && DAY.test(day) && new Date(`${day}T00:00:00Z`).toISOString().startsWith(day);
}

export async function GET() {
  if (!(await isOwner())) return json({ error: "Unauthorized" }, 401);
  const db = database();
  if (!db) return json({ error: "Supabase not configured" }, 500);
  try {
    const [{ data: accounts, error }, balances] = await Promise.all([
      db.from("finance_accounts").select("*").order("created_at").order("id"),
      // Balances grow by a row per account per record, forever: paged, on a
      // unique order.
      fetchAllRows<FinanceBalance>((from, to) =>
        db.from("finance_balances").select("*").order("as_of").order("id").range(from, to)),
    ]);
    if (error) throw error;
    return json({ accounts: accounts ?? [], balances });
  } catch (err) {
    return json({ error: reason(err) }, 500);
  }
}

export async function POST(req: NextRequest) {
  if (!(await isOwner())) return json({ error: "Unauthorized" }, 401);
  const db = database();
  if (!db) return json({ error: "Supabase not configured" }, 500);

  let body: Record<string, unknown>;
  try {
    body = await req.json();
  } catch {
    return json({ error: "Expected a JSON body" }, 400);
  }

  try {
    switch (body.action) {
      case "createAccount": return json(await createAccount(db, body.account));
      case "updateAccount": return await updateAccount(db, body.id, body.updates);
      case "deleteAccount": return await deleteAccount(db, body.id);
      case "recordBalances": return await recordBalances(db, body.as_of, body.entries);
      case "deleteBalance": {
        if (typeof body.id !== "string") throw new Invalid("id is required");
        const { error } = await db.from("finance_balances").delete().eq("id", body.id);
        if (error) throw error;
        return json({ ok: true });
      }
      default:
        return json({ error: "Invalid action" }, 400);
    }
  } catch (err) {
    if (err instanceof Invalid) return json({ error: err.message }, 400);
    return json({ error: reason(err) }, 500);
  }
}

type AccountFields = Partial<Pick<FinanceAccount, "name" | "institution" | "region" | "currency" | "kind" | "category" | "note" | "sort_order">>;

/** The fields of an account a request may set, checked. `kind` is the kind the
 *  account will have, which is what its category has to belong to. */
function accountFields(input: Record<string, unknown>, kind: Kind): AccountFields {
  const out: AccountFields = {};
  if ("name" in input) {
    const name = optionalText(input.name, "Name", 80);
    if (!name) throw new Invalid("A name is required");
    out.name = name;
  }
  if ("institution" in input) out.institution = optionalText(input.institution, "Institution", 80) ?? null;
  if ("note" in input) out.note = optionalText(input.note, "Note", 500) ?? null;
  if ("region" in input) {
    if (!isRegion(input.region)) throw new Invalid("Region must be CN, SG or OTHER");
    out.region = input.region;
  }
  if ("currency" in input) {
    if (!isFinanceCurrency(input.currency)) throw new Invalid("That currency is not supported");
    out.currency = input.currency;
  }
  if ("kind" in input) out.kind = kind;
  if ("category" in input) {
    if (!isCategory(kind, input.category)) throw new Invalid(`That category is not one for an ${kind === "asset" ? "asset" : "liability"}`);
    out.category = input.category;
  }
  if ("sort_order" in input) {
    if (!Number.isInteger(input.sort_order)) throw new Invalid("sort_order must be a whole number");
    out.sort_order = input.sort_order as number;
  }
  return out;
}

async function createAccount(db: SupabaseClient, input: unknown) {
  const a = (input ?? {}) as Record<string, unknown>;
  if (!isKind(a.kind)) throw new Invalid("Kind must be asset or liability");
  for (const field of ["name", "region", "currency", "category"]) {
    if (!(field in a)) throw new Invalid(`${field} is required`);
  }
  const fields = accountFields(a, a.kind);
  const { data, error } = await db.from("finance_accounts").insert(fields).select().single();
  if (error) throw error;
  return data;
}

async function balanceCount(db: SupabaseClient, accountId: string): Promise<number> {
  const { count, error } = await db.from("finance_balances").select("id", { count: "exact", head: true }).eq("account_id", accountId);
  if (error) throw error;
  return count ?? 0;
}

async function updateAccount(db: SupabaseClient, id: unknown, input: unknown) {
  if (typeof id !== "string") throw new Invalid("id is required");
  const updates = (input ?? {}) as Record<string, unknown>;
  const { data: current, error: readError } = await db.from("finance_accounts").select("*").eq("id", id).maybeSingle();
  if (readError) throw readError;
  if (!current) return json({ error: "No such account" }, 404);

  const kind = "kind" in updates ? updates.kind : current.kind;
  if (!isKind(kind)) throw new Invalid("Kind must be asset or liability");
  // Changing kind drags the category with it: the old one may not exist on the other side.
  if ("kind" in updates && !("category" in updates) && !isCategory(kind, current.category)) {
    throw new Invalid("Choose a category for the new kind");
  }
  const fields: Record<string, unknown> = accountFields(updates, kind);
  if ("archived" in updates) {
    if (typeof updates.archived !== "boolean") throw new Invalid("archived must be true or false");
    fields.archived_at = updates.archived ? new Date().toISOString() : null;
  }
  // Balances are stored in the account's currency; they cannot be re-read in another.
  if (fields.currency && fields.currency !== current.currency && (await balanceCount(db, id)) > 0) {
    return json({ error: `Its balances are recorded in ${current.currency}. Add a new account for ${fields.currency} instead.` }, 409);
  }
  const { data, error } = await db.from("finance_accounts").update(fields).eq("id", id).select().single();
  if (error) throw error;
  return json(data);
}

async function deleteAccount(db: SupabaseClient, id: unknown) {
  if (typeof id !== "string") throw new Invalid("id is required");
  if ((await balanceCount(db, id)) > 0) {
    return json({ error: "It has recorded balances. Archive it instead, so its history stays." }, 409);
  }
  const { error } = await db.from("finance_accounts").delete().eq("id", id);
  if (error) throw error;
  return json({ ok: true });
}

/** Record what each account held on `asOf`, priced at that day's rates. Recording
 *  a day again replaces what was recorded for it. */
async function recordBalances(db: SupabaseClient, asOf: unknown, input: unknown) {
  if (!isRealDay(asOf)) throw new Invalid("as_of must be a date, YYYY-MM-DD");
  if (asOf > todayInSG()) throw new Invalid("That day has not happened yet");
  if (!Array.isArray(input) || input.length === 0) throw new Invalid("Nothing to record");

  const entries = input.map((raw, i) => {
    const e = (raw ?? {}) as Record<string, unknown>;
    if (typeof e.account_id !== "string") throw new Invalid(`Entry ${i + 1} has no account`);
    const amount = typeof e.amount === "number" ? e.amount : Number.NaN;
    if (!Number.isFinite(amount)) throw new Invalid(`Entry ${i + 1} needs an amount`);
    return { account_id: e.account_id, amount, note: optionalText(e.note, "Note", 500) ?? null };
  });
  const ids = [...new Set(entries.map((e) => e.account_id))];
  if (ids.length !== entries.length) throw new Invalid("An account appears twice");

  const { data: accounts, error: readError } = await db.from("finance_accounts").select("*").in("id", ids);
  if (readError) throw readError;
  const byId = new Map((accounts as FinanceAccount[]).map((a) => [a.id, a]));
  for (const id of ids) {
    const account = byId.get(id);
    if (!account) throw new Invalid("Unknown account");
    if (account.archived_at) throw new Invalid(`${account.name} is archived`);
  }

  let rates;
  try {
    rates = await ratesOn(asOf, [...new Set([...byId.values()].map((a) => a.currency))]);
  } catch (err) {
    // Nothing is written without its rate: a balance priced from a guess would
    // keep the guess forever.
    return json({ error: `Could not get exchange rates for ${asOf}: ${reason(err)}. Nothing was recorded; try again.` }, 502);
  }

  const rows = entries.map((e) => {
    const account = byId.get(e.account_id)!;
    const unit = rates.rates[account.currency];
    return {
      account_id: e.account_id,
      as_of: asOf,
      currency: account.currency,
      amount: e.amount,
      cny_rate: unit.cny,
      sgd_rate: unit.sgd,
      rate_date: rates.date,
      note: e.note,
    };
  });
  const { data, error } = await db.from("finance_balances").upsert(rows, { onConflict: "account_id,as_of" }).select();
  if (error) throw error;
  return json({ balances: data, rate_date: rates.date });
}
