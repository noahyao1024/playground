/** Optional metadata: legacy saved comparisons retain their arithmetic.
 * CPF tables for 2026 and announced 2027; later years hold 2027 rules.
 * Sources: https://www.cpf.gov.sg/content/dam/web/employer/employer-obligations/documents/CPFcontributionratesfrom1Jan2026.pdf
 * https://www.cpf.gov.sg/service/sfc/servlet.shepherd/document/download/069IW00000DZMxZYAX
 * https://www.cpf.gov.sg/content/dam/web/employer/employer-obligations/documents/jan2027cpfcontributionrates.pdf
 * https://www.cpf.gov.sg/content/dam/web/employer/employer-obligations/documents/jan2027cpfallocationrates.pdf
 */
import { addMonths, isRealDay } from "@/lib/dates";
import type { Residency } from "@/lib/housing";

export const CPF_PR_RULES = "2026-2027-pr-v2";
export const CPF_RULES = ["2026-2027-v1", CPF_PR_RULES] as const;
export const GUIDANCE_LIMITS = { lease_start: [1800, 2200], lease_term: [1, 999],
  salary: [0, 1_000_000], age: [16, 100], retirement_age: [16, 100], cpf_limit: [0, 100_000_000] } as const;
const validDay = (value: unknown): value is string => {
  try { return isRealDay(value); } catch { return false; }
};

export type HousingGuidance = {
  version: 1;
  cpf_rules: (typeof CPF_RULES)[number];
  pr_since: string | null;
  cpf_scheme: "graduated" | "full";
  as_of: string;
  confirmed: boolean;
  annual_value_auto: boolean;
  tenure: "unknown" | "freehold" | "leasehold";
  lease_start: number | null;
  lease_term: number;
  cpf_mode: "manual" | "salary" | "none";
  salary: number | null;
  age: number | null;
  retirement_age: number;
  cpf_eligible: boolean;
  /** Official housing usage limit where required; null means not verified. */
  cpf_limit: number | null;
};
export function newGuidance(asOf: string): HousingGuidance {
  return { version: 1, cpf_rules: CPF_PR_RULES, pr_since: null, cpf_scheme: "graduated", as_of: asOf, annual_value_auto: true, confirmed: false, tenure: "unknown", lease_start: null, lease_term: 99,
    cpf_mode: "none", salary: null, age: null, retirement_age: 65,
    cpf_eligible: false, cpf_limit: null };
}
export function parseGuidance(raw: unknown): HousingGuidance {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) throw new Error("guidance must be an object");
  const given = raw as Record<string, unknown>;
  if (!validDay(given.as_of)) throw new Error("Invalid assessment date");
  const out = newGuidance(given.as_of);
  if ((given.version !== undefined && given.version !== 1) || (given.cpf_rules !== undefined && !CPF_RULES.some(v => v === given.cpf_rules))) throw new Error("Unsupported housing rule version");
  // Unversioned older JSON also retains its full-rate assumption.
  out.cpf_rules = (given.cpf_rules ?? (given.pr_since !== undefined || given.cpf_scheme !== undefined ? CPF_PR_RULES : "2026-2027-v1")) as HousingGuidance["cpf_rules"];
  out.cpf_scheme = out.cpf_rules === "2026-2027-v1" ? "full" : "graduated";
  if (given.pr_since !== undefined && given.pr_since !== null) {
    if (!validDay(given.pr_since) || given.pr_since > out.as_of) throw new Error("PR date must be a real date on or before the assessment date");
    out.pr_since = given.pr_since;
  }
  for (const [key, options] of [["tenure", ["unknown", "freehold", "leasehold"]], ["cpf_mode", ["manual", "salary", "none"]], ["cpf_scheme", ["graduated", "full"]]] as const) {
    if (given[key] !== undefined) {
      if (!options.some(v => v === given[key])) throw new Error(`Invalid ${key}`);
      Object.assign(out, { [key]: given[key] });
    }
  }
  for (const key of ["confirmed", "cpf_eligible", "annual_value_auto"] as const) {
    if (given[key] !== undefined) {
      if (typeof given[key] !== "boolean") throw new Error(`Invalid ${key}`);
      out[key] = given[key];
    }
  }
  // A key not named here -- build_year, kept by comparisons saved before it was
  // dropped -- is passed over.
  for (const [key, [min,max]] of Object.entries(GUIDANCE_LIMITS)) {
    const v = given[key];
    if (v === undefined) continue;
    if (v === null && !["lease_term", "retirement_age"].includes(key)) { Object.assign(out, { [key]: null }); continue; }
    if (typeof v !== "number" || !Number.isFinite(v) || v < min || v > max || (!["salary", "cpf_limit"].includes(key) && !Number.isInteger(v))) throw new Error(`Invalid ${key}`);
    Object.assign(out, { [key]: v });
  }
  return out;
}
/** Year precision is deliberately explicit: expiry is 1 January start+term. */
export function remainingLease(g: HousingGuidance, at = g.as_of): number | null {
  if (g.tenure !== "leasehold" || g.lease_start === null) return null;
  const years = (Date.UTC(g.lease_start + g.lease_term, 0, 1) - Date.parse(at)) / (365.2425 * 86400000);
  return Number.isFinite(years) ? Math.max(0, years) : null;
}
export function leaseFactor(g: HousingGuidance | undefined, month: number): number {
  const left = g ? remainingLease(g) : null;
  if (left === null) return 1;
  if (left <= 0) return 0;
  const remaining = Math.max(0, left - month / 12);
  // Discounted right-to-occupy at a fixed 3%, normalized to today's price.
  // An illustrative assumption, not an official valuation or Bala table.
  return -Math.expm1(-0.03 * remaining) / -Math.expm1(-0.03 * left);
}
export function estimatedOa(salary: number, age: number, year = 2026, prYear: 1 | 2 | 3 = 3): number {
  const wages = Math.min(8000, Math.max(0, salary));
  if (wages <= 50) return 0;
  const future = year >= 2027;
  const fullBands = age <= 55 ? [0.17, 0.20] : age <= 60 ? (future ? [0.165,0.19] : [0.16,0.18]) : age <= 65 ? (future ? [0.13,0.13] : [0.125,0.125]) : age <= 70 ? [0.09,0.075] : [0.075,0.05];
  // Published G/G rates are unchanged in 2027. Full rates still depend on age/year.
  const bands = prYear === 1 ? (age <= 60 ? [0.04,0.05] : [0.035,0.05])
    : prYear === 2 ? (age <= 55 ? [0.09,0.15] : age <= 60 ? [0.06,0.125] : age <= 65 ? [0.035,0.075] : [0.035,0.05]) : fullBands;
  const employee = wages <= 500 ? 0 : wages <= 750 ? bands[1] * 3 * (wages - 500) : wages * bands[1];
  const total = Math.round(wages * bands[0] + employee);
  const allocation = age <= 35 ? [0.1621,0.2162] : age <= 45 ? [0.1891,0.2432] : age <= 50 ? [0.2162,0.2702] : age <= 55 ? [0.3108,0.2837] : age <= 60 ? (future ? [0.3661,0.2957] : [0.3382,0.3088]) : age <= 65 ? (future ? [0.4615,0.4038] : [0.44,0.42]) : age <= 70 ? [0.303,0.6363] : [0.08,0.84];
  // MA and SA/RA rounded to cents; OA receives the remainder.
  return Math.round(total * 100 - Math.round(total * allocation[0] * 100) - Math.round(total * allocation[1] * 100)) / 100;
}
/** Anniversary-month wages keep the old rate. The next month changes stage.
 * https://www.cpf.gov.sg/service/article/how-do-i-determine-the-year-of-my-singapore-permanent-resident-status-for-the-purpose-of-cpf-contributions */
