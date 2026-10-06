import { ESTIMATED, inTodaysMoney, type MarketData, type ScenarioInputs } from "./housing";
import { remainingLease, salaryOa } from "./housing-guidance";
import { CALCULATION_RULES, resolveComparison, type Comparison } from "./housing-comparison";
import { comparisonCharts, marketChartId, projectCharts, type Chart } from "./housing-charts";
import { SIMULATED_YEARS, simulate, summarize as summarizeFutures, type Stress } from "./housing-model";
import { byBand, byBedrooms, byQuarter, lastYear, leaseOf, marketForProject, psfOf, summarize, type Project } from "./housing-projects";
import { bankFinancing } from "./housing-financing";
import { propertyContext, quoteSource } from "./housing-property";
import { breakdownAtYear } from "./housing-breakdown";

export const ANALYSIS_VERSION = "3";
export type AnalysisCheck = { code: string; fields: string[]; message: string };

function checks(comparison: Comparison, project?: Project): AnalysisCheck[] {
  const i=comparison.resolved, g=i.guidance, out: AnalysisCheck[]=[];
  const add=(code: string, fields: string[], message: string) => out.push({code,fields,message});
  if (i.years > SIMULATED_YEARS) add("long_horizon",["years"],`只提供中央情景；超过 ${SIMULATED_YEARS} 年不估计未来分布。长期固定增长率会放大假设的影响，建议同时比较 10、15、20、30 年。`);
  if (i.loan_type === "bank" && i.loan_share > 0) {
    const f = bankFinancing(i);
    if (!f.within_limits) add("check_ltv",["loan_share","loan_years","financing"],`当前贷款条件估算 LTV 上限 ${f.max_ltv}%，最长 ${f.term_limit} 年；输入超出范围。计算仍按输入展示成本，需银行核实融资方案。参考 ${f.source}`);
    if (f.age_assumption !== "bank_assessed" || !i.financing) add("financing_assumptions",["financing.borrower_age","financing.outstanding_loans"],`最低现金首付按 ${f.minimum_cash_percent}% 计算；现有房贷默认零笔，不能从房产套数推断。${f.borrower_age === null ? "借款年龄未知，采用较保守档。" : "借款年龄暂按 CPF 年龄为单一借款人估算；联名买方请填银行评估年龄。"}`);
  }
  if (g && g.tenure === "leasehold") add("lease_valuation",["growth","guidance.lease_start","guidance.lease_term","guidance.lease_discount_rate"],`房价增长之外还应用了示意性的租约折损（${g.lease_discount_rate ?? 3}% 年折现，可调整；0% 为线性折损）；0% 房价增长仍可能贬值。这不是官方估值。到期归零，之后买方也付租金。起始日期按年份的 1 月 1 日估算，应查产权文件。`);
  if (i.cpf_balance > 0 || i.cpf_monthly > 0 || g?.cpf_mode === "salary") add("cpf_interest_model",["cpf_rate","guidance.as_of"],"CPF 按模拟月度余额累计利息、年底入账后复利；当月缴款下月计息、当月提款不计息。待入账利息属于净资产但不能提前还贷。未导入基准日前待入账利息、实际交易日及额外 CPF 利息；不是 CPF 账单。参考 https://www.cpf.gov.sg/member/infohub/reports-and-statistics/cpf-statistics/interest-statistics");
  if (g?.cpf_mode === "salary") add("salary_cpf",["cpf_monthly","guidance.salary","guidance.cpf_scheme"],"工资模式用年龄、工资上限、PR 日期及所选缴费制度估算 OA，忽略手填 cpf_monthly；不含奖金。full 表示已批准的全额缴费，请以实际工资单为准。");
  const left=g ? remainingLease(g) : null;
  if (i.sell_costs === 0 && (left === null || i.years < left)) add("selling_costs",["sell_costs"],"比较假设期末出售但出售费用为零；若需要中介、法律及 GST 等费用，应填入实际费率并比较敏感性。");
  for (const key of ESTIMATED) if (i.auto.includes(key)) add(`auto_${key}`,[key,"auto"],comparison.estimates[key] ? `采用当前市场估计 ${i[key]}%，保存的数值是备用值；若是实际合同或个人假设，请从 auto 移除 ${key}。` : "当前数据无法估计此项，使用保存的备用值。");
  if (project) {
    const lease=leaseOf(project.tenure);
    if (g && lease && (g.tenure !== lease.tenure || (lease.tenure === "leasehold" && (g.lease_start !== lease.lease_start || g.lease_term !== lease.lease_term)))) add("project_lease_mismatch",["guidance.tenure","guidance.lease_start","guidance.lease_term"],`选定项目的 URA 租约记录为 ${project.tenure}，与情景不一致。核对产权文件后修正，API 不会替你改写保存的数据。`);
    if (i.kind === "private" && i.market !== marketForProject(project)) add("project_market",["market"],`项目对应市场为 ${marketForProject(project)}，当前使用 ${i.market}；若比较此项目，应核对市场选择。`);
  }
  if (i.property) {
    if (i.property.project && !project) add("property_project_unavailable",["property.project"],"关联楼盘目前没有可用资料；计算保留已保存金额、区域与地契，不推断为已匹配。");
    for (const key of ["price","rent"] as const) {
      const source = quoteSource(i,key);
      if (source.source && (!source.matches_input || !source.context_matches)) add(`property_${key}_source_changed`,[key,"property"],"金额或房源条件已改变，来源快照需重新核对；不自动替换你的输入。");
    }
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
      financing:c.resolved.loan_type === "bank" && c.resolved.loan_share > 0 ? bankFinancing(c.resolved) : null,
      simulation_method:{kind:"historical_block_bootstrap",block_quarters:8,seed:1,interpretation:"Shares of historical replay scenarios, not calibrated probabilities of future outcomes."},
      history:{from:c.model.history[0]?.quarter ?? null,to:c.model.history.at(-1)?.quarter ?? null,quarters:c.model.history.length},
      checks:checks(c,selectedProject ?? projects.find(p=>p.name === c.resolved.property?.project)),calculation_rules:CALCULATION_RULES,
      property_context:propertyContext(c.resolved,projects),
      breakdown:c.projection.years.map(row=>breakdownAtYear(c.projection,row.year)),
    } : null,
    projects:analyseProjects(projects),charts,market_charts,
  };
}
