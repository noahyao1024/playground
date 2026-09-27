/** Restricted stock units: shares granted, vesting in tranches, that turn into
 *  money only as their plan allows.
 *
 *  A plan names how that happens. The numbers it runs on -- when the windows
 *  fall, how much of a tranche may be sold in one -- belong to the owner and are
 *  kept with the account (`rsu_rules`), private like the rest of finance: they
 *  come from the employer's own estimate page, and this repository is public. */

import { isRealDay } from "./dates";
import { isFinanceCurrency } from "./fx";

/** tiktok: double-trigger RSUs that a private company buys back, in windows.
 *  A tranche counts in a window once it has vested by the window's cutoff, at
 *  the rate its profile sets for the full years it has then been vested; the
 *  most the window buys is the floor of the sum, less every share sold in the
 *  windows before. Nothing settles until a share is sold. */
export const RSU_PLANS = ["tiktok"] as const;
export type RsuPlan = (typeof RSU_PLANS)[number];
export const RSU_PLAN_LABELS: Record<RsuPlan, string> = { tiktok: "TikTok" };

export function isRsuPlan(value: unknown): value is RsuPlan {
  return typeof value === "string" && (RSU_PLANS as readonly string[]).includes(value);
}

/** How much of a tranche a window may buy, in percent, by the full years it has
 *  been vested: under one year, one, two... The last holds for longer. */
export type RsuProfile = { label?: string; rates: number[] };

export type RsuRules = {
  /** What the share price is quoted in. */
  currency: string;
  /** A window in each of these months, its cutoff on this day: a tranche counts
   *  once vested on or before it. */
  windows: { months: number[]; cutoff_day: number };
  /** By name; each grant follows one. */
  profiles: Record<string, RsuProfile>;
  /** The last cutoff the rules were checked against the employer's own figures.
   *  Later windows are projections. */
  verified_through?: string | null;
};

export type RsuTranche = { vests_on: string; shares: number };

export interface RsuGrant {
  id: string;
  account_id: string;
  /** As the employer numbers it: ESOP… */
  grant_no: string;
  /** What kind of grant: an entry grant, a refresher. */
  label: string | null;
  /** Which of the account's profiles its tranches sell by. */
  profile: string;
  granted_on: string | null;
  /** The day its vesting is counted from. */
  vest_start: string | null;
  /** False for a grant offered and not yet accepted: counted only when asked. */
  signed: boolean;
  /** Oldest first. */
  tranches: RsuTranche[];
  note: string | null;
  created_at: string;
}

/** Shares sold in a window, which later windows' quotas are net of. */
export interface RsuSale {
  id: string;
  account_id: string;
  /** The cutoff of the window it was sold in. */
  window_cutoff: string;
  shares: number;
  /** Per share, in the rules' currency. */
  price: number | null;
  /** Withheld, in the same currency. */
  tax: number | null;
  note: string | null;
  created_at: string;
}

/** What an account needs to be worked out as RSUs. */
export type RsuTerms = { plan: RsuPlan; rules: RsuRules; grants: RsuGrant[]; sales: RsuSale[] };

// ─── Reading what is stored ──────────────────────────────────────────

const PROFILE = /^[a-z0-9_]{1,40}$/;

const isObject = (v: unknown): v is Record<string, unknown> => typeof v === "object" && v !== null && !Array.isArray(v);

