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
 *  principal level, so interest and with it the payment fall month by month.
 *  等本等息 -- a flat rate: card instalments, car and personal loans in
 *  Singapore -- charges the same interest every month, on the amount borrowed,
 *  with the same principal. 先息后本 pays interest only, and the principal
 *  with the last repayment. */
export const LOAN_METHODS = ["annuity", "equal_principal", "flat", "interest_only"] as const;
export type LoanMethod = (typeof LOAN_METHODS)[number];
export const LOAN_METHOD_LABELS: Record<LoanMethod, string> = {
  annuity: "等额本息", equal_principal: "等额本金", flat: "等本等息", interest_only: "先息后本",
};

export function isLoanMethod(value: unknown): value is LoanMethod {
  return typeof value === "string" && (LOAN_METHODS as readonly string[]).includes(value);
}

/** Whether a method's payment is level, and so one a bank can state. */
export const hasLevelPayment = (method: LoanMethod) => method === "annuity" || method === "flat";

/** How interest is counted. 30/360: a month's interest is a twelfth of a
 *  year's, as Chinese banks count it. actual/365: by the day, a year of 365 --
 *  daily rest, as Singapore banks count a home loan. actual/360: by the day, a
 *  year of 360, as a daily rate is quoted. */
export const LOAN_DAY_COUNTS = ["30/360", "actual/365", "actual/360"] as const;
export type LoanDayCount = (typeof LOAN_DAY_COUNTS)[number];
export const LOAN_DAY_COUNT_LABELS: Record<LoanDayCount, string> = {
  "30/360": "By the month", "actual/365": "By the day, 365", "actual/360": "By the day, 360",
};

export function isLoanDayCount(value: unknown): value is LoanDayCount {
  return typeof value === "string" && (LOAN_DAY_COUNTS as readonly string[]).includes(value);
}

/** What a prepayment does to the rest of a loan: keep the payment and end
 *  sooner, or keep the end and pay less each month. */
export const PREPAYMENT_MODES = ["shorten", "reduce"] as const;
export type PrepaymentMode = (typeof PREPAYMENT_MODES)[number];
export const PREPAYMENT_MODE_LABELS: Record<PrepaymentMode, string> = { shorten: "缩短期限", reduce: "减少月供" };

export function isPrepaymentMode(value: unknown): value is PrepaymentMode {
  return typeof value === "string" && (PREPAYMENT_MODES as readonly string[]).includes(value);
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
  /** The monthly payment as the bank states it, under 等额本息 or 等本等息. Null
   *  works it out from the terms, to the cent. */
  loan_payment?: number | null;
  /** The first repayment's interest as the bank charged it: after a rate reset
   *  it covers a different stretch than a plain month. Null works it out. */
  loan_first_interest?: number | null;
  /** The contract's end date, YYYY-MM-DD, when it falls after the last monthly
   *  repayment's day: the last repayment is then due on it, with interest for
   *  the days since the one before. Null: the last falls on the monthly day. */
  loan_maturity?: string | null;
  /** How its interest is counted. Null: 30/360, by the month. */
  loan_day_count?: LoanDayCount | null;
  /** Its loan's rate changes, oldest first. An account read from the API always
   *  has the list, empty for most. */
  rate_changes?: LoanRateChange[];
  /** Its loan's prepayments, oldest first; the same, always there. */
  prepayments?: LoanPrepayment[];
  archived_at: string | null;
  created_at: string;
}

/** A change to a loan's rate, kept beside the terms rather than written over
 *  them, so the months before it keep the rate they were charged at. */
export interface LoanRateChange {
  id: string;
  account_id: string;
  /** The first repayment charged at the new rate, YYYY-MM-DD. */
  effective_date: string;
  /** Annual, in percent. */
  rate: number;
  /** The payment from then on as the bank states it, where the payment is
   *  level. Null works it out: what repays the balance then owed over the
   *  repayments left. */
  payment: number | null;
  created_at: string;
}

