"use client";

import { useEffect, useMemo, useState } from "react";
import { toast } from "sonner";
import { ChevronRight, PenLine, Plus, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { NumberInput } from "@/components/ui/number-input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import { Input } from "@/components/ui/input";
import { addMonths } from "@/lib/dates";
import { sortAccounts, type FinanceAccount, type FinanceBalance } from "@/lib/finance";
import { dayLabel, original, percent } from "@/lib/finance-format";
import { ratesOn, type DayRates } from "@/lib/fx";
import {
  LIQUID_WITHIN_MONTHS, RSU_PLAN_LABELS, isRsuPlan, nextWindow, parseRsuRules, priceOn, rsuOutlook, rsuProceeds, rsuStatus, rsuWindow,
  windowCutoffs, type RsuGrant, type RsuPlan, type RsuPrice, type RsuRules, type RsuSale,
} from "@/lib/rsu";
import { cn } from "@/lib/utils";
import { AccountName } from "./account-name";
import { financeAction, messageOf } from "./api";
import type { Confirmation } from "./confirm-dialog";
import { RsuGrantDialog } from "./rsu-grant-dialog";
import { RsuPriceChart } from "./rsu-price-chart";

/** How far the outlook looks. */
const OUTLOOK = 8;

/** A window by its month: "Oct 2026". */
const windowLabel = (cutoff: string) => new Date(`${cutoff}T00:00:00Z`).toLocaleDateString("en-GB", { month: "short", year: "numeric", timeZone: "UTC" });

/** A share of the holding, as the accounts list gives one: 45.8%. */
const share = (ratio: number) => `${Math.round(ratio * 1000) / 10}%`;

/** The tax rate last used for an account, remembered on this device. A price
 *  typed over the plan's is a what-if, and is not. */
function rememberedTax(id: string): number {
  try {
    const saved = JSON.parse(window.localStorage.getItem(`finance.rsu.${id}`) ?? "{}");
    return Number.isFinite(saved.tax) ? saved.tax : Number.NaN;
  } catch {
    return Number.NaN;
  }
}
function rememberTax(id: string, tax: number) {
  try { window.localStorage.setItem(`finance.rsu.${id}`, JSON.stringify({ tax })); } catch { /* private mode: not remembered */ }
}

/** RSUs, account by account: where the shares stand, and what a window would
 *  turn into money at a price -- the liquid part of an RSU account. */
export function RsuCard({ accounts, today, onSaved, onRecorded, onConfirm }: {
  accounts: FinanceAccount[];
  today: string;
  onSaved: (account: FinanceAccount) => void;
  onRecorded: (written: FinanceBalance[]) => void;
  onConfirm: (confirmation: Confirmation) => void;
}) {
  const holdings = sortAccounts(accounts.filter((a) => !a.archived_at && a.kind === "asset" && isRsuPlan(a.rsu_plan)))
    .map((account) => {
      const parsed = parseRsuRules(account.rsu_rules);
      return { account, rules: "rules" in parsed ? parsed.rules : null };
    })
    .filter((h): h is { account: FinanceAccount; rules: RsuRules } => h.rules !== null);
  if (holdings.length === 0) return null;
  return (
    <section className="rounded-2xl bg-card p-5 ring-1 ring-foreground/10 sm:p-6">
      <h2 className="text-base font-medium">RSUs</h2>
      <p className="mt-0.5 text-xs text-muted-foreground">
        What a buyback window would turn into money: pick the window; the price is the plan&rsquo;s, unless you give one.
      </p>
      <div className="mt-1 divide-y divide-border/60">
        {holdings.map(({ account, rules }) => (
          <Holding key={account.id} account={account} rules={rules} today={today} onSaved={onSaved} onRecorded={onRecorded} onConfirm={onConfirm} />
        ))}
      </div>
    </section>
  );
}

function Holding({ account, rules, today, onSaved, onRecorded, onConfirm }: {
  account: FinanceAccount;
  rules: RsuRules;
  today: string;
  onSaved: (account: FinanceAccount) => void;
  onRecorded: (written: FinanceBalance[]) => void;
  onConfirm: (confirmation: Confirmation) => void;
}) {
  const grants = useMemo(() => account.rsu_grants ?? [], [account.rsu_grants]);
  const sales = useMemo(() => account.rsu_sales ?? [], [account.rsu_sales]);
  const terms = useMemo(() => ({ rules, grants, sales }), [rules, grants, sales]);
  const hasProposed = grants.some((g) => !g.signed);
  const [includeProposed, setIncludeProposed] = useState(false);
  const counted = includeProposed && hasProposed;

  // Every window from the first tranche's to the year after the last one's.
  const windows = useMemo(() => {
    const days = [today, ...grants.flatMap((g) => g.tranches.map((t) => t.vests_on))].sort();
    return windowCutoffs(rules, days[0], `${Number(days.at(-1)!.slice(0, 4)) + 1}-12-31`);
  }, [grants, rules, today]);
  const [chosen, setChosen] = useState(() => nextWindow(rules, today));
  const cutoff = windows.includes(chosen) ? chosen : nextWindow(rules, today);

  // A price typed over the plan's, for a what-if; NaN uses the plan's.
  const [typed, setTyped] = useState(Number.NaN);
  const [tax, setTaxState] = useState(() => rememberedTax(account.id));
  const setTax = (t: number) => { setTaxState(t); rememberTax(account.id, t); };
  const given = typed > 0;
  /** The price a window sells at: the one typed, or the plan's in effect by its cutoff. */
  const priceAt = (day: string) => (given ? typed : priceOn(rules, day)?.price ?? Number.NaN);

  const [fx, setFx] = useState<DayRates | null>(null);
  useEffect(() => {
    let alive = true;
    ratesOn(today, [rules.currency, account.currency])
      .then((r) => { if (alive) setFx(r); })
      .catch(() => { /* amounts stay in the plan's currency */ });
    return () => { alive = false; };
  }, [today, rules.currency, account.currency]);

  const status = rsuStatus({ plan: account.rsu_plan as RsuPlan, ...terms }, today);
  const position = status.position;
  const w = rsuWindow(terms, cutoff, { includeProposed: counted });
  const outlook = rsuOutlook(terms, today, OUTLOOK, { includeProposed: counted });
  const windowPrice = priceOn(rules, cutoff);
  const price = priceAt(cutoff);
  const priced = price > 0;
  const proceeds = priced ? rsuProceeds(w.remaining, price, Number.isFinite(tax) ? tax / 100 : null) : null;
  // One unit of the plan's currency in the account's: to value the holding as the account keeps it.
  const toAccount = rules.currency === account.currency ? 1 : fx ? fx.rates[rules.currency].cny / fx.rates[account.currency].cny : null;
  // Today's value of what is held: at the price typed, or the plan's today.
  const priceToday = priceAt(today);
  const heldValue = priceToday > 0 && toAccount !== null ? Math.round(position.held * priceToday * toAccount * 100) / 100 : null;
  const latest = status.price;
  const yearAgo = priceOn(rules, addMonths(today, -12));
  const lastWindowPrice = rules.prices?.at(-1);
  const [showLines, setShowLines] = useState(false);
  const [grantOpen, setGrantOpen] = useState<RsuGrant | "new" | null>(null);

  /** Whether it went through: a form stays open on what failed. */
  async function act(action: string, payload: Record<string, unknown>, done: string): Promise<boolean> {
    try {
      onSaved(await financeAction<FinanceAccount>(action, payload));
      toast.success(done);
      return true;
    } catch (err) {
      toast.error(messageOf(err));
      return false;
    }
  }

  async function recordValue() {
    if (heldValue === null) return;
    try {
      const reply = await financeAction<{ balances: FinanceBalance[] }>("recordBalances", { as_of: today, entries: [{ account_id: account.id, amount: heldValue }] });
      onRecorded(reply.balances);
      toast.success(`Recorded ${original(heldValue, account.currency)} for ${dayLabel(today)}`);
    } catch (err) {
      toast.error(messageOf(err));
    }
  }

  return (
    <div className="py-4">
      <div className="flex items-start justify-between gap-3">
        <AccountName account={account} className="text-sm font-medium" />
        <span className="shrink-0 text-xs text-muted-foreground">{RSU_PLAN_LABELS[account.rsu_plan as keyof typeof RSU_PLAN_LABELS]} plan</span>
      </div>
      <p className="meta-row mt-0.5 flex flex-wrap gap-x-1.5 text-xs text-muted-foreground tabular-nums">
        <span>{position.held} held</span>
        <span>{position.unvested} still to vest</span>
        {position.sold > 0 && <span>{position.sold} sold</span>}
        {position.proposed > 0 && <span>{position.proposed} in a grant not yet signed</span>}
        {latest && (
          <span>
            {original(latest.price, rules.currency)} a share since {dayLabel(latest.effective_date)}
            {yearAgo && yearAgo !== latest && `, ${percent(latest.price / yearAgo.price - 1)} on a year before`}
          </span>
        )}
      </p>

      {grants.length === 0 ? (
        <p className="mt-3 text-sm text-muted-foreground">No grants yet. Add one, with its vesting schedule.</p>
      ) : (
        <>
          <div className="mt-3 grid grid-cols-2 items-end gap-3 sm:grid-cols-4">
            <div className="col-span-2 grid gap-1.5 sm:col-span-2">
              <Label className="text-xs">Window</Label>
              <Select value={cutoff} onValueChange={(v) => setChosen(v as string)}>
                <SelectTrigger className="h-9 w-full">
                  <SelectValue>{(v: string | null) => (v ? `${windowLabel(v)} · cutoff ${dayLabel(v)}` : "Window")}</SelectValue>
                </SelectTrigger>
                <SelectContent>
                  {windows.map((c) => (
                    <SelectItem key={c} value={c}>
                      {windowLabel(c)}{c < today ? " (past)" : c === nextWindow(rules, today) ? " (next)" : ""}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="grid gap-1.5">
              <Label htmlFor={`rsu-price-${account.id}`} className="text-xs">Price, {rules.currency}</Label>
              <NumberInput
                id={`rsu-price-${account.id}`} value={typed} emptyValue={Number.NaN} step="any" inputMode="decimal" className="h-9 text-right tabular-nums"
                placeholder={windowPrice ? original(windowPrice.price, rules.currency, { code: false }) : "Price"} onValueChange={setTyped}
              />
            </div>
            <div className="grid gap-1.5">
              <Label htmlFor={`rsu-tax-${account.id}`} className="text-xs">Tax, % <span className="font-normal text-muted-foreground">(optional)</span></Label>
              <NumberInput id={`rsu-tax-${account.id}`} value={tax} emptyValue={Number.NaN} step="any" inputMode="decimal" className="h-9 text-right tabular-nums" onValueChange={setTax} />
            </div>
          </div>
          {hasProposed && (
            <label className="mt-2 flex items-center gap-2 text-xs text-muted-foreground">
              <Switch checked={includeProposed} onCheckedChange={setIncludeProposed} />
              Count the grant not yet signed
            </label>
          )}

          <dl className="mt-3 grid grid-cols-2 gap-x-4 gap-y-2 sm:grid-cols-4">
            <Figure label="Vested by the cutoff" value={`${w.vested}`} />
            <Figure label="Sellable, all windows" value={`${w.cumulative}`} />
            <Figure label="Sold before" value={`${w.sold_before}`} />
            <Figure label={w.sold > 0 ? "This window, left" : "This window"} value={`${w.remaining} shares`} strong />
          </dl>
          {proceeds && (
            <div className="mt-3 rounded-lg bg-muted/60 px-3 py-2.5">
              <p className="text-xs text-muted-foreground">
                {w.remaining} × {original(price, rules.currency)}
                {given
                  ? " · the price given"
                  : windowPrice && (windowPrice === lastWindowPrice && cutoff > today
                    ? ` · the latest price, from ${dayLabel(windowPrice.effective_date)}`
                    : ` · the price from ${dayLabel(windowPrice.effective_date)}`)}
                {w.projected && <span> · a projection: past what the rules were checked against</span>}
              </p>
              <dl className="mt-1.5 grid grid-cols-2 gap-x-4 gap-y-1 sm:grid-cols-3">
                <Money label="Before tax" amount={proceeds.gross} currency={rules.currency} fx={fx} strong={proceeds.net === null} />
                {proceeds.tax !== null && <Money label={`Tax at ${tax}%`} amount={proceeds.tax} currency={rules.currency} fx={fx} />}
                {proceeds.net !== null && <Money label="After tax" amount={proceeds.net} currency={rules.currency} fx={fx} strong />}
              </dl>
            </div>
          )}

          <Disclosure open={showLines} onToggle={() => setShowLines((v) => !v)} label={`Every tranche in the ${windowLabel(cutoff)} window`} />
          {showLines && <Lines lines={w.lines} />}

          <div className="mt-4">
            <p className="text-sm font-medium">Window by window</p>
            <p className="text-xs text-muted-foreground">
              If every window from the next is sold in full
              {given ? `, at ${original(typed, rules.currency)}` : lastWindowPrice ? `, each at the price by its cutoff: the latest, ${original(lastWindowPrice.price, rules.currency)}, for one still to come` : ""}.
            </p>
            <div className="@container mt-1.5 overflow-x-auto">
              <table className="w-full text-sm tabular-nums">
                <thead className="text-xs text-muted-foreground">
                  <tr className="border-b">
                    <th className="py-1.5 pr-2 text-left font-normal">Window</th>
                    <th className="px-2 text-right font-normal">Sellable, all</th>
                    <th className="px-2 text-right font-normal">This one</th>
                    {(given || lastWindowPrice) && <th className="pl-2 text-right font-normal">Before tax</th>}
                  </tr>
                </thead>
                <tbody>
                  {outlook.map((o) => (
                    <tr key={o.cutoff} className={cn("border-b border-border/40", o.projected && "text-muted-foreground")}>
                      <td className="py-1.5 pr-2">{windowLabel(o.cutoff)}{o.projected && <span title="Past what the rules were checked against"> *</span>}</td>
                      <td className="px-2 text-right">{o.cumulative}</td>
                      <td className="px-2 text-right font-medium">{o.if_sold_in_full}</td>
                      {(given || lastWindowPrice) && (
                        <td className="pl-2 text-right">{priceAt(o.cutoff) > 0 ? original(o.if_sold_in_full * priceAt(o.cutoff), rules.currency, { whole: true, code: false }) : "–"}</td>
                      )}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            {outlook.some((o) => o.projected) && <p className="mt-1 text-xs text-muted-foreground">* A projection: the rules were checked through {rules.verified_through ? dayLabel(rules.verified_through) : "no window"}.</p>}
          </div>

          {heldValue !== null && (
            <div className="mt-4 flex flex-wrap items-center justify-between gap-2 text-xs text-muted-foreground">
              <span>
                The {position.held} shares held come to {original(heldValue, account.currency)} at {given ? "the price given" : "today\u2019s price"}.{" "}
                {account.liquidity != null
                  ? `Counted liquid: ${share(Number(account.liquidity))}, as set on the account.`
                  : status.liquid.window
                    ? `Counted liquid: ${share(status.liquidity)}, what the ${windowLabel(status.liquid.window)} window, within ${LIQUID_WITHIN_MONTHS} months, may still buy of them.`
                    : `Counted liquid: none, as no window falls within ${LIQUID_WITHIN_MONTHS} months; the next is ${windowLabel(status.next_window.cutoff)}.`}
              </span>
              <Button variant="outline" size="sm" onClick={recordValue}><PenLine /> Record as today&rsquo;s balance</Button>
            </div>
          )}
        </>
      )}

      <Grants
        grants={grants}
        rules={rules}
        today={today}
        onAdd={() => setGrantOpen("new")}
        onEdit={(g) => setGrantOpen(g)}
        onSign={(g) => act("updateRsuGrant", { id: g.id, updates: { signed: true } }, `Signed ${g.grant_no}`)}
        onDelete={(g) => onConfirm({
          title: `Delete ${g.grant_no}?`,
          description: "Its tranches go with it, and every window is worked out without them.",
          action: "Delete",
          run: async () => { await act("deleteRsuGrant", { id: g.id }, `Deleted ${g.grant_no}`); },
        })}
      />
      <Sales
        account={account}
        rules={rules}
        sales={sales}
        windows={windows}
        defaults={{ cutoff, shares: w.remaining, price }}
        onAdd={(sale) => act("addRsuSale", { account_id: account.id, ...sale }, `Recorded the ${windowLabel(sale.window_cutoff)} sale`)}
        onDelete={(s) => onConfirm({
          title: `Delete the ${windowLabel(s.window_cutoff)} sale?`,
          description: "Later windows are worked out as if it had not been sold.",
          action: "Delete",
          run: async () => { await act("deleteRsuSale", { id: s.id }, "Sale deleted"); },
        })}
      />

      <Prices
        id={account.id}
        rules={rules}
        today={today}
        onSave={(prices, done) => act("updateAccount", { id: account.id, updates: { rsu_rules: { ...rules, prices } } }, done)}
        onDelete={(p) => onConfirm({
          title: `Delete the price from ${dayLabel(p.effective_date)}?`,
          description: "A window it priced takes the price before it instead.",
          action: "Delete",
          run: async () => {
            const prices = (rules.prices ?? []).filter((x) => x.effective_date !== p.effective_date);
            await act("updateAccount", { id: account.id, updates: { rsu_rules: { ...rules, prices } } }, "Price deleted");
          },
        })}
      />

      <RsuGrantDialog
        open={grantOpen !== null}
        grant={grantOpen === "new" ? null : grantOpen}
        account={account}
        rules={rules}
        onClose={() => setGrantOpen(null)}
        onSaved={onSaved}
      />
    </div>
  );
}

function Figure({ label, value, strong = false }: { label: string; value: string; strong?: boolean }) {
  return (
    <div>
      <dt className="text-xs text-muted-foreground">{label}</dt>
      <dd className={cn("text-sm tabular-nums", strong && "font-medium")}>{value}</dd>
    </div>
  );
}

/** An amount in the plan's currency, with what it comes to in CNY and SGD. */
function Money({ label, amount, currency, fx, strong = false }: { label: string; amount: number; currency: string; fx: DayRates | null; strong?: boolean }) {
  const unit = fx?.rates[currency];
  return (
    <div>
      <dt className="text-xs text-muted-foreground">{label}</dt>
      <dd className={cn("text-sm tabular-nums", strong && "font-medium")}>{original(amount, currency)}</dd>
      {unit && (
        <dd className="text-xs text-muted-foreground tabular-nums">
          ≈ {original(amount * unit.cny, "CNY", { whole: true })} · {original(amount * unit.sgd, "SGD", { whole: true })}
        </dd>
      )}
    </div>
  );
}

function Disclosure({ open, onToggle, label }: { open: boolean; onToggle: () => void; label: string }) {
  return (
    <button type="button" aria-expanded={open} onClick={onToggle} className="-ml-1 mt-3 flex items-center gap-1 rounded px-1 text-left text-xs font-medium hover:bg-muted">
      <ChevronRight className={cn("size-3.5 shrink-0 text-muted-foreground transition-transform", open && "rotate-90")} />
      {label}
    </button>
  );
}

function Lines({ lines }: { lines: ReturnType<typeof rsuWindow>["lines"] }) {
  if (lines.length === 0) return <p className="mt-1.5 text-xs text-muted-foreground">No tranche has vested by this cutoff.</p>;
  return (
    <div className="mt-1.5 overflow-x-auto">
      <table className="w-full text-xs tabular-nums">
        <thead className="text-muted-foreground">
          <tr className="border-b">
            <th className="py-1 pr-2 text-left font-normal">Grant</th>
            <th className="px-2 text-left font-normal">Vested</th>
            <th className="px-2 text-right font-normal">Shares</th>
            <th className="px-2 text-right font-normal">Years</th>
            <th className="px-2 text-right font-normal">Rate</th>
            <th className="pl-2 text-right font-normal">Sellable</th>
          </tr>
        </thead>
        <tbody>
          {lines.map((l) => (
            <tr key={`${l.grant_no}-${l.vests_on}`} className={cn("border-b border-border/40", !l.signed && "text-muted-foreground")}>
              <td className="py-1 pr-2">{l.grant_no}{!l.signed && " (unsigned)"}</td>
              <td className="px-2">{dayLabel(l.vests_on)}</td>
              <td className="px-2 text-right">{l.shares}</td>
              <td className="px-2 text-right">{l.full_years}</td>
              <td className="px-2 text-right">{l.rate}%{l.extrapolated && " *"}</td>
              <td className="pl-2 text-right">{Number(l.sellable.toFixed(4))}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function Grants({ grants, rules, today, onAdd, onEdit, onSign, onDelete }: {
  grants: RsuGrant[];
  rules: RsuRules;
  today: string;
  onAdd: () => void;
  onEdit: (g: RsuGrant) => void;
  onSign: (g: RsuGrant) => void;
  onDelete: (g: RsuGrant) => void;
}) {
  const [open, setOpen] = useState(grants.length === 0);
  return (
    <div className="mt-4">
      <div className="flex items-center justify-between gap-2">
        <Disclosure open={open} onToggle={() => setOpen((v) => !v)} label={`Grants (${grants.length})`} />
        <Button variant="ghost" size="sm" className="mt-3" onClick={onAdd}><Plus /> Add grant</Button>
      </div>
      {open && (
        <ul className="mt-1 divide-y divide-border/60 text-sm">
          {grants.map((g) => {
            const total = g.tranches.reduce((n, t) => n + t.shares, 0);
            const vested = g.tranches.filter((t) => t.vests_on <= today).reduce((n, t) => n + t.shares, 0);
            return (
              <li key={g.id} className="flex items-center gap-2 py-2">
                <div className="min-w-0 flex-1">
                  <p className="truncate">
                    {g.grant_no}
                    {g.label && <span className="text-muted-foreground"> · {g.label}</span>}
                    {!g.signed && <span className="ml-1.5 rounded bg-muted px-1.5 py-0.5 text-[10px] font-medium">Not signed</span>}
                  </p>
                  <p className="text-xs text-muted-foreground tabular-nums">
                    {vested} of {total} vested · {rules.profiles[g.profile]?.label ?? g.profile} ({rules.profiles[g.profile]?.rates.map((r) => `${r}%`).join(" / ") ?? "no such profile"})
                  </p>
                </div>
                {!g.signed && <Button variant="outline" size="sm" onClick={() => onSign(g)}>Signed</Button>}
                <Button variant="ghost" size="sm" aria-label={`Edit ${g.grant_no}`} onClick={() => onEdit(g)}><PenLine /></Button>
                <Button variant="ghost" size="sm" aria-label={`Delete ${g.grant_no}`} onClick={() => onDelete(g)}><Trash2 /></Button>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}

function Sales({ account, rules, sales, windows, defaults, onAdd, onDelete }: {
  account: FinanceAccount;
  rules: RsuRules;
  sales: RsuSale[];
  windows: string[];
  defaults: { cutoff: string; shares: number; price: number };
  onAdd: (sale: { window_cutoff: string; shares: number; price: number | null; tax: number | null }) => Promise<boolean>;
  onDelete: (s: RsuSale) => void;
}) {
  const [open, setOpen] = useState(false);
  const [adding, setAdding] = useState(false);
  const [form, setForm] = useState({ cutoff: defaults.cutoff, shares: Number.NaN, price: Number.NaN, tax: Number.NaN });
  const start = () => {
    setForm({ cutoff: defaults.cutoff, shares: defaults.shares || Number.NaN, price: defaults.price, tax: Number.NaN });
    setAdding(true);
    setOpen(true);
  };
  async function save() {
    if (!(Number.isInteger(form.shares) && form.shares > 0)) { toast.error("Enter the shares sold, a whole number"); return; }
    const added = await onAdd({
      window_cutoff: form.cutoff, shares: form.shares,
      price: form.price > 0 ? form.price : null, tax: Number.isFinite(form.tax) && form.tax >= 0 ? form.tax : null,
    });
    if (added) setAdding(false);
  }
  return (
    <div className="mt-2">
      <div className="flex items-center justify-between gap-2">
        <Disclosure open={open} onToggle={() => setOpen((v) => !v)} label={`Sales (${sales.length})`} />
        <Button variant="ghost" size="sm" className="mt-3" onClick={start}><Plus /> Record a sale</Button>
      </div>
      {open && (
        <div className="mt-1">
          {sales.length === 0 && !adding && <p className="text-xs text-muted-foreground">Nothing sold yet. Each sale comes off the windows after it.</p>}
          <ul className="divide-y divide-border/60 text-sm">
            {sales.map((s) => (
              <li key={s.id} className="flex items-center gap-2 py-2">
                <div className="min-w-0 flex-1 tabular-nums">
                  <p>{windowLabel(s.window_cutoff)}: {s.shares} shares{s.price != null && ` at ${original(Number(s.price), rules.currency)}`}</p>
                  {s.tax != null && <p className="text-xs text-muted-foreground">{original(Number(s.tax), rules.currency)} tax withheld</p>}
                </div>
                <Button variant="ghost" size="sm" aria-label={`Delete the ${windowLabel(s.window_cutoff)} sale`} onClick={() => onDelete(s)}><Trash2 /></Button>
              </li>
            ))}
          </ul>
          {adding && (
            <div className="mt-2 grid grid-cols-2 items-end gap-2 sm:grid-cols-5">
              <div className="col-span-2 grid gap-1">
                <Label className="text-xs">Window</Label>
                <Select value={form.cutoff} onValueChange={(v) => setForm((f) => ({ ...f, cutoff: v as string }))}>
                  <SelectTrigger className="h-9 w-full"><SelectValue>{(v: string | null) => (v ? windowLabel(v) : "Window")}</SelectValue></SelectTrigger>
                  <SelectContent>{windows.map((c) => <SelectItem key={c} value={c}>{windowLabel(c)}</SelectItem>)}</SelectContent>
                </Select>
              </div>
              <div className="grid gap-1">
                <Label htmlFor={`sale-shares-${account.id}`} className="text-xs">Shares</Label>
                <NumberInput id={`sale-shares-${account.id}`} value={form.shares} emptyValue={Number.NaN} step={1} inputMode="numeric" className="h-9 text-right tabular-nums" onValueChange={(v) => setForm((f) => ({ ...f, shares: v }))} />
              </div>
              <div className="grid gap-1">
                <Label htmlFor={`sale-price-${account.id}`} className="text-xs">Price</Label>
                <NumberInput id={`sale-price-${account.id}`} value={form.price} emptyValue={Number.NaN} step="any" inputMode="decimal" className="h-9 text-right tabular-nums" onValueChange={(v) => setForm((f) => ({ ...f, price: v }))} />
              </div>
              <div className="grid gap-1">
                <Label htmlFor={`sale-tax-${account.id}`} className="text-xs">Tax withheld</Label>
                <NumberInput id={`sale-tax-${account.id}`} value={form.tax} emptyValue={Number.NaN} step="any" inputMode="decimal" className="h-9 text-right tabular-nums" onValueChange={(v) => setForm((f) => ({ ...f, tax: v }))} />
              </div>
              <div className="col-span-2 flex gap-2 sm:col-span-5">
                <Button size="sm" onClick={save}>Record</Button>
                <Button variant="ghost" size="sm" onClick={() => setAdding(false)}>Cancel</Button>
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

/** The plan's price over time: the trend, and the list of prices -- the same
 *  numbers, and where a new one is added as the plan announces it. */
function Prices({ id, rules, today, onSave, onDelete }: {
  id: string;
  rules: RsuRules;
  today: string;
  onSave: (prices: RsuPrice[], done: string) => Promise<boolean>;
  onDelete: (p: RsuPrice) => void;
}) {
  const prices = rules.prices ?? [];
  const [open, setOpen] = useState(false);
  const [adding, setAdding] = useState(false);
  const [form, setForm] = useState({ day: today, price: Number.NaN });
  const start = () => {
    setForm({ day: today, price: Number.NaN });
    setAdding(true);
    setOpen(true);
  };
  async function save() {
    if (!form.day) { toast.error("Give the day the price took effect"); return; }
    if (!(form.price > 0)) { toast.error("Enter the price per share"); return; }
    if (prices.some((p) => p.effective_date === form.day)) { toast.error(`There is already a price from ${dayLabel(form.day)}`); return; }
    const next = [...prices, { effective_date: form.day, price: form.price }].sort((a, b) => a.effective_date.localeCompare(b.effective_date));
    if (await onSave(next, `Added the price from ${dayLabel(form.day)}`)) setAdding(false);
  }
  const newestFirst = [...prices].reverse();
  return (
    <div className="mt-2">
      <div className="flex items-center justify-between gap-2">
        <Disclosure open={open} onToggle={() => setOpen((v) => !v)} label={`Prices (${prices.length})`} />
        <Button variant="ghost" size="sm" className="mt-3" onClick={start}><Plus /> Add price</Button>
      </div>
      {open && (
        <div className="mt-1 space-y-2">
          {prices.length === 0 && !adding && (
            <p className="text-xs text-muted-foreground">No prices yet. Each window is priced at the one in effect by its cutoff.</p>
          )}
          <RsuPriceChart prices={prices} currency={rules.currency} today={today} />
          {prices.length > 0 && (
            <div className="overflow-x-auto">
              <table className="w-full text-sm tabular-nums">
                <thead className="text-xs text-muted-foreground">
                  <tr className="border-b">
                    <th className="py-1.5 pr-2 text-left font-normal">From</th>
                    <th className="px-2 text-right font-normal">Price, {rules.currency}</th>
                    <th className="px-2 text-right font-normal">Change</th>
                    <th className="w-8" aria-label="Delete" />
                  </tr>
                </thead>
                <tbody>
                  {newestFirst.map((p, i) => {
                    const before = newestFirst[i + 1];
                    return (
                      <tr key={p.effective_date} className="border-b border-border/40">
                        <td className="py-1 pr-2">{dayLabel(p.effective_date)}</td>
                        <td className="px-2 text-right">{original(p.price, rules.currency, { code: false })}</td>
                        <td className="px-2 text-right text-muted-foreground">{before ? percent(p.price / before.price - 1) : ""}</td>
                        <td className="text-right">
                          <Button variant="ghost" size="sm" aria-label={`Delete the price from ${dayLabel(p.effective_date)}`} onClick={() => onDelete(p)}><Trash2 /></Button>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
          {adding && (
            <div className="grid grid-cols-2 items-end gap-2 sm:grid-cols-4">
              <div className="grid gap-1">
                <Label htmlFor={`rsu-price-day-${id}`} className="text-xs">From</Label>
                <Input id={`rsu-price-day-${id}`} type="date" className="h-9" value={form.day} onChange={(e) => setForm((f) => ({ ...f, day: e.target.value }))} />
              </div>
              <div className="grid gap-1">
                <Label htmlFor={`rsu-price-new-${id}`} className="text-xs">Price, {rules.currency}</Label>
                <NumberInput id={`rsu-price-new-${id}`} value={form.price} emptyValue={Number.NaN} step="any" inputMode="decimal" className="h-9 text-right tabular-nums" onValueChange={(v) => setForm((f) => ({ ...f, price: v }))} />
              </div>
              <div className="col-span-2 flex gap-2">
                <Button size="sm" onClick={save}>Add</Button>
                <Button variant="ghost" size="sm" onClick={() => setAdding(false)}>Cancel</Button>
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
