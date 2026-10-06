import { describe, expect, it } from "vitest";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { DEFAULT_INPUTS, rentOrBuy, ownerOccupierTax } from "@/lib/housing";
import { newGuidance } from "@/lib/housing-guidance";
import { breakdownAtYear } from "@/lib/housing-breakdown";
import { PkDetails } from "@/components/housing/pk-details";
import { cumulativeCostRows } from "@/lib/housing-charts";

const inputs = () => ({ ...DEFAULT_INPUTS, residency: "citizen" as const, price: 500000, rent: 2200, loan_years: 25, loan_rate: 0, spread: 0, loan_share: 75, maintenance: 0, upkeep: 0, annual_value: 0, buy_costs: 0, renovation: 0, sell_costs: 0, rent_costs: 0, growth: 0, rent_growth: 0, cost_growth: 0, invest_return: 6, cpf_balance: 0, cpf_monthly: 0, cpf_rate: 0, years: 2, financing: { outstanding_loans: 0 as const, borrower_age: 30 } });
describe("PK assets, cumulative flows and gap reconciliation", () => {
  it("separates contributions from compound investment gains, independently matching annuity arithmetic", () => {
    const i = inputs(), p = rentOrBuy(i), last = p.years.at(-1)!;
    const r = 1.06 ** (1 / 12) - 1;
    const buyerSavings = 2200 - 1250;
    const expectedBuy = buyerSavings * ((1 + r) ** 24 - 1) / r;
    expect(last.buy_investments).toBeCloseTo(expectedBuy, 2);
    expect(last.rent_investments).toBeCloseTo(p.upfront.from_cash * 1.06 ** 2, 2);
    expect(last.cumulative.buy_invested).toBe(buyerSavings * 24);
    expect(last.cumulative.buy_investment_gain).toBeCloseTo(expectedBuy - buyerSavings * 24, 2);
    expect(last.cumulative.rent_investment_gain).toBeCloseTo(p.upfront.from_cash * (1.06 ** 2 - 1), 2);
    expect(last.cumulative.mortgage_principal).toBe(30000);
    expect(last.cumulative.mortgage_principal + last.loan_balance).toBe(p.upfront.loan);
  });
  it("counts cumulative nominal mortgage interest, property tax and running costs, excluding principal", () => {
    const i = { ...inputs(), years: 3, loan_rate: 3, spread: 3, invest_return: 0, maintenance: 180, upkeep: 720, annual_value: 25000, rent_costs: 120 };
    const p = rentOrBuy(i), y = p.years.at(-1)!;
    expect(y.cumulative.maintenance).toBe(180 * 36);
    expect(y.cumulative.upkeep).toBe(720 * 3);
    expect(y.cumulative.property_tax).toBe(ownerOccupierTax(25000) * 3);
    expect(y.cumulative.mortgage_interest).toBeCloseTo(p.instalment * 36 - y.cumulative.mortgage_principal, 2);
    expect(y.own_spent).toBeCloseTo(p.upfront.bsd + y.cumulative.mortgage_interest + y.cumulative.maintenance + y.cumulative.upkeep + y.cumulative.property_tax, 2);
    expect(y.rent_spent).toBe(2200 * 36 + 120 * 3);
    const costs = breakdownAtYear(p, 3).cumulative.filter(row => row.kind === "cost").reduce((sum, row) => sum + row.buy, 0);
    expect(costs).toBeCloseTo(y.own_spent, 2);
  });
  it.each([0, 1, 2])("shows up-front expenses once and reconciles annual rows to cumulative rows: year %s", year => {
    const p = rentOrBuy(inputs()), d = breakdownAtYear(p, year);
    const annualBsd = d.annual.find(row => row.key === "bsd")!.buy;
    expect(annualBsd).toBe(year === 0 ? p.upfront.bsd : 0);
    expect(d.annual.find(row => row.key === "down_payment")!.buy).toBe(year === 0 ? p.upfront.down_payment : 0);
    const annual = Array.from({ length: year + 1 }, (_, n) => breakdownAtYear(p, n));
    for (const row of d.cumulative) {
      const buy = annual.reduce((sum, a) => sum + a.annual.find(r => r.key === row.key)!.buy, 0);
      expect(buy).toBeCloseTo(row.buy, 2);
    }
  });
  it.each([6, -8, 0])("reconciles every asset and gap component with CPF and lease expiry, even at %s%% returns", invest_return => {
    const i = { ...inputs(), years: 15, invest_return, growth: -1, rent_growth: 2, cost_growth: 2, maintenance: 180, upkeep: 720, cpf_balance: 40000, cpf_monthly: 850, cpf_rate: 2.5, sell_costs: 1.8, guidance: { ...newGuidance("2026-11-01"), tenure: "leasehold" as const, lease_start: 2020, lease_term: 12, cpf_mode: "manual" as const, cpf_eligible: true, cpf_limit: 200000, confirmed: true } };
    const p = rentOrBuy(i);
    for (const y of p.years) {
      const d = breakdownAtYear(p, y.year);
      expect(d.assets.buy.reduce((sum, a) => sum + a.amount, 0)).toBeCloseTo(y.buy_net_worth, 2);
      expect(d.assets.rent.reduce((sum, a) => sum + a.amount, 0)).toBeCloseTo(y.rent_net_worth, 2);
      expect(d.gap_bridge.reduce((sum, a) => sum + a.amount, 0)).toBeCloseTo(y.buy_net_worth - y.rent_net_worth, 2);
      expect(Math.abs(d.gap_bridge.find(a => a.key === "rounding")!.amount)).toBeLessThanOrEqual(0.05);
      expect(y.cumulative.buy_cash_paid + y.cumulative.buy_invested).toBeCloseTo(y.cumulative.cash_budget, 1);
      expect(y.cumulative.rent_cash_paid + y.cumulative.rent_invested).toBeCloseTo(y.cumulative.cash_budget, 1);
      expect(y.cpf_buy_balance + y.cpf_buy_pending_interest).toBeCloseTo(i.cpf_balance + y.cumulative.cpf_contributions + y.cumulative.buy_cpf_interest - y.cumulative.buy_cpf_paid, 1);
      expect(d.assets.buy.some(a => a.key === "cpf_refund")).toBe(false);
    }
    expect(p.years.at(-1)!.cumulative.replacement_rent).toBeGreaterThan(0);
    expect(p.years.at(-1)!.home_value).toBe(0);
  });
  it("renders the final-year drilldown, year selection and actual cumulative curve", () => {
    const i = inputs(), p = rentOrBuy(i);
    const html = renderToStaticMarkup(createElement(PkDetails, { inputs: i, result: p, year: 2, onYearChange: () => {} }));
    expect(html).toContain("housing-pk-details");
    expect(html).toContain("累计差额是怎样形成的");
    expect(html).toContain("仅该年发生");
    expect(html).toContain("第 2 年末");
    expect(html).toContain("CPF 退款");
    expect(cumulativeCostRows(p).at(-1)).toMatchObject({ buy: p.years.at(-1)!.own_spent, rent: p.years.at(-1)!.rent_spent });
  });
  it("separates actual OA interest and housing-refund interest when CPF pays for the purchase", () => {
    const i = { ...inputs(), years: 4, cpf_balance: 60000, cpf_monthly: 900, cpf_rate: 2.5, guidance: { ...newGuidance("2026-11-01"), tenure: "leasehold" as const, lease_start: 2016, lease_term: 99, age: 30, cpf_mode: "manual" as const, cpf_eligible: true, confirmed: true } };
    const p = rentOrBuy(i), last = p.years.at(-1)!;
    expect(p.upfront.from_cpf).toBe(60000);
    expect(last.cpf_housing_interest).toBeGreaterThan(0);
    expect(last.cumulative.rent_cpf_interest).toBeGreaterThan(last.cumulative.buy_cpf_interest);
    for (const y of p.years) {
      const d = breakdownAtYear(p, y.year);
      expect(Math.abs(d.gap_bridge.find(row => row.key === "rounding")!.amount)).toBeLessThanOrEqual(0.05);
      expect(d.gap_bridge.find(row => row.key === "cpf_difference")!.amount).toBeCloseTo(y.cumulative.buy_cpf_interest - y.cumulative.rent_cpf_interest, 2);
      expect(d.assets.buy.some(row => row.amount === -y.cpf_refund && row.key !== "rounding")).toBe(false);
    }
  });
});