/** Principal repaid early, beyond the schedule. */
export interface LoanPrepayment {
  id: string;
  account_id: string;
  /** The day it was paid, YYYY-MM-DD. Interest runs on what was owed before it
   *  up to that day, and on what is left after. */
  paid_on: string;
  amount: number;
  /** shorten: the payment stays, the loan ends sooner. reduce: the end stays,
   *  the payment falls. */
  mode: PrepaymentMode;
  /** The payment from then on as the bank states it, when it reduces a level
   *  payment. Null works it out. */
  payment: number | null;
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

/** Adds up a day from each account's balance as of that day -- the arithmetic
 *  positionOn and historyOf share. Accounts unknown, or archived by `day`, are
 *  passed over. */
function positionFrom(byId: Map<string, FinanceAccount>, latest: Iterable<FinanceBalance>, day: string, lens: Lens): Position {
  const position: Position = {
    day,
    ...noTotals(),
    byRegion: { CN: noTotals(), SG: noTotals(), OTHER: noTotals() },
    byCategory: {},
  };
  for (const balance of latest) {
    const account = byId.get(balance.account_id);
    if (!account || !countsOn(account, day)) continue;
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

/** Where things stood at the end of `day`, as the lens sees it. */
export function positionOn(accounts: FinanceAccount[], balances: FinanceBalance[], day: string, lens: Lens = {}): Position {
  const byId = new Map(accounts.map((a) => [a.id, a]));
  return positionFrom(byId, latestOn(accounts, balances, day).values(), day, lens);
}

/** One point for every day anything was recorded, oldest first.
 *
 *  One pass over the balances in day order, carrying each account's latest
 *  forward, rather than a fresh scan of every balance for every day: the
 *  difference between milliseconds and seconds once years of weekly records
 *  pile up. Held by a test to exactly what positionOn gives each day. */
export function historyOf(accounts: FinanceAccount[], balances: FinanceBalance[], lens: Lens = {}): Position[] {
  const byId = new Map(accounts.map((a) => [a.id, a]));
  const ordered = [...balances].sort((a, b) => (a.as_of < b.as_of ? -1 : a.as_of > b.as_of ? 1 : 0));
  const latest = new Map<string, FinanceBalance>();
  const history: Position[] = [];
  for (let i = 0; i < ordered.length;) {
    const day = ordered[i].as_of;
    // A day holds at most one balance per account, so the last write wins cleanly.
    for (; i < ordered.length && ordered[i].as_of === day; i++) latest.set(ordered[i].account_id, ordered[i]);
    history.push(positionFrom(byId, latest.values(), day, lens));
  }
  return history;
}

/** The balances with `written` in place: one for the same account and day is
 *  replaced, anything new added. A save puts the server's reply on screen this
 *  way, instead of fetching every balance again. */
export function withBalances(balances: FinanceBalance[], written: FinanceBalance[]): FinanceBalance[] {
  const key = (b: FinanceBalance) => `${b.account_id}|${b.as_of}`;
  const replaced = new Set(written.map(key));
  return [...balances.filter((b) => !replaced.has(key(b))), ...written];
}

/** The accounts with `account` added, or put in place of the one it updates. */
export function withAccount(accounts: FinanceAccount[], account: FinanceAccount): FinanceAccount[] {
  return accounts.some((a) => a.id === account.id)
    ? accounts.map((a) => (a.id === account.id ? account : a))
    : [...accounts, account];
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

export type LoanRateChangeTerms = Pick<LoanRateChange, "effective_date" | "rate" | "payment">;
export type LoanPrepaymentTerms = Pick<LoanPrepayment, "paid_on" | "amount" | "mode" | "payment">;

export type LoanTerms = {
  principal: number;
  /** Annual, in percent. */
  rate: number;
  start: string;
  months: number;
  method: LoanMethod;
  /** The bank's stated monthly payment, where it is level; absent or null works it out. */
  payment?: number | null;
  /** The first repayment's interest as the bank charged it; absent or null works it out. */
  firstInterest?: number | null;
  /** The contract's end date; absent or null, the last repayment is a monthly one. */
  maturity?: string | null;
  /** How interest is counted; absent or null, 30/360. */
  dayCount?: LoanDayCount | null;
  /** Changes to the rate, in any order. */
  rateChanges?: LoanRateChangeTerms[];
  /** Principal repaid early, in any order. */
  prepayments?: LoanPrepaymentTerms[];
};

const numberOrNull = (value: number | null | undefined) => (value == null ? null : Number(value));

/** A loan's terms, if all five are set, with whatever else is known of how the
 *  bank schedules it. PostgREST may hand numerics over as strings. */
export function loanTermsOf(a: FinanceAccount): LoanTerms | null {
  const { loan_principal: principal, loan_rate: rate, loan_start: start, loan_term_months: months, loan_method: method } = a;
  if (principal == null || rate == null || !start || months == null || !method) return null;
  return {
    principal: Number(principal),
    rate: Number(rate),
    start,
    months: Number(months),
    method,
    payment: numberOrNull(a.loan_payment),
    firstInterest: numberOrNull(a.loan_first_interest),
    maturity: a.loan_maturity ?? null,
    dayCount: a.loan_day_count ?? null,
    rateChanges: (a.rate_changes ?? []).map((c) => ({ effective_date: c.effective_date, rate: Number(c.rate), payment: numberOrNull(c.payment) })),
    prepayments: (a.prepayments ?? []).map((p) => ({ paid_on: p.paid_on, amount: Number(p.amount), mode: p.mode, payment: numberOrNull(p.payment) })),
  };
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

/** Days from one day to another in a 360-day year, every month thirty days
 *  and a 31st counted as the 30th -- the way a Chinese bank counts a broken
 *  period: 1 December to 16 January is 45. */
export function days360(from: string, to: string): number {
  const [y1, m1, d1] = from.split("-").map(Number);
  const [y2, m2, d2] = to.split("-").map(Number);
  return (y2 - y1) * 360 + (m2 - m1) * 30 + Math.min(d2, 30) - Math.min(d1, 30);
}

const utcDay = (day: string) => {
  const [y, m, d] = day.split("-").map(Number);
  return Date.UTC(y, m - 1, d);
};
/** Days from one day to another on the calendar. */
export const actualDays = (from: string, to: string) => Math.round((utcDay(to) - utcDay(from)) / 86_400_000);

/** How many of the repayments have fallen due by the end of `day`: they are
 *  in date order, the last on the contract's end date if it has one. */
export function repaymentsMade(periods: Array<{ date: string }>, day: string): number {
  let made = 0;
  while (made < periods.length && periods[made].date <= day) made++;
  return made;
}

/** One repayment of a loan, in the loan's currency. */
export type LoanPeriod = {
  /** Which repayment: 1 for the first. */
  n: number;
  /** When it falls due; for a loan cleared by a prepayment, the day it was cleared. */
  date: string;
  /** Annual, in percent: what this repayment's interest ran at. */
  rate: number;
  /** principal + interest. */
  payment: number;
  principal: number;
  interest: number;
  /** Principal still owed once it is paid. */
  balance: number;
  /** Principal repaid early since the repayment before, taken off before this
   *  one's interest: it runs on what was owed before each, up to its day. Only
   *  where there is any. */
  prepaid?: Array<{ paid_on: string; amount: number }>;
};

export type LoanSchedule = {
  periods: LoanPeriod[];
  /** Everything paid, added up -- the repayments and the prepayments: principal
   *  and interest make the payment. */
  totals: { payment: number; principal: number; interest: number };
};

// A bank keeps a repayment plan in whole cents (分), and so does the schedule:
// below, every amount is a whole number of cents until it is handed out.
const toCents = (amount: number) => Math.round(amount * 100);

/** a / b to the nearest whole number, halves up, for whole a ≥ 0 and b > 0 --
 *  exactly, which floating-point division is not at a half. */
function divideHalfUp(a: number, b: number): number {
  const n = 2 * a + b, d = 2 * b;
  return (n - (n % d)) / d;
}

/** A month in a 360-day year: a month's interest is the balance times rate / 12. */
const MONTH = 30;

/** Interest on `balanceDays` -- cents owed, times the days they were owed -- at
 *  `rate` percent a year of `basis` days, rounded to the cent with halves up.
 *  In floating point a half cent can land a hair under and round down, so one
 *  that lands near a half is settled in whole numbers; anywhere else the float
 *  cannot be wrong by enough to matter. */
function interestOn(balanceDays: number, rate: number, basis: number): number {
  const approx = (balanceDays * rate) / (basis * 100);
  if (Math.abs(approx - Math.floor(approx) - 0.5) > 1e-9 * Math.max(1, approx)) return Math.round(approx);
  // basis days × 100 percent × the 10^9 a rate is scaled by to make it whole.
  const scale = BigInt(basis) * BigInt(100_000_000_000);
  const twice = BigInt(balanceDays) * BigInt(Math.round(rate * 1e9)) * BigInt(2);
  return Number((twice + scale) / (scale * BigInt(2)));
}

/** The level payment, in cents, that repays `balance` cents over `months` at
 *  `rate` percent a year: P·i(1+i)^n / ((1+i)^n − 1), to the cent. */
function levelPayment(balance: number, rate: number, months: number): number {
  if (rate === 0) return divideHalfUp(balance, months);
  const i = rate / 1200;
  const growth = (1 + i) ** months;
  return Math.round((balance * i * growth) / (growth - 1));
}

/** How many repayments, the next included, clear `balance` at the payment as
 *  it stands: what shortening a loan leaves of its term. At most `most`. */
function repaymentsToClear(balance: number, method: LoanMethod, payment: number, part: number, rate: number, flatInterest: number, most: number): number {
  let m = most;
  if (method === "equal_principal") m = Math.ceil(balance / part);
  else if (method === "flat" && payment > flatInterest) m = Math.ceil(balance / (payment - flatInterest));
  else if (method === "annuity") {
    const i = rate / 1200;
    if (i === 0) m = Math.ceil(balance / payment);
    else if (payment > balance * i) m = Math.ceil(Math.log(payment / (payment - balance * i)) / Math.log(1 + i) - 1e-9);
  }
  return Math.max(1, Math.min(most, m));
}

const byKey = <T,>(items: T[], key: (item: T) => string) =>
  [...items].sort((a, b) => (key(a) < key(b) ? -1 : key(a) > key(b) ? 1 : 0));

/** loanSchedule's repayments, in cents. */
function repayments(terms: LoanTerms): LoanPeriod[] {
  const { months: n, method } = terms;
  const dayCount = terms.dayCount ?? "30/360";
  const byTheDay = dayCount !== "30/360";
  const basis = dayCount === "actual/365" ? 365 : 360;
  const changes = byKey(terms.rateChanges ?? [], (c) => c.effective_date);
  const prepayments = byKey(terms.prepayments ?? [], (p) => p.paid_on);
  let balance = toCents(terms.principal);
  let rate = terms.rate;
  // 等额本金 and 等本等息 repay the same principal each month. 等本等息 charges
  // the same interest each month too, a month's on `base`: the amount borrowed,
  // or what was owed after the last prepayment.
  let part = divideHalfUp(balance, n);
  let base = balance;
  const flatInterest = () => interestOn(base * MONTH, rate, 360);
  // A level payment no one has stated: what repays the balance over `left` repayments.
  const worked = (left: number) => (method === "annuity" ? levelPayment(balance, rate, left) : part + flatInterest());
  let payment = hasLevelPayment(method) ? (terms.payment != null ? toCents(terms.payment) : worked(n)) : 0;
  // A contract ending after the last monthly day moves the last repayment to its end.
  const maturity = terms.maturity && terms.maturity > addMonths(terms.start, n - 1) ? terms.maturity : null;
  // The last repayment: the term's, or sooner once a prepayment shortens it.
  let end = n;
  const periods: LoanPeriod[] = [];
  for (let k = 1, nextChange = 0, nextPrepayment = 0; k <= end && balance > 0; k++) {
    // The repayment before -- for the first, a month before it -- to this one.
    const from = addMonths(terms.start, k - 2);
    const date = k === n && maturity ? maturity : addMonths(terms.start, k - 1);
    const left = () => end - k + 1;
    const span = byTheDay ? actualDays(from, date) : k === n && maturity ? days360(from, maturity) : MONTH;
    const into = (day: string) => Math.min(span, Math.max(0, byTheDay ? actualDays(from, day) : days360(from, day)));

    // Prepayments since the repayment before: interest runs on what was owed
    // before each, up to its day, and on what is left after.
    let balanceDays = 0, counted = 0;
    const prepaid: Array<{ paid_on: string; amount: number }> = [];
    while (nextPrepayment < prepayments.length && prepayments[nextPrepayment].paid_on < date) {
      const p = prepayments[nextPrepayment++];
      const amount = Math.min(toCents(p.amount), balance);
      if (amount <= 0) continue;
      const at = into(p.paid_on);
      balanceDays += balance * (at - counted);
      counted = at;
      balance -= amount;
      prepaid.push({ paid_on: p.paid_on, amount });
      if (method === "flat") base = balance;
      if (p.mode === "reduce") {
        if (method === "equal_principal" || method === "flat") part = divideHalfUp(balance, left());
        if (hasLevelPayment(method)) payment = p.payment != null ? toCents(p.payment) : worked(left());
      } else if (balance > 0) {
        // The payment stays: the term is what it now takes to clear what is left.
        end = k - 1 + repaymentsToClear(balance, method, payment, part, rate, method === "flat" ? flatInterest() : 0, left());
      }
    }
    if (balance === 0) {
      // Cleared early: the interest owed up to the day, and no repayment after.
      const interest = method === "flat" ? 0 : interestOn(balanceDays, rate, basis);
      periods.push({ n: k, date: prepaid[prepaid.length - 1].paid_on, rate, payment: interest, principal: 0, interest, balance: 0, prepaid });
      break;
    }

    // Every rate change in force by this repayment; of two, the later decides.
    let change: LoanRateChangeTerms | undefined;
    while (nextChange < changes.length && changes[nextChange].effective_date <= date) change = changes[nextChange++];
    if (change) {
      rate = change.rate;
      if (hasLevelPayment(method)) payment = change.payment != null ? toCents(change.payment) : worked(left());
    }

    balanceDays += balance * (span - counted);
    const interest = k === 1 && terms.firstInterest != null
      ? toCents(terms.firstInterest)
      : method === "flat" ? flatInterest() : interestOn(balanceDays, rate, basis);
    const due = method === "equal_principal" ? part : method === "interest_only" ? 0 : payment - interest;
    // The last repayment clears what is left, and so does one that would repay more.
    const principal = k === end ? balance : Math.min(due, balance);
    balance -= principal;
    periods.push({ n: k, date, rate, payment: principal + interest, principal, interest, balance, ...(prepaid.length ? { prepaid } : {}) });
  }
  return periods;
}

const sumOf = (periods: LoanPeriod[], key: "payment" | "principal" | "interest") => periods.reduce((sum, p) => sum + p[key], 0);
const prepaidIn = (period: LoanPeriod | undefined, until = "9999-12-31") =>
  (period?.prepaid ?? []).reduce((sum, p) => sum + (p.paid_on <= until ? p.amount : 0), 0);

/** A loan's every repayment, to the cent, the way a bank's repayment plan
 *  (还款计划) has it. Each month's interest is what is owed times the monthly
 *  rate -- or, counted by the day, times the days -- rounded to the cent.
 *  等额本息 takes it out of a level payment and repays the rest; 等额本金
 *  repays the same principal each month, P/n to the cent; 等本等息 charges a
 *  month's interest on the amount borrowed, every month, beside P/n; 先息后本
 *  pays interest alone until the last. The last repayment clears what is left,
 *  taking up the cents the rounding moved.
 *
 *  The level payment is the bank's stated one when given, else the formula's
 *  to the cent. A rate change sets the rate from its first repayment, and the
 *  payment to the one given, or to what repays the balance then owed over the
 *  repayments left. A prepayment comes off what is owed on its day; after it
 *  the payment stays and the loan ends sooner, or the end stays and the
 *  payment falls. A contract that ends after the last monthly day has its last
 *  repayment on that day, charged interest by the day from the repayment
 *  before. */
export function loanSchedule(terms: LoanTerms): LoanSchedule {
  const periods = repayments(terms);
  const early = periods.reduce((sum, p) => sum + prepaidIn(p), 0);
  return {
    periods: periods.map((p) => ({
      ...p,
      payment: p.payment / 100,
      principal: p.principal / 100,
      interest: p.interest / 100,
      balance: p.balance / 100,
      ...(p.prepaid ? { prepaid: p.prepaid.map((x) => ({ paid_on: x.paid_on, amount: x.amount / 100 })) } : {}),
    })),
    totals: {
      payment: (sumOf(periods, "payment") + early) / 100,
      principal: (sumOf(periods, "principal") + early) / 100,
      interest: sumOf(periods, "interest") / 100,
    },
  };
}

/** Where a loan's schedule stands, in its own currency. */
export type LoanStatus = {
  /** The next repayment: level under 等额本息 and 等本等息 but for the last,
   *  which clears what is left; falling under 等额本金; the interest alone under
   *  先息后本 until the last. 0 once it is repaid. */
  payment: number;
  /** Annual, in percent: what the next repayment runs at, or the last did. */
  rate: number;
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

/** A loan's schedule on `day`, read off its repayments. */
export function loanStatus(terms: LoanTerms, day: string): LoanStatus {
  const periods = repayments(terms);
  const made = repaymentsMade(periods, day);
  const next = periods[made];
  const last = periods.at(-1);
  // What the repayments made leave owing, less what has been prepaid since.
  const principalLeft = (made === 0 ? toCents(terms.principal) : periods[made - 1].balance) - prepaidIn(next, day);
  const interestLeft = sumOf(periods.slice(made), "interest");
  return {
    payment: next ? next.payment / 100 : 0,
    rate: (next ?? last)?.rate ?? terms.rate,
    payments_made: made,
    payments_left: periods.length - made,
    principal_left: principalLeft / 100,
    interest_left: interestLeft / 100,
    total_left: (principalLeft + interestLeft) / 100,
    total_interest: sumOf(periods, "interest") / 100,
    next_payment: next?.date ?? null,
    last_payment: last?.date ?? terms.start,
  };
}

const cents = (n: number) => Math.round(n * 100) / 100;
const rounded = (m: Money): Money => ({ cny: cents(m.cny), sgd: cents(m.sgd) });
const roundedTotals = (t: Totals): Totals => ({ assets: rounded(t.assets), liabilities: rounded(t.liabilities), net: rounded(t.net) });
const minus = (a: Money, b: Money): Money => ({ cny: a.cny - b.cny, sgd: a.sgd - b.sgd });

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
        loan: terms ? loanStatus(terms, today) : null,
      };
    }),
    history: history.map((p) => ({ day: p.day, ...roundedTotals(p) })),
  };
}
