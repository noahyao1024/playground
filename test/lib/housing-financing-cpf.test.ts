import { describe, expect, it } from "vitest";
import { bankFinancing } from "@/lib/housing-financing";
import { CpfHousingLedger, CpfOaLedger } from "@/lib/housing-cpf";
import { DEFAULT_INPUTS, parseInputs, rentOrBuy } from "@/lib/housing";
import { leaseFactor, newGuidance } from "@/lib/housing-guidance";

const bank = { ...DEFAULT_INPUTS, residency: "citizen" as const, kind: "private" as const, loan_type: "bank" as const,
  price: 1_000_000, loan_years: 30, cpf_balance: 800_000, buy_costs: 0, renovation: 0,
  financing: { outstanding_loans: 0 as const, borrower_age: 30 } };

describe("bank loan eligibility and minimum cash", () => {
  it.each([
    [0,30,30,75,5], [0,35,30,75,5], [0,35.1,30,55,10], [0,30,31,55,10],
    [1,30,30,45,25], [1,40,30,25,25], [2,30,30,35,25], [2,40,30,15,25],
  ])("%i outstanding loans, age %s, term %i: LTV %i and cash %i", (outstanding,age,term,ltv,cash) => {
    const i = parseInputs({ ...bank, loan_share: ltv, loan_years: term, financing: { outstanding_loans: outstanding, borrower_age: age } });
    expect(bankFinancing(i)).toMatchObject({ max_ltv: ltv, minimum_cash_percent: cash, within_limits: true });
    expect(rentOrBuy(i).upfront.from_cash).toBe(bank.price * cash / 100);
  });
  it("does not infer the lower LTV band from a voluntary lower loan share, or outstanding loans from ABSD count", () => {
    expect(rentOrBuy({ ...bank, loan_share: 55 }).upfront.from_cash).toBe(50_000);
    expect(bankFinancing({ ...bank, nth: 3 })).toMatchObject({ outstanding_loans: 0, max_ltv: 75 });
  });
  it("requires 10% cash in the lower first-loan band even with abundant OA, and flags an excessive requested loan", () => {
    const i = { ...bank, financing: { outstanding_loans: 0 as const, borrower_age: 40 }, loan_share: 55 };
    expect(rentOrBuy(i).upfront.from_cash).toBe(100_000);
    expect(bankFinancing({ ...i, loan_share: 75 }).within_limits).toBe(false);
    expect(rentOrBuy({ ...i, loan_share: 75 }).notes.join(" ")).toContain("超出");
  });
  it("uses separate bank-assessed age for joint borrowing, conservative unknown ages, and HDB bank term limits", () => {
    const g = { ...newGuidance("2026-01-01"), age: 40 };
    expect(bankFinancing({ ...bank, guidance: g }).max_ltv).toBe(75);
    expect(bankFinancing({ ...bank, financing: undefined, guidance: g })).toMatchObject({ max_ltv: 55, age_assumption: "single_borrower_from_guidance" });
    expect(bankFinancing({ ...bank, financing: undefined })).toMatchObject({ max_ltv: 55, minimum_cash_percent: 10, age_assumption: "unknown_conservative" });
    expect(bankFinancing({ ...bank, kind: "hdb", loan_years: 26 })).toMatchObject({ max_ltv: 55, minimum_cash_percent: 10, term_limit: 30 });
    expect(bankFinancing({ ...bank, kind: "hdb", loan_years: 31 }).within_limits).toBe(false);
  });
  it("applies no minimum bank cash when paying without a loan or using an HDB loan", () => {
    expect(rentOrBuy({ ...bank, loan_share: 0, cpf_balance: 2_000_000 }).upfront.from_cash).toBe(0);
    expect(rentOrBuy({ ...bank, loan_type: "hdb" }).upfront.from_cash).toBe(0);
  });
  it("validates financing facts rather than guessing", () => {
    for (const financing of [[],{outstanding_loans:3},{outstanding_loans:"1"},{borrower_age:NaN},{borrower_age:17}]) expect(()=>parseInputs({financing})).toThrow();
  });
});

