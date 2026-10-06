import { HOUSING_CUMULATIVE_FIELDS, type HousingCumulative, type Projection } from "./housing";

export type PkAmount = { key: string; label: string; amount: number };
export type PkFlow = { key: string; label: string; kind: "cost" | "principal" | "funding" | "investment" | "cpf" | "total"; buy: number; rent: number };
const round = (n: number) => { const value = Math.round(n * 100) / 100; return value === 0 ? 0 : value; };

/** All drill-downs reconcile with the projection. Expenses are explanatory, never deducted again. */
export function breakdownAtYear(p: Projection, year: number) {
  const row = p.years.find(y => y.year === year);
  if (!row) throw new Error("Comparison year unavailable");
  const previous = p.years.find(y => y.year === year - 1);
  const c = row.cumulative;
  const annual = Object.fromEntries(HOUSING_CUMULATIVE_FIELDS.map(key => [key, round(c[key] - (previous?.cumulative[key] ?? 0))])) as HousingCumulative;
  const buy: PkAmount[] = [
    { key: "home", label: "房屋价值", amount: row.home_value },
    { key: "loan", label: "减：剩余贷款", amount: -row.loan_balance },
    { key: "sale", label: "减：假设当年出售费用 / SSD", amount: -row.sale_costs },
    { key: "investments", label: "现金投资余额", amount: row.buy_investments },
    { key: "cpf", label: "CPF OA 已入账余额", amount: row.cpf_buy_balance },
    { key: "cpf_pending", label: "CPF OA 待入账利息", amount: row.cpf_buy_pending_interest },
  ];
  const rent: PkAmount[] = [
    { key: "investments", label: "现金投资余额", amount: row.rent_investments },
    { key: "cpf", label: "CPF OA 已入账余额", amount: row.cpf_rent_balance },
    { key: "cpf_pending", label: "CPF OA 待入账利息", amount: row.cpf_rent_pending_interest },
  ];
  const reconcile = (rows: PkAmount[], total: number) => [...rows, { key: "rounding", label: "显示金额的舍入差", amount: round(total - rows.reduce((sum, r) => sum + r.amount, 0)) }];
  const gap = round(row.buy_net_worth - row.rent_net_worth);
  const bridge: PkAmount[] = [
    { key: "rent_costs", label: "租房累计已付成本", amount: row.rent_spent },
    { key: "buy_costs", label: "减：买房累计已付成本（不含本金）", amount: -row.own_spent },
    { key: "sale_costs", label: "减：假设当年出售费用 / SSD", amount: -row.sale_costs },
    { key: "home_change", label: "房屋价值相对买入价的变化（含租约折损）", amount: round(row.home_value - p.upfront.down_payment - p.upfront.loan) },
    { key: "investment_difference", label: "买房减租房：累计现金投资收益差", amount: round(c.buy_investment_gain - c.rent_investment_gain) },
    { key: "cpf_difference", label: "买房减租房：累计 OA 利息差", amount: round(c.buy_cpf_interest - c.rent_cpf_interest) },
  ];
  const flows = (ledger: HousingCumulative, upfront: boolean, ownCosts: number, rentCosts: number): PkFlow[] => [
    { key: "down_payment", label: "首付（转为房屋权益）", kind: "principal", buy: upfront ? p.upfront.down_payment : 0, rent: 0 },
    ...(["bsd", "absd", "buy_costs", "renovation"] as const).map((key, n) => ({ key, label: ["买方印花税 BSD", "额外买方印花税 ABSD", "买入法律及其他费用", "装修"][n], kind: "cost" as const, buy: upfront ? p.upfront[key] : 0, rent: 0 })),
    { key: "mortgage_principal", label: "已还贷款本金（转为房屋权益）", kind: "principal", buy: ledger.mortgage_principal, rent: 0 },
    { key: "mortgage_interest", label: "贷款利息", kind: "cost", buy: ledger.mortgage_interest, rent: 0 },
    { key: "maintenance", label: "物业 / 管理费", kind: "cost", buy: ledger.maintenance, rent: 0 },
    { key: "property_tax", label: "房产税", kind: "cost", buy: ledger.property_tax, rent: 0 },
    { key: "upkeep", label: "维修 / 保险", kind: "cost", buy: ledger.upkeep, rent: 0 },
    { key: "rent", label: "整套租金（买方仅地契到期后）", kind: "cost", buy: ledger.replacement_rent, rent: ledger.rent },
    { key: "rent_fees", label: "租赁费用（买方仅地契到期后）", kind: "cost", buy: ledger.replacement_rent_fees, rent: ledger.rent_fees },
    { key: "cost_total", label: "已付成本合计（不含本金、假设出售费用）", kind: "total", buy: round(ownCosts), rent: round(rentCosts) },
    { key: "cash_paid", label: "现金支付（已含上述首付、本金与费用）", kind: "funding", buy: ledger.buy_cash_paid, rent: ledger.rent_cash_paid },
    { key: "cpf_paid", label: "CPF 支付（已含上述首付与还贷）", kind: "funding", buy: ledger.buy_cpf_paid, rent: 0 },
    { key: "invested", label: "投入现金投资的金额", kind: "investment", buy: ledger.buy_invested, rent: ledger.rent_invested },
    { key: "investment_gain", label: "现金投资收益 / 损失", kind: "investment", buy: ledger.buy_investment_gain, rent: ledger.rent_investment_gain },
    { key: "cpf_contributions", label: "新缴入 CPF OA 的金额", kind: "cpf", buy: ledger.cpf_contributions, rent: ledger.cpf_contributions },
    { key: "cpf_interest", label: "CPF OA 实际累计利息（含待入账）", kind: "cpf", buy: ledger.buy_cpf_interest, rent: ledger.rent_cpf_interest },
  ];
  return { year, buy_net_worth: row.buy_net_worth, rent_net_worth: row.rent_net_worth, gap,
    assets: { buy: reconcile(buy, row.buy_net_worth), rent: reconcile(rent, row.rent_net_worth) },
    gap_bridge: reconcile(bridge, gap),
    cumulative: flows(c, true, row.own_spent, row.rent_spent),
    annual: flows(annual, year === 0, row.own_spent - (previous?.own_spent ?? 0), row.rent_spent - (previous?.rent_spent ?? 0)),
    cpf_refund: { principal: row.cpf_housing_principal, accrued_interest: row.cpf_housing_interest, required: row.cpf_refund, description: "CPF 退款是出售所得与 OA 之间的资产转移；不再次扣减净资产，也不把住房累计利息当作已取得的收益。" },
    cash_budget: c.cash_budget,
  };
}
