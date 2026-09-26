"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { toast } from "sonner";
import { ArrowDownRight, ArrowUpRight, KeyRound, Minus, PenLine, Plus, RotateCw } from "lucide-react";
import { Button } from "@/components/ui/button";
import { todayInSG } from "@/lib/dates";
import {
  CATEGORIES, REGIONS, REGION_LABELS, changeBetween, displayName, historyOf, isLongTerm, lastBalances, liquidityOf, positionOn,
  withAccount, withBalances,
  type Change, type FinanceAccount, type FinanceBalance, type Kind, type Lens, type Position, type Region, type Unit,
} from "@/lib/finance";
import { UNIT_CODE, compactMoney, dayLabel, dayTime, money, percent } from "@/lib/finance-format";
import { cn } from "@/lib/utils";
import { financeAction, loadFinance, messageOf, type FinanceData } from "./api";
import { AccountDialog } from "./account-dialog";
import { ApiAccessDialog } from "./api-access-dialog";
import { AccountsCard } from "./accounts-card";
import { ConfirmDialog, type Confirmation } from "./confirm-dialog";
import { LensBar, describeLens } from "./lens-bar";
import { LoansCard } from "./loans-card";
import { RecordDialog } from "./record-dialog";
import { RecordsCard } from "./records-card";
import { Segmented } from "./segmented";
import { TrendChart, type TrendRow, type TrendSeries } from "./trend-chart";

const UNIT_KEY = "finance.unit";
/** Away this long, and the page reads everything again on return: an agent with
 *  the token may have written in the meantime. */
const STALE_AFTER_MS = 5 * 60_000;
const LENS_KEY = "finance.lens";
const UNIT_OPTIONS = [{ value: "cny", label: "CNY" }, { value: "sgd", label: "SGD" }] as const;
const VIEW_OPTIONS = [
  { value: "net", label: "Net worth" },
  { value: "split", label: "Assets & debts" },
  { value: "region", label: "By region" },
] as const;
type View = (typeof VIEW_OPTIONS)[number]["value"];
const VIEW_TITLES: Record<View, string> = {
  net: "Net worth over time",
  split: "Assets and liabilities",
  region: "Net worth by region",
};

/** The unit last chosen here. Read once, as state starts: the page renders a
 *  skeleton until its data arrives, so nothing the server sent depends on it. */
function storedUnit(): Unit {
  try {
    return typeof window !== "undefined" && window.localStorage.getItem(UNIT_KEY) === "sgd" ? "sgd" : "cny";
  } catch {
    return "cny";
  }
}

/** The filters last chosen here, read the same way as the unit. */
function storedLens(): Lens {
  try {
    const raw = typeof window !== "undefined" ? window.localStorage.getItem(LENS_KEY) : null;
    const saved = raw ? JSON.parse(raw) : {};
    return {
      excludeLongTerm: saved.excludeLongTerm === true,
      liquidOnly: saved.liquidOnly === true,
      owner: typeof saved.owner === "string" ? saved.owner : null,
    };
  } catch {
    return {};
  }
}

// Fixed per entity, whichever of them are on screen: assets are the second
// colour in every view, China the first whether or not anything is elsewhere.
const NET_SERIES: TrendSeries[] = [{ key: "net", label: "Net worth", color: "var(--series-1)", lead: true }];
const SPLIT_SERIES: TrendSeries[] = [
  { key: "assets", label: "Assets", color: "var(--series-2)" },
  { key: "liabilities", label: "Liabilities", color: "var(--series-3)" },
];
const REGION_COLORS: Record<Region, string> = { CN: "var(--series-1)", SG: "var(--series-2)", OTHER: "var(--series-3)" };
// Tailwind sees only whole class names, so each count is spelled out.
const TILE_COLUMNS: Record<number, string> = { 3: "lg:grid-cols-3", 4: "lg:grid-cols-4", 5: "lg:grid-cols-5" };