describe("CPF monthly accrual with calendar-year credit", () => {
  it("credits once at year end; interest does not earn interest before credit", () => {
    const oa = new CpfOaLedger(100_000);
    for (let m=1;m<=11;m++) oa.month(0,0,2.5,m);
    expect(oa.balance).toBe(100_000);
    expect(oa.pending).toBeCloseTo(100_000*.025*11/12,9);
    oa.month(0,0,2.5,12);
    expect(oa.balance).toBe(102_500);
    expect(oa.pending).toBe(0);
    for (let m=1;m<=12;m++) oa.month(0,0,2.5,m);
    expect(oa.balance).toBe(105_062.5);
  });
  it("starts deposits earning next month and removes withdrawals from the month's interest base", () => {
    const oa = new CpfOaLedger(10_000);
    oa.month(1_000,3_000,2.4,1);
    expect(oa.balance).toBe(8_000);
    expect(oa.pending).toBe(14); // 7,000 × .024/12, not 8,000 or 10,000
    oa.month(1_000,0,2.4,2);
    expect(oa.pending).toBe(30);
  });
  it("does not spend uncredited interest; December's credit can fund January", () => {
    const oa = new CpfOaLedger(0);
    oa.pending=100;
    expect(oa.month(0,200,2.5,12)).toBe(0);
    expect(oa.balance).toBe(100);
    expect(oa.month(0,200,2.5,1)).toBe(100);
    expect(oa.balance).toBe(0);
  });
  it("compounds housing accrued interest annually, with new withdrawals earning no interest on interest within the year", () => {
    const housing = new CpfHousingLedger(10_000);
    for (let m=1;m<=12;m++) housing.month(100,2.4,m);
    const interest = (12*10_000 + 100*78)*.024/12;
    expect(housing.principal).toBe(11_200);
    expect(housing.interest).toBeCloseTo(interest,8);
    for (let m=1;m<=12;m++) housing.month(0,2.4,m);
    expect(housing.refund).toBeCloseTo(Math.round((11_200+interest)*1.024*100)/100,8);
  });
  it("uses the saved start month, and exposes pending interest separately in net worth and refunds", () => {
    const i = { ...DEFAULT_INPUTS, loan_share: 0, years: 1, cpf_balance: 10_000, cpf_monthly: 0,
      guidance: { ...newGuidance("2026-10-06"), tenure: "freehold" as const, cpf_mode: "none" as const } };
    const year = rentOrBuy(i).years[1];
    const credited = 10_000 + Math.round(10_000*.025*3/12*100)/100;
    expect(year.cpf_rent_balance).toBe(credited);
    expect(year.cpf_rent_pending_interest).toBe(Math.round(credited*.025*9/12*100)/100);
    expect(year.cpf_buy_balance).toBe(year.cpf_rent_balance);
    expect(year.cpf_refund).toBe(0);
  });
});

describe("editable lease decay assumption", () => {
  it("uses an annual effective discount, provides the linear 0% limit and keeps expiry at zero", () => {
    const g = { ...newGuidance("2026-01-01"), tenure: "leasehold" as const, lease_start: 2026, lease_term: 10 };
    expect(leaseFactor(g,0)).toBe(1);
    const left = (Date.UTC(2036,0,1)-Date.UTC(2026,0,1))/(365.2425*86400000);
    expect(leaseFactor(g,60)).toBeCloseTo((1-1.03**-(left-5))/(1-1.03**-left),12);
    expect(leaseFactor({...g,lease_discount_rate:0},60)).toBeCloseTo((left-5)/left,12);
    expect(leaseFactor({...g,lease_discount_rate:6},60)).toBeGreaterThan(leaseFactor(g,60));
    expect(leaseFactor(g,121)).toBe(0);
    expect(parseInputs({guidance:{...g,lease_discount_rate:2.5}}).guidance?.lease_discount_rate).toBe(2.5);
    for (const rate of [null,-1,21,NaN]) expect(()=>parseInputs({guidance:{...g,lease_discount_rate:rate}})).toThrow();
  });
});
