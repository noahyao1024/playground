"use client";

import { useEffect, useRef, useState } from "react";
import { toast } from "sonner";
import { PenLine, Plus, RotateCw, Trash2, Upload } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { NumberInput } from "@/components/ui/number-input";
import { dayInSG, todayInSG } from "@/lib/dates";
import { sortAccounts, type FinanceAccount, type FinanceBalance } from "@/lib/finance";
import { dayLabel, original, percent } from "@/lib/finance-format";
import { holdingsOf, minGainOf, type Holding, type StockPosition } from "@/lib/stocks";
import { cn } from "@/lib/utils";
import { AccountName } from "./account-name";
import { financeAction, messageOf } from "./api";
import type { Confirmation } from "./confirm-dialog";
import { StockImportDialog } from "./stock-import-dialog";

/** What the stock actions answer: the account or accounts as they now stand,
 *  and today's balances recorded from them. */
export type StocksReply = {
  account?: FinanceAccount | null;
  accounts?: FinanceAccount[];
  balances?: FinanceBalance[];
  recorded?: string[];
  priced?: number;
  failures?: Array<{ symbol: string; reason: string }>;
  skipped?: Array<{ account_id: string; reason: string }>;
};

/** How old prices may be before opening the page fetches them again. */
const STALE_MS = 10 * 60_000;

/** A share, as the accounts list gives one: 45.8%. */
const share = (ratio: number) => `${Math.round(ratio * 1000) / 10}%`;

/** When positions were last priced: the time today, else the day. */
function pricedLabel(at: string): string {
  const day = dayInSG(at);
  if (day !== todayInSG()) return dayLabel(day);
  return new Date(at).toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit", timeZone: "Asia/Singapore" });
}

const lastPriced = (positions: StockPosition[]) =>
  positions.reduce<string | null>((t, p) => (p.priced_at && (!t || p.priced_at > t) ? p.priced_at : t), null);

/** Stocks, account by account, at market prices: what each position is worth,
 *  what it gained, and how much of it is liquid -- positions up by more than
 *  the account's threshold. */
export function StocksCard({ accounts, onChanged, onConfirm }: {
  accounts: FinanceAccount[];
  onChanged: (reply: StocksReply) => void;
  onConfirm: (confirmation: Confirmation) => void;
}) {
  const open = accounts.filter((a) => !a.archived_at && a.kind === "asset");
  const holding = sortAccounts(open.filter((a) => (a.stock_positions?.length ?? 0) > 0));
  // Where positions may go: an open asset holding no RSUs, investments first.
  const into = open.filter((a) => !a.rsu_plan).sort((a, b) => Number(b.category === "investment") - Number(a.category === "investment"));
  const [importing, setImporting] = useState<string | null | false>(false);
  const [refreshing, setRefreshing] = useState(false);

  // Opening the page prices the positions again once they are ten minutes old.
  // Quietly: if the source will not answer, the prices kept stand.
  const stale = holding.some((a) => a.stock_positions!.some((p) => !p.priced_at || Date.now() - Date.parse(p.priced_at) > STALE_MS));
  const asked = useRef(false);
  useEffect(() => {
    if (!stale || asked.current) return;
    asked.current = true;
    financeAction<StocksReply>("revalueStocks", {}).then(onChanged).catch(() => { /* Refresh says why */ });
  }, [stale, onChanged]);

  async function refresh() {
    setRefreshing(true);
    try {
      const reply = await financeAction<StocksReply>("revalueStocks", {});
      onChanged(reply);
      if (reply.failures?.length) toast.error(`No price for ${reply.failures.map((f) => f.symbol).join(", ")} just now: its last one stands`);
      else toast.success("Prices refreshed");
    } catch (err) {
      toast.error(messageOf(err));
    } finally {
      setRefreshing(false);
    }
  }

  if (holding.length === 0 && into.length === 0) return null;
  return (
    <section className="rounded-2xl bg-card p-5 ring-1 ring-foreground/10 sm:p-6">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div>
          <h2 className="text-base font-medium">Stocks</h2>
          <p className="mt-0.5 text-xs text-muted-foreground">
            At market prices, from Yahoo Finance. A position up more than the account&rsquo;s threshold counts as liquid.
          </p>
        </div>
        <div className="flex gap-1.5">
          {holding.length > 0 && (
            <Button variant="outline" size="sm" onClick={refresh} disabled={refreshing}>
              <RotateCw className={cn(refreshing && "animate-spin")} /> Refresh
            </Button>
          )}
          <Button variant="outline" size="sm" onClick={() => setImporting(holding[0]?.id ?? into[0]?.id ?? null)}><Upload /> Import</Button>
        </div>
      </div>
      {holding.length === 0 ? (
        <p className="mt-3 text-sm text-muted-foreground">No positions yet. Import them from your broker: a line each, the symbol, the shares and the average cost.</p>
      ) : (
        <div className="mt-1 divide-y divide-border/60">
          {holding.map((a) => <Brokerage key={a.id} account={a} onChanged={onChanged} onConfirm={onConfirm} onImport={() => setImporting(a.id)} />)}
        </div>
      )}
      <StockImportDialog
        open={importing !== false}
        accounts={into}
        initial={importing === false ? null : importing}
        onClose={() => setImporting(false)}
        onImported={onChanged}
      />
    </section>
  );
}

