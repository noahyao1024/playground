import { dayInSG, todayInSG } from "./dates";

/** Where an account is held. */
export const REGIONS = ["CN", "SG", "OTHER"] as const;
export type Region = (typeof REGIONS)[number];
export const REGION_LABELS: Record<Region, string> = { CN: "China", SG: "Singapore", OTHER: "Elsewhere" };

/** An asset holds money; a liability is money owed, recorded as a positive amount. */
export const KINDS = ["asset", "liability"] as const;
export type Kind = (typeof KINDS)[number];

export const CATEGORIES: Record<Kind, Record<string, string>> = {
  asset: {
    cash: "Cash & current",
    deposit: "Deposits",
    investment: "Investments",
    retirement: "CPF / 公积金",
    property: "Property & vehicles",
    receivable: "Owed to me",
    other: "Other",
  },
  liability: {
    credit_card: "Credit card",
    loan: "Loan",
    mortgage: "Mortgage",
    payable: "I owe",
    other: "Other",
  },
};

/** How a loan is repaid. 等额本息 keeps the payment level; 等额本金 keeps the
 *  principal level, so interest and with it the payment fall month by month. */
export const LOAN_METHODS = ["annuity", "equal_principal"] as const;
export type LoanMethod = (typeof LOAN_METHODS)[number];
export const LOAN_METHOD_LABELS: Record<LoanMethod, string> = { annuity: "等额本息", equal_principal: "等额本金" };

export function isLoanMethod(value: unknown): value is LoanMethod {
  return typeof value === "string" && (LOAN_METHODS as readonly string[]).includes(value);
}

export function isRegion(value: unknown): value is Region {
  return typeof value === "string" && (REGIONS as readonly string[]).includes(value);
}
export function isKind(value: unknown): value is Kind {
  return typeof value === "string" && (KINDS as readonly string[]).includes(value);
}
export function isCategory(kind: Kind, value: unknown): value is string {
  return typeof value === "string" && Object.hasOwn(CATEGORIES[kind], value);
}

export interface FinanceAccount {
  id: string;
  name: string;
  institution: string | null;
  /** Who in the family holds it; null for nobody in particular. */
  owner?: string | null;
  region: Region;
  currency: string;
  kind: Kind;
  category: string;
  note: string | null;
  sort_order: number;
  /** The share of an asset that could be spent or sold now, 0 to 1. Null follows
   *  the category. */
  liquidity?: number | null;
  /** Whether a liability is long-term debt. Null follows the category. */
  long_term?: boolean | null;
  /** A loan's terms, in the account's currency: all five, or none. */
  loan_principal?: number | null;
  /** Annual, in percent. */
  loan_rate?: number | null;
  /** The first repayment, YYYY-MM-DD; each later one on the same day of the month. */
  loan_start?: string | null;
  loan_term_months?: number | null;
  loan_method?: LoanMethod | null;
  archived_at: string | null;
  created_at: string;
}

// Han, kana and hangul: scripts that put no space between words.
const CLOSE_SET = /[\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}\p{Script=Hangul}]/u;

/** What an account is called on the page: its institution and name, the way
 *  they would be said -- "微信余额", "DBS Multiplier" -- without repeating an
 *  institution the name already carries. Who holds it goes beside, not in it. */
export function displayName(a: Pick<FinanceAccount, "name" | "institution">): string {
  const name = a.name.trim();
  const institution = a.institution?.trim();
  if (!institution || name.toLowerCase().includes(institution.toLowerCase())) return name;
  const tight = CLOSE_SET.test(institution.slice(-1)) && CLOSE_SET.test(name.charAt(0));
  return institution + (tight ? "" : " ") + name;
}

/** A way of looking at the totals: what to leave out, and how much of the rest
 *  to count. Every figure on the page is worked out through the same one. */
export type Lens = {
  /** Leave out long-term debt: mortgages, and anything else marked long-term. */
  excludeLongTerm?: boolean;
  /** Count only the share of each asset that could be spent now. */
  liquidOnly?: boolean;
  /** Only this person's accounts; "" for those nobody in particular holds.
   *  Absent or null: everyone's. */
  owner?: string | null;
};

