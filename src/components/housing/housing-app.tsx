"use client";

import { useCallback, useEffect, useState } from "react";
import { toast } from "sonner";
import { RotateCw } from "lucide-react";
import { Button } from "@/components/ui/button";
import { ConfirmDialog, type Confirmation } from "@/components/finance/confirm-dialog";
import { Segmented } from "@/components/finance/segmented";
import { dayInSG } from "@/lib/dates";
import { dayLabel } from "@/lib/finance-format";
import {
  FLAT_TYPE_LABELS, PRIVATE_SEGMENTS, clampInputs, findSeries, inputsFromMarket, latestPoint, parseInputs, quarterFromNumber, quarterLabel,
  quarterNumber, readInputs, townLabel,
} from "@/lib/housing";
import { housingAction, loadHousing, messageOf, type HousingData, type ProjectsRefresh, type Refresh, type Scenario } from "./api";
import type { Project } from "@/lib/housing-projects";
import { MarketView, type MarketChoice } from "./market-view";
import { NEW_DRAFT, RentOrBuy, type Draft } from "./rent-or-buy";

const TAB_KEY = "housing.tab";
const DRAFT_KEY = "housing.draft";
const TABS = [{ value: "market", label: "Market" }, { value: "compare", label: "Rent or buy" }] as const;
type Tab = (typeof TABS)[number]["value"];

function storedTab(): Tab {
  try {
    return typeof window !== "undefined" && window.localStorage.getItem(TAB_KEY) === "compare" ? "compare" : "market";
  } catch {
    return "market";
  }
}

/** The comparison last worked on in this browser, kept so a reload does not
 *  lose it. It is saved as typed, so a field may be half done: that one opens
 *  at its default and the rest as they were. Anything unreadable starts afresh. */
function storedDraft(): Draft {
  try {
    const raw = typeof window !== "undefined" ? window.localStorage.getItem(DRAFT_KEY) : null;
    if (!raw) return NEW_DRAFT;
    const saved = JSON.parse(raw);
    return {
      id: typeof saved.id === "string" ? saved.id : null,
      name: typeof saved.name === "string" ? saved.name.slice(0, 80) : "",
      inputs: { ...readInputs(saved.inputs),
        ...(saved.inputs?.price === null ? { price: NaN } : {}),
        ...(saved.inputs?.rent === null ? { rent: NaN } : {}),
      },
    };
  } catch {
    return NEW_DRAFT;
  }
}

/** What the market's figures filled in, said in a sentence. */
function filledFrom(data: HousingData, choice: MarketChoice): string {
  if (choice.kind === "project") {
    return `Filled in from ${choice.label}: the middle price and rent of the latest year. Price and rent growth follow URA's indices for its market.`;
  }
  if (choice.kind === "private") {
    const market = PRIVATE_SEGMENTS.find((s) => s.area === choice.area && s.segment === choice.segment);
    return `Price and rent growth follow URA's indices for ${market?.noun ?? "private homes"}. Put in the home's own price and rent.`;
  }
  const latest = latestPoint(findSeries(data.market, "hdb_resale", choice.town, choice.flatType));
  return `Filled in from ${townLabel(choice.town)} ${FLAT_TYPE_LABELS[choice.flatType]} medians${latest ? `, ${quarterLabel(latest.quarter)}` : ""}; price and rent growth follow HDB's.`;
}

