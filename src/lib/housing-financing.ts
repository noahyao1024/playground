import type { ScenarioInputs } from "./housing";

export type HousingFinancing = {
  /** Outstanding housing loans, independent of the ABSD property count. */
  outstanding_loans: 0 | 1 | 2;
  /** Bank-assessed age, including the bank's joint-borrower assessment. */
  borrower_age: number | null;
};
export const DEFAULT_FINANCING: HousingFinancing = { outstanding_loans: 0, borrower_age: null };
export function parseFinancing(raw: unknown): HousingFinancing {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) throw new Error("financing must be an object");
  const given = raw as Record<string, unknown>;
  const out = { ...DEFAULT_FINANCING };
  if (given.outstanding_loans !== undefined) {
    if (![0, 1, 2].includes(given.outstanding_loans as number)) throw new Error("outstanding_loans must be 0, 1 or 2 (two or more)");
    out.outstanding_loans = given.outstanding_loans as HousingFinancing["outstanding_loans"];
  }
  if (given.borrower_age !== undefined && given.borrower_age !== null) {
    const age = given.borrower_age;
    if (typeof age !== "number" || !Number.isFinite(age) || age < 18 || age > 100) throw new Error("borrower_age must be between 18 and 100, or null");
    out.borrower_age = age;
  }
  return out;
}

/** MoneySense / MAS bank-loan bands. Choosing to borrow less does not change
 * eligibility or the minimum cash percentage. No claim of TDSR approval.
 * https://www.moneysense.gov.sg/buying-a-property-how-much-can-you-afford/ */
export function bankFinancing(i: ScenarioInputs) {
  const f = i.financing ?? DEFAULT_FINANCING;
  const age = f.borrower_age ?? i.guidance?.age ?? null;
  const termLimit = i.kind === "hdb" ? 25 : 30;
  const lower = i.loan_years > termLimit || age === null || age + i.loan_years > 65;
  const maxLtv = f.outstanding_loans === 0 ? (lower ? 55 : 75) : f.outstanding_loans === 1 ? (lower ? 25 : 45) : (lower ? 15 : 35);
  const cashPercent = f.outstanding_loans > 0 ? 25 : lower ? 10 : 5;
  return {
    outstanding_loans: f.outstanding_loans, borrower_age: age,
    age_assumption: f.borrower_age !== null ? "bank_assessed" : age !== null ? "single_borrower_from_guidance" : "unknown_conservative",
    lower_band: lower, max_ltv: maxLtv, minimum_cash_percent: cashPercent,
    term_limit: i.kind === "hdb" ? 30 : 35,
    within_limits: i.loan_share <= maxLtv && i.loan_years <= (i.kind === "hdb" ? 30 : 35),
    source: "https://www.moneysense.gov.sg/buying-a-property-how-much-can-you-afford/",
  };
}
