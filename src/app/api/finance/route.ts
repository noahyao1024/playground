import { NextRequest } from "next/server";
import type { SupabaseClient } from "@supabase/supabase-js";
import { todayInSG } from "@/lib/dates";
import { isFinanceCurrency, ratesOn } from "@/lib/fx";
import { isCategory, isKind, isLoanMethod, isRegion, type FinanceAccount, type Kind } from "@/lib/finance";
import { financeDatabase, financeJson as json, isFinanceRequest, readFinance, reason } from "@/lib/finance-server";

/** The owner's money. Every request is checked -- the owner's session, or the
 *  token an agent carries -- and every answer is marked uncacheable. What the
 *  actions take is described at /api/finance/openapi. */
export const dynamic = "force-dynamic";

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

export async function GET(req: NextRequest) {
  if (!(await isFinanceRequest(req))) return json({ error: "Unauthorized" }, 401);
  const db = financeDatabase();
  if (!db) return json({ error: "Supabase not configured" }, 500);
  try {
    return json(await readFinance(db));
  } catch (err) {
    return json({ error: reason(err) }, 500);
  }
}

export async function POST(req: NextRequest) {
  if (!(await isFinanceRequest(req))) return json({ error: "Unauthorized" }, 401);
  const db = financeDatabase();
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

type AccountFields = Partial<Pick<FinanceAccount,
  | "name" | "institution" | "owner" | "region" | "currency" | "kind" | "category" | "note" | "sort_order"
  | "liquidity" | "long_term" | "loan_principal" | "loan_rate" | "loan_start" | "loan_term_months" | "loan_method">>;

/** A number that may also be cleared: null, or a number `ok` accepts. */
function nullableNumber(value: unknown, field: string, ok: (n: number) => boolean, what: string): number | null {
  if (value === null) return null;
  if (typeof value !== "number" || !Number.isFinite(value) || !ok(value)) throw new Invalid(`${field} must be ${what}`);
  return value;
}

const LOAN_FIELDS = ["loan_principal", "loan_rate", "loan_start", "loan_term_months", "loan_method"] as const;

/** A loan's terms go in whole or not at all, and only on a liability. The
 *  database insists on the same, but this says which part is missing. */
function checkLoanTerms(account: Record<string, unknown>) {
  const missing = LOAN_FIELDS.filter((f) => account[f] == null);
  if (missing.length === LOAN_FIELDS.length) return;
  if (missing.length > 0) throw new Invalid(`Loan terms need all five of ${LOAN_FIELDS.join(", ")}; missing ${missing.join(", ")}`);
  if (account.kind !== "liability") throw new Invalid("Only a liability has loan terms");
}

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
  if ("owner" in input) out.owner = optionalText(input.owner, "Owner", 40) ?? null;
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
  if ("liquidity" in input) {
    out.liquidity = nullableNumber(input.liquidity, "liquidity", (n) => n >= 0 && n <= 1, "a share from 0 to 1, or null");
  }
  if ("long_term" in input) {
    if (input.long_term !== null && typeof input.long_term !== "boolean") throw new Invalid("long_term must be true, false or null");
    out.long_term = input.long_term;
  }
  // Each loan term alone here; together, and against the kind, in checkLoanTerms.
  if ("loan_principal" in input) {
    out.loan_principal = nullableNumber(input.loan_principal, "loan_principal", (n) => n > 0, "a positive amount");
  }
  if ("loan_rate" in input) {
    out.loan_rate = nullableNumber(input.loan_rate, "loan_rate", (n) => n >= 0 && n < 100, "an annual percentage, from 0 to under 100");
  }
  if ("loan_start" in input) {
    if (input.loan_start !== null && !isRealDay(input.loan_start)) throw new Invalid("loan_start must be a date, YYYY-MM-DD");
    out.loan_start = input.loan_start;
  }
  if ("loan_term_months" in input) {
    out.loan_term_months = nullableNumber(input.loan_term_months, "loan_term_months",
      (n) => Number.isInteger(n) && n >= 1 && n <= 600, "a whole number of months, 1 to 600");
  }
  if ("loan_method" in input) {
    if (input.loan_method !== null && !isLoanMethod(input.loan_method)) throw new Invalid("loan_method must be annuity or equal_principal");
    out.loan_method = input.loan_method;
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
  checkLoanTerms(fields);
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
  checkLoanTerms({ ...current, ...fields });
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
