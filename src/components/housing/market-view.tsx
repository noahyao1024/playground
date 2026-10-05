"use client";

import { useMemo, useState } from "react";
import { ArrowRight } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Segmented } from "@/components/finance/segmented";
import { compactMoney, money, percent } from "@/lib/finance-format";
import {
  FLAT_TYPE_LABELS, HDB_FLAT_TYPES, PRIVATE_SEGMENTS, changeOver, findSeries, grossYield, hdbTowns, latestPoint, paired, pointsOf,
  quarterFromNumber, quarterLabel, quarterNumber, quarterYear, townLabel, townTable,
  type MarketData, type MarketSeries, type TownRow,
} from "@/lib/housing";
import type { Project } from "@/lib/housing-projects";
import { cn } from "@/lib/utils";
import { Developments, type ProjectChoice } from "./developments";
import { LinesChart, yearTicks, type LineRow, type LineSeries } from "./line-chart";

/** Where the market view was left, kept per browser. */
const STATE_KEY = "housing.market";
type Kind = "hdb" | "private";
type Range = "5" | "10" | "all";
type Saved = { kind: Kind; town: string; flatType: string; segment: string; range: Range };

const KIND_OPTIONS = [{ value: "hdb", label: "HDB flats" }, { value: "private", label: "Private homes" }] as const;
const RANGE_OPTIONS = [{ value: "5", label: "5Y" }, { value: "10", label: "10Y" }, { value: "all", label: "All" }] as const;

// Fixed per entity, in every chart: prices the first colour, rents the second,
// what is worked out of both the third.
const PRICE = "var(--series-1)", RENT = "var(--series-2)", BOTH = "var(--series-3)";

function stored(): Saved {
  const fallback: Saved = { kind: "hdb", town: "", flatType: "4-room", segment: "ALL:non-landed", range: "10" };
  try {
    const raw = typeof window !== "undefined" ? window.localStorage.getItem(STATE_KEY) : null;
    return raw ? { ...fallback, ...JSON.parse(raw) } : fallback;
  } catch {
    return fallback;
  }
}

/** 4.1%: a share that is not a change. */
export const share = (ratio: number, digits = 1) => `${(ratio * 100).toFixed(digits)}%`;
const indexText = (n: number) => n.toFixed(1);
/** An axis tick, as round as the tick is. */
const tickText = (n: number) => String(Number(n.toFixed(1)));

export type MarketChoice = { kind: "hdb"; town: string; flatType: string } | { kind: "private"; area: string; segment: string } | ProjectChoice;

/** The developments followed, and what can be done with them. */
export type Following = {
  projects: Project[];
  /** Whether URA's key is set on the site. */
  ura: boolean;
  onFollow: (name: string) => Promise<void>;
  onUnfollow: (name: string) => Promise<void>;
};

/** The market, from HDB's medians and URA's indices: how prices and rents have
 *  moved, against each other. */
export function MarketView({ market, following, onCompare }: { market: MarketData; following: Following; onCompare: (choice: MarketChoice) => void }) {
  const [state, setState] = useState<Saved>(stored);
  const update = (next: Partial<Saved>) => setState((s) => {
    const merged = { ...s, ...next };
    try { window.localStorage.setItem(STATE_KEY, JSON.stringify(merged)); } catch { /* not remembered */ }
    return merged;
  });

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <Segmented label="Homes" value={state.kind} onChange={(kind) => update({ kind })} options={KIND_OPTIONS} />
        <Segmented label="Years shown" value={state.range} onChange={(range) => update({ range })} options={RANGE_OPTIONS} />
      </div>
      {state.kind === "hdb"
        ? <HdbMarket market={market} state={state} update={update} onCompare={onCompare} />
        : <PrivateMarket market={market} state={state} update={update} following={following} onCompare={onCompare} />}
    </div>
  );
}

/** The first quarter shown: `range` years before the latest. */
function since(latest: string | undefined, range: Range): string | undefined {
  if (!latest || range === "all") return undefined;
  return quarterFromNumber(quarterNumber(latest) - Number(range) * 4);
}

/** Two series on a common base: each at 100 in the first quarter shown that has both. */
function indexedRows(a: MarketSeries | undefined, b: MarketSeries | undefined, from: string | undefined, keys: [string, string]): { rows: LineRow[]; base: string | null } {
  const both = paired(a, b, from);
  const base = both[0];
  if (!base) return { rows: [], base: null };
  const rows = both.map((p) => ({
    x: quarterYear(p.quarter),
    title: quarterLabel(p.quarter),
    [keys[0]]: (p.a / base.a) * 100,
    [keys[1]]: (p.b / base.b) * 100,
    a: p.a,
    b: p.b,
  }));
  return { rows, base: base.quarter };
}