export function FinanceApp() {
  const [data, setData] = useState<FinanceData | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [unit, setUnitState] = useState<Unit>(storedUnit);
  const [chosenLens, setLensState] = useState<Lens>(storedLens);
  const [view, setView] = useState<View>("net");
  const [recordDay, setRecordDay] = useState<string | null>(null);
  const [apiOpen, setApiOpen] = useState(false);
  const [editing, setEditing] = useState<FinanceAccount | "new" | null>(null);
  const [confirmation, setConfirmation] = useState<Confirmation | null>(null);

  // Its writes land in promise callbacks, and it can be abandoned if the page
  // goes away first. reload() below is for trying again and for coming back to
  // the page; saves never read everything again.
  useEffect(() => {
    let alive = true;
    loadFinance()
      .then((d) => { if (alive) setData(d); })
      .catch((err) => { if (alive) setLoadError(messageOf(err)); });
    return () => { alive = false; };
  }, []);

  const reload = useCallback(async () => {
    try {
      setData(await loadFinance());
      setLoadError(null);
    } catch (err) {
      if (data) toast.error(`Could not refresh: ${messageOf(err)}`);
      else setLoadError(messageOf(err));
    }
  }, [data]);

  // Back after a while in another tab or app: read everything again, quietly.
  const hiddenAt = useRef<number | null>(null);
  useEffect(() => {
    function onVisibility() {
      if (document.visibilityState === "hidden") {
        hiddenAt.current = Date.now();
      } else if (hiddenAt.current !== null && Date.now() - hiddenAt.current > STALE_AFTER_MS) {
        hiddenAt.current = null;
        void reload();
      }
    }
    document.addEventListener("visibilitychange", onVisibility);
    return () => document.removeEventListener("visibilitychange", onVisibility);
  }, [reload]);

  /** A save puts the server's own reply on screen, rather than reading every
   *  balance again: the cost of saving stays the same however long the history. */
  const patch = useCallback((update: (d: FinanceData) => FinanceData) => setData((d) => (d ? update(d) : d)), []);

  function setUnit(next: Unit) {
    setUnitState(next);
    try { window.localStorage.setItem(UNIT_KEY, next); } catch { /* private mode: it just is not remembered */ }
  }

  function setLens(next: Lens) {
    setLensState(next);
    try { window.localStorage.setItem(LENS_KEY, JSON.stringify(next)); } catch { /* as above */ }
  }

  const accounts = useMemo(() => data?.accounts ?? [], [data]);
  const balances = useMemo(() => data?.balances ?? [], [data]);
  const owners = useMemo(() => [...new Set(accounts.map((a) => a.owner?.trim()).filter((o): o is string => !!o))].sort(), [accounts]);
  const hasUnowned = accounts.some((a) => !a.owner);
  const hasLongTerm = accounts.some((a) => !a.archived_at && isLongTerm(a));
  const hasIlliquid = accounts.some((a) => !a.archived_at && a.kind === "asset" && liquidityOf(a) < 1);
  // A filter that no longer changes anything is dropped rather than claimed:
  // an owner since renamed, a long-term switch with no long-term debt left.
  const lens: Lens = useMemo(() => ({
    excludeLongTerm: !!chosenLens.excludeLongTerm && hasLongTerm,
    liquidOnly: !!chosenLens.liquidOnly && hasIlliquid,
    owner: chosenLens.owner != null && (chosenLens.owner === "" ? hasUnowned && owners.length > 0 : owners.includes(chosenLens.owner))
      ? chosenLens.owner
      : null,
  }), [chosenLens, hasLongTerm, hasIlliquid, hasUnowned, owners]);
  const history = useMemo(() => historyOf(accounts, balances, lens), [accounts, balances, lens]);
  const last = useMemo(() => lastBalances(balances), [balances]);
  const latest = history.at(-1);
  const previous = history.at(-2);
  // The accounts list shows what each account holds, whatever the filters count.
  const unfiltered = useMemo(() => (latest ? positionOn(accounts, balances, latest.day) : undefined), [accounts, balances, latest]);
  const filtered = describeLens(lens);
  const regions = REGIONS.filter((r) => accounts.some((a) => a.region === r));
  const openAccounts = accounts.filter((a) => !a.archived_at);

  async function act<T>(action: string, payload: Record<string, unknown>, done: string, apply: (reply: T) => (d: FinanceData) => FinanceData) {
    try {
      const reply = await financeAction<T>(action, payload);
      patch(apply(reply));
      toast.success(done);
    } catch (err) {
      toast.error(messageOf(err));
    }
  }

  if (!data) {
    return loadError ? (
      <div className="mx-auto max-w-md space-y-3 py-16 text-center">
        <p className="text-sm font-medium">Could not load your accounts</p>
        <p className="text-sm text-muted-foreground">{loadError}</p>
        <Button variant="outline" size="sm" onClick={() => { setLoadError(null); void reload(); }}><RotateCw /> Try again</Button>
      </div>
    ) : (
      <div className="space-y-4" aria-busy="true" aria-label="Loading">
        <div className="h-9 w-48 animate-pulse rounded-md bg-muted" />
        <div className="h-40 animate-pulse rounded-2xl bg-muted" />
        <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">{[0, 1, 2, 3].map((i) => <div key={i} className="h-24 animate-pulse rounded-xl bg-muted" />)}</div>
        <div className="h-72 animate-pulse rounded-2xl bg-muted" />
      </div>
    );
  }

  const other: Unit = unit === "cny" ? "sgd" : "cny";
  const since = previous && dayLabel(previous.day);
  // By region needs two regions to compare; with one it falls back to the total.
  const views = VIEW_OPTIONS.filter((o) => o.value !== "region" || regions.length > 1);
  const shown: View = views.some((o) => o.value === view) ? view : "net";

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">
            Finance <span className="ml-1 text-base font-normal text-muted-foreground">资产负债</span>
          </h1>
          <p className="mt-1 max-w-xl text-sm text-muted-foreground">
            Accounts in China and Singapore, each kept in its own currency and valued in CNY and SGD at the rates of the day it was recorded.
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          <Button variant="outline" onClick={() => setApiOpen(true)}><KeyRound /> API access</Button>
          {openAccounts.length > 0 && (
            <Button onClick={() => setRecordDay(todayInSG())}><PenLine /> Record balances</Button>
          )}
        </div>
      </div>

      {accounts.length === 0 ? (
        <section className="rounded-2xl bg-card px-6 py-12 text-center ring-1 ring-foreground/10">
          <p className="text-sm font-medium">Start with the accounts you hold</p>
          <p className="mx-auto mt-1 max-w-md text-sm text-muted-foreground">
            Bank accounts, CPF and 公积金, brokerages, property &mdash; and what is owed: cards, loans, a mortgage.
            Then record what each holds, whenever you like; every record adds a point to the trend.
          </p>
          <Button className="mt-4" onClick={() => setEditing("new")}><Plus /> Add an account</Button>
        </section>
      ) : (
        <>
          <LensBar
            lens={lens}
            onChange={setLens}
            owners={owners}
            hasUnowned={hasUnowned}
            hasLongTerm={hasLongTerm}
            hasIlliquid={hasIlliquid}
          />

          <section className="rounded-2xl bg-card p-5 ring-1 ring-foreground/10 sm:p-6">
            <div className="flex items-start justify-between gap-4">
              <div>
                <p className="text-sm text-muted-foreground">Net worth</p>
                {filtered && <p className="text-xs text-muted-foreground">{filtered}</p>}
              </div>
              <Segmented label="Show figures in" value={unit} onChange={setUnit} options={UNIT_OPTIONS} />
            </div>
            {latest ? (
              <>
                <p className="mt-1 text-4xl font-semibold tracking-tight sm:text-5xl">{money(latest.net[unit], unit)}</p>
                <p className="mt-2 text-sm text-muted-foreground">
                  {money(latest.net[other], other)} {"·"} as of {dayLabel(latest.day)}
                </p>
                <Delta className="mt-3" change={changeBetween(previous?.net, latest.net, unit)} unit={unit} since={since} />
              </>
            ) : (
              <p className="mt-2 max-w-md text-sm text-muted-foreground">
                Nothing recorded yet. Record what each account holds today to see where you stand.
              </p>
            )}
          </section>

          {latest && (
            // An odd tile out spans the row on a phone rather than sitting alone in half of it.
            <div className={cn("grid grid-cols-2 gap-3 [&>*:last-child:nth-child(odd)]:col-span-2 lg:[&>*:last-child:nth-child(odd)]:col-span-1", TILE_COLUMNS[2 + regions.length])}>
              <Tile label="Assets" value={latest.assets[unit]} unit={unit} change={changeBetween(previous?.assets, latest.assets, unit)} />
              <Tile label="Liabilities" value={latest.liabilities[unit]} unit={unit} change={changeBetween(previous?.liabilities, latest.liabilities, unit)} upIsGood={false} />
              {regions.map((r) => (
                <Tile
                  key={r}
                  label={`${REGION_LABELS[r]}, net`}
                  value={latest.byRegion[r].net[unit]}
                  unit={unit}
                  change={changeBetween(previous?.byRegion[r].net, latest.byRegion[r].net, unit)}
                />
              ))}
            </div>
          )}

          {latest && (
            <section className="rounded-2xl bg-card p-5 ring-1 ring-foreground/10 sm:p-6">
              <div className="mb-4 flex flex-wrap items-start justify-between gap-3">
                <div>
                  <h2 className="text-base font-medium">{VIEW_TITLES[shown]}</h2>
                  <p className="mt-0.5 text-xs text-muted-foreground">In {UNIT_CODE[unit]}, each record at its own day&rsquo;s rates</p>
                </div>
                <Segmented label="Chart" value={shown} onChange={setView} options={views} />
              </div>
              {history.length < 2 ? (
                <p className="py-12 text-center text-sm text-muted-foreground">The line starts with your second record.</p>
              ) : (
                <TrendChart unit={unit} {...trend(shown, history, regions, unit)} />
              )}
            </section>
          )}

          <AccountsCard
            accounts={accounts}
            last={last}
            position={unfiltered}
            lens={lens}
            unit={unit}
            actions={{
              onAdd: () => setEditing("new"),
              onEdit: (a) => setEditing(a),
              onArchive: (a, archived) => act<FinanceAccount>(
                "updateAccount",
                { id: a.id, updates: { archived } },
                archived ? `Archived ${displayName(a)}. Its history stays.` : `Restored ${displayName(a)}`,
                (saved) => (d) => ({ ...d, accounts: withAccount(d.accounts, saved) }),
              ),
              onDelete: (a) => setConfirmation({
                title: `Delete ${displayName(a)}?`,
                description: "It has no balances recorded, so nothing else goes with it.",
                action: "Delete",
                run: () => act("deleteAccount", { id: a.id }, `Deleted ${displayName(a)}`,
                  () => (d) => ({ ...d, accounts: d.accounts.filter((x) => x.id !== a.id) })),
              }),
            }}
          />

          <LoansCard accounts={accounts} last={last} today={todayInSG()} />

          {latest && <Breakdown position={latest} unit={unit} />}

          {history.length > 0 && (
            <RecordsCard
              history={history}
              accounts={accounts}
              balances={balances}
              unit={unit}
              onEditDay={setRecordDay}
              onDeleteBalance={(b: FinanceBalance, a) => setConfirmation({
                title: "Delete this balance?",
                description: `${a ? displayName(a) : "The account"} on ${dayLabel(b.as_of)}. Later days that carried it forward will carry the balance before it instead.`,
                action: "Delete",
                run: () => act("deleteBalance", { id: b.id }, "Balance deleted",
                  () => (d) => ({ ...d, balances: d.balances.filter((x) => x.id !== b.id) })),
              })}
            />
          )}
        </>
      )}

      <RecordDialog
        day={recordDay}
        accounts={accounts}
        balances={balances}
        onClose={() => setRecordDay(null)}
        onSaved={(written) => patch((d) => ({ ...d, balances: withBalances(d.balances, written) }))}
      />
      <AccountDialog
        open={editing !== null}
        account={editing === "new" ? null : editing}
        hasBalances={editing !== null && editing !== "new" && last.has(editing.id)}
        owners={owners}
        onClose={() => setEditing(null)}
        onSaved={(saved) => patch((d) => ({ ...d, accounts: withAccount(d.accounts, saved) }))}
      />
      <ConfirmDialog confirmation={confirmation} onClose={() => setConfirmation(null)} />
      <ApiAccessDialog open={apiOpen} onClose={() => setApiOpen(false)} />
    </div>
  );
}