/** Whether a liability is long-term debt: as marked, or else a mortgage. */
export function isLongTerm(a: FinanceAccount): boolean {
  return a.kind === "liability" && (a.long_term ?? a.category === "mortgage");
}

/** Categories locked away until something happens -- retirement, a sale -- and
 *  so not liquid unless marked otherwise. */
export const ILLIQUID_CATEGORIES: ReadonlySet<string> = new Set(["retirement", "property"]);

/** The share of an asset that could be spent now, 0 to 1: as marked, or else
 *  none of CPF / 公积金 or property, and all of anything else. */
export function liquidityOf(a: FinanceAccount): number {
  if (a.liquidity == null) return ILLIQUID_CATEGORIES.has(a.category) ? 0 : 1;
  const share = Number(a.liquidity);
  return Number.isFinite(share) ? Math.min(1, Math.max(0, share)) : 1;
}

/** How much of an account's balance a lens counts: 1 all of it, 0 none. */
export function weightOf(a: FinanceAccount, lens: Lens = {}): number {
  if (lens.owner != null && (a.owner ?? "") !== lens.owner) return 0;
  if (lens.excludeLongTerm && isLongTerm(a)) return 0;
  if (lens.liquidOnly && a.kind === "asset") return liquidityOf(a);
  return 1;
}

export interface FinanceBalance {
  id: string;
  account_id: string;
  /** YYYY-MM-DD: the day the balance is for. */
  as_of: string;
  currency: string;
  amount: number;
  /** CNY and SGD per one unit of `currency`, as published for rate_date. */
  cny_rate: number;
  sgd_rate: number;
  rate_date: string;
  note: string | null;
  created_at: string;
  updated_at: string | null;
}

/** An amount in both reporting currencies. */
export type Money = { cny: number; sgd: number };
/** Which of the two a figure is shown in. */
export type Unit = keyof Money;
const zero = (): Money => ({ cny: 0, sgd: 0 });
function add(into: Money, value: Money, sign = 1) {
  into.cny += sign * value.cny;
  into.sgd += sign * value.sgd;
}

/** A balance in CNY and SGD, at the rates stored with it -- the rates of its own
 *  day, so a month already recorded keeps its value when the market moves.
 *  PostgREST may hand numerics over as strings; Number() takes either. */
export function valueOf(b: Pick<FinanceBalance, "amount" | "cny_rate" | "sgd_rate">): Money {
  const amount = Number(b.amount);
  return { cny: amount * Number(b.cny_rate), sgd: amount * Number(b.sgd_rate) };
}

/** Archiving takes an account off the books from the day after, in Singapore. */
function countsOn(account: FinanceAccount, day: string): boolean {
  return !account.archived_at || day <= dayInSG(account.archived_at);
}

/** Each counted account's latest balance on or before `day`. An account not
 *  recorded that day carries its last balance forward, which is what lets a
 *  snapshot skip an account that did not change. */
export function latestOn(accounts: FinanceAccount[], balances: FinanceBalance[], day: string): Map<string, FinanceBalance> {
  const counted = new Set(accounts.filter((a) => countsOn(a, day)).map((a) => a.id));
  const latest = new Map<string, FinanceBalance>();
  for (const b of balances) {
    if (b.as_of > day || !counted.has(b.account_id)) continue;
    const seen = latest.get(b.account_id);
    if (!seen || b.as_of > seen.as_of) latest.set(b.account_id, b);
  }
  return latest;
}

export type Totals = {
  assets: Money;
  liabilities: Money;
  /** Assets less liabilities. */
  net: Money;
};
const noTotals = (): Totals => ({ assets: zero(), liabilities: zero(), net: zero() });

export type Position = Totals & {
  day: string;
  byRegion: Record<Region, Totals>;
  /** Gross, per `${kind}:${category}`. */
  byCategory: Record<string, Money>;
};

