"use client";

import { useState } from "react";
import { breakdownAtYear, type PkAmount } from "@/lib/housing-breakdown";
import { cumulativeCostRows } from "@/lib/housing-charts";
import { inTodaysMoney, type Projection, type ScenarioInputs } from "@/lib/housing";
import { compactMoney, money } from "@/lib/finance-format";
import { Segmented } from "@/components/finance/segmented";
import { Card } from "./market-view";
import { LinesChart, yearTicks } from "./line-chart";

const preciseMoney: typeof money = (value, unit, options = {}) => money(value, unit, { ...options, decimals: 2 });
const VIEWS = [{ value: "cumulative", label: "从开始累计" }, { value: "annual", label: "仅该年发生" }] as const;
const visible = (rows: PkAmount[]) => rows.filter(row => row.key !== "rounding" || row.amount !== 0);
export function PkDetails({ inputs, result, year, onYearChange }: { inputs: ScenarioInputs; result: Projection; year: number; onYearChange: (year: number) => void }) {
  const [view, setView] = useState<"cumulative" | "annual">("cumulative");
  const data = breakdownAtYear(result, year);
  const final = result.years.at(-1)!;
  const flow = data[view];
  const assetRows = Array.from(new Set([...data.assets.buy, ...data.assets.rent].map(row => row.key))).filter(key => key !== "rounding" || [...data.assets.buy, ...data.assets.rent].some(row => row.key === key && row.amount !== 0));
  const draw = cumulativeCostRows(result);
  return <div id="housing-pk" className="scroll-mt-4">
    <Card title={`最终 PK · 第 ${inputs.years} 年`} sub="先看最终净资产，再展开每笔累计成本和收益。">
      <div className="grid grid-cols-2 gap-3 text-sm">
        <div><p className="text-muted-foreground">买房净资产</p><p className="mt-1 font-semibold tabular-nums">{preciseMoney(final.buy_net_worth, "sgd")}</p></div>
        <div><p className="text-muted-foreground">租房净资产</p><p className="mt-1 font-semibold tabular-nums">{preciseMoney(final.rent_net_worth, "sgd")}</p></div>
      </div>
      <details id="housing-pk-details" className="mt-4 border-t pt-3">
        <summary className="cursor-pointer text-sm font-medium">展开下钻：净资产组成、累计支出及收益</summary>
        <div className="mt-4 space-y-5">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <label className="flex items-center gap-2 text-sm" htmlFor="pk-year">查看到<select id="pk-year" value={year} onChange={e => onYearChange(Number(e.target.value))} className="h-9 rounded-md border bg-background px-2">{result.years.map(row => <option key={row.year} value={row.year}>{row.year === 0 ? "买入时" : `第 ${row.year} 年末`}</option>)}</select></label>
            <Segmented label="明细期间" value={view} onChange={setView} options={VIEWS} />
          </div>
          <p className="text-sm">第 {year} 年末差额（买房 − 租房）：<strong className="tabular-nums">{preciseMoney(data.gap, "sgd", { sign: true })}</strong>；按通胀折算至基准日 {preciseMoney(inTodaysMoney(data.gap, inputs.cost_growth, year), "sgd", { sign: true })}。</p>
          <section className="space-y-2">
            <h3 className="text-sm font-medium">这一年末的净资产组成</h3>
            <div className="overflow-x-auto"><table className="w-full min-w-96 text-sm"><thead><tr className="border-b text-xs text-muted-foreground"><th className="py-2 text-left font-normal">资产 / 负债</th><th className="py-2 text-right font-normal">买房</th><th className="py-2 text-right font-normal">租房</th></tr></thead><tbody>
              {assetRows.map(key => {
                const buy = data.assets.buy.find(row => row.key === key), rent = data.assets.rent.find(row => row.key === key);
                return <tr key={key} className="border-b"><th scope="row" className="py-2 pr-3 text-left font-normal">{buy?.label ?? rent!.label}</th><td className="py-2 text-right tabular-nums whitespace-nowrap">{buy ? preciseMoney(buy.amount, "sgd") : "—"}</td><td className="py-2 text-right tabular-nums whitespace-nowrap">{rent ? preciseMoney(rent.amount, "sgd") : "—"}</td></tr>;
              })}
              <tr className="font-medium"><th scope="row" className="py-2 text-left">净资产合计</th><td className="py-2 text-right tabular-nums">{preciseMoney(data.buy_net_worth, "sgd")}</td><td className="py-2 text-right tabular-nums">{preciseMoney(data.rent_net_worth, "sgd")}</td></tr>
            </tbody></table></div>
          </section>
          <section className="space-y-2">
            <h3 className="text-sm font-medium">{view === "cumulative" ? `买入至第 ${year} 年末的累计支出` : year === 0 ? "买入时的支出" : `仅第 ${year} 年的支出`}</h3>
            <p className="text-xs text-muted-foreground">以下是当时支付的名义金额。本金转为资产，成本合计不含本金；假设出售费用已列在上面的净资产表中。</p>
            <div className="overflow-x-auto"><table className="w-full min-w-96 text-sm"><thead><tr className="border-b text-xs text-muted-foreground"><th className="py-2 text-left font-normal">项目</th><th className="py-2 text-right font-normal">买房</th><th className="py-2 text-right font-normal">租房</th></tr></thead><tbody>{flow.filter(row => ["cost", "principal", "total"].includes(row.kind)).map(row => <tr key={row.key} className={`border-b last:border-0 ${row.kind === "total" ? "font-medium" : ""}`}><th scope="row" className={`py-2 pr-3 text-left ${row.kind === "total" ? "font-medium" : "font-normal"}`}>{row.label}</th><td className="py-2 text-right tabular-nums whitespace-nowrap">{preciseMoney(row.buy, "sgd")}</td><td className="py-2 text-right tabular-nums whitespace-nowrap">{preciseMoney(row.rent, "sgd")}</td></tr>)}</tbody></table></div>
          </section>
          <details className="rounded-lg border p-3"><summary className="cursor-pointer text-sm font-medium">付款来源与投资{view === "cumulative" ? "累计" : "年度变化"}</summary>
            <p className="mt-2 text-xs text-muted-foreground">现金 / CPF 支付是上述支出的资金来源，不能再加到成本合计。现金投资本金、投资收益及新 OA 缴款分开显示；双方采用相同可用现金预算及 OA 缴款。</p>
            <div className="mt-2 overflow-x-auto"><table className="w-full min-w-96 text-sm"><thead><tr className="border-b text-xs text-muted-foreground"><th className="py-2 text-left font-normal">项目</th><th className="py-2 text-right font-normal">买房</th><th className="py-2 text-right font-normal">租房</th></tr></thead><tbody>{flow.filter(row => ["funding", "investment", "cpf"].includes(row.kind)).map(row => <tr key={row.key} className="border-b last:border-0"><th scope="row" className="py-2 pr-3 text-left font-normal">{row.label}</th><td className="py-2 text-right tabular-nums whitespace-nowrap">{preciseMoney(row.buy, "sgd")}</td><td className="py-2 text-right tabular-nums whitespace-nowrap">{preciseMoney(row.rent, "sgd")}</td></tr>)}</tbody></table></div>
          </details>
          <section className="space-y-2">
            <h3 className="text-sm font-medium">累计差额是怎样形成的</h3>
            <p className="text-xs text-muted-foreground">正数有利于买房，负数有利于租房。所有项目相加等于上面的净资产差额。</p>
            <table className="w-full text-sm"><tbody>{visible(data.gap_bridge).map(row => <tr key={row.key} className="border-b"><th scope="row" className="py-2 pr-3 text-left font-normal">{row.label}</th><td className="py-2 text-right tabular-nums whitespace-nowrap">{preciseMoney(row.amount, "sgd", { sign: true })}</td></tr>)}<tr><th scope="row" className="py-2 text-left font-medium">净资产差额</th><td className="py-2 text-right font-medium tabular-nums">{preciseMoney(data.gap, "sgd", { sign: true })}</td></tr></tbody></table>
            <p className="text-xs text-muted-foreground">机会成本已体现在双方投资结果中，不再额外扣一次。CPF 退款：本金 {preciseMoney(data.cpf_refund.principal, "sgd")}、住房累计利息 {preciseMoney(data.cpf_refund.accrued_interest, "sgd")}；退款是资产转移，不再扣减净资产。住房累计利息不是 OA 已取得的收益。</p>
          </section>
          <section><h3 className="mb-3 text-sm font-medium">累计已付成本走势（不含本金、假设出售费用）</h3><LinesChart rows={draw} series={[{ key: "buy", label: "买房累计成本", color: "var(--series-1)" }, { key: "rent", label: "租房累计成本", color: "var(--series-2)" }]} format={value => preciseMoney(value, "sgd")} axisFormat={value => compactMoney(value, "sgd")} ticks={yearTicks(0, inputs.years, 8)} xFormat={value => `${value} 年`} height={220} /></section>
        </div>
      </details>
    </Card>
  </div>;
}
