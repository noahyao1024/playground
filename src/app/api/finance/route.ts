import { NextRequest } from "next/server";
import type { SupabaseClient } from "@supabase/supabase-js";
import { todayInSG } from "@/lib/dates";
import { isFinanceCurrency, ratesOn } from "@/lib/fx";
import { addMonths, isCategory, isKind, isLoanMethod, isRegion, loanTermsOf, type FinanceAccount, type Kind } from "@/lib/finance";
import {
  financeDatabase, financeJson as json, isFinanceRequest, isUuid, readAccount, readAccounts, readRateChanges, reason, streamFinance, withRateChanges,
} from "@/lib/finance-server";

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
    return await streamFinance(db);
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
      case "addLoanRateChange": return await addLoanRateChange(db, body);
      case "deleteLoanRateChange": return await deleteLoanRateChange(db, body.id);
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
  | "liquidity" | "long_term" | "loan_principal" | "loan_rate" | "loan_start" | "loan_term_months" | "loan_method"
  | "loan_payment" | "loan_first_interest" | "loan_maturity">>;

/** A number that may also be cleared: null, or a number `ok` accepts. */
function nullableNumber(value: unknown, field: string, ok: (n: number) => boolean, what: string): number | null {
  if (value === null) return null;
  if (typeof value !== "number" || !Number.isFinite(value) || !ok(value)) throw new Invalid(`${field} must be ${what}`);
  return value;
}

const LOAN_FIELDS = ["loan_principal", "loan_rate", "loan_start", "loan_term_months", "loan_method"] as const;
/** What the bank states beyond the terms. Each is optional on its own. */
const LOAN_EXTRAS = ["loan_payment", "loan_first_interest", "loan_maturity"] as const;

const PERCENT = "an annual percentage, from 0 to under 100";

/** A loan's terms go in whole or not at all, and only on a liability. The
 *  database insists on the same, but this says which part is missing. What the
 *  bank states beyond them needs a loan to qualify, a stated payment a level
 *  one -- 等额本金's falls every month -- and a contract end date has to fall
 *  where the last repayment could: from the last monthly day to before the
 *  month after it. Later would mean a longer term. */