const scaled = (m: Money, k: number): Money => (k === 1 ? m : { cny: m.cny * k, sgd: m.sgd * k });

/** Where things stood at the end of `day`, as the lens sees it. */
export function positionOn(accounts: FinanceAccount[], balances: FinanceBalance[], day: string, lens: Lens = {}): Position {
  const byId = new Map(accounts.map((a) => [a.id, a]));
  const position: Position = {
    day,
    ...noTotals(),
    byRegion: { CN: noTotals(), SG: noTotals(), OTHER: noTotals() },
    byCategory: {},
  };
  for (const [id, balance] of latestOn(accounts, balances, day)) {
    const account = byId.get(id)!;
    const weight = weightOf(account, lens);
    if (weight === 0) continue;
    const value = scaled(valueOf(balance), weight);
    const sign = account.kind === "asset" ? 1 : -1;
    for (const totals of [position, position.byRegion[account.region]]) {
      add(account.kind === "asset" ? totals.assets : totals.liabilities, value);
      add(totals.net, value, sign);
    }
    add((position.byCategory[`${account.kind}:${account.category}`] ??= zero()), value);
  }
  return position;
}

/** One point for every day anything was recorded, oldest first. */
export function historyOf(accounts: FinanceAccount[], balances: FinanceBalance[], lens: Lens = {}): Position[] {
  const days = [...new Set(balances.map((b) => b.as_of))].sort();
  return days.map((day) => positionOn(accounts, balances, day, lens));
}

export type Change = {
  amount: number;
  /** Relative to where it started; null from zero. */
  ratio: number | null;
};

/** The change from one figure to another, in one unit. Each unit has its own
 *  ratio: between two days the rate moves too, so the same money can have grown
 *  in CNY and shrunk in SGD. */
export function changeBetween(from: Money | undefined, to: Money, unit: Unit): Change | null {
  if (!from) return null;
  const amount = to[unit] - from[unit];
  return { amount, ratio: from[unit] === 0 ? null : amount / Math.abs(from[unit]) };
}

/** Each account's most recent balance, whatever day it is from. */
export function lastBalances(balances: FinanceBalance[]): Map<string, FinanceBalance> {
  const last = new Map<string, FinanceBalance>();
  for (const b of balances) {
    const seen = last.get(b.account_id);
    if (!seen || b.as_of > seen.as_of) last.set(b.account_id, b);
  }
  return last;
}

export type Draft = {
  amount: number;
  /** The day the amount comes from: `day` itself when that day is already
   *  recorded, else the last day before it, which is what is carried forward. */
  from: string;
};

/** What the record form starts from for `day`, per open account: that day's own
 *  balance if it has one, so recording a day again edits it, else the balance
 *  the day would otherwise carry forward. An account with neither is left out
 *  and starts blank. */
export function draftFor(accounts: FinanceAccount[], balances: FinanceBalance[], day: string): Map<string, Draft> {
  const open = accounts.filter((a) => !a.archived_at);
  const drafts = new Map<string, Draft>();
  for (const [id, b] of latestOn(open, balances, day)) {
    drafts.set(id, { amount: Number(b.amount), from: b.as_of });
  }
  return drafts;
}

/** Assets before liabilities, then China, Singapore, elsewhere, then the order
 *  the owner set, then name. */
export function sortAccounts(accounts: FinanceAccount[]): FinanceAccount[] {
  return [...accounts].sort((a, b) =>
    KINDS.indexOf(a.kind) - KINDS.indexOf(b.kind)
    || REGIONS.indexOf(a.region) - REGIONS.indexOf(b.region)
    || a.sort_order - b.sort_order
    || a.name.localeCompare(b.name)
    || a.id.localeCompare(b.id));
}

export type LoanTerms = { principal: number; rate: number; start: string; months: number; method: LoanMethod };

/** A loan's terms, if all of them are set. */
export function loanTermsOf(a: FinanceAccount): LoanTerms | null {
  const { loan_principal: principal, loan_rate: rate, loan_start: start, loan_term_months: months, loan_method: method } = a;
  if (principal == null || rate == null || !start || months == null || !method) return null;
  return { principal: Number(principal), rate: Number(rate), start, months: Number(months), method };
}

