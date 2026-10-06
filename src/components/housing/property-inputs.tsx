"use client";

import { useState } from "react";
import { RotateCw, ExternalLink } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { NumberInput } from "@/components/ui/number-input";
import { dayInSG } from "@/lib/dates";
import { dayLabel, money } from "@/lib/finance-format";
import type { ScenarioInputs } from "@/lib/housing";
import { bandLabel, SQFT_PER_SQM, type Project } from "@/lib/housing-projects";
import { EMPTY_PROPERTY, linkHousingProject, listingFilters, listingUrl, propertyComparables, propertySqft, referenceQuote, type HousingProperty, type HousingQuote } from "@/lib/housing-property";
import { Card } from "./market-view";

export function PropertyInputs({ inputs, projects, onChange, onRefresh }: {
  inputs: ScenarioInputs; projects: Project[]; onChange: (value: Partial<ScenarioInputs>) => void; onRefresh?: (name: string) => Promise<void>;
}) {
  const p = inputs.property ?? EMPTY_PROPERTY;
  const project = projects.find(row => row.name === p.project);
  const comparable = project ? propertyComparables(project, p) : null;
  const [reading, setReading] = useState(false);
  const update = (value: Partial<HousingProperty>) => onChange({ property: { ...p, ...value } });
  const apply = (key: "price" | "rent", statistic: "p50" | "mean") => {
    if (!project) return;
    const source = referenceQuote(p, project, key, statistic);
    if (source) onChange({ [key]: source.amount, property: { ...p, [key === "price" ? "price_source" : "rent_source"]: source } });
  };
  const refresh = async () => {
    if (!project || !onRefresh) return;
    setReading(true);
    try { await onRefresh(project.name); } finally { setReading(false); }
  };
  const numeric = (key: "area" | "bedrooms" | "bathrooms", label: string, min: number, step = 1) => <div className="space-y-1.5">
    <Label htmlFor={`property-${key}`} className="text-xs">{label}</Label>
    <NumberInput id={`property-${key}`} value={p[key] ?? NaN} emptyValue={NaN} min={min} step={step} onValueChange={v => update({ [key]: Number.isFinite(v) ? v : null, ...(key === "area" ? { area_band: null } : {}) })} className="h-9" />
  </div>;
  const link = (key: "buy_url" | "rent_url", label: string, amount: "price" | "rent") => {
    const value = p[key] ?? "";
    let url: string | null = null, error: string | null = null;
    try { url = listingUrl(value); } catch (err) { error = err instanceof Error ? err.message : "链接无效"; }
    const filters = listingFilters(url);
    const wrongType = (amount === "price" && filters?.type === "rent") || (amount === "rent" && filters?.type === "sale");
    const mark = () => {
      if (!url || filters?.search || wrongType || !Number.isFinite(inputs[amount])) return;
      const source: HousingQuote = { kind: "listing", amount: inputs[amount], project: p.project, area_sqft: propertySqft(p), band: p.area_band, bedrooms: p.bedrooms, bathrooms: p.bathrooms, read_at: new Date().toISOString(), url };
      update({ [amount === "price" ? "price_source" : "rent_source"]: source });
    };
    return <div className="space-y-1.5" key={key}>
      <Label htmlFor={`property-${key}`} className="text-xs">{label}（选填）</Label>
      <Input id={`property-${key}`} type="url" maxLength={4096} value={value} placeholder="https://www.propertyguru.com.sg/…" onChange={e => update({ [key]: e.target.value || null })} aria-invalid={!!error || undefined} className="h-9" />
      {error && <p className="text-xs text-destructive">{error}</p>}
      {url && <a href={url} target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-1 text-xs underline">打开来源 <ExternalLink className="size-3" /></a>}
      {filters?.search ? <p className="text-xs text-muted-foreground">这是搜索列表：{filters.type === "rent" ? "月租" : "价格"} {filters.min_price ?? "不限"}–{filters.max_price ?? "不限"}，面积 {filters.min_sqft ?? "不限"}–{filters.max_sqft ?? "不限"} sqft{filters.bedrooms.length ? `，房数 ${filters.bedrooms.join("、")}` : ""}。筛选边界不是某套房的实际报价或面积，请手填。</p>
        : url && <Button type="button" size="sm" variant="outline" disabled={wrongType || !Number.isFinite(inputs[amount])} onClick={mark}>将当前{amount === "price" ? "买价" : "月租"}标记为此房源报价</Button>}
      {wrongType && <p className="text-xs text-muted-foreground">此链接的买卖 / 租赁类型与当前字段不一致，请核对。</p>}
    </div>;
  };

  return <Card title="关联具体房源（选填）" sub="楼盘资料用于区域与地契核对；具体报价优先，参考数据不会自动覆盖金额。">
    <div className="space-y-3">
      <div className="space-y-1.5">
        <Label htmlFor="property-project" className="text-xs">关联已关注楼盘</Label>
        <select id="property-project" className="h-9 w-full rounded-md border bg-background px-2 text-sm" value={p.project ?? ""} onChange={e => {
          const selected = projects.find(row => row.name === e.target.value);
          if (selected) onChange(linkHousingProject(inputs, selected));
          else update({ project: e.target.value || null });
        }}>
          <option value="">未关联楼盘</option>
          {p.project && !project && <option value={p.project}>{p.project}（当前未关注）</option>}
          {projects.map(row => <option key={row.name} value={row.name}>{row.name}</option>)}
        </select>
        <p className="text-xs text-muted-foreground">选择后应用该楼盘的区域及可识别地契，并要求重新确认。买价、租金、费用和手动增长假设保留。其他楼盘请先到 Market → Private homes 关注。</p>
      </div>
      <div className="grid grid-cols-2 gap-3">
        {numeric("area", "实际面积（选填）", 1, 0.1)}
        <div className="space-y-1.5"><Label htmlFor="property-unit" className="text-xs">面积单位</Label><select id="property-unit" value={p.area_unit} onChange={e => {
          const unit = e.target.value as HousingProperty["area_unit"];
          const area = p.area === null ? null : Math.round(p.area * (unit === p.area_unit ? 1 : unit === "sqm" ? 1 / SQFT_PER_SQM : SQFT_PER_SQM) * 100) / 100;
          update({ area_unit: unit, area });
        }} className="h-9 w-full rounded-md border bg-background px-2 text-sm"><option value="sqft">sqft（平方英尺）</option><option value="sqm">sqm（平方米）</option></select></div>
        {numeric("bedrooms", "卧室数（0 = Studio）", 0)}
        {numeric("bathrooms", "卫生间数", 1)}
      </div>
      {p.area === null && p.area_band && <p className="text-xs text-muted-foreground">已选参考面积档：{bandLabel(p.area_band)}，实际面积尚未填写。</p>}
      {link("buy_url", "买房 PropertyGuru 链接", "price")}
      {link("rent_url", "可比租房 PropertyGuru 链接", "rent")}
      <p className="text-xs text-muted-foreground">链接保存为来源，不会自动抓取挂牌金额；在下方填写具体报价。卧室 / 卫数与面积也会保存，供页面和 AI 使用。</p>
      {project && comparable && <div className="space-y-3 border-t pt-3" aria-busy={reading}>
        <div className="flex flex-wrap items-center justify-between gap-2">
          <p className="text-sm font-medium">{project.name} 同类 URA 参考</p>
          {onRefresh && <Button type="button" variant="outline" size="sm" disabled={reading} onClick={() => void refresh()}><RotateCw className={reading ? "animate-spin" : undefined} />{reading ? "读取中…" : "更新 URA 参考"}</Button>}
        </div>
        <p className="text-xs text-muted-foreground">{comparable.band_label ?? "填写面积后匹配"}{p.bedrooms !== null ? ` · ${p.bedrooms} 房` : ""} · {project.read_at ? `读取于 ${dayLabel(dayInSG(project.read_at))}` : "尚未读取"}</p>
        <p className="text-xs text-muted-foreground">当前计算区域：{inputs.market}；楼盘区域：{comparable.market}。{inputs.market !== comparable.market && "区域尚未一致，可在下方重新应用。"}</p>
        <p className="text-xs text-muted-foreground">当前计算地契：{inputs.guidance?.tenure === "leasehold" ? `${inputs.guidance.lease_term} 年，从 ${inputs.guidance.lease_start ?? "未填"} 年起` : inputs.guidance?.tenure === "freehold" ? "永久地契" : "未知"}；URA：{project.tenure || "未提供"}。地契起始年需核对产权文件，不是 TOP 年。</p>
        <Button type="button" size="sm" variant="outline" onClick={() => onChange(linkHousingProject(inputs, project))}>重新应用楼盘区域与地契</Button>
        {(["price", "rent"] as const).map(key => {
          const summary = key === "price" ? comparable.prices : comparable.rents;
          return <div key={key} className="rounded-lg bg-muted/40 p-3 text-xs">
            <p className="font-medium">{key === "price" ? "成交总价（同面积）" : "整套月租（同面积及已填房数）"}</p>
            {summary ? <><p className="mt-1">P50 {money(summary.p50, "sgd")} · 平均 {money(summary.mean, "sgd")} · {summary.count} 个样本</p><div className="mt-2 flex flex-wrap gap-2"><Button type="button" variant="outline" size="sm" onClick={() => apply(key, "p50")}>采用 P50</Button><Button type="button" variant="outline" size="sm" onClick={() => apply(key, "mean")}>采用平均值</Button></div></> : <p className="mt-1 text-muted-foreground">{comparable.band ? "当前条件没有样本，保留你的报价。" : "请先填写面积或选定面积档。"}</p>}
          </div>;
        })}
        <p className="text-xs text-muted-foreground">成交窗口 {comparable.window.sales_from ?? "—"} 至 {comparable.window.sales_to ?? "—"}；租赁窗口 {comparable.window.rents_from ?? "—"} 至 {comparable.window.rents_to ?? "—"}。</p>
        {comparable.notes.map(note => <p key={note} className="text-xs text-muted-foreground">{note}</p>)}
      </div>}
      {p.project && !project && <p className="text-xs text-muted-foreground">此楼盘没有已存储资料；金额和假设仍按当前输入计算。</p>}
    </div>
  </Card>;
}
