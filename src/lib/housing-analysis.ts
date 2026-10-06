import { ESTIMATED, inTodaysMoney, type MarketData, type ScenarioInputs } from "./housing";
import { remainingLease, salaryOa } from "./housing-guidance";
import { CALCULATION_RULES, resolveComparison, type Comparison } from "./housing-comparison";
import { comparisonCharts, marketChartId, projectCharts, type Chart } from "./housing-charts";
import { SIMULATED_YEARS, simulate, summarize as summarizeFutures, type Stress } from "./housing-model";
import { byBand, byBedrooms, byQuarter, lastYear, leaseOf, marketForProject, psfOf, summarize, type Project } from "./housing-projects";

export const ANALYSIS_VERSION = "1";
export type AnalysisCheck = { code: string; fields: string[]; message: string };

function checks(comparison: Comparison, project?: Project): AnalysisCheck[] {
  const i=comparison.resolved, g=i.guidance, out: AnalysisCheck[]=[];
  const add=(code: string, fields: string[], message: string) => out.push({code,fields,message});
  if (i.years > SIMULATED_YEARS) add("long_horizon",["years"],`只提供中央情景；超过 ${SIMULATED_YEARS} 年不估计未来分布。长期固定增长率会放大假设的影响，建议同时比较 10、15、20、30 年。`);
  if (i.loan_type === "bank" && i.loan_share > 55 && (i.loan_years > 30 || (g?.age !== null && g?.age !== undefined && g.age+i.loan_years > 65))) add("check_ltv",["loan_share","loan_years","guidance.age"],"若是个人首套银行贷款，期限超过 30 年或还款到超过 65 岁，一般最高 LTV 降为 55%。联名买方年龄、现有房贷和银行评估需另核实；此模型不代表贷款获批。参考 https://www.moneysense.gov.sg/buying-a-property-how-much-can-you-afford/");
  if (g && g.tenure === "leasehold") add("lease_valuation",["growth","guidance.lease_start","guidance.lease_term"],"房价增长之外还应用了示意性的租约折损；0% 增长仍可能意味着房屋贬值。租约到期归零，之后买方也付租金。租约从起始年 1 月 1 日算，精确日期应查产权文件。");
  if (i.cpf_balance > 0 || i.cpf_monthly > 0 || g?.cpf_mode === "salary") add("cpf_interest_approximation",["cpf_rate"],"模型采用等效月利率近似 OA 及住房应计利息；CPF 实际按月计算、按年入账并复利。模型未计每月最低余额、实际存取日期和额外 CPF 利息。参考 https://www.cpf.gov.sg/member/infohub/reports-and-statistics/cpf-statistics/interest-statistics");
  if (g?.cpf_mode === "salary") add("salary_cpf",["cpf_monthly","guidance.salary","guidance.cpf_scheme"],"工资模式用年龄、工资上限、PR 日期及所选缴费制度估算 OA，忽略手填 cpf_monthly；不含奖金。full 表示已批准的全额缴费，请以实际工资单为准。");
  const left=g ? remainingLease(g) : null;
  if (i.sell_costs === 0 && (left === null || i.years < left)) add("selling_costs",["sell_costs"],"比较假设期末出售但出售费用为零；若需要中介、法律及 GST 等费用，应填入实际费率并比较敏感性。");
  for (const key of ESTIMATED) if (i.auto.includes(key)) add(`auto_${key}`,[key,"auto"],comparison.estimates[key] ? `采用当前市场估计 ${i[key]}%，保存的数值是备用值；若是实际合同或个人假设，请从 auto 移除 ${key}。` : "当前数据无法估计此项，使用保存的备用值。");
  if (project) {
    const lease=leaseOf(project.tenure);
    if (g && lease && (g.tenure !== lease.tenure || (lease.tenure === "leasehold" && (g.lease_start !== lease.lease_start || g.lease_term !== lease.lease_term)))) add("project_lease_mismatch",["guidance.tenure","guidance.lease_start","guidance.lease_term"],`选定项目的 URA 租约记录为 ${project.tenure}，与情景不一致。核对产权文件后修正，API 不会替你改写保存的数据。`);
    if (i.kind === "private" && i.market !== marketForProject(project)) add("project_market",["market"],`项目对应市场为 ${marketForProject(project)}，当前使用 ${i.market}；若比较此项目，应核对市场选择。`);
  }
  return out;
}