/** Days in a month, `month` counted from 1. */
const daysIn = (year: number, month: number) => new Date(Date.UTC(year, month, 0)).getUTCDate();

/** `day` moved on by `months`, to the same day of the month -- or the month's
 *  last day when it is shorter: 31 January plus a month is 28 February. */
export function addMonths(day: string, months: number): string {
  const [y, m, d] = day.split("-").map(Number);
  const total = y * 12 + (m - 1) + months;
  const year = Math.floor(total / 12);
  const month = total - year * 12 + 1;
  const date = Math.min(d, daysIn(year, month));
  return `${year}-${String(month).padStart(2, "0")}-${String(date).padStart(2, "0")}`;
}

/** How many repayments have fallen due by the end of `day`. */
export function paymentsMade(terms: LoanTerms, day: string): number {
  const [sy, sm, sd] = terms.start.split("-").map(Number);
  const [y, m, d] = day.split("-").map(Number);
  let made = (y - sy) * 12 + (m - sm);
  if (d >= Math.min(sd, daysIn(y, m))) made += 1;
  return Math.max(0, Math.min(terms.months, made));
}

/** Where a loan's schedule stands, in its own currency. */
export type LoanStatus = {
  /** This month's payment: level under 等额本息, the next, falling one under
   *  等额本金. 0 once it is repaid. */
  payment: number;
  payments_made: number;
  payments_left: number;
  /** Principal the schedule still has owing. A prepaid loan owes less: the
   *  balance recorded for it is the truth, this is the plan. */
  principal_left: number;
  /** Interest in the payments still to come. */
  interest_left: number;
  /** Principal and interest still to pay: 连本带利. */
  total_left: number;
  /** Interest over the life of the loan. */
  total_interest: number;
  next_payment: string | null;
  last_payment: string;
};

// Float residue left after the last payment, a millionth of a cent.
const settled = (n: number) => (Math.abs(n) < 0.005 ? 0 : n);

/** A loan's schedule on `day`. 等额本息 pays P·i(1+i)^n / ((1+i)^n − 1) each
 *  month; 等额本金 pays P/n of principal plus a month's interest on what is left. */
export function loanStatus(terms: LoanTerms, day: string): LoanStatus {
  const { principal, months: n } = terms;
  const i = terms.rate / 100 / 12;
  const k = paymentsMade(terms, day);
  let payment: number, principalLeft: number, interestLeft: number, totalInterest: number;
  if (terms.method === "annuity") {
    const growth = (1 + i) ** n;
    const level = i === 0 ? principal / n : (principal * i * growth) / (growth - 1);
    const grown = (1 + i) ** k;
    principalLeft = i === 0 ? principal - level * k : principal * grown - (level * (grown - 1)) / i;
    interestLeft = level * (n - k) - principalLeft;
    totalInterest = level * n - principal;
    payment = k < n ? level : 0;
  } else {
    const part = principal / n;
    principalLeft = principal - part * k;
    interestLeft = (i * part * (n - k) * (n - k + 1)) / 2;
    totalInterest = (i * part * n * (n + 1)) / 2;
    payment = k < n ? part + principalLeft * i : 0;
  }
  principalLeft = settled(principalLeft);
  interestLeft = settled(interestLeft);
  return {
    payment,
    payments_made: k,
    payments_left: n - k,
    principal_left: principalLeft,
    interest_left: interestLeft,
    total_left: principalLeft + interestLeft,
    total_interest: totalInterest,
    next_payment: k < n ? addMonths(terms.start, k) : null,
    last_payment: addMonths(terms.start, n - 1),
  };
}

