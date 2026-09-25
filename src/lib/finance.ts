import { dayInSG } from "./dates";

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
  region: Region;
  currency: string;
  kind: Kind;
  category: string;
  note: string | null;
  sort_order: number;
  archived_at: string | null;
  created_at: string;
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

/** Where things stood at the end of `day`. */
export function positionOn(accounts: FinanceAccount[], balances: FinanceBalance[], day: string): Position {
  const byId = new Map(accounts.map((a) => [a.id, a]));
  const position: Position = {
    day,
    ...noTotals(),
    byRegion: { CN: noTotals(), SG: noTotals(), OTHER: noTotals() },
    byCategory: {},
  };
  for (const [id, balance] of latestOn(accounts, balances, day)) {
    const account = byId.get(id)!;
    const value = valueOf(balance);
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
export function historyOf(accounts: FinanceAccount[], balances: FinanceBalance[]): Position[] {
  const days = [...new Set(balances.map((b) => b.as_of))].sort();
  return days.map((day) => positionOn(accounts, balances, day));
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

const cents = (n: number) => Math.round(n * 100) / 100;
const rounded = (m: Money): Money => ({ cny: cents(m.cny), sgd: cents(m.sgd) });
const roundedTotals = (t: Totals): Totals => ({ assets: rounded(t.assets), liabilities: rounded(t.liabilities), net: rounded(t.net) });
const minus = (a: Money, b: Money): Money => ({ cny: a.cny - b.cny, sgd: a.sgd - b.sgd });

export type AccountSummary = FinanceAccount & {
  /** Whether it counts in the totals of `as_of`: open then, and recorded by then. */
  counted: boolean;
  /** Its newest balance, valued at the rates stored with it. */
  latest: (Pick<FinanceBalance, "as_of" | "amount" | "cny_rate" | "sgd_rate" | "rate_date"> & { value: Money }) | null;
};

/** Where things stand, worked out the way the page works it out -- for anything
 *  reading the API rather than the page, so it need not redo carry-forward,
 *  archiving and stored rates, and cannot get them subtly wrong. Money is
 *  rounded to cents; rates are left as stored. */
export type Summary = Totals & {
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

export function summarize(accounts: FinanceAccount[], balances: FinanceBalance[]): Summary {
  const history = historyOf(accounts, balances);
  const latest = history.at(-1);
  const previous = history.at(-2);
  const counted = latest ? latestOn(accounts, balances, latest.day) : new Map<string, FinanceBalance>();
  const last = lastBalances(balances);
  return {
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
      return {
        ...a,
        counted: counted.has(a.id),
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
      };
    }),
    history: history.map((p) => ({ day: p.day, ...roundedTotals(p) })),
  };
}
