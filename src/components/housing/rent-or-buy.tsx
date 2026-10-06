"use client";

import { GuidedInputs } from "./guided-inputs";
import { CPF_PR_RULES, newGuidance, parseGuidance } from "@/lib/housing-guidance";
import { dayInSG } from "@/lib/dates";
import { useMemo, useState } from "react";
import { toast } from "sonner";
import { Save, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { NumberInput } from "@/components/ui/number-input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Segmented } from "@/components/finance/segmented";
import type { Confirmation } from "@/components/finance/confirm-dialog";
import { compactMoney, money } from "@/lib/finance-format";
import {
  ABSD_RATES, DEFAULT_INPUTS, ESTIMATED, HOME_KINDS, LOAN_TYPES, PRIVATE_MARKETS, PRIVATE_SEGMENTS, RESIDENCIES, RESIDENCY_LABELS, comparisonReady, clampInputs, findSeries, inTodaysMoney,
  pointsOf, quarterFromNumber, quarterLabel, quarterNumber, quarterYear, rentOrBuy, withinLimits,
  type Estimated, type HomeKind, type LoanType, type MarketData, type OwningMonth, type Projection, type Residency, type ScenarioInputs,
} from "@/lib/housing";
import {
  SIMULATED_YEARS, STRESSES, estimatesFor, expectedEconomy, marketModel, stressed, withEstimates,
  type Estimates, type Model, type Simulation, type SoraOutlook, type Stress,
} from "@/lib/housing-model";
import { cn } from "@/lib/utils";
import { housingAction, messageOf, type Scenario } from "./api";
import { FanChart, type FanRow } from "./fan-chart";
import { LinesChart, yearTicks, type LineRow } from "./line-chart";
import { Card, Stat, share } from "./market-view";
import { useSimulation } from "./use-simulation";

/** What is being worked on: a kept scenario, by id, or a new one. */
export type Draft = { id: string | null; name: string; inputs: ScenarioInputs };
/** A new comparison leaves every input it can to the market's live estimates. */
export const NEW_DRAFT: Draft = { id: null, name: "", inputs: { ...DEFAULT_INPUTS, auto: [...ESTIMATED], price: NaN, rent: NaN, guidance: newGuidance(dayInSG(new Date())) } };

type NumberKey = { [K in keyof ScenarioInputs]: ScenarioInputs[K] extends number ? K : never }[keyof ScenarioInputs] & string;

/** Each number's label, unit and step. */
const FIELDS: Partial<Record<NumberKey, { label: string; unit: string; step?: number }>> = {
  price: { label: "购房价格", unit: "S$", step: 10_000 },
  loan_share: { label: "贷款比例", unit: "房价 %", step: 5 },
  loan_rate: { label: "年利率", unit: "%/年", step: 0.05 },
  loan_years: { label: "贷款年限", unit: "年", step: 1 },
  lock_years: { label: "固定利率期", unit: "年", step: 1 },
  spread: { label: "之后 SORA 加点", unit: "%/年", step: 0.05 },
  maintenance: { label: "物业 / 管理费", unit: "S$/月", step: 10 },
  annual_value: { label: "IRAS Annual value", unit: "S$/年", step: 1_000 },
  upkeep: { label: "维修 / 保险", unit: "S$/年", step: 100 },
  buy_costs: { label: "法律及其他费用", unit: "S$", step: 500 },
  renovation: { label: "装修预算", unit: "S$", step: 5_000 },
  sell_costs: { label: "出售费用", unit: "房价 %", step: 0.5 },
  rent: { label: "整套月租", unit: "S$/月", step: 100 },
  rent_growth: { label: "租金增长", unit: "%/年", step: 0.5 },
  rent_costs: { label: "租赁中介及印花税", unit: "S$/年", step: 100 },
  growth: { label: "房价增长", unit: "%/年", step: 0.5 },
  invest_return: { label: "投资回报", unit: "%/年", step: 0.5 },
  cost_growth: { label: "通胀 / 费用增长", unit: "%/年", step: 0.5 },
  years: { label: "持有比较年限", unit: "年", step: 1 },
  cpf_balance: { label: "现有 OA 余额", unit: "S$", step: 1_000 },
  cpf_monthly: { label: "OA 月缴款", unit: "S$/月", step: 100 },
  cpf_rate: { label: "OA 年利率", unit: "%/年", step: 0.1 },
};

const isEstimated = (key: string): key is Estimated => (ESTIMATED as readonly string[]).includes(key);

/** The estimates, as the assumptions name them. */
const ESTIMATE_LABELS: Record<Estimated, string> = {
  loan_rate: "The loan's rate",
  growth: "The home's price",
  rent_growth: "Rents",
  cost_growth: "Inflation and running costs",
  invest_return: "Investments",
};

const KIND_LABELS: Record<HomeKind, string> = { hdb: "HDB flat", private: "Private" };
const LOAN_LABELS: Record<LoanType, string> = { hdb: "HDB loan", bank: "Bank loan" };
const NTH_OPTIONS = [{ value: "1", label: "First" }, { value: "2", label: "Second" }, { value: "3", label: "Third+" }] as const;

/** What could go wrong, and what trying it does. */
const STRESS_TEXT: Record<Stress, { label: string; note: string }> = {
  none: { label: "As expected", note: "The future the estimates expect, and futures drawn around it." },
  rates: { label: "SORA +2 points", note: "SORA two points above what is expected, from next year on: a bank loan pays it once its rate is no longer fixed." },
  rents: { label: "Rents flat 3 years", note: "Rents held where they are for three years, the annual value with them, then rising as expected." },
  prices: { label: "Prices −15% in year 2", note: "The home loses 15% of its value through the second year, and stays that much below where it would have been." },
};

// The same colours as the market's: buying is the price's, renting the rent's;
// what is expected, and SORA, the third.
const BUY = "var(--series-1)", RENT = "var(--series-2)", THIRD = "var(--series-3)";

const yearLabel = (x: number) => (x === 0 ? "Now" : `${x}y`);
const yearsText = (n: number) => `${n} year${n === 1 ? "" : "s"}`;
const signedMoney = (n: number) => compactMoney(n, "sgd", { sign: true, digits: 2 });
const axisMoney = (v: number) => compactMoney(v, "sgd", { digits: 1 });
/** A rate, % a year: to a tenth, or a hundredth where it has one. */
const rateText = (n: number) => {
  const r = Number(n.toFixed(2));
  return `${Number.isInteger(Math.round(r * 100) / 10) ? r.toFixed(1) : r.toFixed(2)}%`;
};
/** SORA and what is paid over it, to a hundredth of a point. */
const points = (n: number) => `${n.toFixed(2)}%`;

export function RentOrBuy({ draft, setDraft, market, scenarios, onSaved, onDeleted, onConfirm }: {
  draft: Draft;
  setDraft: (update: (d: Draft) => Draft) => void;
  market: MarketData;
  scenarios: Scenario[];
  onSaved: (scenario: Scenario) => void;
  onDeleted: (id: string) => void;
  onConfirm: (confirmation: Confirmation) => void;
}) {
  const [saving, setSaving] = useState(false);
  const [stress, setStress] = useState<Stress>("none");
  const inputs = draft.inputs;
  const [advanced, setAdvanced] = useState(!draft.inputs.guidance);
  const ready = comparisonReady(inputs);
  // A number half typed -- an emptied field, a year of 0 -- is worked out at
  // the nearest it may be, and its field marked; saving says what is wrong.
  const typed = useMemo(() => {
    const out = clampInputs(inputs);
    try { if (out.guidance) out.guidance = parseGuidance(out.guidance); } catch { delete out.guidance; }
    if (out.guidance?.annual_value_auto) out.annual_value = Math.min(10_000_000, out.rent * 12);
    return out;
  }, [inputs]);
  // What the market's history says, for this kind of home in its market; the
  // inputs left to it take its estimates, and the comparison runs on those.
  const model = useMemo(() => marketModel(market, { kind: typed.kind, market: typed.market }), [market, typed.kind, typed.market]);
  const estimates = useMemo(() => estimatesFor(model, typed), [model, typed]);
  const resolved = useMemo(() => withEstimates(typed, estimates), [typed, estimates]);
  const result = useMemo(() => rentOrBuy(resolved, stressed(expectedEconomy(resolved, model), stress)), [resolved, model, stress]);
  const { simulation, drawing } = useSimulation(resolved, model, stress, ready && inputs.years <= SIMULATED_YEARS);
  const kept = scenarios.find((s) => s.id === draft.id) ?? null;
  const changed = !kept || kept.name !== draft.name.trim() || JSON.stringify(kept.inputs) !== JSON.stringify(inputs);

  const set = (next: Partial<ScenarioInputs>) => setDraft((d) => {
    const merged = { ...d.inputs, ...next };
    if (merged.guidance && (["residency", "nth", "kind"] as const).some(k => next[k] !== undefined && next[k] !== d.inputs[k])) merged.guidance = { ...merged.guidance, confirmed: false };
    if (next.residency === "pr" && next.residency !== d.inputs.residency && merged.guidance?.cpf_mode === "salary") merged.guidance = { ...merged.guidance, cpf_rules:CPF_PR_RULES, cpf_scheme:"graduated" };
    // HDB lends for HDB flats only.
    if (merged.kind === "private" && merged.loan_type === "hdb") merged.loan_type = "bank";
    return { ...d, inputs: merged };
  });
  /** Hands an input to the market's estimate, or takes it back. */
  const setAuto = (key: Estimated, on: boolean) => setDraft((d) => ({
    ...d,
    inputs: { ...d.inputs, auto: ESTIMATED.filter((k) => (k === key ? on : d.inputs.auto.includes(k))) },
  }));
  /** A number typed: the owner's own from then on. Emptied, an input the
   *  market can set goes back to its estimate. */
  const setNumber = (key: NumberKey, value: number) => {
    if (isEstimated(key) && Number.isNaN(value)) setAuto(key, true);
    else setDraft((d) => ({ ...d, inputs: { ...d.inputs, [key]: value, ...(key === "annual_value" && d.inputs.guidance ? { guidance: { ...d.inputs.guidance, annual_value_auto: false } } : {}), auto: d.inputs.auto.filter((k) => k !== key) } }));
  };

  async function save(asNew: boolean) {
    if (!ready) { toast.error("请完成必填项、身份确认及 CPF 资格确认。"); return; }
    const name = draft.name.trim();
    if (!name) { toast.error("Give it a name first"); return; }
    setSaving(true);
    try {
      const { scenario } = await housingAction<{ scenario: Scenario }>("saveScenario", { id: asNew ? null : draft.id, name, inputs: { ...inputs, annual_value: typed.annual_value } });
      onSaved(scenario);
      setDraft(() => ({ id: scenario.id, name: scenario.name, inputs: scenario.inputs }));
      toast.success(asNew || !draft.id ? `Saved ${scenario.name}` : `Updated ${scenario.name}`);
    } catch (err) {
      toast.error(messageOf(err));
    } finally {
      setSaving(false);
    }
  }

  function remove() {
    if (!kept) return;
    onConfirm({
      title: `Delete ${kept.name}?`,
      description: "The comparison goes; the market figures stay.",
      action: "Delete",
      run: async () => {
        try {
          await housingAction("deleteScenario", { id: kept.id });
          onDeleted(kept.id);
          setDraft((d) => ({ ...d, id: null }));
          toast.success(`Deleted ${kept.name}`);
        } catch (err) {
          toast.error(messageOf(err));
        }
      },
    });
  }

  const field = (key: NumberKey) => {
    const f = FIELDS[key]!;
    const estimate = isEstimated(key) ? estimates[key] : undefined;
    const auto = !!estimate && isEstimated(key) && inputs.auto.includes(key);
    const label = key === "loan_rate" && typed.loan_type === "bank" ? "银行固定利率" : f.label;
    return (
      <div key={key} className="min-w-0 space-y-1.5">
        <Label htmlFor={`rb-${key}`} className="flex items-baseline justify-between gap-1.5 text-xs font-normal text-muted-foreground">
          <span className="truncate">{label}</span>
          <span className="shrink-0 text-[11px] text-muted-foreground/80">{f.unit}</span>
        </Label>
        <NumberInput
          id={`rb-${key}`}
          value={key === "annual_value" && inputs.guidance?.annual_value_auto ? typed.annual_value : auto ? estimate.value : inputs[key]}
          onValueChange={(v) => setNumber(key, v)}
          // Emptied, an input the market can set goes back to it.
          emptyValue={isEstimated(key) ? Number.NaN : 0}
          step={f.step}
          aria-invalid={(!auto && !withinLimits(key, inputs[key])) || undefined}
          className={cn("h-9 tabular-nums", auto && "bg-muted/50")}
        />
        {key === "annual_value" && inputs.guidance && <button type="button" onClick={() => set({ guidance: { ...inputs.guidance!, annual_value_auto: true } })} className="text-[11px] text-muted-foreground underline">{inputs.guidance.annual_value_auto ? "粗估：整套月租 × 12" : "恢复月租 × 12 粗估"}</button>}
        {estimate && isEstimated(key) && (auto
          ? <p className="text-[11px] text-muted-foreground">自动估算：市场历史数据</p>
          : (
            <button type="button" onClick={() => setAuto(key, true)} className="text-[11px] text-muted-foreground underline-offset-2 hover:text-foreground hover:underline">
              Market&rsquo;s: {rateText(estimate.value)}
            </button>
          ))}
      </div>
    );
  };

  const bank = typed.loan_type === "bank";
  return (
    <div className="grid gap-6 lg:grid-cols-[minmax(0,22rem)_minmax(0,1fr)]">
      <div className="space-y-4">
        <Card title="保存比较方案">
          <div className="space-y-3">
            <Select
              value={draft.id ?? "new"}
              onValueChange={(v) => {
                const s = scenarios.find((x) => x.id === v);
                setDraft(() => (s ? { id: s.id, name: s.name, inputs: s.inputs } : { ...NEW_DRAFT, inputs: draft.inputs }));
              }}
            >
              <SelectTrigger aria-label="Saved comparisons" className="h-9 w-full">
                <SelectValue>{(v: string | null) => scenarios.find((s) => s.id === v)?.name ?? "New comparison"}</SelectValue>
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="new">New comparison</SelectItem>
                {scenarios.map((s) => <SelectItem key={s.id} value={s.id}>{s.name}</SelectItem>)}
              </SelectContent>
            </Select>
            <Input aria-label="Name" placeholder="方案名称（保存时必填）" value={draft.name} maxLength={80} onChange={(e) => setDraft((d) => ({ ...d, name: e.target.value }))} className="h-9" />
            <div className="flex flex-wrap gap-2">
              <Button size="sm" disabled={saving || !changed || !ready} onClick={() => save(false)}><Save /> {draft.id ? "Save" : "Keep"}</Button>
              {draft.id && <Button size="sm" variant="outline" disabled={saving || !ready} onClick={() => save(true)}>Save as new</Button>}
              {kept && <Button size="sm" variant="ghost" className="ml-auto text-destructive" onClick={remove} aria-label={`Delete ${kept.name}`}><Trash2 /></Button>}
            </div>
            {kept && changed && <p className="text-xs text-muted-foreground">Changed since it was saved.</p>}
          </div>
        </Card>

        <GuidedInputs inputs={inputs} onChange={set} />
        <Button type="button" variant="outline" className="w-full" aria-expanded={advanced} onClick={() => setAdvanced(!advanced)}>{advanced ? "收起高级设置" : "高级设置：贷款、费用和增长假设"}</Button>
        {advanced && <div className="space-y-4">
        <Card title="贷款与市场参数（可调整）">
          <div className="space-y-3">
            <Choice label="Buyer">
              <Segmented label="Buyer" value={inputs.residency} onChange={(v: Residency) => set({ residency: v })} options={RESIDENCIES.map((r) => ({ value: r, label: RESIDENCY_LABELS[r] }))} />
            </Choice>
            <Choice label="Their home">
              <Segmented label="Which home of theirs" value={String(inputs.nth) as "1" | "2" | "3"} onChange={(v) => set({ nth: Number(v) })} options={NTH_OPTIONS} />
            </Choice>
            <Choice label="Home">
              <Segmented label="Kind of home" value={inputs.kind} onChange={(v: HomeKind) => set({ kind: v })} options={HOME_KINDS.map((k) => ({ value: k, label: KIND_LABELS[k] }))} />
            </Choice>
            {inputs.kind === "private" && (
              <Choice label="Market">
                <Select value={inputs.market} onValueChange={(v) => { const m = PRIVATE_MARKETS.find((k) => k === v); if (m) set({ market: m }); }}>
                  <SelectTrigger aria-label="Market" className="h-9 w-40">
                    <SelectValue>{(v: string | null) => PRIVATE_SEGMENTS.find((s) => s.key === v)?.short ?? "Market"}</SelectValue>
                  </SelectTrigger>
                  <SelectContent>{PRIVATE_SEGMENTS.map((s) => <SelectItem key={s.key} value={s.key}>{s.label}</SelectItem>)}</SelectContent>
                </Select>
              </Choice>
            )}
            <Choice label="Loan">
              <Segmented
                label="Loan"
                value={inputs.loan_type}
                onChange={(v: LoanType) => set({ loan_type: v })}
                options={LOAN_TYPES.filter((t) => t === "bank" || inputs.kind === "hdb").map((t) => ({ value: t, label: LOAN_LABELS[t] }))}
              />
            </Choice>
            <div className="grid grid-cols-2 gap-3">
              {(["loan_share", ...(bank && typed.lock_years === 0 ? [] : ["loan_rate" as const]), "loan_years"] as const).map(field)}
              {bank && (["lock_years", "spread"] as const).map(field)}
            </div>
            {bank && (
              <p className="text-xs text-muted-foreground">
                {typed.lock_years > 0 ? `Fixed for ${yearsText(typed.lock_years)}, then` : "From the start,"} 3-month SORA plus the spread, reset every three months.
              </p>
            )}
          </div>
        </Card>

        <Card title="买房费用（默认估算，可调整）" sub="物业费来自管理处；装修按自己的计划；Annual value 请从 IRAS 查询，不等于挂牌年租金。">
          <div className="grid grid-cols-2 gap-3">
            {(["maintenance", "annual_value", "upkeep", "buy_costs", "renovation", "sell_costs"] as const).map(field)}
          </div>
        </Card>

        <Card title="租房费用与增长（可调整）">
          <div className="grid grid-cols-2 gap-3">
            {(["rent_growth", "rent_costs"] as const).map(field)}
          </div>
        </Card>

        <Card title="增长假设（自动估算，可覆盖）" sub="A rate marked auto is the market's live estimate, its reason with the results. Type over it to set your own; empty it to hand it back">
          <div className="grid grid-cols-2 gap-3">
            {(["growth", "invest_return", "cost_growth", "years"] as const).map(field)}
          </div>
        </Card>

        <Card title="CPF 手动参数（可调整）" sub="It pays for a home and its loan, never for rent">
          <div className="grid grid-cols-2 gap-3">
            {(["cpf_balance", "cpf_monthly", "cpf_rate"] as const).map(field)}
          </div>
        </Card>
        </div>}
      </div>

      {ready ? <Results
        typed={typed}
        inputs={resolved}
        result={result}
        estimates={estimates}
        model={model}
        market={market}
        simulation={simulation}
        drawing={drawing}
        stress={stress}
        onStress={setStress}
        onAuto={setAuto}
      /> : <Card title="完成必填项后显示比较"><p className="text-sm text-muted-foreground">填写价格和租金，确认买方身份、房产数及房屋类型。若选择地契或工资估算，还需填写相应信息。超过 35 年的比较需确认地契类型。</p></Card>}

      {/* On a phone the inputs and the results are a long scroll apart: the
          verdict stays in sight while the numbers change. */}
      {ready && <Verdict inputs={resolved} result={result} simulation={drawing ? null : simulation} className="sticky bottom-3 z-10 lg:hidden" />}
    </div>
  );
}

/** What to try: the future expected, or one with something gone wrong. */
function StressPicker({ value, onChange, bank }: { value: Stress; onChange: (stress: Stress) => void; bank: boolean }) {
  return (
    <div className="space-y-2">
      <div role="radiogroup" aria-label="What if" className="flex flex-wrap items-center gap-1.5">
        <span className="mr-1 text-xs text-muted-foreground">What if</span>
        {STRESSES.map((s) => (
          <button
            key={s}
            type="button"
            role="radio"
            aria-checked={value === s}
            onClick={() => onChange(s)}
            className={cn(
              "rounded-full px-3 py-1 text-xs font-medium whitespace-nowrap ring-1 transition-colors outline-none focus-visible:ring-3 focus-visible:ring-ring/50",
              value === s ? "bg-foreground text-background ring-foreground" : "text-muted-foreground ring-foreground/15 hover:text-foreground",
            )}
          >
            {STRESS_TEXT[s].label}
          </button>
        ))}
      </div>
      <p className="text-xs text-muted-foreground">
        {value === "rates" && !bank ? "SORA two points above what is expected -- but an HDB loan's rate is HDB's own, and SORA does not move it." : STRESS_TEXT[value].note}
      </p>
    </div>
  );
}

/** A month of owning taken apart, for a year chosen: what goes out, what of it
 *  is principal and stays yours, and what is truly a cost -- against the rent. */
function MonthTakenApart({ inputs, months, ticks, stress }: { inputs: ScenarioInputs; months: OwningMonth[]; ticks: number[]; stress: Stress }) {
  const [chosen, setChosen] = useState(1);
  const year = Math.min(Math.max(1, chosen), months.length);
  const m = months[year - 1];
  const gap = m.rent - m.net;
  const rows: Array<{ label: string; value: number; note?: string; indent?: boolean; strong?: boolean; sign?: boolean }> = [
    { label: "Goes out each month, CPF and cash", value: m.paid, strong: true },
    { label: "Principal", note: "into the home: still yours, not a cost", value: m.principal, indent: true },
    { label: "贷款利息", value: m.interest, indent: true },
    { label: "S&CC or maintenance, property tax, repairs", value: m.running, indent: true },
    { label: "Stamp duties, fees, renovation, selling", note: `paid once, spread over ${inputs.years} years`, value: m.one_off },
    {
      label: "Opportunity cost",
      note: `the money in the home, had it been invested at ${rateText(inputs.invest_return)}${inputs.cpf_balance + inputs.cpf_monthly > 0 ? ` (CPF's at ${rateText(inputs.cpf_rate)})` : ""}`,
      value: m.opportunity,
    },
    {
      label: "The home's rise in value",
      note: `at ${rateText(inputs.growth)} a year${stress === "prices" ? ", 15% off in year 2" : ""}, set against the costs`,
      value: -m.appreciation,
      sign: true,
    },
    { label: "What owning costs", note: "all but the principal", value: m.net, strong: true },
    { label: "What renting costs", note: "the rent and its fees", value: m.rent, strong: true },
  ];
  const chart: LineRow[] = months.map((x) => ({ x: x.year, title: `Year ${x.year}, a month`, own: x.net, rent: x.rent, paid: x.paid, principal: x.principal }));

  return (
    <Card
      title="A month of owning, taken apart"
      sub="Principal is not a cost: it is still yours, in the home. Interest, the running and one-off costs and what the money would have earned are; the home's rise in value counts against them"
      action={(
        <Select value={String(year)} onValueChange={(v) => setChosen(Number(v))}>
          <SelectTrigger aria-label="Year" className="h-9 w-28"><SelectValue>{(v: string | null) => `Year ${v ?? year}`}</SelectValue></SelectTrigger>
          <SelectContent>{months.map((x) => <SelectItem key={x.year} value={String(x.year)}>Year {x.year}</SelectItem>)}</SelectContent>
        </Select>
      )}
    >
      <table className="w-full text-sm">
        <caption className="sr-only">An average month of year {year}, owning against renting</caption>
        <tbody>
          {rows.map((r) => (
            <tr key={r.label} className="border-b last:border-0">
              <th scope="row" className={cn("py-2 pr-3 text-left", r.strong ? "font-medium" : "font-normal", r.indent && "pl-4 text-muted-foreground")}>
                {r.label}
                {r.note && <span className="ml-1.5 text-xs font-normal text-muted-foreground">{r.note}</span>}
              </th>
              <td className={cn("py-2 text-right tabular-nums whitespace-nowrap", r.strong && "font-medium", r.indent && "text-muted-foreground")}>{money(r.value, "sgd", { sign: r.sign })}</td>
            </tr>
          ))}
        </tbody>
      </table>
      <p className="mt-3 text-sm">
        In year {year}, owning costs <span className="font-medium">{money(Math.abs(gap), "sgd")}</span> a month {gap >= 0 ? "less" : "more"} than renting.
      </p>

      <div className="mt-6">
        <LinesChart
          rows={chart}
          series={[{ key: "own", label: "Owning, what it costs", color: BUY }, { key: "rent", label: "Renting", color: RENT }]}
          format={(v) => money(v, "sgd")}
          axisFormat={axisMoney}
          ticks={ticks}
          xFormat={yearLabel}
          zero
          details={(row) => [
            { label: "goes out, owning", value: money(Number(row.paid), "sgd") },
            { label: "of it principal, still yours", value: money(Number(row.principal), "sgd") },
          ]}
        />
      </div>
      <p className="mt-3 text-xs text-muted-foreground">
        A month at a time, nothing compounds. With nothing earning, these months add up to the gap in what each leaves you with;
        with returns, that gap compounds them, and is the comparison to go by.
      </p>
    </Card>
  );
}

/** The comparison across the futures drawn: how far ahead buying is, the
 *  middle of them and the spread; how likely it is to be ahead; and when it
 *  first pulls ahead. */
function Futures({ result, simulation, drawing, model, ticks }: {
  result: Projection;
  simulation: Simulation | null;
  drawing: boolean;
  model: Model;
  ticks: number[];
}) {
  if (model.history.length === 0) {
    return (
      <Card title="Across many futures">
        <p className="text-sm text-muted-foreground">
          There is not enough of the market&rsquo;s history yet -- prices, rents, consumer prices, shares and SORA, quarter by quarter together -- to draw futures from.
          It comes with the daily job, or with Refresh data.
        </p>
      </Card>
    );
  }
  // None are drawn this far ahead: say so, rather than wait for them.
  if (result.years.length - 1 > SIMULATED_YEARS) {
    return (
      <Card title="Across many futures">
        <p className="text-sm text-muted-foreground">
          Futures are drawn for up to {SIMULATED_YEARS} years ahead. Past that, the market&rsquo;s history is too short to say how often buying comes out ahead, so this comparison shows its central projection and assumptions only.
        </p>
      </Card>
    );
  }
  const from = model.history[0].quarter, to = model.history[model.history.length - 1].quarter;
  const sub = `Each replays ${quarterLabel(from)} to ${quarterLabel(to)} two years at a time, from random places: prices, rents, costs, shares and SORA moving together as they did, around the rates set`;
  if (!simulation || simulation.years.length === 0) {
    return (
      <Card title="Across many futures" sub={sub}>
        <div className="h-96 animate-pulse rounded-xl bg-muted" aria-busy="true" aria-label="Drawing futures" />
      </Card>
    );
  }

  const central = result.years.map((y) => y.buy_net_worth - y.rent_net_worth);
  // The futures' own last year: while new ones are drawn for a longer or
  // shorter look ahead, the last drawn are shown, and say what they cover.
  const end = simulation.years[simulation.years.length - 1];
  const b = simulation.breakEven;
  const after = (y: number) => `After ${yearsText(y)}`;
  const rows: FanRow[] = [
    { x: 0, title: "Now", low: central[0], high: central[0], middle: central[0], expected: central[0] },
    ...simulation.years.map((y) => ({ x: y.year, title: after(y.year), low: y.low, high: y.high, middle: y.middle, expected: central[y.year] ?? null })),
  ];
  const chance: LineRow[] = simulation.years.map((y) => ({ x: y.year, title: after(y.year), ahead: y.ahead }));
  const pulls = b.middle === null
    ? `In half of them it has not pulled ahead within ${yearsText(end.year)}.`
    : `It pulls ahead by year ${b.middle} in half of them${b.late !== null ? `, by year ${b.late} in three of four` : ""}${b.never > 0 ? `; in ${share(b.never, 0)} not within ${yearsText(end.year)}` : ""}.`;

  return (
    <Card title={`Across ${simulation.paths} futures`} sub={sub}>
      <div className={cn("space-y-6 transition-opacity", drawing && "opacity-50")} aria-busy={drawing || undefined}>
        <p className="text-sm">
          After {yearsText(end.year)} buying is ahead in <span className="font-medium">{share(end.ahead, 0)}</span> of them. {pulls}
        </p>
        <div>
          <p className="mb-2 text-xs font-medium">How far buying is ahead of renting, or behind</p>
          <FanChart
            rows={rows}
            band={{ label: "8 in 10 futures", color: BUY }}
            lines={[{ key: "middle", label: "The middle future", color: BUY }, { key: "expected", label: "The future expected", color: THIRD, dashed: true }]}
            format={(v) => compactMoney(v, "sgd", { sign: true, digits: 2 })}
            axisFormat={axisMoney}
            ticks={ticks}
            xFormat={yearLabel}
            reference={0}
          />
        </div>
        <div>
          <p className="mb-2 text-xs font-medium">The chance buying is ahead, selling then</p>
          <LinesChart
            rows={chance}
            series={[{ key: "ahead", label: "Buying ahead", color: BUY }]}
            format={(v) => share(v, 0)}
            scale={{ domain: [0, 1], ticks: [0, 0.25, 0.5, 0.75, 1] }}
            ticks={ticks.filter((t) => t > 0)}
            xFormat={yearLabel}
            reference={0.5}
            height={180}
          />
        </div>
        <details className="group">
          <summary className="cursor-pointer text-xs text-muted-foreground hover:text-foreground">The futures, year by year</summary>
          <div className="-mx-1 mt-3 overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="text-xs text-muted-foreground">
                <tr className="border-b">
                  <th className="py-2 pr-2 text-left font-normal">Year</th>
                  <th className="py-2 pr-2 text-right font-normal">1 in 10 below</th>
                  <th className="py-2 pr-2 text-right font-normal">Middle</th>
                  <th className="py-2 pr-2 text-right font-normal">1 in 10 above</th>
                  <th className="py-2 pr-2 text-right font-normal">Buying ahead</th>
                </tr>
              </thead>
              <tbody>
                {simulation.years.map((y) => (
                  <tr key={y.year} className="border-b last:border-0">
                    <td className="py-2 pr-2">{yearLabel(y.year)}</td>
                    <td className="py-2 pr-2 text-right tabular-nums">{signedMoney(y.low)}</td>
                    <td className="py-2 pr-2 text-right tabular-nums">{signedMoney(y.middle)}</td>
                    <td className="py-2 pr-2 text-right tabular-nums">{signedMoney(y.high)}</td>
                    <td className="py-2 pr-2 text-right tabular-nums">{share(y.ahead, 0)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </details>
      </div>
    </Card>
  );
}

/** What the years ahead are taken to be, each with its reason: the market's
 *  estimates, or the owner's own beside them. And for a bank loan, SORA. */
function Assumptions({ typed, inputs, estimates, model, market, simulation, stress, onAuto }: {
  typed: ScenarioInputs;
  inputs: ScenarioInputs;
  estimates: Estimates;
  model: Model;
  market: MarketData;
  simulation: Simulation | null;
  stress: Stress;
  onAuto: (key: Estimated, on: boolean) => void;
}) {
  const yours = ESTIMATED.filter((k) => estimates[k] && !typed.auto.includes(k));
  return (
    <Card
      title="What the years ahead are taken to be"
      sub="Read off the market's own history as it stands each time the figures are read: returns conservatively, costs as they usually go"
      action={yours.length > 1 ? <Button size="sm" variant="outline" onClick={() => yours.forEach((k) => onAuto(k, true))}>Use the market&rsquo;s for all</Button> : undefined}
    >
      <dl className="divide-y">
        {ESTIMATED.map((k) => {
          const e = estimates[k];
          const auto = !!e && typed.auto.includes(k);
          return (
            <div key={k} className="py-3 first:pt-0 last:pb-0">
              <dt className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1 text-sm">
                <span className="font-medium">{ESTIMATE_LABELS[k]}</span>
                <span className="flex items-baseline gap-2">
                  <span className="tabular-nums">{rateText(inputs[k])} a year</span>
                  <span className="text-xs text-muted-foreground">{auto ? "auto" : "yours"}</span>
                </span>
              </dt>
              <dd className="mt-1 text-xs text-muted-foreground">
                {!e ? "The market's figures make no estimate of it yet." : (
                  <>
                    {!auto && <>The market&rsquo;s is {rateText(e.value)}{" "}<button type="button" onClick={() => onAuto(k, true)} className="font-medium text-foreground underline-offset-2 hover:underline">use it</button>: </>}
                    {e.reason}
                  </>
                )}
              </dd>
            </div>
          );
        })}
      </dl>
      {inputs.loan_type === "bank" && model.sora && (
        <SoraView inputs={inputs} outlook={model.sora} market={market} simulation={simulation} stress={stress} />
      )}
    </Card>
  );
}

/** SORA: where it has been, where the bond market expects it to go, and the
 *  spread of the futures drawn around that. */
function SoraView({ inputs, outlook, market, simulation, stress }: { inputs: ScenarioInputs; outlook: SoraOutlook; market: MarketData; simulation: Simulation | null; stress: Stress }) {
  const nowQuarter = quarterNumber(outlook.latest.quarter);
  const now = quarterYear(outlook.latest.quarter);
  const shift = (y: number) => (stress === "rates" && y >= 1 ? 2 : 0);
  const history = pointsOf(findSeries(market, "sora", "ALL", "3m")).filter((p) => quarterNumber(p.quarter) > nowQuarter - 40 && quarterNumber(p.quarter) <= nowQuarter);
  const rows: FanRow[] = [
    ...history.map((p) => {
      const latest = p.quarter === outlook.latest.quarter;
      return { x: quarterYear(p.quarter), title: quarterLabel(p.quarter), low: latest ? p.value : null, high: latest ? p.value : null, sora: p.value, expected: latest ? p.value : null };
    }),
    ...Array.from({ length: inputs.years }, (_, k) => k + 1).map((y) => {
      const drawn = simulation?.years[y - 1]?.sora;
      return {
        x: now + y,
        title: quarterLabel(quarterFromNumber(nowQuarter + 4 * y)),
        low: drawn ? drawn[0] : null,
        high: drawn ? drawn[2] : null,
        sora: null,
        expected: outlook.expected[Math.min(4 * y, outlook.expected.length - 1)] + shift(y),
      };
    }),
  ];
  const [f1, f2, f5, f10] = outlook.forwards.map((f) => points(f.rate));
  const halfLife = outlook.persistence > 0 ? Math.log(0.5) / Math.log(outlook.persistence) / 4 : 0;
  return (
    <div className="mt-5 space-y-3 border-t pt-5">
      <div>
        <p className="text-sm font-medium">SORA, and where it is expected to go</p>
        <p className="mt-1 text-xs text-muted-foreground">
          3-month compounded SORA was {points(outlook.latest.value)} in {quarterLabel(outlook.latest.quarter)}. Government bond yields, less the premium
          each has paid over SORA since {outlook.since}, expect it to average {f1} over the next year, {f2} the year after, {f5} in years three to five
          and {f10} after. {inputs.lock_years > 0 ? `Once its rate is no longer fixed, after ${yearsText(inputs.lock_years)}, the` : "The"} loan
          pays SORA and its {points(inputs.spread)} spread, reset every three months. In the futures drawn SORA strays from that path as it has:
          about {outlook.shock.toFixed(2)} points a quarter, half of a departure gone in {halfLife.toFixed(1)} years, and never below nothing.
        </p>
      </div>
      <FanChart
        rows={rows}
        band={{ label: "8 in 10 futures", color: THIRD }}
        lines={[{ key: "sora", label: "SORA", color: THIRD }, { key: "expected", label: stress === "rates" ? "Expected, 2 points up" : "Expected", color: THIRD, dashed: true }]}
        format={points}
        axisFormat={(v) => `${Number(v.toFixed(2))}%`}
        ticks={yearTicks(rows[0]?.x ?? now, rows[rows.length - 1]?.x ?? now, 6)}
        xFormat={(x) => String(Math.round(x))}
        height={220}
      />
    </div>
  );
}

/** The comparison in a line: when buying pulls ahead, by how much at the end,
 *  and in how many of the futures drawn. */
function Verdict({ inputs, result, simulation, className }: { inputs: ScenarioInputs; result: Projection; simulation: Simulation | null; className?: string }) {
  const last = result.years[result.years.length - 1];
  const difference = last.buy_net_worth - last.rent_net_worth;
  const subject = result.break_even === null ? "renting" : "buying";
  const lead = difference >= 0 ? "buying" : "renting";
  const amount = compactMoney(Math.abs(difference), "sgd", { digits: 1 });
  const chance = simulation?.years[simulation.years.length - 1]?.ahead;
  return (
    <p className={cn("rounded-xl bg-popover px-4 py-2.5 text-sm shadow-md ring-1 ring-foreground/10", className)}>
      {result.break_even === null ? `Renting stays ahead all ${inputs.years} years` : `Buying pulls ahead in year ${result.break_even}`}
      <span className="text-muted-foreground">
        {` · ${lead === subject ? "" : `${lead} `}${amount} ahead at year ${inputs.years}`}
        {` · 今天的钱 ${compactMoney(Math.abs(inTodaysMoney(difference, inputs.cost_growth, inputs.years)), "sgd", { digits: 1 })}`}
        {chance !== undefined && ` · buying ahead in ${share(chance, 0)} of futures`}
      </span>
    </p>
  );
}

function Choice({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex items-center justify-between gap-3">
      <span className="text-xs text-muted-foreground">{label}</span>
      {children}
    </div>
  );
}

/** What it comes to: the money up front, the months, the years, the futures. */
function Results({ typed, inputs, result, estimates, model, market, simulation, drawing, stress, onStress, onAuto }: {
  typed: ScenarioInputs;
  inputs: ScenarioInputs;
  result: Projection;
  estimates: Estimates;
  model: Model;
  market: MarketData;
  simulation: Simulation | null;
  drawing: boolean;
  stress: Stress;
  onStress: (stress: Stress) => void;
  onAuto: (key: Estimated, on: boolean) => void;
}) {
  const { upfront, years } = result;
  const last = years[years.length - 1];
  const first = result.monthly[0];
  const difference = last.buy_net_worth - last.rent_net_worth;
  const absdRate = ABSD_RATES[inputs.residency][Math.min(3, inputs.nth) - 1];
  const ticks = yearTicks(0, inputs.years, 8);
  const terms = inputs.loan_type !== "bank" ? "" : inputs.lock_years > 0 ? `, fixed ${yearsText(inputs.lock_years)}, then SORA + ${rateText(inputs.spread)}` : `, SORA + ${rateText(inputs.spread)}`;

  const worth: LineRow[] = years.map((y) => ({ x: y.year, title: y.year === 0 ? "Now" : `After ${yearsText(y.year)}`, buy: y.buy_net_worth, rent: y.rent_net_worth }));

  return (
    <div className="min-w-0 space-y-4">
      <Card title="先看实际需要准备的钱"><p className="text-sm">购房时需要现金 {money(upfront.from_cash, "sgd")}，使用现有 OA {money(upfront.from_cpf, "sgd")}；第一年月均支出（含 CPF）{money(first.paid, "sgd")}，其中房贷 {money(result.instalment, "sgd")}/月。</p><p className="mt-2 text-xs text-muted-foreground">这是成本和净资产比较，不是贷款获批或负担能力结论；TDSR / MSR、年龄、已有债务和联名购房资格需另核实。</p></Card>
      <StressPicker value={stress} onChange={onStress} bank={inputs.loan_type === "bank"} />

      <div className="grid grid-cols-2 gap-3 xl:grid-cols-3">
        <Stat
          label="一次性投入（现金 + CPF）"
          value={compactMoney(upfront.total, "sgd", { digits: 2 })}
          title={money(upfront.total, "sgd")}
          sub={upfront.from_cpf > 0 ? `${compactMoney(upfront.from_cpf, "sgd", { digits: 1 })} CPF, ${compactMoney(upfront.from_cash, "sgd", { digits: 1 })} cash` : "All in cash"}
        />
        <Stat
          label="购房印花税（自动计算）"
          value={compactMoney(upfront.bsd + upfront.absd, "sgd", { digits: 2 })}
          title={money(upfront.bsd + upfront.absd, "sgd")}
          sub={`BSD ${money(upfront.bsd, "sgd")}${upfront.absd ? `, ABSD ${share(absdRate, 0)} ${money(upfront.absd, "sgd")}` : ", no ABSD"}`}
        />
        <Stat
          label="房贷月供"
          value={`${money(result.instalment, "sgd")}/mo`}
          sub={`${compactMoney(upfront.loan, "sgd", { digits: 2 })} over ${inputs.loan_years} years at ${rateText(years[0].loan_rate ?? inputs.loan_rate)}${terms}`}
        />
        <Stat
          label="第一年：买房与租房的月成本"
          value={`${money(first.net, "sgd")} vs ${money(first.rent, "sgd")}`}
          sub={`Owning against renting. ${money(first.paid, "sgd")} goes out; ${money(first.principal, "sgd")} of it is principal, still yours`}
        />
        <Stat
          label="Buying pulls ahead"
          value={result.break_even === null ? "Not yet" : `Year ${result.break_even}`}
          sub={result.break_even === null ? `Not within ${inputs.years} years` : "Selling then would leave more than renting"}
        />
        <Stat
          label={`After ${inputs.years} years, ${difference >= 0 ? "buying" : "renting"} is ahead by`}
          value={compactMoney(Math.abs(difference), "sgd", { digits: 2 })}
          title={money(Math.abs(difference), "sgd")}
          sub={`折合今天的钱 ${compactMoney(Math.abs(inTodaysMoney(difference, inputs.cost_growth, inputs.years)), "sgd", { digits: 2 })} · 通胀 ${rateText(inputs.cost_growth)}/年${inputs.guidance ? ` · 基准 ${inputs.guidance.as_of}` : " · 基准为比较起点"}`}
        />
      </div>

      <Card title="What each leaves you with" sub="In the future expected, everything at each year's end, the home as though sold then: its price less the loan and the costs of selling, plus investments and CPF">
        <LinesChart
          rows={worth}
          series={[{ key: "buy", label: "Buying", color: BUY }, { key: "rent", label: "Renting", color: RENT }]}
          format={(v) => compactMoney(v, "sgd", { digits: 2 })}
          axisFormat={axisMoney}
          ticks={ticks}
          xFormat={yearLabel}
          height={280}
          details={(row) => {
            const d = Number(row.buy) - Number(row.rent);
            return [{ label: d >= 0 ? "buying ahead" : "renting ahead", value: money(Math.abs(d), "sgd") }];
          }}
        />
      </Card>

      <Futures result={result} simulation={simulation} drawing={drawing} model={model} ticks={ticks} />

      <MonthTakenApart inputs={inputs} months={result.monthly} ticks={ticks.filter((t) => t > 0)} stress={stress} />

      <Assumptions typed={typed} inputs={inputs} estimates={estimates} model={model} market={market} simulation={drawing ? null : simulation} stress={stress} onAuto={onAuto} />

      <Card title="Year by year" sub="In the future expected">
        <div className="-mx-1 overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="text-xs text-muted-foreground">
              <tr className="border-b">
                <th className="py-2 pr-2 text-left font-normal">Year</th>
                <th className="py-2 pr-2 text-right font-normal">Home</th>
                <th className="hidden py-2 pr-2 text-right font-normal sm:table-cell">Loan</th>
                <th className="hidden py-2 pr-2 text-right font-normal sm:table-cell">Rate</th>
                <th className="py-2 pr-2 text-right font-normal">Buying</th>
                <th className="py-2 pr-2 text-right font-normal">Renting</th>
                <th className="py-2 pr-2 text-right font-normal">Difference</th>
                <th className="hidden py-2 pr-2 text-right font-normal md:table-cell">To CPF on sale</th>
              </tr>
            </thead>
            <tbody>
              {years.map((y) => {
                const d = y.buy_net_worth - y.rent_net_worth;
                return (
                  <tr key={y.year} className={cn("border-b last:border-0", y.year === result.break_even && "bg-muted")}>
                    <td className="py-2 pr-2">{yearLabel(y.year)}</td>
                    <td className="py-2 pr-2 text-right tabular-nums">{compactMoney(y.home_value, "sgd", { digits: 2 })}</td>
                    <td className="hidden py-2 pr-2 text-right tabular-nums sm:table-cell">{compactMoney(y.loan_balance, "sgd", { digits: 2 })}</td>
                    <td className="hidden py-2 pr-2 text-right tabular-nums sm:table-cell">{y.loan_rate === null ? "–" : rateText(y.loan_rate)}</td>
                    <td className="py-2 pr-2 text-right tabular-nums">{compactMoney(y.buy_net_worth, "sgd", { digits: 2 })}</td>
                    <td className="py-2 pr-2 text-right tabular-nums">{compactMoney(y.rent_net_worth, "sgd", { digits: 2 })}</td>
                    <td className="py-2 pr-2 text-right tabular-nums">{signedMoney(d)}</td>
                    <td className="hidden py-2 pr-2 text-right tabular-nums md:table-cell">{compactMoney(y.cpf_refund, "sgd", { digits: 2 })}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </Card>

      {result.notes.length > 0 && (
        <ul className="space-y-1 rounded-xl bg-muted/60 px-4 py-3 text-sm">
          {result.notes.map((n) => <li key={n}>{n}</li>)}
        </ul>
      )}
      <p className="text-xs text-muted-foreground">
        Stamp duties and property tax as IRAS published them in October 2026: BSD up to 6%; ABSD by who buys and which home it is;
        seller&rsquo;s stamp duty on a sale within four years; owner-occupier property tax on the annual value, which moves with rents.
        Both sides start with the same money and spend the same each month; whichever costs less invests the rest. A lease and the
        annual value are renewed each year at the market then. Charts show Singapore dollars of the future. The gap also shows today’s purchasing power, discounted at the CPI-based inflation / cost-growth assumption (or your override) from the comparison’s baseline date.
      </p>
    </div>
  );
}