const cents = (n: number) => Math.round(n * 100) / 100;
const rounded = (m: Money): Money => ({ cny: cents(m.cny), sgd: cents(m.sgd) });
const roundedTotals = (t: Totals): Totals => ({ assets: rounded(t.assets), liabilities: rounded(t.liabilities), net: rounded(t.net) });
const minus = (a: Money, b: Money): Money => ({ cny: a.cny - b.cny, sgd: a.sgd - b.sgd });
const roundedLoan = (l: LoanStatus): LoanStatus => ({
  ...l,
  payment: cents(l.payment),
  principal_left: cents(l.principal_left),
  interest_left: cents(l.interest_left),
  total_left: cents(l.total_left),
  total_interest: cents(l.total_interest),
});

export type AccountSummary = FinanceAccount & {
  /** Institution and name, as the page shows them. */
  display_name: string;
  /** Long-term debt, with the category's default applied. */
  is_long_term: boolean;
  /** The share of its balance the lens counts: 1, 0, or its liquidity. */
  weight: number;
  /** Whether it counts in the totals of `as_of`: open then, recorded by then,
   *  and not left out by the lens. */
  counted: boolean;
  /** Its newest balance, valued at the rates stored with it. */
  latest: (Pick<FinanceBalance, "as_of" | "amount" | "cny_rate" | "sgd_rate" | "rate_date"> & { value: Money }) | null;
  /** For a loan with terms, where its schedule stands today. */
  loan: LoanStatus | null;
};

/** Where things stand, worked out the way the page works it out -- for anything
 *  reading the API rather than the page, so it need not redo carry-forward,
 *  archiving and stored rates, and cannot get them subtly wrong. Money is
 *  rounded to cents; rates are left as stored. */
export type Summary = Totals & {
  /** What the totals leave out, and how much of the rest they count. */
  lens: { exclude_long_term: boolean; liquid_only: boolean; owner: string | null };
  /** The latest day anything was recorded; null before the first record. */
  as_of: string | null;
  /** Against the record before `as_of`; null with fewer than two. */
  change: (Totals & { since: string }) | null;
  by_region: Record<Region, Totals>;
  /** Gross, per `${kind}:${category}`. */
  by_category: Record<string, Money>;
  accounts: AccountSummary[];
  history: Array<Totals & { day: string }>;
};

export function summarize(accounts: FinanceAccount[], balances: FinanceBalance[], lens: Lens = {}, today = todayInSG()): Summary {
  const history = historyOf(accounts, balances, lens);
  const latest = history.at(-1);
  const previous = history.at(-2);
  const counted = latest ? latestOn(accounts, balances, latest.day) : new Map<string, FinanceBalance>();
  const last = lastBalances(balances);
  return {
    lens: { exclude_long_term: !!lens.excludeLongTerm, liquid_only: !!lens.liquidOnly, owner: lens.owner ?? null },
    as_of: latest?.day ?? null,
    ...roundedTotals(latest ?? noTotals()),
    change: latest && previous
      ? {
        since: previous.day,
        assets: rounded(minus(latest.assets, previous.assets)),
        liabilities: rounded(minus(latest.liabilities, previous.liabilities)),
        net: rounded(minus(latest.net, previous.net)),
      }
      : null,
    by_region: Object.fromEntries(REGIONS.map((r) => [r, roundedTotals(latest?.byRegion[r] ?? noTotals())])) as Record<Region, Totals>,
    by_category: Object.fromEntries(Object.entries(latest?.byCategory ?? {}).map(([key, value]) => [key, rounded(value)])),
    accounts: sortAccounts(accounts).map((a) => {
      const b = last.get(a.id);
      const weight = weightOf(a, lens);
      const terms = loanTermsOf(a);
      return {
        ...a,
        display_name: displayName(a),
        is_long_term: isLongTerm(a),
        weight,
        counted: counted.has(a.id) && weight > 0,
        latest: b
          ? {
            as_of: b.as_of,
            amount: Number(b.amount),
            cny_rate: Number(b.cny_rate),
            sgd_rate: Number(b.sgd_rate),
            rate_date: b.rate_date,
            value: rounded(valueOf(b)),
          }
          : null,
        loan: terms ? roundedLoan(loanStatus(terms, today)) : null,
      };
    }),
    history: history.map((p) => ({ day: p.day, ...roundedTotals(p) })),
  };
}