/** The rules as stored, checked and put in order; or what is wrong with them. */
export function parseRsuRules(value: unknown): { rules: RsuRules } | { problem: string } {
  if (!isObject(value)) return { problem: "rsu_rules must be an object" };
  const { currency, windows, profiles, verified_through } = value;
  if (!isFinanceCurrency(currency)) return { problem: "rsu_rules.currency must be one of the finance currencies, as USD" };
  if (!isObject(windows)) return { problem: "rsu_rules.windows must be {months, cutoff_day}" };
  const months = windows.months;
  if (!Array.isArray(months) || months.length === 0 || months.length > 12
    || !months.every((m) => Number.isInteger(m) && m >= 1 && m <= 12) || new Set(months).size !== months.length) {
    return { problem: "rsu_rules.windows.months must be the months a window falls in, 1 to 12, each once" };
  }
  const cutoffDay = windows.cutoff_day;
  if (!Number.isInteger(cutoffDay) || (cutoffDay as number) < 1 || (cutoffDay as number) > 28) {
    return { problem: "rsu_rules.windows.cutoff_day must be a day of the month, 1 to 28" };
  }
  if (!isObject(profiles) || Object.keys(profiles).length === 0) return { problem: "rsu_rules.profiles must name at least one profile" };
  const parsed: Record<string, RsuProfile> = {};
  for (const [name, p] of Object.entries(profiles)) {
    if (!PROFILE.test(name)) return { problem: `rsu_rules.profiles: "${name}" must be lowercase letters, digits and _` };
    if (!isObject(p)) return { problem: `rsu_rules.profiles.${name} must be {label, rates}` };
    if (p.label != null && (typeof p.label !== "string" || p.label.length > 40)) return { problem: `rsu_rules.profiles.${name}.label must be text, up to 40 characters` };
    const rates = p.rates;
    if (!Array.isArray(rates) || rates.length === 0 || rates.length > 10
      || !rates.every((r) => typeof r === "number" && r >= 0 && r <= 100 && Math.abs(r * 100 - Math.round(r * 100)) < 1e-6)) {
      return { problem: `rsu_rules.profiles.${name}.rates must be percentages, 0 to 100, to two decimal places, by full years vested` };
    }
    parsed[name] = { ...(typeof p.label === "string" && p.label.trim() ? { label: p.label.trim() } : {}), rates: rates as number[] };
  }
  if (verified_through != null && !isRealDay(verified_through)) return { problem: "rsu_rules.verified_through must be a date, YYYY-MM-DD, or null" };
  return {
    rules: {
      currency,
      windows: { months: [...(months as number[])].sort((a, b) => a - b), cutoff_day: cutoffDay as number },
      profiles: parsed,
      verified_through: (verified_through as string | null | undefined) ?? null,
    },
  };
}

/** Rules as typed into the account's form: JSON, checked as the server checks
 *  them; or what is wrong with them. */
export function rulesFromText(text: string): { rules: RsuRules } | { problem: string } {
  if (!text.trim()) return { problem: "Paste the plan's rules, as JSON" };
  let value: unknown;
  try {
    value = JSON.parse(text);
  } catch {
    return { problem: "The rules are not JSON: check the brackets, quotes and commas" };
  }
  return parseRsuRules(value);
}

/** A grant's tranches as given -- [{vests_on, shares}] -- checked and put in
 *  order; or what is wrong with them. */
export function parseTranches(value: unknown): { tranches: RsuTranche[] } | { problem: string } {
  if (!Array.isArray(value) || value.length === 0 || value.length > 200) return { problem: "tranches must list 1 to 200 {vests_on, shares}" };
  const tranches: RsuTranche[] = [];
  for (const t of value) {
    if (!isObject(t) || !isRealDay(t.vests_on) || !Number.isInteger(t.shares) || (t.shares as number) <= 0) {
      return { problem: "each tranche must be {vests_on: YYYY-MM-DD, shares: a whole number above 0}" };
    }
    tranches.push({ vests_on: t.vests_on, shares: t.shares as number });
  }
  tranches.sort((a, b) => (a.vests_on < b.vests_on ? -1 : a.vests_on > b.vests_on ? 1 : 0));
  if (tranches.some((t, i) => i > 0 && t.vests_on === tranches[i - 1].vests_on)) return { problem: "tranches must fall on different days" };
  return { tranches };
}

/** Tranches from lines of "YYYY-MM-DD shares" -- the way a grant's schedule is
 *  copied out of the employer's page -- or what is wrong with them. */
export function tranchesFromText(text: string): { tranches: RsuTranche[] } | { problem: string } {
  const rows: Array<{ vests_on: string; shares: number }> = [];
  for (const [i, raw] of text.split(/\r?\n/).entries()) {
    const line = raw.trim();
    if (!line) continue;
    const m = /^(\d{4}-\d{2}-\d{2})[\s,;:\t]+([\d,]+)$/.exec(line);
    if (!m) return { problem: `Line ${i + 1}: write the date and the shares, as 2026-06-15 40` };
    rows.push({ vests_on: m[1], shares: Number(m[2].replace(/,/g, "")) });
  }
  return parseTranches(rows);
}

