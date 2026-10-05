"use client";

import { useState } from "react";
import { ArrowRight, Plus, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { compactMoney, dayLabel, money } from "@/lib/finance-format";
import { quarterYear, townLabel, type PrivateMarket } from "@/lib/housing";
import { MAX_PROJECTS, byBand, byBedrooms, byQuarter, lastYear, projectName, summarize, psfOf, type BandRow, type Project } from "@/lib/housing-projects";
import { dayInSG } from "@/lib/dates";
import { LinesChart, yearTicks, type LineRow } from "./line-chart";

/** What a development's size fills a comparison with. */
export type ProjectChoice = { kind: "project"; name: string; label: string; market: PrivateMarket; price: number; rent: number };

const PRICE = "var(--series-1)", AVERAGE = "var(--series-3)";
const LANDED = /terrace|semi-d|detached|bungalow|cluster/i;

/** The market a development's prices move with: its region's condos, or landed homes island-wide. */
function marketOf(p: Project): PrivateMarket {
  const landed = p.sales.filter((s) => s.property_type && LANDED.test(s.property_type)).length;
  if (landed > p.sales.length / 2) return "ALL:landed";
  return p.segment ? `${p.segment}:non-landed` : "ALL:non-landed";
}

const monthText = (day: string) => new Date(`${day}T00:00:00Z`).toLocaleDateString("en-SG", { month: "short", year: "numeric", timeZone: "UTC" });
const psfText = (n: number) => `${money(n, "sgd")} psf`;
/** 3.6%: a yield, unsigned. */
const yieldText = (ratio: number) => `${(ratio * 100).toFixed(1)}%`;

/** The private developments the owner follows, as URA recorded them: the
 *  middle and the average of their latest year, by size, and how their price
 *  a square foot has moved. */
export function Developments({ projects, ura, onFollow, onUnfollow, onCompare }: {
  projects: Project[];
  /** Whether URA's key is set on the site. */
  ura: boolean;
  onFollow: (name: string) => Promise<void>;
  onUnfollow: (name: string) => Promise<void>;
  onCompare: (choice: ProjectChoice) => void;
}) {
  const [name, setName] = useState("");
  const [busy, setBusy] = useState(false);
  const typed = projectName(name);

  async function follow() {
    if (!typed) return;
    setBusy(true);
    try {
      await onFollow(typed);
      setName("");
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className="space-y-4 rounded-2xl bg-card p-5 ring-1 ring-foreground/10 sm:p-6">
      <div>
        <h2 className="text-base font-medium">Developments you follow</h2>
        <p className="mt-0.5 text-xs text-muted-foreground">
          Their sales and rents as URA recorded them, read weekly: the middle (P50) and the average of the latest twelve months, by size.
        </p>
      </div>
      <form
        className="flex flex-wrap gap-2"
        onSubmit={(e) => { e.preventDefault(); void follow(); }}
      >
        <Input
          aria-label="Development, as URA names it"
          placeholder="As URA names it: WATERTOWN"
          value={name}
          maxLength={80}
          onChange={(e) => setName(e.target.value)}
          className="h-9 min-w-0 flex-1 basis-56"
        />
        <Button type="submit" disabled={!typed || busy || projects.length >= MAX_PROJECTS}>
          <Plus /> {busy ? "Reading URA…" : "Follow"}
        </Button>
      </form>
      {!ura && (
        <p className="rounded-lg bg-muted/60 px-3 py-2 text-xs text-muted-foreground">
          URA_ACCESS_KEY is not set on Vercel yet: developments followed wait for it, and are read once it is.
        </p>
      )}
      {projects.length === 0 && <p className="text-sm text-muted-foreground">None followed yet.</p>}
      <div className="space-y-6">
        {projects.map((p) => (
          <Development key={p.name} project={p} ura={ura} onUnfollow={onUnfollow} onCompare={onCompare} />
        ))}
      </div>
    </section>
  );
}

function Development({ project: p, ura, onUnfollow, onCompare }: {
  project: Project;
  ura: boolean;
  onUnfollow: (name: string) => Promise<void>;
  onCompare: (choice: ProjectChoice) => void;
}) {
  const label = townLabel(p.name);
  const where = [p.street && townLabel(p.street), p.district && `D${p.district}`, p.segment].filter(Boolean).join(" · ");
  const header = (
    <div className="flex items-start justify-between gap-2">
      <div className="min-w-0">
        <h3 className="text-sm font-medium">{label}</h3>
        <p className="text-xs text-muted-foreground">
          {where || "Not read yet"}{p.read_at && ` · read ${dayLabel(dayInSG(p.read_at))}`}
        </p>
      </div>
      <Button variant="ghost" size="sm" aria-label={`Stop following ${label}`} onClick={() => void onUnfollow(p.name)}>
        <X />
      </Button>
    </div>
  );

  if (p.found === false) {
    return (
      <div className="space-y-2 border-t pt-4 first:border-0 first:pt-0">
        {header}
        <p className="text-sm text-muted-foreground">URA has no sale or rental contract under this name in the last five years. It writes names its own way: check the spelling on URA&rsquo;s site.</p>
      </div>
    );
  }
  if (p.sales.length + p.rents.length === 0) {
    return (
      <div className="space-y-2 border-t pt-4 first:border-0 first:pt-0">
        {header}
        <p className="text-sm text-muted-foreground">
          {ura ? "Waiting for URA's records: they are read when a development is followed, and weekly after." : "Waiting for URA_ACCESS_KEY to be set on Vercel."}
        </p>
      </div>
    );
  }

  const year = lastYear(p);
  const prices = summarize(year.sales.map((s) => s.price / s.units));
  const psf = summarize(year.sales.map(psfOf));
  const rents = summarize(year.rents.map((r) => r.rent));
  const bands = byBand(p);
  const bedrooms = byBedrooms(p);
  const quarters = byQuarter(p).filter((q) => q.psf);
  const trend: LineRow[] = quarters.map((q) => ({ x: quarterYear(q.quarter), title: `${q.label}, ${q.psf!.count} sale${q.psf!.count === 1 ? "" : "s"}`, p50: q.psf!.p50, mean: q.psf!.mean }));
  const market = marketOf(p);
  const compare = (row: BandRow) => onCompare({ kind: "project", name: p.name, label: `${label}, ${row.label}`, market, price: Math.round(row.prices!.p50), rent: Math.round(row.rents!.p50) });

  return (
    <div className="space-y-4 border-t pt-4 first:border-0 first:pt-0">
      {header}
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <Figure
          label="Price, P50"
          value={prices && compactMoney(prices.p50, "sgd", { digits: 2 })}
          average={prices && compactMoney(prices.mean, "sgd", { digits: 2 })}
          sub={prices && year.salesFrom ? `${prices.count} sale${prices.count === 1 ? "" : "s"} since ${monthText(year.salesFrom)}` : "No sale in the last five years"}
        />
        <Figure
          label="Price a sq ft, P50"
          value={psf && money(psf.p50, "sgd")}
          average={psf && money(psf.mean, "sgd")}
          sub={psf ? `P25 ${money(psf.p25, "sgd")}, P75 ${money(psf.p75, "sgd")}` : undefined}
        />
        <Figure
          label="Rent a month, P50"
          value={rents && money(rents.p50, "sgd")}
          average={rents && money(rents.mean, "sgd")}
          sub={rents && year.rentsFrom ? `${rents.count} contract${rents.count === 1 ? "" : "s"} since ${monthText(year.rentsFrom)}` : "No rental contract in the last year"}
        />
        <Figure
          label="Gross yield, P50"
          value={prices && rents && yieldText((rents.p50 * 12) / prices.p50)}
          sub="A year's rent over the price, middle to middle, all sizes"
        />
      </div>

      {/* Relative, so the table's screen-reader text scrolls with it rather than widening the page. */}
      <div className="relative -mx-1 overflow-x-auto">
        <table className="w-full min-w-[30rem] text-sm">
          <caption className="sr-only">{label} by size, the latest twelve months</caption>
          <thead className="text-xs text-muted-foreground">
            <tr className="border-b">
              <th className="py-2 pr-2 text-left font-normal">Size</th>
              <th className="py-2 pr-2 text-right font-normal">Sales</th>
              <th className="py-2 pr-2 text-right font-normal">Price P50<span className="block">average</span></th>
              <th className="py-2 pr-2 text-right font-normal">psf P50</th>
              <th className="py-2 pr-2 text-right font-normal">Leases</th>
              <th className="py-2 pr-2 text-right font-normal">Rent P50<span className="block">average</span></th>
              <th className="py-2 pr-2 text-right font-normal">Yield</th>
              <th className="py-2 text-right font-normal"><span className="sr-only">Compare</span></th>
            </tr>
          </thead>
          <tbody>
            {bands.map((row) => (
              <tr key={row.label} className="border-b last:border-0">
                <td className="py-2 pr-2">
                  {row.label}
                  {row.bedrooms !== null && <span className="ml-1.5 text-xs text-muted-foreground">{row.bedrooms} bed</span>}
                </td>
                <td className="py-2 pr-2 text-right tabular-nums">{row.prices?.count ?? 0}</td>
                <td className="py-2 pr-2 text-right tabular-nums whitespace-nowrap">
                  <Pair p50={row.prices && compactMoney(row.prices.p50, "sgd", { digits: 2 })} average={row.prices && compactMoney(row.prices.mean, "sgd", { digits: 2 })} />
                </td>
                <td className="py-2 pr-2 text-right tabular-nums">{row.psf ? money(row.psf.p50, "sgd") : "–"}</td>
                <td className="py-2 pr-2 text-right tabular-nums">{row.rents?.count ?? 0}</td>
                <td className="py-2 pr-2 text-right tabular-nums whitespace-nowrap">
                  <Pair p50={row.rents && money(row.rents.p50, "sgd")} average={row.rents && money(row.rents.mean, "sgd")} />
                </td>
                <td className="py-2 pr-2 text-right tabular-nums">{row.yield === null ? "–" : yieldText(row.yield)}</td>
                <td className="py-2 text-right">
                  {row.prices && row.rents && (
                    <Button variant="ghost" size="sm" className="h-7 px-2" aria-label={`Rent or buy: ${label}, ${row.label}`} onClick={() => compare(row)}>
                      <ArrowRight />
                    </Button>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {bedrooms.length > 0 && (
        <p className="text-xs text-muted-foreground">
          Rents by bedrooms, P50 · average:{" "}
          {bedrooms.map((b) => `${b.bedrooms === null ? "not said" : `${b.bedrooms} bed`} ${money(b.rents.p50, "sgd")} · ${money(b.rents.mean, "sgd")} (${b.rents.count})`).join("; ")}.
        </p>
      )}

      {trend.length > 1 && (
        <div>
          <p className="mb-2 text-xs font-medium">Price a sq ft, each quarter&rsquo;s sales</p>
          <LinesChart
            rows={trend}
            series={[{ key: "p50", label: "P50", color: PRICE }, { key: "mean", label: "Average", color: AVERAGE }]}
            format={psfText}
            axisFormat={(v) => money(v, "sgd")}
            ticks={yearTicks(trend[0].x, trend[trend.length - 1].x, 6)}
            xFormat={(x) => String(Math.floor(x))}
            height={200}
          />
        </div>
      )}
      <p className="text-xs text-muted-foreground">
        Sales are caveats lodged in the last five years, new, sub-sale and resale; rents are contracts stamped in the last four quarters, their floor areas
        in URA&rsquo;s bands, which sales are put in by their own area. P50 is the middle figure, half above and half below.
      </p>
    </div>
  );
}

/** A figure's middle, large, and its average beneath. */
function Figure({ label, value, average, sub }: { label: string; value: string | null | false; average?: string | null | false; sub?: string }) {
  return (
    <div className="min-w-0 rounded-xl bg-muted/40 p-3">
      <p className="text-xs text-muted-foreground">{label}</p>
      <p className="mt-1 text-lg font-semibold tracking-tight tabular-nums">{value || "–"}</p>
      {average && <p className="text-xs tabular-nums text-muted-foreground">Average {average}</p>}
      {sub && <p className="mt-0.5 text-xs text-muted-foreground">{sub}</p>}
    </div>
  );
}

/** A cell's middle over its average. */
function Pair({ p50, average }: { p50: string | null | false; average: string | null | false }) {
  if (!p50) return <>–</>;
  return (
    <>
      <span className="block">{p50}</span>
      <span className="block text-xs text-muted-foreground">{average}</span>
    </>
  );
}
