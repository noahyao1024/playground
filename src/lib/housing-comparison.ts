import { clampInputs, rentOrBuy, type MarketData, type ScenarioInputs } from "./housing";
import { parseGuidance } from "./housing-guidance";
import { estimatesFor, expectedEconomy, marketModel, stressed, withEstimates, type Model, type Stress } from "./housing-model";

/** The page and agent API resolve the same estimates and run the same future.
 * The page may preview half-typed numbers; API callers validate before this. */
export function comparisonInputs(inputs: ScenarioInputs) {
  const typed = clampInputs(inputs);
  try { if (typed.guidance) typed.guidance = parseGuidance(typed.guidance); } catch { delete typed.guidance; }
  if (typed.guidance?.annual_value_auto) typed.annual_value = Math.min(10_000_000, typed.rent * 12);
  return typed;
}

export function resolveComparison(inputs: ScenarioInputs, market: MarketData, stress: Stress = "none", model: Model = marketModel(market, inputs)) {
  const typed = comparisonInputs(inputs);
  const estimates = estimatesFor(model, typed);
  const resolved = withEstimates(typed, estimates);
  const projection = rentOrBuy(resolved, stressed(expectedEconomy(resolved, model), stress));
  return { typed, model, estimates, resolved, projection };
}

export type Comparison = ReturnType<typeof resolveComparison>;

/** These describe the model, rather than promising how a future will turn out. */
export const CALCULATION_RULES = [
  { key: "investment", method: "compound", description: "Annual effective return converted to (1 + r/100)^(1/12) - 1; gains and monthly cash differences are reinvested." },
  { key: "home_price", method: "compound_growth", description: "Home-price growth compounds. A leasehold home also carries an illustrative 3% discounted right-to-occupy factor, declining to zero at expiry; this is not an official valuation." },
  { key: "rent_and_costs", method: "compound_growth", description: "Rent and running costs grow cumulatively at their annual rates, reset each year; growth is not interest paid by a bank." },
  { key: "purchasing_power", method: "compound_discount", description: "Today's money = nominal amount / (1 + cost_growth/100)^years. The baseline is guidance.as_of, or the start of the comparison." },
  { key: "mortgage", method: "reducing_balance", description: "Interest is charged on outstanding principal each period, using the shared loan schedule. Ordinary repayments pay the interest; it is not added to principal to earn interest again." },
  { key: "cpf", method: "compound_approximation", description: "OA savings and housing accrued interest use an equivalent monthly rate. CPF actually computes interest monthly and credits/compounds it yearly; transaction dates, lowest monthly balances and extra CPF interest are not modelled." },
  { key: "monthly_cost_breakdown", method: "non_compounding", description: "Monthly opportunity cost and amortised one-off costs are an accounting breakdown. They do not compound; the net-worth comparison reinvests cash differences and is the primary comparison." },
  { key: "taxes_and_fees", method: "cash_flow", description: "Stamp duties, property tax, renovation, repairs and fees are cash flows; no interest is earned on them. Repaid mortgage principal remains an asset." },
] as const;