function Brokerage({ account, onChanged, onConfirm, onImport }: {
  account: FinanceAccount;
  onChanged: (reply: StocksReply) => void;
  onConfirm: (confirmation: Confirmation) => void;
  onImport: () => void;
}) {
  const positions = account.stock_positions ?? [];
  const minGain = minGainOf(account);
  const held = holdingsOf(positions, minGain);
  const priced = held.holdings.filter((h) => h.value !== null);
  const liquidCount = priced.filter((h) => h.liquid).length;
  const at = lastPriced(positions);
  const [threshold, setThreshold] = useState(minGain);
  const [editing, setEditing] = useState<string | null>(null);
  const [adding, setAdding] = useState(false);

  /** Whether it went through: a form stays open on what failed. */
  async function act(action: string, payload: Record<string, unknown>, done: string): Promise<boolean> {
    try {
      onChanged(await financeAction<StocksReply>(action, payload));
      toast.success(done);
      return true;
    } catch (err) {
      toast.error(messageOf(err));
      return false;
    }
  }

  async function saveThreshold() {
    if (!Number.isFinite(threshold) || threshold === minGain) return;
    try {
      await financeAction<FinanceAccount>("updateAccount", { id: account.id, updates: { liquid_min_gain: threshold } });
      // Today's balance again, its liquid share with the new threshold.
      onChanged(await financeAction<StocksReply>("revalueStocks", { account_id: account.id, prices: "kept" }));
      toast.success(`Liquid once up more than ${threshold}%`);
    } catch (err) {
      setThreshold(minGain);
      toast.error(messageOf(err));
    }
  }

  return (
    <div className="py-4">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <AccountName account={account} className="text-sm font-medium" />
          <p className="mt-0.5 text-xs text-muted-foreground">
            {positions.length} position{positions.length === 1 ? "" : "s"}{at && ` · prices from ${pricedLabel(at)}`}
          </p>
        </div>
        <div className="shrink-0 text-right tabular-nums">
          <p className="text-sm font-medium">{original(held.value, account.currency)}</p>
          {held.gain !== null && <p className="text-xs text-muted-foreground">{percent(held.gain)} on cost</p>}
        </div>
      </div>

      <div className="mt-2 flex flex-wrap items-center gap-x-1.5 gap-y-1 rounded-lg bg-muted/60 px-3 py-2 text-xs">
        <span>
          Liquid <span className="font-medium tabular-nums">{original(held.liquid_value, account.currency)}</span>
          <span className="text-muted-foreground"> ({share(held.liquidity)}): {liquidCount} of {priced.length} up more than</span>
        </span>
        <NumberInput
          aria-label="Liquid once up more than, percent"
          value={threshold}
          emptyValue={Number.NaN}
          step="any"
          inputMode="decimal"
          className="h-7 w-16 text-right tabular-nums"
          onValueChange={setThreshold}
          onBlur={saveThreshold}
          onKeyDown={(e) => { if (e.key === "Enter") (e.target as HTMLInputElement).blur(); }}
        />
        <span className="text-muted-foreground">%</span>
      </div>
      {held.unpriced.length > 0 && (
        <p className="mt-1.5 text-xs text-muted-foreground">Not priced yet, so left out: {held.unpriced.join(", ")}. Refresh to try again.</p>
      )}

      <ul className="mt-1 divide-y divide-border/60">
        {held.holdings.map((h) => (
          editing === h.position.id
            ? <PositionForm key={h.position.id} holding={h} onCancel={() => setEditing(null)} onSave={async (updates) => {
              if (await act("updateStockPosition", { id: h.position.id, updates }, `Saved ${h.position.symbol}`)) setEditing(null);
            }} />
            : <PositionRow
              key={h.position.id}
              holding={h}
              accountCurrency={account.currency}
              onEdit={() => setEditing(h.position.id)}
              onDelete={() => onConfirm({
                title: `Delete ${h.position.symbol}?`,
                description: "The account is valued again without it.",
                action: "Delete",
                run: async () => { await act("deleteStockPosition", { id: h.position.id }, `Deleted ${h.position.symbol}`); },
              })}
            />
        ))}
      </ul>

      {adding ? (
        <AddPosition onCancel={() => setAdding(false)} onAdd={async (p) => {
          if (await act("addStockPosition", { account_id: account.id, ...p }, `Added ${p.symbol.toUpperCase()}`)) setAdding(false);
        }} />
      ) : (
        <div className="mt-1 flex gap-1">
          <Button variant="ghost" size="sm" onClick={() => setAdding(true)}><Plus /> Add position</Button>
          <Button variant="ghost" size="sm" onClick={onImport}><Upload /> Import</Button>
        </div>
      )}
    </div>
  );
}