/** The chart for a view. Net worth alone fits its axis to the line, so a month's
 *  change is visible; the others compare sizes, so theirs reach zero. */
function trend(view: View, history: Position[], regions: Region[], unit: Unit): { rows: TrendRow[]; series: TrendSeries[]; zero: boolean } {
  const base = (p: Position) => ({ day: p.day, t: dayTime(p.day) });
  if (view === "region") {
    return {
      series: regions.map((r) => ({ key: r, label: REGION_LABELS[r], color: REGION_COLORS[r] })),
      rows: history.map((p) => ({ ...base(p), ...Object.fromEntries(regions.map((r) => [r, p.byRegion[r].net[unit]])) })),
      zero: true,
    };
  }
  if (view === "split") {
    return {
      series: SPLIT_SERIES,
      rows: history.map((p) => ({ ...base(p), assets: p.assets[unit], liabilities: p.liabilities[unit] })),
      zero: true,
    };
  }
  return { series: NET_SERIES, rows: history.map((p) => ({ ...base(p), net: p.net[unit] })), zero: false };
}

/** A change, signed, with an arrow: never colour alone. Whether up is good
 *  decides the colour -- more owed is a rise, and not a good one. */
function Delta({ change, unit, since, upIsGood = true, className }: {
  change: Change | null;
  unit: Unit;
  since?: string;
  upIsGood?: boolean;
  className?: string;
}) {
  if (!change) return null;
  const flat = money(change.amount, unit) === money(0, unit);
  const Icon = flat ? Minus : change.amount > 0 ? ArrowUpRight : ArrowDownRight;
  const good = change.amount > 0 === upIsGood;
  return (
    <p className={cn("flex flex-wrap items-center gap-x-1 text-sm", className)}>
      <span className={cn("flex items-center gap-1", flat ? "text-muted-foreground" : good ? "text-delta-up" : "text-delta-down")}>
        <Icon aria-hidden className="size-[1.15em]" />
        {money(change.amount, unit, { sign: true })}
        {change.ratio !== null && !flat && <span>({percent(change.ratio)})</span>}
      </span>
      {since && <span className="text-muted-foreground">since {since}</span>}
    </p>
  );
}