function checkLoanTerms(account: Record<string, unknown>) {
  const missing = LOAN_FIELDS.filter((f) => account[f] == null);
  if (missing.length === LOAN_FIELDS.length) {
    const extras = LOAN_EXTRAS.filter((f) => account[f] != null);
    if (extras.length > 0) throw new Invalid(`${extras.join(" and ")} belong to a loan's terms; with no terms, clear ${extras.length > 1 ? "them" : "it"} too`);
    return;
  }
  if (missing.length > 0) throw new Invalid(`Loan terms need all five of ${LOAN_FIELDS.join(", ")}; missing ${missing.join(", ")}`);
  if (account.kind !== "liability") throw new Invalid("Only a liability has loan terms");
  if (account.loan_payment != null && account.loan_method !== "annuity") {
    throw new Invalid("loan_payment is a level monthly payment, which only an annuity (等额本息) loan has");
  }
  if (account.loan_maturity != null) {
    const start = String(account.loan_start), months = Number(account.loan_term_months);
    const last = addMonths(start, months - 1), after = addMonths(start, months);
    const maturity = String(account.loan_maturity);
    if (maturity < last || maturity >= after) {
      throw new Invalid(`loan_maturity is when the last repayment falls due: from the last monthly one, ${last}, to before ${after}`);
    }
  }
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
    out.loan_rate = nullableNumber(input.loan_rate, "loan_rate", (n) => n >= 0 && n < 100, PERCENT);
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
  if ("loan_payment" in input) {
    out.loan_payment = nullableNumber(input.loan_payment, "loan_payment", (n) => n > 0, "a positive amount, or null");
  }
  if ("loan_first_interest" in input) {
    out.loan_first_interest = nullableNumber(input.loan_first_interest, "loan_first_interest", (n) => n >= 0, "an amount of 0 or more, or null");
  }
  if ("loan_maturity" in input) {
    if (input.loan_maturity !== null && !isRealDay(input.loan_maturity)) throw new Invalid("loan_maturity must be a date, YYYY-MM-DD, or null");
    out.loan_maturity = input.loan_maturity;
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
  // Empty is what they start as anyway. Left out, the insert also works before
  // their migration is applied.
  for (const f of LOAN_EXTRAS) if (fields[f] === null) delete fields[f];
  const { data, error } = await db.from("finance_accounts").insert(fields).select().single();
  if (error) throw error;
  return { ...data, rate_changes: [] };
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
  // A column its migration has not added yet has nothing to clear.
  for (const f of LOAN_EXTRAS) if (fields[f] === null && !(f in current)) delete fields[f];
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
  return json(withRateChanges([data as FinanceAccount], await readRateChanges(db, id))[0]);
}

/** A change to a loan's rate, from the first repayment charged at it. Kept
 *  beside the terms, so the months before keep the rate they were charged at.
 *  Answers the account, with its rate changes as they now stand. */
async function addLoanRateChange(db: SupabaseClient, input: Record<string, unknown>) {
  if (!isUuid(input.account_id)) throw new Invalid("account_id is required: the loan's account");
  const account = await readAccount(db, input.account_id);
  if (!account) return json({ error: "No such account" }, 404);
  const terms = loanTermsOf(account);
  if (!terms) throw new Invalid("That account has no loan terms to change the rate of");
  const day = input.effective_date;
  if (!isRealDay(day)) throw new Invalid("effective_date must be a date, YYYY-MM-DD: the first repayment charged at the new rate");
  // The last repayment: the monthly one, or the contract's end date after it.
  const monthly = addMonths(terms.start, terms.months - 1);
  const last = terms.maturity && terms.maturity > monthly ? terms.maturity : monthly;
  if (day <= terms.start) throw new Invalid(`effective_date must come after the first repayment, ${terms.start}. For the rate from the start, change loan_rate.`);
  if (day > last) throw new Invalid(`effective_date is after the last repayment, ${last}: it would change nothing`);
  const rate = input.rate;
  if (typeof rate !== "number" || !Number.isFinite(rate) || rate < 0 || rate >= 100) throw new Invalid(`rate must be ${PERCENT}`);
  const payment = input.payment == null ? null : nullableNumber(input.payment, "payment", (n) => n > 0, "a positive amount, or null");
  if (payment !== null && terms.method !== "annuity") throw new Invalid("payment is a level monthly payment, which only an annuity (等额本息) loan has");
  const taken = `There is already a rate change on ${day}. Delete it first to put another in its place.`;
  if (account.rate_changes?.some((c) => c.effective_date === day)) return json({ error: taken }, 409);
  const { error } = await db.from("finance_loan_rate_changes").insert({ account_id: account.id, effective_date: day, rate, payment });
  if (error) {
    if (error.code === "23505") return json({ error: taken }, 409);
    throw error;
  }
  return json(await readAccount(db, account.id));
}

/** Takes a rate change back: the loan's schedule runs on as if it never was.
 *  Answers the account, with the rate changes left. */
async function deleteLoanRateChange(db: SupabaseClient, id: unknown) {
  if (!isUuid(id)) throw new Invalid("id is required: the rate change's");
  const { data, error } = await db.from("finance_loan_rate_changes").delete().eq("id", id).select("account_id");
  if (error) throw error;
  if (!data?.length) return json({ error: "No such rate change" }, 404);
  return json(await readAccount(db, data[0].account_id));
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

  // All of them, not `id=in.(…)`: that list rides in the URL, and at a few
  // hundred accounts the gateway refuses the request.
  const byId = new Map((await readAccounts(db)).map((a) => [a.id, a]));
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