// ─── Working it out ──────────────────────────────────────────────────

/** Whole years from one day to another: those whose anniversary of `from` has
 *  come by `to`, the day itself included. */
export function fullYears(from: string, to: string): number {
  const [y1, m1, d1] = from.split("-").map(Number);
  const [y2, m2, d2] = to.split("-").map(Number);
  return Math.max(0, y2 - y1 - (m2 < m1 || (m2 === m1 && d2 < d1) ? 1 : 0));
}

const pad = (n: number) => String(n).padStart(2, "0");

/** Every window's cutoff from one day to another, both included, in order. */
export function windowCutoffs(rules: RsuRules, from: string, to: string): string[] {
  const out: string[] = [];
  for (let y = Number(from.slice(0, 4)); y <= Number(to.slice(0, 4)); y++) {
    for (const m of rules.windows.months) {
      const day = `${y}-${pad(m)}-${pad(rules.windows.cutoff_day)}`;
      if (day >= from && day <= to) out.push(day);
    }
  }
  return out;
}

/** The first window cutoff on or after `day`. */
export function nextWindow(rules: RsuRules, day: string): string {
  const year = Number(day.slice(0, 4));
  return windowCutoffs(rules, day, `${year + 1}-12-31`)[0];
}

/** How a window counts one tranche. */
export type RsuLine = {
  grant_no: string;
  signed: boolean;
  vests_on: string;
  shares: number;
  full_years: number;
  /** Percent. */
  rate: number;
  /** shares × rate, before the window's sum is rounded down. */
  sellable: number;
  /** Vested longer than the profile's rates go, so its last rate is assumed. */
  extrapolated: boolean;
};

export type RsuWindow = {
  cutoff: string;
  /** Past the rules' checked range, or counting a tranche at an assumed rate. */
  projected: boolean;
  /** Shares vested by the cutoff. */
  vested: number;
  /** The most the window and every one before it could have bought: the floor
   *  of the tranches' sellable shares, added up. */
  cumulative: number;
  /** Sold in the windows before. */
  sold_before: number;
  /** What this window may buy: cumulative less sold_before. */
  quota: number;
  /** Already sold in it. */
  sold: number;
  /** What it may still buy. */
  remaining: number;
  lines: RsuLine[];
};

/** A window, worked out: which tranches count, at what rate, and what it may
 *  buy. A proposed grant counts only when asked for. */
export function rsuWindow(terms: Pick<RsuTerms, "rules" | "grants" | "sales">, cutoff: string, { includeProposed = false } = {}): RsuWindow {
  const { rules, grants, sales } = terms;
  const lines: RsuLine[] = [];
  // Summed in hundredths of a percent, whole numbers throughout, so the floor
  // is taken of an exact sum: 0.55 × 20 is 11.000000000000002 in floating point.
  let exact = 0;
  for (const g of grants) {
    if (!g.signed && !includeProposed) continue;
    const rates = rules.profiles[g.profile]?.rates;
    if (!rates) continue;
    for (const t of g.tranches) {
      if (t.vests_on > cutoff) continue;
      const years = fullYears(t.vests_on, cutoff);
      const rate = rates[Math.min(years, rates.length - 1)];
      const hundredths = Math.round(rate * 100);
      exact += t.shares * hundredths;
      lines.push({
        grant_no: g.grant_no, signed: g.signed, vests_on: t.vests_on, shares: t.shares, full_years: years, rate,
        sellable: (t.shares * hundredths) / 10_000, extrapolated: years >= rates.length,
      });
    }
  }
  lines.sort((a, b) => a.vests_on.localeCompare(b.vests_on) || a.grant_no.localeCompare(b.grant_no));
  const cumulative = Math.floor(exact / 10_000);
  const soldBefore = sales.filter((s) => s.window_cutoff < cutoff).reduce((n, s) => n + s.shares, 0);
  const sold = sales.filter((s) => s.window_cutoff === cutoff).reduce((n, s) => n + s.shares, 0);
  const quota = Math.max(0, cumulative - soldBefore);
  const past = rules.verified_through != null && cutoff > rules.verified_through;
  return {
    cutoff,
    projected: past || lines.some((l) => l.extrapolated),
    vested: lines.reduce((n, l) => n + l.shares, 0),
    cumulative,
    sold_before: soldBefore,
    quota,
    sold,
    remaining: Math.max(0, quota - sold),
    lines,
  };
}