function PositionRow({ holding: h, accountCurrency, onEdit, onDelete }: {
  holding: Holding;
  accountCurrency: string;
  onEdit: () => void;
  onDelete: () => void;
}) {
  const p = h.position;
  return (
    <li className="flex items-start gap-2 py-2">
      <div className="min-w-0 flex-1">
        <p className="flex min-w-0 items-baseline gap-1.5 text-sm">
          <span className="shrink-0 font-medium">{p.symbol}</span>
          {p.name && <span className="truncate text-xs text-muted-foreground">{p.name}</span>}
        </p>
        <p className="text-xs text-muted-foreground tabular-nums">
          {Number(p.quantity).toLocaleString("en-US")} × {p.price != null ? original(Number(p.price), p.currency) : "no price yet"}
          {" · "}cost {original(Number(p.cost), p.currency, { code: false })}
        </p>
      </div>
      <div className="shrink-0 text-right tabular-nums">
        <p className="text-sm">{h.value !== null ? original(h.value, accountCurrency, { code: false }) : "–"}</p>
        <p className="text-xs text-muted-foreground">
          {h.gain !== null ? percent(h.gain) : h.value !== null ? "no cost" : ""}
          {h.value !== null && h.liquid && <span className="ml-1.5 rounded bg-muted px-1.5 py-0.5 text-[10px] font-medium text-foreground">Liquid</span>}
        </p>
      </div>
      <Button variant="ghost" size="sm" aria-label={`Edit ${p.symbol}`} onClick={onEdit}><PenLine /></Button>
      <Button variant="ghost" size="sm" aria-label={`Delete ${p.symbol}`} onClick={onDelete}><Trash2 /></Button>
    </li>
  );
}

function PositionForm({ holding: h, onSave, onCancel }: {
  holding: Holding;
  onSave: (updates: { quantity: number; cost: number }) => Promise<void>;
  onCancel: () => void;
}) {
  const p = h.position;
  const [quantity, setQuantity] = useState(Number(p.quantity));
  const [cost, setCost] = useState(Number(p.cost));
  return (
    <li className="grid grid-cols-2 items-end gap-2 py-2 sm:grid-cols-4">
      <p className="col-span-2 text-sm font-medium sm:col-span-4">{p.symbol}</p>
      <div className="grid gap-1">
        <Label htmlFor={`stock-qty-${p.id}`} className="text-xs">Shares</Label>
        <NumberInput id={`stock-qty-${p.id}`} value={quantity} emptyValue={Number.NaN} step="any" inputMode="decimal" className="h-9 text-right tabular-nums" onValueChange={setQuantity} />
      </div>
      <div className="grid gap-1">
        <Label htmlFor={`stock-cost-${p.id}`} className="text-xs">Average cost, {p.currency}</Label>
        <NumberInput id={`stock-cost-${p.id}`} value={cost} emptyValue={Number.NaN} step="any" inputMode="decimal" className="h-9 text-right tabular-nums" onValueChange={setCost} />
      </div>
      <div className="col-span-2 flex gap-2">
        <Button size="sm" onClick={() => {
          if (!(quantity > 0) || !(cost >= 0)) { toast.error("Enter the shares, above 0, and the average cost"); return; }
          void onSave({ quantity, cost });
        }}>Save</Button>
        <Button variant="ghost" size="sm" onClick={onCancel}>Cancel</Button>
      </div>
    </li>
  );
}

function AddPosition({ onAdd, onCancel }: {
  onAdd: (p: { symbol: string; quantity: number; cost: number }) => Promise<void>;
  onCancel: () => void;
}) {
  const [symbol, setSymbol] = useState("");
  const [quantity, setQuantity] = useState(Number.NaN);
  const [cost, setCost] = useState(Number.NaN);
  return (
    <div className="mt-2 grid grid-cols-3 items-end gap-2">
      <div className="grid gap-1">
        <Label htmlFor="stock-new-symbol" className="text-xs">Symbol</Label>
        <Input id="stock-new-symbol" className="h-9 uppercase" placeholder="AAPL" value={symbol} onChange={(e) => setSymbol(e.target.value)} />
      </div>
      <div className="grid gap-1">
        <Label htmlFor="stock-new-qty" className="text-xs">Shares</Label>
        <NumberInput id="stock-new-qty" value={quantity} emptyValue={Number.NaN} step="any" inputMode="decimal" className="h-9 text-right tabular-nums" onValueChange={setQuantity} />
      </div>
      <div className="grid gap-1">
        <Label htmlFor="stock-new-cost" className="text-xs">Average cost</Label>
        <NumberInput id="stock-new-cost" value={cost} emptyValue={Number.NaN} step="any" inputMode="decimal" className="h-9 text-right tabular-nums" onValueChange={setCost} />
      </div>
      <div className="col-span-3 flex gap-2">
        <Button size="sm" onClick={() => {
          if (!symbol.trim() || !(quantity > 0) || !(cost >= 0)) { toast.error("Enter the symbol, the shares and the average cost"); return; }
          void onAdd({ symbol: symbol.trim(), quantity, cost });
        }}>Add</Button>
        <Button variant="ghost" size="sm" onClick={onCancel}>Cancel</Button>
      </div>
    </div>
  );
}
