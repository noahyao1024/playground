import { describe, expect, it } from "vitest";
import { analyseHousing } from "@/lib/housing-analysis";
import { resolveComparison } from "@/lib/housing-comparison";
import { comparisonCharts, marketChart } from "@/lib/housing-charts";
import { chartSvg } from "@/lib/housing-chart-svg";
import { PATHS, simulate, summarize } from "@/lib/housing-model";
import { steadyEconomy, inTodaysMoney } from "@/lib/housing";
import { housingInputs, housingMarket, housingProject } from "../helpers/housing-fixtures";

describe("housing analysis and images",()=>{
  it("uses effective annual compound growth and discounts consistently",()=>{
    const i={...housingInputs(),growth:4,rent_growth:2,cost_growth:2.5,invest_return:6,years:15};
    const e=steadyEconomy(i);
    expect(e.price.at(-1)).toBeCloseTo(1.04**15,12);
    expect(e.rent.at(-1)).toBeCloseTo(1.02**15,12);
    expect(e.costs.at(-1)).toBeCloseTo(1.025**15,12);
    expect(e.invest.reduce((value,month)=>value*(1+month),1)).toBeCloseTo(1.06**15,12);
    expect(inTodaysMoney(100000,2.5,15)).toBeCloseTo(100000/1.025**15,10);
  });

  it("returns exactly the browser's 500 seeded paths when batches do not divide 500",()=>{
    const c=resolveComparison(housingInputs(),housingMarket());
    const all=simulate(c.resolved,c.model);
    const batched=[];
    for (let first=0;first<PATHS;first+=18) batched.push(...simulate(c.resolved,c.model,{first,count:18}));
    expect(batched).toHaveLength(PATHS);
    expect(batched).toEqual(all);
    expect(summarize(batched)).toEqual(summarize(all));
    expect(simulate(c.resolved,c.model,{first:PATHS,count:18})).toEqual([]);
  });

  it("labels CPF monthly accrual assumptions and checks lease, market, fees and loan age without mutating inputs",()=>{
    const i={...housingInputs(),years:15,market:"ALL:non-landed" as const,sell_costs:0};
    const before=structuredClone(i);
    const result=analyseHousing(housingMarket(),[housingProject()],i,"none",false,{...housingProject(),tenure:"99 yrs lease commencing from 2009"});
    expect(i).toEqual(before);
    expect(result.comparison?.checks.map(c=>c.code)).toEqual(expect.arrayContaining(["cpf_interest_model","salary_cpf","lease_valuation","check_ltv","selling_costs","project_lease_mismatch","project_market"]));
    expect(result.comparison?.calculation_rules.find(r=>r.key === "cpf")?.method).toBe("monthly_accrual_annual_compounding");
    expect(result.comparison?.calculation_rules.find(r=>r.key === "monthly_cost_breakdown")?.method).toBe("non_compounding");
    expect(result.comparison?.effective_inputs.guidance?.cpf_scheme).toBe(i.guidance?.cpf_scheme);
  });

  it("escapes saved text in SVG and preserves gaps rather than joining them",()=>{
    const chart=marketChart({series:"ura_ppi",area:'<script>alert("x")</script>&',segment:"non-landed",start:"2025-Q1",values:[100,null,120]});
    const svg=chartSvg(chart);
    expect(svg).toContain("&lt;script&gt;");
    expect(svg).not.toMatch(/<script|<foreignObject|\bonload=|\bhref=/i);
    const path=svg.match(/<path d="([^"]+)"/)![1];
    expect(path.match(/M/g)).toHaveLength(2);
    expect(path).not.toContain("L");
    expect(svg).toContain("120 index");
    expect(svg).not.toMatch(/NaN|Infinity/);
  });

  it("renders the same nominal wealth and non-compounding costs as its JSON rows",()=>{
    const c=resolveComparison(housingInputs(),housingMarket());
    const charts=comparisonCharts(c.projection,null,c.model.sora,housingMarket(),"none");
    const wealth=charts.find(chart=>chart.id === "wealth")!;
    expect(wealth.rows.at(-1)?.buy).toBe(c.projection.years.at(-1)?.buy_net_worth);
    expect(chartSvg(wealth)).toContain(`${wealth.rows.at(-1)?.buy} SGD`);
    expect(charts.find(chart=>chart.id === "costs")?.rows[0].own).toBe(c.projection.monthly[0].net);
  });
});
