"use client";

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
  ABSD_RATES, DEFAULT_INPUTS, HOME_KINDS, LOAN_TYPES, RESIDENCIES, RESIDENCY_LABELS, clampInputs, rentOrBuy, withinLimits,
  type HomeKind, type LoanType, type OwningMonth, type Projection, type Residency, type ScenarioInputs,
} from "@/lib/housing";
import { cn } from "@/lib/utils";
import { housingAction, messageOf, type Scenario } from "./api";
import { LinesChart, yearTicks, type LineRow } from "./line-chart";
import { Card, Stat, share } from "./market-view";

/** What is being worked on: a kept scenario, by id, or a new one. */
export type Draft = { id: string | null; name: string; inputs: ScenarioInputs };
export const NEW_DRAFT: Draft = { id: null, name: "", inputs: DEFAULT_INPUTS };

type NumberKey = { [K in keyof ScenarioInputs]: ScenarioInputs[K] extends number ? K : never }[keyof ScenarioInputs];

/** Each number's label, unit and step. */
const FIELDS: Partial<Record<NumberKey, { label: string; unit: string; step?: number }>> = {
  price: { label: "Price", unit: "S$", step: 10_000 },
  loan_share: { label: "Borrowed", unit: "% of price", step: 5 },
  loan_rate: { label: "Interest", unit: "%/yr", step: 0.05 },
  loan_years: { label: "Loan term", unit: "years", step: 1 },
  maintenance: { label: "S&CC, maintenance", unit: "S$/mo", step: 10 },
  annual_value: { label: "Annual value", unit: "S$/yr", step: 1_000 },
  upkeep: { label: "Repairs, insurance", unit: "S$/yr", step: 100 },
  buy_costs: { label: "Legal, other fees", unit: "S$", step: 500 },
  renovation: { label: "Renovation", unit: "S$", step: 5_000 },
  sell_costs: { label: "Selling costs", unit: "% of price", step: 0.5 },
  rent: { label: "Rent", unit: "S$/mo", step: 100 },
  rent_growth: { label: "Rent growth", unit: "%/yr", step: 0.5 },
  rent_costs: { label: "Agent fees, duty", unit: "S$/yr", step: 100 },
  growth: { label: "Price growth", unit: "%/yr", step: 0.5 },
  invest_return: { label: "Investments earn", unit: "%/yr", step: 0.5 },
  years: { label: "Look ahead", unit: "years", step: 1 },
  cpf_balance: { label: "OA balance", unit: "S$", step: 1_000 },
  cpf_monthly: { label: "OA contributions", unit: "S$/mo", step: 100 },
  cpf_rate: { label: "OA interest", unit: "%/yr", step: 0.1 },
};

const KIND_LABELS: Record<HomeKind, string> = { hdb: "HDB flat", private: "Private" };
const LOAN_LABELS: Record<LoanType, string> = { hdb: "HDB loan", bank: "Bank loan" };
const NTH_OPTIONS = [{ value: "1", label: "First" }, { value: "2", label: "Second" }, { value: "3", label: "Third+" }] as const;

// The same colours as the market's: buying is the price's, renting the rent's.
const BUY = "var(--series-1)", RENT = "var(--series-2)";

const yearLabel = (x: number) => (x === 0 ? "Now" : `${x}y`);
const signedMoney = (n: number) => compactMoney(n, "sgd", { sign: true, digits: 2 });
const axisMoney = (v: number) => compactMoney(v, "sgd", { digits: 1 });