const ticksOf = (rows: LineRow[]) => (rows.length ? yearTicks(rows[0].x, rows[rows.length - 1].x) : []);
const yearText = (x: number) => String(x);

function HdbMarket({ market, state, update, onCompare }: {
  market: MarketData;
  state: Saved;
  update: (next: Partial<Saved>) => void;
  onCompare: (choice: MarketChoice) => void;
}) {
  const flatType = (HDB_FLAT_TYPES as readonly string[]).includes(state.flatType) ? state.flatType : "4-room";
  const towns = useMemo(() => hdbTowns(market, flatType), [market, flatType]);
  const town = towns.includes(state.town) ? state.town : towns[0] ?? "";
  const price = findSeries(market, "hdb_resale", town, flatType);
  const rent = findSeries(market, "hdb_rent", town, flatType);
  const latest = paired(price, rent).at(-1);
  const from = since(latest?.quarter ?? latestPoint(price)?.quarter, state.range);
  const indexed = indexedRows(price, rent, from, ["price", "rent"]);
  const yields: LineRow[] = paired(price, rent, from).map((p) => ({ x: quarterYear(p.quarter), title: quarterLabel(p.quarter), yield: grossYield(p.a, p.b) * 100 }));
  const priceChange = changeOver(price, 5), rentChange = changeOver(rent, 5);

  return (
    <>
      <div className="flex flex-wrap items-center gap-2">
        <Select value={town} onValueChange={(v) => update({ town: v as string })}>
          <SelectTrigger aria-label="Town" className="h-9 min-w-44"><SelectValue>{(v: string | null) => (v ? townLabel(v) : "Town")}</SelectValue></SelectTrigger>
          <SelectContent>{towns.map((t) => <SelectItem key={t} value={t}>{townLabel(t)}</SelectItem>)}</SelectContent>
        </Select>
        <Select value={flatType} onValueChange={(v) => update({ flatType: v as string })}>
          <SelectTrigger aria-label="Flat type" className="h-9 w-36"><SelectValue>{(v: string | null) => FLAT_TYPE_LABELS[v ?? ""] ?? "Flat type"}</SelectValue></SelectTrigger>
          <SelectContent>{HDB_FLAT_TYPES.map((t) => <SelectItem key={t} value={t}>{FLAT_TYPE_LABELS[t]}</SelectItem>)}</SelectContent>
        </Select>
        <Button variant="outline" className="ml-auto" disabled={!latest} onClick={() => onCompare({ kind: "hdb", town, flatType })}>
          Rent or buy here <ArrowRight />
        </Button>
      </div>

      {!latest ? (
        <Empty>HDB has published no median price and rent for {FLAT_TYPE_LABELS[flatType]} flats in {townLabel(town)} in the same quarter.</Empty>
      ) : (
        <>
          <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
            <Stat label="Median resale price" value={compactMoney(latest.a, "sgd", { digits: 2 })} title={money(latest.a, "sgd")} sub={quarterLabel(latest.quarter)} />
            <Stat label="Median rent" value={`${money(latest.b, "sgd")}/mo`} sub={quarterLabel(latest.quarter)} />
            <Stat label="Gross rental yield" value={share(grossYield(latest.a, latest.b))} sub="A year's rent over the price" />
            <Stat
              label="Over 5 years"
              value={priceChange === null ? "—" : `${percent(priceChange)} price`}
              sub={rentChange === null ? undefined : `${percent(rentChange)} rent`}
            />
          </div>

          <Card title="Price and rent, side by side" sub={`Each median at 100 in ${quarterLabel(indexed.base!)}; the tooltip has the dollars`}>
            <LinesChart
              rows={indexed.rows}
              series={[{ key: "price", label: "Median resale price", color: PRICE }, { key: "rent", label: "Median rent", color: RENT }]}
              format={indexText}
              axisFormat={tickText}
              ticks={ticksOf(indexed.rows)}
              xFormat={yearText}
              reference={100}
              details={(row) => [
                { label: "price", value: money(Number(row.a), "sgd") },
                { label: "rent a month", value: money(Number(row.b), "sgd") },
              ]}
            />
          </Card>

          <Card title="Gross rental yield" sub="A year's median rent over the median price: higher means renting costs more against buying">
            <LinesChart rows={yields} series={[{ key: "yield", label: "Gross yield", color: BOTH }]} format={(v) => `${v.toFixed(2)}%`} axisFormat={(v) => `${tickText(v)}%`} ticks={ticksOf(yields)} xFormat={yearText} />
          </Card>
        </>
      )}

      <TownsCard market={market} flatType={flatType} town={town} onPick={(t) => update({ town: t })} />
    </>
  );
}