/** A figure beside the hero one: compact, with the exact amount on hover. */
function Tile({ label, value, unit, change, upIsGood = true }: {
  label: string;
  value: number;
  unit: Unit;
  change: Change | null;
  upIsGood?: boolean;
}) {
  return (
    <div className="rounded-xl bg-card p-4 ring-1 ring-foreground/10">
      <p className="text-xs text-muted-foreground">{label}</p>
      <p className="mt-1 text-xl font-semibold tracking-tight" title={money(value, unit)}>{compactMoney(value, unit, { digits: 2 })}</p>
      <Delta className="mt-1 text-xs" change={change} unit={unit} upIsGood={upIsGood} />
    </div>
  );
}

/** What the assets and the debts are made of, by category, on the latest day. */
function Breakdown({ position, unit }: { position: Position; unit: Unit }) {
  const parts = (kind: Kind) => Object.entries(position.byCategory)
    .filter(([key]) => key.startsWith(`${kind}:`))
    .map(([key, value]) => ({ key, label: CATEGORIES[kind][key.slice(kind.length + 1)] ?? key, value: value[unit] }))
    .filter((p) => p.value !== 0)
    .sort((a, b) => b.value - a.value);
  return (
    <section className="grid gap-6 rounded-2xl bg-card p-5 ring-1 ring-foreground/10 sm:grid-cols-2 sm:gap-10 sm:p-6">
      <Shares title="What the assets are" total={position.assets[unit]} parts={parts("asset")} unit={unit} />
      <Shares title="What is owed" total={position.liabilities[unit]} parts={parts("liability")} unit={unit} />
    </section>
  );
}