export function prContributionYear(since: string | null, at: string): 0 | 1 | 2 | 3 {
  if (!validDay(since) || !validDay(at) || at < since) return 0;
  const serial = (day: string) => Number(day.slice(0,4)) * 12 + Number(day.slice(5,7));
  const months = serial(at) - serial(since);
  return months <= 12 ? 1 : months <= 24 ? 2 : 3;
}

export function salaryOa(g: HousingGuidance, month = 0, residency: Residency = "citizen"): number {
  if (!g.cpf_eligible || g.salary === null || g.age === null || residency === "foreigner") return 0;
  const age = g.age + Math.floor(month / 12);
  if (age >= g.retirement_age) return 0;
  const at = addMonths(g.as_of, month);
  const year = Number(at.slice(0,4));
  if (residency !== "pr" || g.cpf_rules === "2026-2027-v1") return estimatedOa(g.salary, age, year);
  const stage = prContributionYear(g.pr_since, at);
  if (!stage) return 0;
  // For the conversion month, calendar-day proration is a labeled estimate of
  // wages earned while PR; an actual payroll calculation can use manual OA.
  const since = g.pr_since!;
  const days = new Date(Date.UTC(year, Number(at.slice(5,7)), 0)).getUTCDate();
  const wages = since.slice(0,7) === at.slice(0,7) ? g.salary * (days - Number(since.slice(8)) + 1) / days : g.salary;
  return estimatedOa(wages, age, year, g.cpf_scheme === "full" ? 3 : stage);
}
export function cpfHousingLimit(g: HousingGuidance, price: number): number {
  if (g.cpf_mode === "none") return 0;
  const left = remainingLease(g);
  if (left !== null && left <= 20) return 0;
  if (g.cpf_limit !== null) return g.cpf_limit;
  // Conservative: no CPF housing usage without a confirmed lease or age.
  if (g.tenure === "unknown" || (g.tenure === "leasehold" && (left === null || g.age === null || left + g.age < 95))) return 0;
  return price; // valuation/purchase price usage limit; no assumed 120% extension.
}