export function analyseProjects(projects: Project[]) {
  const latest=(months: string[]) => months.length ? months.reduce((a,b)=>a>b?a:b) : null;
  return projects.map(project => {
    const window=lastYear(project);
    return {
      name:project.name,read_at:project.read_at,found:project.found,tenure:project.tenure,lease:leaseOf(project.tenure),market:marketForProject(project),
      records:{sales:project.sales.length,rents:project.rents.length},
      window:{sales_from:window.salesFrom,sales_to:latest(window.sales.map(s=>s.month)),rents_from:window.rentsFrom,rents_to:latest(window.rents.map(r=>r.month))},
      prices:summarize(window.sales.map(s=>s.price/s.units)),psf:summarize(window.sales.map(psfOf)),rents:summarize(window.rents.map(r=>r.rent)),
      by_band:byBand(project),by_bedrooms:byBedrooms(project),by_quarter:byQuarter(project),
    };
  });
}

export function analyseHousing(market: MarketData, projects: Project[], inputs: ScenarioInputs | null, stress: Stress = "none", draw = true, selectedProject?: Project) {
  const c=inputs ? resolveComparison(inputs,market,stress) : null;
  const unavailable=!c ? null : c.resolved.years > SIMULATED_YEARS ? "horizon_exceeds_35_years" : c.model.history.length === 0 ? "insufficient_joint_history" : !draw ? "not_requested" : null;
  const simulation=c && !unavailable ? summarizeFutures(simulate(c.resolved,c.model,{stress})) : null;
  const last=c?.projection.years.at(-1);
  const firstOa=c ? c.resolved.guidance?.cpf_mode === "none" ? 0 : c.resolved.guidance?.cpf_mode === "salary" ? salaryOa(c.resolved.guidance,0,c.resolved.residency) : c.resolved.cpf_monthly : null;
  const charts: Chart[]=[...(c ? comparisonCharts(c.projection,simulation,c.model.sora,market,stress) : []),...projects.flatMap(projectCharts)];
  // Every market observation remains available via GET /api/housing. Advertise
  // all export ids without duplicating the full snapshot into 224 chart rows.
  const market_charts=market.series.map(series => ({id:marketChartId(series),title:`${series.series}: ${series.area} / ${series.segment}`,series:series.series,area:series.area,segment:series.segment}));
  return {
    version:ANALYSIS_VERSION,market_refreshed_at:market.refreshed_at,
    comparison:c && last ? {
      inputs,effective_inputs:c.resolved,stress,estimates:c.estimates,projection:c.projection,
      summary:{years:c.resolved.years,baseline:c.resolved.guidance?.as_of ?? null,nominal_gap:last.buy_net_worth-last.rent_net_worth,todays_money_gap:inTodaysMoney(last.buy_net_worth-last.rent_net_worth,c.resolved.cost_growth,c.resolved.years),inflation:c.resolved.cost_growth,winner:last.buy_net_worth >= last.rent_net_worth ? "buy" : "rent",first_month_oa:firstOa,break_even:c.projection.break_even},
      simulation,simulation_unavailable:unavailable,simulation_seed:1,
      history:{from:c.model.history[0]?.quarter ?? null,to:c.model.history.at(-1)?.quarter ?? null,quarters:c.model.history.length},
      checks:checks(c,selectedProject),calculation_rules:CALCULATION_RULES,
    } : null,
    projects:analyseProjects(projects),charts,market_charts,
  };
}