function Shares({ title, total, parts, unit }: {
  title: string;
  total: number;
  parts: Array<{ key: string; label: string; value: number }>;
  unit: Unit;
}) {
  return (
    <div>
      <div className="flex items-baseline justify-between gap-3 border-b pb-1.5">
        <h2 className="text-sm font-medium">{title}</h2>
        <span className="text-sm font-medium tabular-nums">{money(total, unit)}</span>
      </div>
      {parts.length === 0 ? (
        <p className="pt-3 text-sm text-muted-foreground">Nothing</p>
      ) : (
        <ul className="space-y-3 pt-3">
          {parts.map((p) => {
            const share = total > 0 ? p.value / total : 0;
            return (
              <li key={p.key}>
                <div className="flex items-baseline justify-between gap-3 text-sm">
                  <span className="truncate">{p.label}</span>
                  <span className="shrink-0 tabular-nums">
                    {money(p.value, unit)}
                    <span className="ml-2 inline-block w-11 text-right text-xs text-muted-foreground">{Math.round(share * 100)}%</span>
                  </span>
                </div>
                {/* Square where it starts, rounded where the value ends. */}
                <div className="mt-1 h-1.5 bg-muted" aria-hidden>
                  <div className="h-full rounded-r-[3px] bg-foreground/55" style={{ width: `${Math.max(0, Math.min(1, share)) * 100}%` }} />
                </div>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
