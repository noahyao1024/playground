import { NextRequest } from "next/server";
import type { SupabaseClient } from "@supabase/supabase-js";
import { isRealDay, todayInSG } from "@/lib/dates";
import { isFinanceCurrency, ratesOn } from "@/lib/fx";
import {
  addMonths, decimalPlaces, FIRST_INTEREST_PLACES, hasLevelPayment, isCategory, isKind, isLoanDayCount, isLoanMethod, isPrepaymentMode, isRegion,
  LOAN_METHODS, loanStatus, loanTermsOf,
  type FinanceAccount, type Kind, type LoanTerms,
} from "@/lib/finance";
import {
  isRsuPlan, parseRsuRules, parseTranches, RSU_PLANS, rsuWindow, windowCutoffs, type RsuGrant, type RsuRules,
} from "@/lib/rsu";
import {
  financeDatabase, financeJson as json, isFinanceRequest, isUuid, readAccount, readAccounts, readAccountEvents, reason, streamFinance, withAccountEvents,
} from "@/lib/finance-server";
import { quotesFor, type NoQuote, type Quote } from "@/lib/quotes";
import { normalizeSymbol, type PositionInput } from "@/lib/stocks";
import { revalueStocks, type Revaluation } from "@/lib/stocks-server";

/** The owner's money. Every request is checked -- the owner's session, or the
 *  token an agent carries -- and every answer is marked uncacheable. What the
 *  actions take is described at /api/finance/openapi. */
export const dynamic = "force-dynamic";
// Importing or valuing stocks prices each position from the quote source.
export const maxDuration = 60;

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
      case "addLoanPrepayment": return await addLoanPrepayment(db, body);
      case "deleteLoanPrepayment": return await deleteLoanPrepayment(db, body.id);
      case "addRsuGrant": return await addRsuGrant(db, body);
      case "updateRsuGrant": return await updateRsuGrant(db, body.id, body.updates);
      case "deleteRsuGrant": return await deleteRsuGrant(db, body.id);
      case "addRsuSale": return await addRsuSale(db, body);
      case "deleteRsuSale": return await deleteRsuSale(db, body.id);
      case "importStockPositions": return await importStockPositions(db, body.account_id, body.positions, body.replace !== false);
      case "addStockPosition": return await importStockPositions(db, body.account_id, [body], false);
      case "updateStockPosition": return await updateStockPosition(db, body.id, body.updates);
      case "deleteStockPosition": return await deleteStockPosition(db, body.id);
      case "revalueStocks": return await revalueAction(db, body.account_id, body.prices);
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
  | "loan_payment" | "loan_first_interest" | "loan_maturity" | "loan_day_count" | "rsu_plan" | "rsu_rules" | "liquid_min_gain">>;

/** A number that may also be cleared: null, or a number `ok` accepts. */
function nullableNumber(value: unknown, field: string, ok: (n: number) => boolean, what: string): number | null {
  if (value === null) return null;
  if (typeof value !== "number" || !Number.isFinite(value) || !ok(value)) throw new Invalid(`${field} must be ${what}`);
  return value;
}

const LOAN_FIELDS = ["loan_principal", "loan_rate", "loan_start", "loan_term_months", "loan_method"] as const;
/** What the bank states beyond the terms. Each is optional on its own. */
const LOAN_EXTRAS = ["loan_payment", "loan_first_interest", "loan_maturity", "loan_day_count"] as const;
/** Columns added after the accounts table, left out of a write while empty so
 *  it works before their migration is applied. */
const LATER_COLUMNS = [...LOAN_EXTRAS, "rsu_plan", "rsu_rules", "liquid_min_gain"] as const;

const PERCENT = "an annual percentage, from 0 to under 100";
const LEVEL_ONLY = (field: string) => `${field} is a level monthly payment, which only an annuity (等额本息) or flat (等本等息) loan has`;