export function RentOrBuy({ draft, setDraft, scenarios, onSaved, onDeleted, onConfirm }: {
  draft: Draft;
  setDraft: (update: (d: Draft) => Draft) => void;
  scenarios: Scenario[];
  onSaved: (scenario: Scenario) => void;
  onDeleted: (id: string) => void;
  onConfirm: (confirmation: Confirmation) => void;
}) {
  const [saving, setSaving] = useState(false);
  const inputs = draft.inputs;
  // A number half typed -- an emptied field, a year of 0 -- is worked out at
  // the nearest it may be, and its field marked; saving says what is wrong.
  const result = useMemo(() => rentOrBuy(clampInputs(inputs)), [inputs]);
  const kept = scenarios.find((s) => s.id === draft.id) ?? null;
  const changed = !kept || kept.name !== draft.name.trim() || JSON.stringify(kept.inputs) !== JSON.stringify(inputs);

  const set = (next: Partial<ScenarioInputs>) => setDraft((d) => {
    const merged = { ...d.inputs, ...next };
    // HDB lends for HDB flats only.
    if (merged.kind === "private" && merged.loan_type === "hdb") merged.loan_type = "bank";
    return { ...d, inputs: merged };
  });

  async function save(asNew: boolean) {
    const name = draft.name.trim();
    if (!name) { toast.error("Give it a name first"); return; }
    setSaving(true);
    try {
      const { scenario } = await housingAction<{ scenario: Scenario }>("saveScenario", { id: asNew ? null : draft.id, name, inputs });
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
    return (
      <div key={key} className="min-w-0 space-y-1.5">
        <Label htmlFor={`rb-${key}`} className="flex items-baseline justify-between gap-1.5 text-xs font-normal text-muted-foreground">
          <span className="truncate">{f.label}</span>
          <span className="shrink-0 text-[11px] text-muted-foreground/80">{f.unit}</span>
        </Label>
        <NumberInput
          id={`rb-${key}`}
          value={inputs[key]}
          onValueChange={(v) => set({ [key]: v } as Partial<ScenarioInputs>)}
          step={f.step}
          aria-invalid={!withinLimits(key, inputs[key]) || undefined}
          className="h-9 tabular-nums"
        />
      </div>
    );
  };

  return (
    <div className="grid gap-6 lg:grid-cols-[minmax(0,22rem)_minmax(0,1fr)]">
      <div className="space-y-4">
        <Card title="Comparison">
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
            <Input aria-label="Name" placeholder="Name, to keep it" value={draft.name} maxLength={80} onChange={(e) => setDraft((d) => ({ ...d, name: e.target.value }))} className="h-9" />
            <div className="flex flex-wrap gap-2">
              <Button size="sm" disabled={saving || !changed} onClick={() => save(false)}><Save /> {draft.id ? "Save" : "Keep"}</Button>
              {draft.id && <Button size="sm" variant="outline" disabled={saving} onClick={() => save(true)}>Save as new</Button>}
              {kept && <Button size="sm" variant="ghost" className="ml-auto text-destructive" onClick={remove} aria-label={`Delete ${kept.name}`}><Trash2 /></Button>}
            </div>
            {kept && changed && <p className="text-xs text-muted-foreground">Changed since it was saved.</p>}
          </div>
        </Card>

        <Card title="The buyer and the home">
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
            <Choice label="Loan">
              <Segmented
                label="Loan"
                value={inputs.loan_type}
                onChange={(v: LoanType) => set({ loan_type: v })}
                options={LOAN_TYPES.filter((t) => t === "bank" || inputs.kind === "hdb").map((t) => ({ value: t, label: LOAN_LABELS[t] }))}
              />
            </Choice>
            <div className="grid grid-cols-2 gap-3">
              {(["price", "loan_share", "loan_rate", "loan_years"] as const).map(field)}
            </div>
          </div>
        </Card>

        <Card title="Owning it">
          <div className="grid grid-cols-2 gap-3">
            {(["maintenance", "annual_value", "upkeep", "buy_costs", "renovation", "sell_costs"] as const).map(field)}
          </div>
        </Card>

        <Card title="Renting instead">
          <div className="grid grid-cols-2 gap-3">
            {(["rent", "rent_growth", "rent_costs"] as const).map(field)}
          </div>
        </Card>

        <Card title="Assumptions">
          <div className="grid grid-cols-2 gap-3">
            {(["growth", "invest_return", "years"] as const).map(field)}
          </div>
        </Card>

        <Card title="CPF Ordinary Account" sub="It pays for a home and its loan, never for rent">
          <div className="grid grid-cols-2 gap-3">
            {(["cpf_balance", "cpf_monthly", "cpf_rate"] as const).map(field)}
          </div>
        </Card>
      </div>

      <Results inputs={clampInputs(inputs)} result={result} />

      {/* On a phone the inputs and the results are a long scroll apart: the
          verdict stays in sight while the numbers change. */}
      <Verdict inputs={clampInputs(inputs)} result={result} className="sticky bottom-3 z-10 lg:hidden" />
    </div>
  );
}

/** A month of owning taken apart, for a year chosen: what goes out, what of it
 *  is principal and stays yours, and what is truly a cost -- against the rent. */
function MonthTakenApart({ inputs, months, ticks }: { inputs: ScenarioInputs; months: OwningMonth[]; ticks: number[] }) {
  const [chosen, setChosen] = useState(1);
  const year = Math.min(Math.max(1, chosen), months.length);
  const m = months[year - 1];
  const gap = m.rent - m.net;
  const pct = (n: number) => `${Number(n.toFixed(2))}%`;
  const rows: Array<{ label: string; value: number; note?: string; indent?: boolean; strong?: boolean; sign?: boolean }> = [
    { label: "Goes out each month, CPF and cash", value: m.paid, strong: true },
    { label: "Principal", note: "into the home: still yours, not a cost", value: m.principal, indent: true },
    { label: "Interest", value: m.interest, indent: true },
    { label: "S&CC or maintenance, property tax, repairs", value: m.running, indent: true },
    { label: "Stamp duties, fees, renovation, selling", note: `paid once, spread over ${inputs.years} years`, value: m.one_off },
    {
      label: "Opportunity cost",
      note: `the money in the home, had it been invested at ${pct(inputs.invest_return)}${inputs.cpf_balance + inputs.cpf_monthly > 0 ? ` (CPF's at ${pct(inputs.cpf_rate)})` : ""}`,
      value: m.opportunity,
    },
    { label: "The home's rise in value", note: `at ${pct(inputs.growth)} a year, set against the costs`, value: -m.appreciation, sign: true },
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

/** The comparison in a line: when buying pulls ahead, and by how much at the end. */
function Verdict({ inputs, result, className }: { inputs: ScenarioInputs; result: Projection; className?: string }) {
  const last = result.years[result.years.length - 1];
  const difference = last.buy_net_worth - last.rent_net_worth;
  const subject = result.break_even === null ? "renting" : "buying";
  const lead = difference >= 0 ? "buying" : "renting";
  const amount = compactMoney(Math.abs(difference), "sgd", { digits: 1 });
  return (
    <p className={cn("rounded-xl bg-popover px-4 py-2.5 text-sm shadow-md ring-1 ring-foreground/10", className)}>
      {result.break_even === null ? `Renting stays ahead all ${inputs.years} years` : `Buying pulls ahead in year ${result.break_even}`}
      <span className="text-muted-foreground">{` · ${lead === subject ? "" : `${lead} `}${amount} ahead at year ${inputs.years}`}</span>
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

/** What it comes to: the money up front, the months, the years. */
function Results({ inputs, result }: { inputs: ScenarioInputs; result: Projection }) {
  const { upfront, years } = result;
  const last = years[years.length - 1];
  const first = result.monthly[0];
  const difference = last.buy_net_worth - last.rent_net_worth;
  const absdRate = ABSD_RATES[inputs.residency][Math.min(3, inputs.nth) - 1];
  const ticks = yearTicks(0, inputs.years, 8);

  const worth: LineRow[] = years.map((y) => ({ x: y.year, title: y.year === 0 ? "Now" : `After ${y.year} year${y.year === 1 ? "" : "s"}`, buy: y.buy_net_worth, rent: y.rent_net_worth }));

  return (
    <div className="min-w-0 space-y-4">
      <div className="grid grid-cols-2 gap-3 xl:grid-cols-3">
        <Stat
          label="Up front"
          value={compactMoney(upfront.total, "sgd", { digits: 2 })}
          title={money(upfront.total, "sgd")}
          sub={upfront.from_cpf > 0 ? `${compactMoney(upfront.from_cpf, "sgd", { digits: 1 })} CPF, ${compactMoney(upfront.from_cash, "sgd", { digits: 1 })} cash` : "All in cash"}
        />
        <Stat
          label="Stamp duty"
          value={compactMoney(upfront.bsd + upfront.absd, "sgd", { digits: 2 })}
          title={money(upfront.bsd + upfront.absd, "sgd")}
          sub={`BSD ${money(upfront.bsd, "sgd")}${upfront.absd ? `, ABSD ${share(absdRate, 0)} ${money(upfront.absd, "sgd")}` : ", no ABSD"}`}
        />
        <Stat label="Instalment" value={`${money(result.instalment, "sgd")}/mo`} sub={`${compactMoney(upfront.loan, "sgd", { digits: 2 })} over ${inputs.loan_years} years`} />
        <Stat
          label="A month in year 1, what it costs"
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
          sub="The home sold at the end, its costs paid"
        />
      </div>

      <Card title="What each leaves you with" sub="Everything at each year's end, the home as though sold then: its price less the loan and the costs of selling, plus investments and CPF">
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

      <MonthTakenApart inputs={inputs} months={result.monthly} ticks={ticks.filter((t) => t > 0)} />

      <Card title="Year by year">
        <div className="-mx-1 overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="text-xs text-muted-foreground">
              <tr className="border-b">
                <th className="py-2 pr-2 text-left font-normal">Year</th>
                <th className="py-2 pr-2 text-right font-normal">Home</th>
                <th className="hidden py-2 pr-2 text-right font-normal sm:table-cell">Loan</th>
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
        Both sides start with the same money and spend the same each month; whichever costs less invests the rest.
        In Singapore dollars of the day, not adjusted for inflation.
      </p>
    </div>
  );
}
