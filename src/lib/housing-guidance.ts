/** Optional metadata: legacy saved comparisons retain their arithmetic.
 * CPF tables for 2026 and announced 2027; later years hold 2027 rules.
 * Sources: https://www.cpf.gov.sg/content/dam/web/employer/employer-obligations/documents/CPFcontributionratesfrom1Jan2026.pdf
 * https://www.cpf.gov.sg/service/sfc/servlet.shepherd/document/download/069IW00000DZMxZYAX
 * https://www.cpf.gov.sg/content/dam/web/employer/employer-obligations/documents/jan2027cpfcontributionrates.pdf
 * https://www.cpf.gov.sg/content/dam/web/employer/employer-obligations/documents/jan2027cpfallocationrates.pdf
 */
export type HousingGuidance = {
  version: 1;
  cpf_rules: "2026-2027-v1";
  as_of: string;
  confirmed: boolean;
  annual_value_auto: boolean;
  tenure: "unknown" | "freehold" | "leasehold";
  lease_start: number | null;
  lease_term: number;
  build_year: number | null;
  cpf_mode: "manual" | "salary" | "none";
  salary: number | null;
  age: number | null;
  retirement_age: number;
  cpf_eligible: boolean;
  /** Official housing usage limit where required; null means not verified. */
  cpf_limit: number | null;
};
export function newGuidance(asOf: string): HousingGuidance {
  return { version: 1, cpf_rules: "2026-2027-v1", as_of: asOf, annual_value_auto: true, confirmed: false, tenure: "unknown", lease_start: null, lease_term: 99,
    build_year: null, cpf_mode: "none", salary: null, age: null, retirement_age: 65,
    cpf_eligible: false, cpf_limit: null };
}
export function parseGuidance(raw: unknown): HousingGuidance {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) throw new Error("guidance must be an object");
  const given = raw as Record<string, unknown>;
  if (typeof given.as_of !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(given.as_of) || new Date(given.as_of).toISOString().slice(0,10) !== given.as_of) throw new Error("Invalid assessment date");
  const out = newGuidance(given.as_of);
  if ((given.version !== undefined && given.version !== 1) || (given.cpf_rules !== undefined && given.cpf_rules !== out.cpf_rules)) throw new Error("Unsupported housing rule version");
  for (const [key, options] of [["tenure", ["unknown", "freehold", "leasehold"]], ["cpf_mode", ["manual", "salary", "none"]]] as const) {
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
  const bounds = { lease_start: [1800, 2200], lease_term: [1, 999], build_year: [1800, 2200],
    salary: [0, 1_000_000], age: [16, 100], retirement_age: [16, 100], cpf_limit: [0, 100_000_000] } as const;
  for (const [key, [min,max]] of Object.entries(bounds)) {
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
export function estimatedOa(salary: number, age: number, year = 2026): number {
  const wages = Math.min(8000, Math.max(0, salary));
  if (wages <= 50) return 0;
  const future = year >= 2027;
  const bands = age <= 55 ? [0.17, 0.20] : age <= 60 ? (future ? [0.165,0.19] : [0.16,0.18]) : age <= 65 ? (future ? [0.13,0.13] : [0.125,0.125]) : age <= 70 ? [0.09,0.075] : [0.075,0.05];
  const employee = wages <= 500 ? 0 : wages <= 750 ? bands[1] * 3 * (wages - 500) : wages * bands[1];
  const total = Math.round(wages * bands[0] + employee);
  const allocation = age <= 35 ? [0.1621,0.2162] : age <= 45 ? [0.1891,0.2432] : age <= 50 ? [0.2162,0.2702] : age <= 55 ? [0.3108,0.2837] : age <= 60 ? (future ? [0.3661,0.2957] : [0.3382,0.3088]) : age <= 65 ? (future ? [0.4615,0.4038] : [0.44,0.42]) : age <= 70 ? [0.303,0.6363] : [0.08,0.84];
  // MA and SA/RA rounded to cents; OA receives the remainder.
  return Math.round(total * 100 - Math.round(total * allocation[0] * 100) - Math.round(total * allocation[1] * 100)) / 100;
}
export function salaryOa(g: HousingGuidance, month = 0): number {
  if (!g.cpf_eligible || g.salary === null || g.age === null) return 0;
  const age = g.age + Math.floor(month / 12);
  const year = Number(g.as_of.slice(0,4)) + Math.floor((Number(g.as_of.slice(5,7)) - 1 + month) / 12);
  return age >= g.retirement_age ? 0 : estimatedOa(g.salary, age, year);
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