export function HousingApp() {
  const [data, setData] = useState<HousingData | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [tab, setTabState] = useState<Tab>(storedTab);
  const [draft, setDraftState] = useState<Draft>(storedDraft);
  const [refreshing, setRefreshing] = useState(false);
  const [confirmation, setConfirmation] = useState<Confirmation | null>(null);

  useEffect(() => {
    let alive = true;
    loadHousing()
      .then((d) => { if (alive) setData(d); })
      .catch((err) => { if (alive) setLoadError(messageOf(err)); });
    return () => { alive = false; };
  }, []);

  const reload = useCallback(async () => {
    setLoadError(null);
    try {
      setData(await loadHousing());
    } catch (err) {
      setLoadError(messageOf(err));
    }
  }, []);

  function setTab(next: Tab) {
    setTabState(next);
    try { window.localStorage.setItem(TAB_KEY, next); } catch { /* not remembered */ }
  }

  const setDraft = useCallback((update: (d: Draft) => Draft) => setDraftState((d) => {
    const next = update(d);
    try { window.localStorage.setItem(DRAFT_KEY, JSON.stringify(next)); } catch { /* not remembered */ }
    return next;
  }), []);

  async function refresh() {
    setRefreshing(true);
    try {
      const reply = await housingAction<{ refresh: Refresh; market: HousingData["market"] }>("refresh");
      setData((d) => (d ? { ...d, market: reply.market } : d));
      const { checked, refreshed, failures } = reply.refresh;
      if (failures.length) toast.error(`${failures.length} of the datasets could not be read: ${failures[0].reason}`);
      else toast.success(refreshed ? `Read ${refreshed} updated dataset${refreshed === 1 ? "" : "s"} again` : `All ${checked} datasets are up to date`);
    } catch (err) {
      toast.error(messageOf(err));
    } finally {
      setRefreshing(false);
    }
  }

  function compare(choice: MarketChoice) {
    if (!data) return;
    // A development's size brings its own price and rent; the annual value is
    // approximated as a year's rent; the owner must verify the actual IRAS AV.
    const filled = choice.kind === "project"
      ? { kind: "private" as const, market: choice.market, loan_type: "bank" as const, price: choice.price, rent: choice.rent, annual_value: choice.rent * 12 }
      : inputsFromMarket(data.market, choice);
    let inputs;
    try {
      // The growth of prices and rents is the market's: left to its estimates.
      inputs = parseInputs({
        ...clampInputs(draft.inputs),
        ...filled,
        ...(filled.kind === "private" && draft.inputs.loan_type === "hdb" ? { loan_type: "bank" } : {}),
        auto: [...draft.inputs.auto, "growth", "rent_growth"],
        ...(draft.inputs.guidance ? { guidance: { ...draft.inputs.guidance, confirmed: false, tenure: "unknown", lease_start: null, build_year: null } } : {}),
      });
    } catch (err) {
      toast.error(`The market's figures could not be used: ${messageOf(err)}`);
      return;
    }
    setDraft((d) => ({ ...d, inputs }));
    setTab("compare");
    toast.success(filledFrom(data, choice));
    window.scrollTo({ top: 0, behavior: "smooth" });
  }

  /** Follows a development: URA is read for it at once, if its key is set. */
  async function follow(name: string) {
    try {
      const { project, refresh } = await housingAction<{ project: Project | null; refresh: ProjectsRefresh }>("followProject", { name });
      if (project) setData((d) => (d ? { ...d, projects: [...d.projects.filter((p) => p.name !== project.name), project] } : d));
      if (refresh.failures.length) toast.error(`Following ${name}, but URA could not be read: ${refresh.failures[0].reason}`);
      else if (refresh.state === "no key") toast.message(`Following ${name}: URA is read once URA_ACCESS_KEY is set on Vercel`);
      else if (project?.found === false) toast.error(`URA has no records under ${name}: check how URA spells it`);
      else toast.success(`Following ${name}: ${refresh.sales} sale(s) and ${refresh.rents} rental contract(s) read`);
    } catch (err) {
      toast.error(messageOf(err));
    }
  }

  async function unfollow(name: string) {
    try {
      await housingAction("unfollowProject", { name });
      setData((d) => (d ? { ...d, projects: d.projects.filter((p) => p.name !== name) } : d));
    } catch (err) {
      toast.error(messageOf(err));
    }
  }

  if (!data) {
    return loadError ? (
      <div className="mx-auto max-w-md space-y-3 py-16 text-center">
        <p className="text-sm font-medium">Could not load the housing figures</p>
        <p className="text-sm text-muted-foreground">{loadError}</p>
        <Button variant="outline" size="sm" onClick={() => void reload()}><RotateCw /> Try again</Button>
      </div>
    ) : (
      <div className="space-y-4" aria-busy="true" aria-label="Loading">
        <div className="h-9 w-48 animate-pulse rounded-md bg-muted" />
        <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">{[0, 1, 2, 3].map((i) => <div key={i} className="h-24 animate-pulse rounded-xl bg-muted" />)}</div>
        <div className="h-72 animate-pulse rounded-2xl bg-muted" />
      </div>
    );
  }

  const empty = data.market.series.length === 0;
  const updated = data.market.refreshed_at;
  // The newest quarter anything has a figure for: what "up to date" means here.
  const newest = data.market.series.reduce<number | null>((n, s) => {
    const last = quarterNumber(s.start) + s.values.length - 1;
    return n === null || last > n ? last : n;
  }, null);

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">
            Housing <span className="ml-1 text-base font-normal text-muted-foreground">租房还是买房</span>
          </h1>
          <p className="mt-1 max-w-xl text-sm text-muted-foreground">
            Singapore&rsquo;s home prices and rents from HDB and URA&rsquo;s open data, and what renting or buying would come to over the years.
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-3">
          {newest !== null && (
            <span className="text-xs text-muted-foreground">
              Figures to {quarterLabel(quarterFromNumber(newest))}{updated && `, read ${dayLabel(dayInSG(updated))}`}
            </span>
          )}
          <Button variant="outline" disabled={refreshing} onClick={() => void refresh()}>
            <RotateCw className={refreshing ? "animate-spin" : undefined} /> {refreshing ? "Reading…" : "Refresh data"}
          </Button>
        </div>
      </div>

      <Segmented label="View" value={tab} onChange={setTab} options={TABS} />

      {tab === "market" ? (
        empty ? (
          <section className="rounded-2xl bg-card px-6 py-12 text-center ring-1 ring-foreground/10">
            <p className="text-sm font-medium">No market figures yet</p>
            <p className="mx-auto mt-1 max-w-md text-sm text-muted-foreground">
              They come from data.gov.sg with the daily job, or now: HDB&rsquo;s medians by town and flat type, and URA&rsquo;s indices for private homes.
            </p>
            <Button className="mt-4" disabled={refreshing} onClick={() => void refresh()}><RotateCw /> Read them now</Button>
          </section>
        ) : (
          <MarketView
            market={data.market}
            following={{ projects: data.projects ?? [], ura: data.ura ?? false, onFollow: follow, onUnfollow: unfollow }}
            onCompare={compare}
          />
        )
      ) : (
        <RentOrBuy
          draft={draft}
          setDraft={setDraft}
          market={data.market}
          scenarios={data.scenarios}
          onSaved={(saved: Scenario) => setData((d) => (d ? { ...d, scenarios: [saved, ...d.scenarios.filter((s) => s.id !== saved.id)] } : d))}
          onDeleted={(id) => setData((d) => (d ? { ...d, scenarios: d.scenarios.filter((s) => s.id !== id) } : d))}
          onConfirm={setConfirmation}
        />
      )}

      <ConfirmDialog confirmation={confirmation} onClose={() => setConfirmation(null)} />
    </div>
  );
}
