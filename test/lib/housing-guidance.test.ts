import { describe, expect, it } from "vitest";
import { DEFAULT_INPUTS, parseInputs, rentOrBuy } from "@/lib/housing";

describe("guided housing comparisons", () => {
  it("supports a 99-year holding period independently of the mortgage", () => {
    expect(parseInputs({ years: 99, loan_years: 25 }).years).toBe(99);
  });
  it("retains tenure and sets an expired home to zero, including replacement rent", () => {
    const inputs = parseInputs({ ...DEFAULT_INPUTS, years: 5, growth: 0, loan_share: 0,
      guidance: { as_of: "2026-10-05", tenure: "leasehold", lease_start: 1930, lease_term: 99 } });
    const result = rentOrBuy(inputs);
    expect(result.years[1].home_value).toBeLessThan(DEFAULT_INPUTS.price);
    expect(result.years[4].home_value).toBe(0);
    expect(result.years[4].own_monthly).toBe(result.years[4].rent_monthly);
    expect(JSON.stringify(inputs)).toContain("lease_start");
  });
});

import { comparisonReady, readInputs } from "@/lib/housing";
import { cpfHousingLimit, estimatedOa, leaseFactor, newGuidance, remainingLease, salaryOa } from "@/lib/housing-guidance";

describe("CPF salary estimates and usage", () => {
  it("allocates only OA, caps ordinary wages and handles low wages and age bands", () => {
    expect(estimatedOa(6000, 30)).toBe(1380.18);
    expect(estimatedOa(10000, 30)).toBe(estimatedOa(8000, 30));
    expect(estimatedOa(50, 30)).toBe(0);
    expect(estimatedOa(6000, 57, 2027)).toBe(720.37);
    expect(estimatedOa(6000, 63, 2027)).toBe(210.13);
    expect(estimatedOa(500, 30)).toBe(52.84);
    expect(estimatedOa(6000, 60)).toBeLessThan(estimatedOa(6000, 30));
  });
  it("changes OA as the buyer ages, stops at retirement and requires eligibility", () => {
    const g = { ...newGuidance("2026-10-05"), cpf_mode: "salary" as const, salary: 6000, age: 55, cpf_eligible: true };
    expect(salaryOa(g, 12)).toBeLessThan(salaryOa(g, 0));
    expect(salaryOa(g, 120)).toBe(0);
    expect(salaryOa({ ...g, age:57 }, 3)).toBe(estimatedOa(6000, 57, 2027));
    expect(salaryOa({ ...g, cpf_eligible: false })).toBe(0);
    const inputs = { ...DEFAULT_INPUTS, cpf_balance: 100000, cpf_monthly: 9999, guidance: { ...g, tenure: "freehold" as const } };
    const result = rentOrBuy(inputs);
    const manual = rentOrBuy({ ...inputs, guidance: { ...inputs.guidance, cpf_mode: "manual" }, cpf_monthly: 0 });
    expect(result.years[1].rent_net_worth).toBeGreaterThan(manual.years[1].rent_net_worth);
    expect(result.years[1].rent_net_worth - manual.years[1].rent_net_worth).toBeLessThan(20000);
  });
  it("does not spend CPF without a verified lease allowance or beyond the limit", () => {
    const g = { ...newGuidance("2026-10-05"), cpf_mode: "manual" as const, age: 30 };
    expect(cpfHousingLimit(g, 600000)).toBe(0);
    expect(cpfHousingLimit({ ...g, tenure: "leasehold", lease_start: 2000 }, 600000)).toBe(600000);
    expect(cpfHousingLimit({ ...g, tenure: "leasehold", lease_start: 1980 }, 600000)).toBe(0);
    expect(cpfHousingLimit({ ...g, tenure: "leasehold", lease_start: 1940, cpf_limit: 50000 },600000)).toBe(0);
    const limited = rentOrBuy({ ...DEFAULT_INPUTS, cpf_balance: 100000, cpf_monthly: 2000, guidance: { ...g, cpf_limit: 1000 } });
    expect(limited.upfront.from_cpf).toBe(1000);
    expect(limited.years[1].cpf_refund).toBeCloseTo(1025, 0);
    const none = rentOrBuy({ ...DEFAULT_INPUTS, cpf_balance: 100000, cpf_monthly: 2000, guidance: { ...g, cpf_mode: "none" } });
    expect(none.upfront.from_cpf).toBe(0);
    expect(none.years[1].cpf_refund).toBe(0);
  });
});