type SortKey = "town" | "price" | "rent" | "yield" | "priceChange" | "rentChange";

/** Every town for the flat type, one row each, sortable. */
function TownsCard({ market, flatType, town, onPick }: { market: MarketData; flatType: string; town: string; onPick: (town: string) => void }) {
  const [sort, setSort] = useState<{ key: SortKey; desc: boolean }>({ key: "yield", desc: true });
  const rows = useMemo(() => townTable(market, flatType), [market, flatType]);
  const sorted = useMemo(() => [...rows].sort((a, b) => {
    if (sort.key === "town") return a.town.localeCompare(b.town) * (sort.desc ? -1 : 1);
    const x = a[sort.key], y = b[sort.key];
    // Towns without a figure sink, whichever way the column runs.
    if (x === null || y === null) return x === null ? (y === null ? 0 : 1) : -1;
    return (x - y) * (sort.desc ? -1 : 1);
  }), [rows, sort]);
  const quarter = rows.map((r) => r.quarter).filter((q): q is string => !!q).sort().at(-1);

  const head = (key: SortKey, label: string, className?: string) => (
    <th aria-sort={sort.key === key ? (sort.desc ? "descending" : "ascending") : "none"} className={cn("py-2 pr-2 font-normal", key === "town" ? "text-left" : "text-right", className)}>
      <button
        type="button"
        className="rounded hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring/50 focus-visible:outline-none"
        onClick={() => setSort((s) => ({ key, desc: s.key === key ? !s.desc : key !== "town" }))}
      >
        {label}{sort.key === key ? (sort.desc ? " ↓" : " ↑") : ""}
      </button>
    </th>
  );
  const cell = (row: TownRow, value: number | null, text: (n: number) => string, className?: string) => (
    <td className={cn("py-2 pr-2 text-right tabular-nums", className)}>{value === null ? <span className="text-muted-foreground">—</span> : text(value)}</td>
  );

  return (
    <Card title={`Towns compared: ${FLAT_TYPE_LABELS[flatType]}`} sub={quarter ? `Medians in ${quarterLabel(quarter)} or the latest quarter with both; changes over 5 years` : undefined}>
      {rows.length === 0 ? (
        <p className="py-6 text-center text-sm text-muted-foreground">No figures for this flat type.</p>
      ) : (
        <div className="-mx-1 overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="text-xs text-muted-foreground">
              <tr className="border-b">
                {head("town", "Town")}
                {head("price", "Price")}
                {head("rent", "Rent")}
                {head("yield", "Yield")}
                {head("priceChange", "Price, 5y", "hidden sm:table-cell")}
                {head("rentChange", "Rent, 5y", "hidden sm:table-cell")}
              </tr>
            </thead>
            <tbody>
              {sorted.map((r) => (
                // The whole row picks the town; its name is the button a keyboard reaches.
                <tr
                  key={r.town}
                  onClick={() => onPick(r.town)}
                  className={cn("cursor-pointer border-b last:border-0 hover:bg-muted/50", r.town === town && "bg-muted")}
                >
                  <td className="py-2 pr-2">
                    <button
                      type="button"
                      aria-current={r.town === town || undefined}
                      className={cn("rounded text-left focus-visible:ring-2 focus-visible:ring-ring/50 focus-visible:outline-none", r.town === town && "font-medium")}
                    >
                      {townLabel(r.town)}
                    </button>
                    {r.quarter && r.quarter !== quarter && <span className="ml-1.5 text-xs text-muted-foreground">{quarterLabel(r.quarter)}</span>}
                  </td>
                  {cell(r, r.price, (n) => compactMoney(n, "sgd", { digits: 2 }))}
                  {cell(r, r.rent, (n) => money(n, "sgd"))}
                  {cell(r, r.yield, (n) => share(n))}
                  {cell(r, r.priceChange, percent, "hidden sm:table-cell")}
                  {cell(r, r.rentChange, percent, "hidden sm:table-cell")}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </Card>
  );
}

function PrivateMarket({ market, state, update, following, onCompare }: {
  market: MarketData;
  state: Saved;
  update: (next: Partial<Saved>) => void;
  following: Following;
  onCompare: (choice: MarketChoice) => void;
}) {
  const segment = PRIVATE_SEGMENTS.find((s) => s.key === state.segment) ?? PRIVATE_SEGMENTS[2];
  const ppi = findSeries(market, "ura_ppi", segment.area, segment.segment);
  const rri = findSeries(market, "ura_rri", segment.area, segment.segment);
  const latest = paired(ppi, rri).at(-1);
  const from = since(latest?.quarter, state.range);
  const both = paired(ppi, rri, from);
  const rows: LineRow[] = both.map((p) => ({ x: quarterYear(p.quarter), title: quarterLabel(p.quarter), price: p.a, rent: p.b }));
  const ratio: LineRow[] = both.map((p) => ({ x: quarterYear(p.quarter), title: quarterLabel(p.quarter), ratio: (p.a / p.b) * 100 }));
  const priceChange = changeOver(ppi, 5), rentChange = changeOver(rri, 5);
  const series: LineSeries[] = [{ key: "price", label: "Price index", color: PRICE }, { key: "rent", label: "Rental index", color: RENT }];

  return (
    <>
      <Developments
        projects={following.projects}
        ura={following.ura}
        onFollow={following.onFollow}
        onUnfollow={following.onUnfollow}
        onCompare={onCompare}
      />

      <div className="flex flex-wrap items-center gap-2">
        <Select value={segment.key} onValueChange={(v) => update({ segment: v as string })}>
          <SelectTrigger aria-label="Kind of home" className="h-9 min-w-56">
            <SelectValue>{(v: string | null) => PRIVATE_SEGMENTS.find((s) => s.key === v)?.label ?? "Kind of home"}</SelectValue>
          </SelectTrigger>
          <SelectContent>{PRIVATE_SEGMENTS.map((s) => <SelectItem key={s.key} value={s.key}>{s.label}</SelectItem>)}</SelectContent>
        </Select>
        <Button variant="outline" className="ml-auto" disabled={!latest} onClick={() => onCompare({ kind: "private", area: segment.area, segment: segment.segment })}>
          Rent or buy one <ArrowRight />
        </Button>
      </div>

      {!latest ? (
        <Empty>URA&rsquo;s indices for {segment.label.toLowerCase()} are not here yet.</Empty>
      ) : (
        <>
          <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
            <Stat label="Price index" value={indexText(latest.a)} sub={`${quarterLabel(latest.quarter)}, 2009 Q1 = 100`} />
            <Stat label="Rental index" value={indexText(latest.b)} sub={`${quarterLabel(latest.quarter)}, 2009 Q1 = 100`} />
            <Stat
              label="Over 5 years"
              value={priceChange === null ? "—" : `${percent(priceChange)} price`}
              sub={rentChange === null ? undefined : `${percent(rentChange)} rent`}
            />
            <Stat label="Price against rent" value={percent(latest.a / latest.b - 1)} sub="Since 2009 Q1: up means buying has grown dearer" />
          </div>

          <Card title="Price and rental indices" sub="URA's, both at 100 in 2009 Q1">
            <LinesChart rows={rows} series={series} format={indexText} axisFormat={tickText} ticks={ticksOf(rows)} xFormat={yearText} reference={100} />
          </Card>

          <Card title="Price relative to rent" sub="The price index over the rental index, 2009 Q1 = 100: above 100, prices have outrun rents since">
            <LinesChart rows={ratio} series={[{ key: "ratio", label: "Price over rent", color: BOTH }]} format={indexText} axisFormat={tickText} ticks={ticksOf(ratio)} xFormat={yearText} reference={100} />
          </Card>

          <p className="text-xs text-muted-foreground">
            URA&rsquo;s indices move with a kind of home, not a particular development: follow one above for its own sales and rents.
            {pointsOf(rri).length > 0 && ` Rental figures start in ${quarterLabel(pointsOf(rri)[0].quarter)}.`}
          </p>
        </>
      )}
    </>
  );
}

export function Card({ title, sub, children, action }: { title: string; sub?: string; children: React.ReactNode; action?: React.ReactNode }) {
  return (
    <section className="rounded-2xl bg-card p-5 ring-1 ring-foreground/10 sm:p-6">
      <div className="mb-4 flex flex-wrap items-start justify-between gap-3">
        <div>
          <h2 className="text-base font-medium">{title}</h2>
          {sub && <p className="mt-0.5 text-xs text-muted-foreground">{sub}</p>}
        </div>
        {action}
      </div>
      {children}
    </section>
  );
}

export function Stat({ label, value, sub, title }: { label: string; value: string; sub?: string; title?: string }) {
  return (
    <div className="rounded-xl bg-card p-4 ring-1 ring-foreground/10">
      <p className="text-xs text-muted-foreground">{label}</p>
      <p className="mt-1 text-xl font-semibold tracking-tight tabular-nums" title={title}>{value}</p>
      {sub && <p className="mt-1 text-xs text-muted-foreground">{sub}</p>}
    </div>
  );
}

function Empty({ children }: { children: React.ReactNode }) {
  return <p className="rounded-2xl bg-card px-6 py-10 text-center text-sm text-muted-foreground ring-1 ring-foreground/10">{children}</p>;
}