/** The windows from `from` on, and what each may buy if every one before it from
 *  here is sold in full -- the most that could come out, window by window. */
export function rsuOutlook(terms: Pick<RsuTerms, "rules" | "grants" | "sales">, from: string, count: number, options: { includeProposed?: boolean } = {}) {
  // A window a year at least, so `count` years hold `count` windows.
  const cutoffs = windowCutoffs(terms.rules, from, `${Number(from.slice(0, 4)) + count}-12-31`).slice(0, count);
  let before: number | null = null;
  return cutoffs.map((cutoff) => {
    const w = rsuWindow(terms, cutoff, options);
    // Sold in full: everything the window before could buy is gone by this one.
    const ifSoldInFull = Math.max(0, w.cumulative - Math.max(w.sold_before, before ?? 0));
    before = w.cumulative;
    return { cutoff, projected: w.projected, vested: w.vested, cumulative: w.cumulative, quota: w.quota, if_sold_in_full: ifSoldInFull };
  });
}

/** Where the shares stand on a day: signed grants only, a proposed one apart. */
export type RsuPosition = {
  as_of: string;
  granted: number;
  vested: number;
  unvested: number;
  /** Sold in windows cut off by then. */
  sold: number;
  /** Vested and not sold: what the account holds. */
  held: number;
  /** In grants not yet signed. */
  proposed: number;
};

export function rsuPosition(terms: Pick<RsuTerms, "grants" | "sales">, day: string): RsuPosition {
  let granted = 0, vested = 0, proposed = 0;
  for (const g of terms.grants) {
    for (const t of g.tranches) {
      if (!g.signed) { proposed += t.shares; continue; }
      granted += t.shares;
      if (t.vests_on <= day) vested += t.shares;
    }
  }
  const sold = terms.sales.filter((s) => s.window_cutoff <= day).reduce((n, s) => n + s.shares, 0);
  return { as_of: day, granted, vested, unvested: granted - vested, sold, held: Math.max(0, vested - sold), proposed };
}

/** Selling `shares` at `price`, to the cent: before tax, the tax at `taxRate`
 *  (0.22 for 22%) when given, and what is left. */
export function rsuProceeds(shares: number, price: number, taxRate: number | null = null) {
  const gross = Math.round(shares * price * 100) / 100;
  const tax = taxRate == null ? null : Math.round(gross * taxRate * 100) / 100;
  return { gross, tax, net: tax == null ? null : Math.round((gross - tax) * 100) / 100 };
}

/** What the next window could turn of today's holding into money, as a share of
 *  it: an RSU account's liquidity when none is set by hand. */
export function rsuLiquidity(terms: RsuTerms, day: string): number {
  return rsuStatus(terms, day).liquidity;
}

/** Where an RSU account stands on a day, as the summary gives it: the shares,
 *  and the next window without its tranche-by-tranche lines. */
export function rsuStatus(terms: RsuTerms, day: string) {
  const position = rsuPosition(terms, day);
  const w = rsuWindow(terms, nextWindow(terms.rules, day));
  return {
    plan: terms.plan,
    currency: terms.rules.currency,
    position,
    next_window: {
      cutoff: w.cutoff, projected: w.projected, vested: w.vested, cumulative: w.cumulative,
      sold_before: w.sold_before, quota: w.quota, sold: w.sold, remaining: w.remaining,
    },
    liquidity: position.held > 0 ? Math.min(1, w.remaining / position.held) : 0,
  };
}
export type RsuStatus = ReturnType<typeof rsuStatus>;