/** A loan's terms go in whole or not at all, and only on a liability. The
 *  database insists on the same, but this says which part is missing. What the
 *  bank states beyond them needs a loan to qualify, a stated payment a level
 *  one -- 等额本息's or 等本等息's -- and a contract end date has to fall where
 *  the last repayment could: from the last monthly day to before the month
 *  after it. Later would mean a longer term. */
function checkLoanTerms(account: Record<string, unknown>) {
  const missing = LOAN_FIELDS.filter((f) => account[f] == null);
  if (missing.length === LOAN_FIELDS.length) {
    const extras = LOAN_EXTRAS.filter((f) => account[f] != null);
    if (extras.length > 0) throw new Invalid(`${extras.join(" and ")} belong to a loan's terms; with no terms, clear ${extras.length > 1 ? "them" : "it"} too`);
    return;
  }
  if (missing.length > 0) throw new Invalid(`Loan terms need all five of ${LOAN_FIELDS.join(", ")}; missing ${missing.join(", ")}`);
  if (account.kind !== "liability") throw new Invalid("Only a liability has loan terms");
  if (account.loan_payment != null && !(isLoanMethod(account.loan_method) && hasLevelPayment(account.loan_method))) {
    throw new Invalid(LEVEL_ONLY("loan_payment"));
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
  if ("liquid_min_gain" in input) {
    out.liquid_min_gain = nullableNumber(input.liquid_min_gain, "liquid_min_gain", (n) => n >= -100 && n <= 10000, "a percentage a position must be up by to count as liquid, as 10, or null for 10");
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
    if (input.loan_method !== null && !isLoanMethod(input.loan_method)) throw new Invalid(`loan_method must be ${LOAN_METHODS.join(", ")} or null`);
    out.loan_method = input.loan_method;
  }
  if ("loan_payment" in input) {
    out.loan_payment = nullableNumber(input.loan_payment, "loan_payment", (n) => n > 0, "a positive amount, or null");
  }
  if ("loan_first_interest" in input) {
    out.loan_first_interest = nullableNumber(
      input.loan_first_interest, "loan_first_interest", (n) => n >= 0 && decimalPlaces(n) <= FIRST_INTEREST_PLACES,
      `an amount of 0 or more, to at most ${FIRST_INTEREST_PLACES} decimal places, or null`,
    );
  }
  if ("loan_maturity" in input) {
    if (input.loan_maturity !== null && !isRealDay(input.loan_maturity)) throw new Invalid("loan_maturity must be a date, YYYY-MM-DD, or null");
    out.loan_maturity = input.loan_maturity;
  }
  if ("loan_day_count" in input) {
    if (input.loan_day_count !== null && !isLoanDayCount(input.loan_day_count)) throw new Invalid("loan_day_count must be 30/360, actual/365, actual/360 or null");
    out.loan_day_count = input.loan_day_count;
  }
  if ("rsu_plan" in input) {
    if (input.rsu_plan !== null && !isRsuPlan(input.rsu_plan)) throw new Invalid(`rsu_plan must be ${RSU_PLANS.join(", ")} or null`);
    out.rsu_plan = input.rsu_plan;
  }
  if ("rsu_rules" in input) {
    if (input.rsu_rules === null) out.rsu_rules = null;
    else {
      const parsed = parseRsuRules(input.rsu_rules);
      if ("problem" in parsed) throw new Invalid(parsed.problem);
      out.rsu_rules = parsed.rules;
    }
  }
  return out;
}

/** RSUs belong to an asset, and their rules to a plan. Rules that drop a
 *  profile a grant follows would leave that grant counted nowhere. */
function checkRsu(account: Record<string, unknown>, grants: RsuGrant[] = []) {
  if (account.rsu_plan != null && account.kind !== "asset") throw new Invalid("Only an asset holds RSUs");
  if (account.rsu_rules != null && account.rsu_plan == null) throw new Invalid("rsu_rules belong to an RSU plan; with no plan, clear them too");
  const rules = account.rsu_rules as RsuRules | null | undefined;
  const orphan = rules ? grants.find((g) => !(g.profile in rules.profiles)) : undefined;
  if (orphan) throw new Invalid(`${orphan.grant_no} follows the profile ${orphan.profile}, which these rules do not have`);
}

async function createAccount(db: SupabaseClient, input: unknown) {
  const a = (input ?? {}) as Record<string, unknown>;
  if (!isKind(a.kind)) throw new Invalid("Kind must be asset or liability");
  for (const field of ["name", "region", "currency", "category"]) {
    if (!(field in a)) throw new Invalid(`${field} is required`);
  }
  const fields = accountFields(a, a.kind);
  checkLoanTerms(fields);
  checkRsu(fields);
  // Empty is what they start as anyway. Left out, the insert also works before
  // their migration is applied.
  for (const f of LATER_COLUMNS) if (fields[f] === null) delete fields[f];
  const { data, error } = await db.from("finance_accounts").insert(fields).select().single();
  if (error) throw error;
  return { ...data, rate_changes: [], prepayments: [], rsu_grants: [], rsu_sales: [], stock_positions: [] };
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
  if ("rsu_plan" in fields || "rsu_rules" in fields || "kind" in fields) {
    checkRsu({ ...current, ...fields }, (await readAccountEvents(db, id)).rsuGrants);
  }
  // A column its migration has not added yet has nothing to clear.
  for (const f of LATER_COLUMNS) if (fields[f] === null && !(f in current)) delete fields[f];
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
  const events = await readAccountEvents(db, id);
  // A new threshold changes how much of today's value is liquid: record it
  // again, at the prices already kept.
  if ("liquid_min_gain" in fields && events.stockPositions.length > 0) await revalueStocks(db, { accountId: id, quotes: false });
  return json(withAccountEvents([data as FinanceAccount], events)[0]);
}

/** The loan behind an action on one: the account, and its terms. */
async function loanFor(db: SupabaseClient, accountId: unknown): Promise<{ account: FinanceAccount; terms: LoanTerms } | Response> {
  if (!isUuid(accountId)) throw new Invalid("account_id is required: the loan's account");
  const account = await readAccount(db, accountId);
  if (!account) return json({ error: "No such account" }, 404);
  const terms = loanTermsOf(account);
  if (!terms) throw new Invalid("That account has no loan terms");
  return { account, terms };
}

/** The day of a loan's last repayment: the monthly one, or the contract's end after it. */
function lastRepayment(terms: LoanTerms): string {
  const monthly = addMonths(terms.start, terms.months - 1);
  return terms.maturity && terms.maturity > monthly ? terms.maturity : monthly;
}

/** A change to a loan's rate, from the first repayment charged at it. Kept
 *  beside the terms, so the months before keep the rate they were charged at.
 *  Answers the account, with its rate changes as they now stand. */
async function addLoanRateChange(db: SupabaseClient, input: Record<string, unknown>) {
  const loan = await loanFor(db, input.account_id);
  if (loan instanceof Response) return loan;
  const { account, terms } = loan;
  const day = input.effective_date;
  if (!isRealDay(day)) throw new Invalid("effective_date must be a date, YYYY-MM-DD: the first repayment charged at the new rate");
  const last = lastRepayment(terms);
  if (day <= terms.start) throw new Invalid(`effective_date must come after the first repayment, ${terms.start}. For the rate from the start, change loan_rate.`);
  if (day > last) throw new Invalid(`effective_date is after the last repayment, ${last}: it would change nothing`);
  const rate = input.rate;
  if (typeof rate !== "number" || !Number.isFinite(rate) || rate < 0 || rate >= 100) throw new Invalid(`rate must be ${PERCENT}`);
  const payment = input.payment == null ? null : nullableNumber(input.payment, "payment", (n) => n > 0, "a positive amount, or null");
  if (payment !== null && !hasLevelPayment(terms.method)) throw new Invalid(LEVEL_ONLY("payment"));
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

/** Principal repaid early. It comes off what is owed on its day; after it the
 *  payment stays and the loan ends sooner (shorten), or the end stays and the
 *  payment falls (reduce). No more than is owed then: to clear the loan, that
 *  amount. Answers the account, with its prepayments as they now stand. */
async function addLoanPrepayment(db: SupabaseClient, input: Record<string, unknown>) {
  const loan = await loanFor(db, input.account_id);
  if (loan instanceof Response) return loan;
  const { account, terms } = loan;
  const day = input.paid_on;
  if (!isRealDay(day)) throw new Invalid("paid_on must be a date, YYYY-MM-DD");
  const last = lastRepayment(terms);
  if (day > last) throw new Invalid(`paid_on is after the last repayment, ${last}: nothing is owed then`);
  const amount = input.amount;
  if (typeof amount !== "number" || !Number.isFinite(amount) || amount <= 0) throw new Invalid("amount must be a positive amount");
  if (!isPrepaymentMode(input.mode)) throw new Invalid("mode must be shorten (the payment stays, the loan ends sooner) or reduce (the end stays, the payment falls)");
  const payment = input.payment == null ? null : nullableNumber(input.payment, "payment", (n) => n > 0, "a positive amount, or null");
  if (payment !== null && !hasLevelPayment(terms.method)) throw new Invalid(LEVEL_ONLY("payment"));
  if (payment !== null && input.mode !== "reduce") throw new Invalid("payment goes with reduce: under shorten the payment stays as it was");
  const taken = `There is already a prepayment on ${day}. Delete it first to put another in its place.`;
  if (account.prepayments?.some((p) => p.paid_on === day)) return json({ error: taken }, 409);
  // What is owed that day, after its repayment and any prepayment before.
  const owed = loanStatus(terms, day).principal_left;
  if (amount > owed) throw new Invalid(`That is more than the ${owed.toFixed(2)} owed on ${day}. To clear the loan, prepay ${owed.toFixed(2)}.`);
  const { error } = await db.from("finance_loan_prepayments").insert({ account_id: account.id, paid_on: day, amount, mode: input.mode, payment });
  if (error) {
    if (error.code === "23505") return json({ error: taken }, 409);
    throw error;
  }
  return json(await readAccount(db, account.id));
}

/** Takes a prepayment back: the schedule runs on as if it had not been made.
 *  Answers the account, with the prepayments left. */
async function deleteLoanPrepayment(db: SupabaseClient, id: unknown) {
  if (!isUuid(id)) throw new Invalid("id is required: the prepayment's");
  const { data, error } = await db.from("finance_loan_prepayments").delete().eq("id", id).select("account_id");
  if (error) throw error;
  if (!data?.length) return json({ error: "No such prepayment" }, 404);
  return json(await readAccount(db, data[0].account_id));
}

/** The RSU account behind an action on one: the account, and its rules. */
async function rsuAccountFor(db: SupabaseClient, accountId: unknown): Promise<{ account: FinanceAccount; rules: RsuRules } | Response> {
  if (!isUuid(accountId)) throw new Invalid("account_id is required: the RSU account's");
  const account = await readAccount(db, accountId);
  if (!account) return json({ error: "No such account" }, 404);
  const parsed = parseRsuRules(account.rsu_rules);
  if (!isRsuPlan(account.rsu_plan) || !("rules" in parsed)) throw new Invalid("That account has no RSU plan: set its rsu_plan and rsu_rules first");
  return { account, rules: parsed.rules };
}

/** A grant's fields, checked against its account's rules. A new one needs its
 *  number, profile and tranches; an update, only what it changes. */
function grantFields(input: Record<string, unknown>, rules: RsuRules, isNew: boolean): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  if (isNew || "grant_no" in input) {
    const grantNo = optionalText(input.grant_no, "grant_no", 40);
    if (!grantNo) throw new Invalid("grant_no is required: the grant's number, as its plan gives it");
    out.grant_no = grantNo;
  }
  if ("label" in input) out.label = optionalText(input.label, "label", 80) ?? null;
  if (isNew || "profile" in input) {
    if (typeof input.profile !== "string" || !Object.hasOwn(rules.profiles, input.profile)) {
      throw new Invalid(`profile must be one of the account's: ${Object.keys(rules.profiles).join(", ")}`);
    }
    out.profile = input.profile;
  }
  for (const f of ["granted_on", "vest_start"]) {
    if (!(f in input)) continue;
    if (input[f] !== null && !isRealDay(input[f])) throw new Invalid(`${f} must be a date, YYYY-MM-DD, or null`);
    out[f] = input[f];
  }
  if ("signed" in input) {
    if (typeof input.signed !== "boolean") throw new Invalid("signed must be true or false: false for a grant offered and not yet accepted");
    out.signed = input.signed;
  }
  if (isNew || "tranches" in input) {
    const parsed = parseTranches(input.tranches);
    if ("problem" in parsed) throw new Invalid(parsed.problem);
    out.tranches = parsed.tranches;
  }
  if ("note" in input) out.note = optionalText(input.note, "note", 500) ?? null;
  return out;
}

const grantTaken = (grantNo: unknown) => `There is already a grant ${String(grantNo)} on this account.`;

/** A grant of RSUs, with its tranches. Answers the account, with its grants as
 *  they now stand. */
async function addRsuGrant(db: SupabaseClient, input: Record<string, unknown>) {
  const found = await rsuAccountFor(db, input.account_id);
  if (found instanceof Response) return found;
  const fields = grantFields(input, found.rules, true);
  if (found.account.rsu_grants?.some((g) => g.grant_no === fields.grant_no)) return json({ error: grantTaken(fields.grant_no) }, 409);
  const { error } = await db.from("finance_rsu_grants").insert({ account_id: found.account.id, ...fields });
  if (error) {
    if (error.code === "23505") return json({ error: grantTaken(fields.grant_no) }, 409);
    throw error;
  }
  return json(await readAccount(db, found.account.id));
}

/** Changes a grant: signs a proposed one, corrects its tranches. */
async function updateRsuGrant(db: SupabaseClient, id: unknown, input: unknown) {
  if (!isUuid(id)) throw new Invalid("id is required: the grant's");
  const { data: current, error: readError } = await db.from("finance_rsu_grants").select("account_id").eq("id", id).maybeSingle();
  if (readError) throw readError;
  if (!current) return json({ error: "No such grant" }, 404);
  const found = await rsuAccountFor(db, current.account_id);
  if (found instanceof Response) return found;
  const fields = grantFields((input ?? {}) as Record<string, unknown>, found.rules, false);
  if (Object.keys(fields).length === 0) throw new Invalid("Nothing to change");
  if ("grant_no" in fields && found.account.rsu_grants?.some((g) => g.grant_no === fields.grant_no && g.id !== id)) {
    return json({ error: grantTaken(fields.grant_no) }, 409);
  }
  const { error } = await db.from("finance_rsu_grants").update(fields).eq("id", id);
  if (error) {
    if (error.code === "23505") return json({ error: grantTaken(fields.grant_no) }, 409);
    throw error;
  }
  return json(await readAccount(db, found.account.id));
}

async function deleteRsuGrant(db: SupabaseClient, id: unknown) {
  if (!isUuid(id)) throw new Invalid("id is required: the grant's");
  const { data, error } = await db.from("finance_rsu_grants").delete().eq("id", id).select("account_id");
  if (error) throw error;
  if (!data?.length) return json({ error: "No such grant" }, 404);
  return json(await readAccount(db, data[0].account_id));
}

/** Shares sold in a window, which later windows' quotas are net of. No more
 *  than were held by its cutoff: vested, and not sold in a window before. The
 *  window's own cap is the plan's estimate, not a limit on what was sold. */
async function addRsuSale(db: SupabaseClient, input: Record<string, unknown>) {
  const found = await rsuAccountFor(db, input.account_id);
  if (found instanceof Response) return found;
  const { account, rules } = found;
  const cutoff = input.window_cutoff;
  if (!isRealDay(cutoff) || windowCutoffs(rules, cutoff, cutoff).length === 0) {
    const months = rules.windows.months.map((m) => String(m).padStart(2, "0")).join(", ");
    throw new Invalid(`window_cutoff must be a window's cutoff: day ${rules.windows.cutoff_day} of month ${months}, as YYYY-MM-DD`);
  }
  const shares = input.shares;
  if (!Number.isInteger(shares) || (shares as number) <= 0) throw new Invalid("shares must be a whole number above 0");
  const price = input.price == null ? null : nullableNumber(input.price, "price", (n) => n > 0, "a positive price per share, or null");
  const tax = input.tax == null ? null : nullableNumber(input.tax, "tax", (n) => n >= 0, "the tax withheld, 0 or more, or null");
  const note = optionalText(input.note, "note", 500) ?? null;
  const taken = `There is already a sale in the ${cutoff} window. Delete it first to put another in its place.`;
  if (account.rsu_sales?.some((s) => s.window_cutoff === cutoff)) return json({ error: taken }, 409);
  const w = rsuWindow({ rules, grants: account.rsu_grants ?? [], sales: account.rsu_sales ?? [] }, cutoff);
  const held = w.vested - w.sold_before;
  if ((shares as number) > held) throw new Invalid(`That is more than the ${held} shares vested by ${cutoff} and not sold in a window before`);
  const { error } = await db.from("finance_rsu_sales").insert({ account_id: account.id, window_cutoff: cutoff, shares, price, tax, note });
  if (error) {
    if (error.code === "23505") return json({ error: taken }, 409);
    throw error;
  }
  return json(await readAccount(db, account.id));
}

async function deleteRsuSale(db: SupabaseClient, id: unknown) {
  if (!isUuid(id)) throw new Invalid("id is required: the sale's");
  const { data, error } = await db.from("finance_rsu_sales").delete().eq("id", id).select("account_id");
  if (error) throw error;
  if (!data?.length) return json({ error: "No such sale" }, 404);
  return json(await readAccount(db, data[0].account_id));
}

/** A brokerage account: an asset, open, holding no RSUs. */
async function stockAccountFor(db: SupabaseClient, accountId: unknown): Promise<FinanceAccount | Response> {
  if (!isUuid(accountId)) throw new Invalid("account_id is required: the account holding the stocks");
  const account = await readAccount(db, accountId);
  if (!account) return json({ error: "No such account" }, 404);
  if (account.kind !== "asset") throw new Invalid("Only an asset holds stocks");
  if (account.rsu_plan) throw new Invalid("An RSU account holds grants, not stock positions");
  if (account.archived_at) throw new Invalid(`${account.name} is archived`);
  return account;
}

/** Positions as given -- [{symbol, quantity, cost, currency?, note?}] -- checked. */
function positionInputs(value: unknown): Array<PositionInput & { note: string | null }> {
  if (!Array.isArray(value) || value.length === 0 || value.length > 200) throw new Invalid("positions must list 1 to 200 {symbol, quantity, cost}");
  const seen = new Set<string>();
  return value.map((raw, i) => {
    const p = (raw ?? {}) as Record<string, unknown>;
    const symbol = typeof p.symbol === "string" ? normalizeSymbol(p.symbol) : null;
    if (!symbol) throw new Invalid(`Position ${i + 1}: symbol must be as the market spells it -- AAPL, 0700.HK, 600519.SS, D05.SI`);
    if (seen.has(symbol)) throw new Invalid(`${symbol} is listed twice`);
    seen.add(symbol);
    if (typeof p.quantity !== "number" || !(p.quantity > 0)) throw new Invalid(`${symbol}: quantity must be the shares held, above 0`);
    if (typeof p.cost !== "number" || !(p.cost >= 0)) throw new Invalid(`${symbol}: cost must be the average cost of a share, 0 or more`);
    if (p.currency != null && (typeof p.currency !== "string" || !/^[A-Z]{3}$/.test(p.currency))) {
      throw new Invalid(`${symbol}: currency must be three capital letters, as USD`);
    }
    const note = optionalText(p.note, "note", 500) ?? null;
    return { symbol, quantity: p.quantity, cost: p.cost, ...(p.currency ? { currency: p.currency as string } : {}), note };
  });
}

/** An account after its positions changed, with what valuing it did. */
async function stocksReply(db: SupabaseClient, accountId: string, revaluation: Revaluation) {
  const { recorded, priced, failures, skipped, balances } = revaluation;
  return json({ account: await readAccount(db, accountId), balances, recorded, priced, failures, skipped });
}

/** Positions into an account, each checked against the quote source -- a
 *  symbol it does not know is refused, and the currency is the one the stock
 *  trades in -- then valued, and today's balance recorded from them. With
 *  `replace`, as from a broker's statement, what is not listed is removed. */
async function importStockPositions(db: SupabaseClient, accountId: unknown, input: unknown, replace: boolean) {
  const found = await stockAccountFor(db, accountId);
  if (found instanceof Response) return found;
  const account = found;
  const inputs = positionInputs(input);
  const held = account.stock_positions ?? [];
  if (!replace) {
    const taken = inputs.find((i) => held.some((p) => p.symbol === i.symbol));
    if (taken) return json({ error: `${taken.symbol} is already held: change its shares or cost instead` }, 409);
  }

  const quotes = await quotesFor(inputs.map((i) => i.symbol));
  const unknown: string[] = [], unreached: string[] = [];
  for (const i of inputs) {
    const q = quotes.get(i.symbol)!;
    if ("error" in q) (q.final ? unknown : unreached).push(`${i.symbol} (${q.error})`);
    else if (i.currency && i.currency !== q.currency) unknown.push(`${i.symbol} trades in ${q.currency}, not ${i.currency}`);
    else if (!isFinanceCurrency(q.currency)) unknown.push(`${i.symbol} trades in ${q.currency}, which finance does not convert`);
  }
  if (unknown.length) throw new Invalid(`Nothing was imported: ${unknown.join("; ")}`);
  if (unreached.length) return json({ error: `Nothing was imported: no price for ${unreached.join("; ")}. Try again in a minute.` }, 502);

  const rows = inputs.map((i) => {
    const q = quotes.get(i.symbol) as { currency: string; name: string | null };
    return { account_id: account.id, symbol: i.symbol, quantity: i.quantity, cost: i.cost, currency: q.currency, name: q.name, note: i.note };
  });
  const { error } = await db.from("finance_stock_positions").upsert(rows, { onConflict: "account_id,symbol" });
  if (error) throw error;
  if (replace) {
    const listed = new Set(inputs.map((i) => i.symbol));
    const gone = held.filter((p) => !listed.has(p.symbol)).map((p) => p.id);
    // A few at a time: the ids ride in the URL.
    for (let i = 0; i < gone.length; i += 100) {
      const { error: deleteError } = await db.from("finance_stock_positions").delete().in("id", gone.slice(i, i + 100));
      if (deleteError) throw deleteError;
    }
  }
  return valued(db, account.id, quotes);
}

/** Values an account after a change to its positions, and replies with it. */
async function valued(db: SupabaseClient, accountId: string, quotes: boolean | Map<string, Quote | NoQuote>) {
  try {
    return await stocksReply(db, accountId, await revalueStocks(db, { accountId, quotes }));
  } catch (err) {
    return json({ error: `The positions are saved, but could not be valued: ${reason(err)}. Refresh the prices to try again.` }, 502);
  }
}

/** Changes a position's shares, cost or note, and values the account again at
 *  the prices already kept. */
async function updateStockPosition(db: SupabaseClient, id: unknown, input: unknown) {
  if (!isUuid(id)) throw new Invalid("id is required: the position's");
  const updates = (input ?? {}) as Record<string, unknown>;
  const fields: Record<string, unknown> = {};
  if ("quantity" in updates) {
    if (typeof updates.quantity !== "number" || !(updates.quantity > 0)) throw new Invalid("quantity must be the shares held, above 0");
    fields.quantity = updates.quantity;
  }
  if ("cost" in updates) {
    if (typeof updates.cost !== "number" || !(updates.cost >= 0)) throw new Invalid("cost must be the average cost of a share, 0 or more");
    fields.cost = updates.cost;
  }
  if ("note" in updates) fields.note = optionalText(updates.note, "note", 500) ?? null;
  if (Object.keys(fields).length === 0) throw new Invalid("Nothing to change: quantity, cost or note");
  const { data, error } = await db.from("finance_stock_positions").update(fields).eq("id", id).select("account_id");
  if (error) throw error;
  if (!data?.length) return json({ error: "No such position" }, 404);
  return valued(db, data[0].account_id, false);
}

/** Removes a position. The account is valued again without it -- at nothing,
 *  with none left: what it holds is what it is worth. */
async function deleteStockPosition(db: SupabaseClient, id: unknown) {
  if (!isUuid(id)) throw new Invalid("id is required: the position's");
  const { data, error } = await db.from("finance_stock_positions").delete().eq("id", id).select("account_id");
  if (error) throw error;
  if (!data?.length) return json({ error: "No such position" }, 404);
  const accountId = data[0].account_id as string;
  const account = await readAccount(db, accountId);
  if (account && !account.stock_positions?.length && !account.archived_at) {
    const day = todayInSG();
    let rates;
    try {
      rates = await ratesOn(day, [account.currency]);
    } catch (err) {
      return json({ error: `The position is deleted, but the account could not be valued: ${reason(err)}` }, 502);
    }
    const unit = rates.rates[account.currency];
    const { data: written, error: writeError } = await db.from("finance_balances").upsert({
      account_id: accountId, as_of: day, currency: account.currency, amount: 0, cny_rate: unit.cny, sgd_rate: unit.sgd,
      rate_date: rates.date, liquid_share: 0, note: "No positions left",
    }, { onConflict: "account_id,as_of" }).select();
    if (writeError) throw writeError;
    return json({ account, balances: written ?? [], recorded: [accountId], priced: 0, failures: [], skipped: [] });
  }
  return valued(db, accountId, false);
}

/** Prices every stock account's positions -- or one account's -- from the
 *  quote source, and records today's balances from them. `prices: "kept"`
 *  values them at the prices already fetched. */
async function revalueAction(db: SupabaseClient, accountId: unknown, prices: unknown) {
  if (accountId != null && !isUuid(accountId)) throw new Invalid("account_id must be an account's id, or absent for all");
  if (prices != null && prices !== "fetch" && prices !== "kept") throw new Invalid('prices must be "fetch" or "kept"');
  let revaluation: Revaluation;
  try {
    revaluation = await revalueStocks(db, { accountId: accountId ?? undefined, quotes: prices !== "kept" });
  } catch (err) {
    return json({ error: `Could not value the stocks: ${reason(err)}` }, 502);
  }
  const accounts = (await readAccounts(db)).filter((a) => (a.stock_positions?.length ?? 0) > 0 && (!accountId || a.id === accountId));
  const { recorded, priced, failures, skipped, balances } = revaluation;
  return json({ accounts, balances, recorded, priced, failures, skipped });
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
