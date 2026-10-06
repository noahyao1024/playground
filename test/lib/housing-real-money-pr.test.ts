import { describe, expect, it } from "vitest";
import { DEFAULT_INPUTS, comparisonReady, inTodaysMoney, parseInputs, rentOrBuy } from "@/lib/housing";
import { CPF_PR_RULES, estimatedOa, newGuidance, prContributionYear, salaryOa } from "@/lib/housing-guidance";

describe("PR-date CPF estimates", () => {
  it("uses graduated total contributions and allocates only the OA share", () => {
    expect(estimatedOa(6000, 30, 2026, 1)).toBe(335.72);
    expect(estimatedOa(6000, 30, 2026, 2)).toBe(895.25);
    expect(estimatedOa(6000, 30, 2026, 3)).toBe(1380.18);
  });
  it("switches after the anniversary month, including the complete projection", () => {
    const g = { ...newGuidance("2026-01-15"), cpf_mode:"salary" as const, cpf_eligible:true, salary:6000, age:30, pr_since:"2025-01-15" };
    expect(salaryOa(g, 0, "pr")).toBe(335.72);
    expect(salaryOa(g, 1, "pr")).toBe(895.25);
    expect(salaryOa(g, 12, "pr")).toBe(895.25);
    expect(salaryOa(g, 13, "pr")).toBe(1380.18);
    const input = parseInputs({ ...DEFAULT_INPUTS, guidance:g });
    const projection = rentOrBuy(input);
    const full = rentOrBuy({ ...input, guidance:{ ...input.guidance!, cpf_scheme:"full" } });
    expect(projection.years[1].rent_net_worth).toBeLessThan(full.years[1].rent_net_worth);
    expect(input.guidance).toMatchObject({pr_since:"2025-01-15"});
  });
  it("requires a valid PR date for new salary-based PR scenarios", () => {
    const g = { ...newGuidance("2026-10-06"), cpf_mode:"salary" as const, cpf_eligible:true, confirmed:true, salary:6000, age:30 };
    expect(comparisonReady({ ...DEFAULT_INPUTS, guidance:g })).toBe(false);
    expect(comparisonReady({ ...DEFAULT_INPUTS, guidance:{...g,pr_since:"2025-01-15"} })).toBe(true);
    expect(()=>parseInputs({guidance:{...g,pr_since:"2026-02-30"}})).toThrow();
  });
});

describe("today's money", () => {
  it("deflates compounded future money without changing the winner or nominal projection", () => {
    expect(inTodaysMoney(378000, 2, 15)).toBeCloseTo(280859.57, 2);
    expect(inTodaysMoney(-378000, 2, 15)).toBeLessThan(0);
    expect(inTodaysMoney(5000, 0, 15)).toBe(5000);
    expect(inTodaysMoney(5000, 2, 0)).toBe(5000);
    expect(inTodaysMoney(5000, -2, 15)).toBeGreaterThan(5000);
  });
});

describe("PR boundaries and saved rules", () => {
  it("keeps both anniversary months at their prior stage, including leap years", () => {
    const since = "2024-02-29";
    expect(prContributionYear(since,"2024-02-28")).toBe(0);
    expect(prContributionYear(since,"2025-02-28")).toBe(1);
    expect(prContributionYear(since,"2025-03-01")).toBe(2);
    expect(prContributionYear(since,"2026-02-28")).toBe(2);
    expect(prContributionYear(since,"2026-03-01")).toBe(3);
    expect(prContributionYear(null,"2026-03-01")).toBe(0);
  });
  it("uses graduated senior and low-wage bands as well as the wage cap", () => {
    expect(estimatedOa(6000, 57, 2026, 2)).toBe(391.83);
    expect(estimatedOa(6000, 63, 2026, 1)).toBe(71.4);
    expect(estimatedOa(6000, 63, 2026, 2)).toBe(92.4);
    expect(estimatedOa(6000, 66, 2026, 2)).toBe(30.96);
    expect(estimatedOa(6000, 57, 2027, 2)).toBe(375.4);
    expect(estimatedOa(6000, 63, 2027, 2)).toBe(88.9);
    expect(estimatedOa(10000, 30, 2026, 1)).toBe(estimatedOa(8000, 30, 2026, 1));
    expect(estimatedOa(50, 30, 2026, 1)).toBe(0);
    expect(estimatedOa(500, 30, 2026, 1)).toBe(12.44);
    expect(estimatedOa(600, 30, 2026, 2)).toBe(61.55);
  });
  it("labels and prorates conversion-month wages; full-rate agreements and citizens use full bands", () => {
    const g = { ...newGuidance("2026-01-31"), cpf_mode:"salary" as const, cpf_eligible:true, salary:6200, age:30, pr_since:"2026-01-16" };
    expect(salaryOa(g,0,"pr")).toBe(estimatedOa(3200,30,2026,1)); // 16 out of 31 calendar days
    expect(salaryOa(g,1,"pr")).toBe(estimatedOa(6200,30,2026,1));
    expect(salaryOa({ ...g,cpf_scheme:"full" },1,"pr")).toBe(estimatedOa(6200,30,2026));
    expect(salaryOa(g,0,"citizen")).toBe(estimatedOa(6200,30,2026));
    expect(salaryOa(g,0,"foreigner")).toBe(0);
  });
  it("reads old full-rate scenarios without silently changing their forecasts or dropping guidance", () => {
    const raw = { as_of:"2026-10-06", cpf_rules:"2026-2027-v1", cpf_mode:"salary", salary:6000, age:30, cpf_eligible:true, confirmed:true };
    const old = parseInputs({ guidance:raw });
    expect(old.guidance!.cpf_rules).toBe("2026-2027-v1");
    expect(comparisonReady(old)).toBe(true);
    expect(salaryOa(old.guidance!,0,"pr")).toBe(1380.18);
    expect(parseInputs({ guidance:{as_of:"2026-10-06"} }).guidance!.cpf_rules).toBe("2026-2027-v1");
    expect(parseInputs({ guidance:{as_of:"2026-10-06",pr_since:"2025-01-15"} }).guidance!.cpf_rules).toBe(CPF_PR_RULES);
    expect(()=>parseInputs({guidance:{...raw,cpf_rules:"2026-2027-unknown"}})).toThrow();
    expect(()=>parseInputs({guidance:{...newGuidance("2026-10-06"),pr_since:"2026-10-07"}})).toThrow();
    expect(()=>parseInputs({guidance:{...newGuidance("2026-10-06"),cpf_scheme:"random"}})).toThrow();
  });
});