describe("required facts and saved metadata", () => {
  it("lets a verified IRAS AV override the rough rent-derived estimate", () => {
    const guide = { ...newGuidance("2026-10-05"), confirmed:true };
    const i = { ...DEFAULT_INPUTS, rent:6000, annual_value:0, guidance:guide };
    const rough = rentOrBuy(i);
    const verified = rentOrBuy({ ...i, guidance:{ ...guide, annual_value_auto:false } });
    expect(rough.years[1].own_monthly).toBeGreaterThan(verified.years[1].own_monthly);
    expect(rough.years[1].own_monthly).toBe(rentOrBuy({ ...i, annual_value:72000, guidance:{ ...guide, annual_value_auto:false } }).years[1].own_monthly);
  });
  it("keeps dates reproducible, and reads a comparison saved with a TOP year without it", () => {
    const g = { ...newGuidance("2026-10-05"), tenure: "leasehold" as const, lease_start: 2000 };
    const inputs = parseInputs({ guidance:g });
    expect(inputs.guidance).toEqual(g);
    expect(readInputs({ ...inputs, price: NaN }).guidance).toEqual(g);
    // The TOP year was asked once and counted for nothing: kept from then, it is passed over.
    expect(parseInputs({ guidance: { ...g, build_year: 2017 } }).guidance).toEqual(g);
    expect(remainingLease(g, "2027-10-05")).toBeLessThan(remainingLease(g)!);
    expect(leaseFactor(g, 0)).toBe(1);
    expect(leaseFactor(g, 100 * 12)).toBe(0);
    expect(leaseFactor({ ...g, tenure:"freehold" }, 99*12)).toBe(1);
  });
  it("requires confirmation and valid amounts; long horizons require known tenure", () => {
    const base = { ...DEFAULT_INPUTS, guidance: newGuidance("2026-10-05") };
    expect(comparisonReady(base)).toBe(false);
    expect(comparisonReady({ ...base, guidance: { ...base.guidance, confirmed: true } })).toBe(true);
    expect(comparisonReady({ ...base, price:NaN, guidance:{ ...base.guidance, confirmed:true } })).toBe(false);
    expect(comparisonReady({ ...base, years:99, guidance:{ ...base.guidance, confirmed:true } })).toBe(false);
    expect(comparisonReady({ ...base, years:99, guidance:{ ...base.guidance, confirmed:true, tenure:"freehold" } })).toBe(true);
    expect(comparisonReady({ ...base, guidance:{ ...base.guidance, confirmed:true, tenure:"leasehold" } })).toBe(false);
    expect(comparisonReady({ ...base, residency:"foreigner", guidance:{ ...base.guidance, confirmed:true, cpf_mode:"salary", cpf_eligible:true, salary:6000, age:30 } })).toBe(false);
  });
  it("rejects malformed profile values rather than quietly using default identities or dates", () => {
    for (const v of [{as_of:"2026-02-31"}, {lease_term:0}, {age:-1}, {salary:null, cpf_mode:"bad"}, {cpf_limit:-1}, {confirmed:"yes"}, {lease_start:2010.5}]) {
      expect(()=>parseInputs({guidance:{...newGuidance("2026-10-05"),...v}})).toThrow();
    }
    expect(parseInputs({}).guidance).toBeUndefined();
  });
});
