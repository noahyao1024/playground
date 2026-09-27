import type { SupabaseClient } from "@supabase/supabase-js";
import { todayInSG } from "@/lib/dates";
import type { FinanceAccount, FinanceBalance } from "@/lib/finance";
import { readStockPositions } from "@/lib/finance-server";
import { isFinanceCurrency, ratesOn } from "@/lib/fx";
import { fetchAllRows } from "@/lib/paginate";
import { quotesFor, type NoQuote, type Quote } from "@/lib/quotes";
import { holdingsOf, minGainOf, type StockPosition } from "@/lib/stocks";

/** Stock accounts valued, the server side: positions priced from the quote
 *  source, and each account's balance for the day recorded from them -- with
 *  the share of it that is liquid -- as though the owner had recorded it by
 *  hand. The page, the API and the daily job all value them this way. */

export type Revaluation = {
  /** Accounts whose balance for the day was recorded from their positions. */
  recorded: string[];
  /** Positions given a price just now. */
  priced: number;
  /** Symbols that could not be priced, and why: they keep their last price. */
  failures: Array<{ symbol: string; reason: string }>;
  /** Accounts not recorded: a position has never been priced. */
  skipped: Array<{ account_id: string; reason: string }>;
  /** The balances written. */
  balances: FinanceBalance[];
};

const cents = (n: number) => Math.round(n * 100) / 100;

/** Values every stock account -- or one -- and records today's balance for
 *  each from its positions. `quotes` refetches prices: all of them, or with a
 *  map given, those in it (an import has just fetched them); `false` values
 *  what is held at the prices already kept, after a position is edited. */
export async function revalueStocks(db: SupabaseClient, {
  accountId,
  today = todayInSG(),
  quotes = true,
  now = new Date(),
}: {
  accountId?: string;
  today?: string;
  quotes?: boolean | Map<string, Quote | NoQuote>;
  now?: Date;
} = {}): Promise<Revaluation> {
  const positions = await readStockPositions(db, accountId);
  const accounts = (await fetchAllRows<FinanceAccount>((from, to) => {
    let q = db.from("finance_accounts").select("*");
    if (accountId) q = q.eq("id", accountId);
    return q.order("created_at").order("id").range(from, to);
  })).filter((a) => a.kind === "asset" && !a.archived_at);
  const byAccount = new Map(accounts.map((a) => [a.id, [] as StockPosition[]]));
  for (const p of positions) byAccount.get(p.account_id)?.push(p);
  const held = [...byAccount].filter(([, list]) => list.length > 0);
  const out: Revaluation = { recorded: [], priced: 0, failures: [], skipped: [], balances: [] };
  if (held.length === 0) return out;

  const symbols = [...new Set(held.flatMap(([, list]) => list.map((p) => p.symbol)))];
  const fetched = quotes === false ? new Map() : quotes instanceof Map ? quotes : await quotesFor(symbols);
  const currencies = [...new Set([...held.flatMap(([id, list]) => [accounts.find((a) => a.id === id)!.currency, ...list.map((p) => p.currency)])])];
  // Throws rather than guess, as recording a balance by hand does.
  const rates = await ratesOn(today, currencies.filter(isFinanceCurrency));

  const repriced: StockPosition[] = [];
  const rows: Record<string, unknown>[] = [];
  for (const [id, list] of held) {
    const account = accounts.find((a) => a.id === id)!;
    const valued = list.map((p) => {
      const q = fetched.get(p.symbol);
      if (!q) return p;
      if ("error" in q) {
        out.failures.push({ symbol: p.symbol, reason: q.error });
        return p;
      }
      if (q.currency !== p.currency) {
        out.failures.push({ symbol: p.symbol, reason: `quoted in ${q.currency}, held in ${p.currency}` });
        return p;
      }
      const unit = rates.rates[q.currency], home = rates.rates[account.currency];
      if (!unit || !home) {
        out.failures.push({ symbol: p.symbol, reason: `no exchange rate for ${q.currency}` });
        return p;
      }
      const next = { ...p, price: q.price, fx: unit.cny / home.cny, priced_at: now.toISOString(), name: p.name ?? q.name };
      repriced.push(next);
      return next;
    });
    const never = valued.filter((p) => p.price == null || p.fx == null).map((p) => p.symbol);
    if (never.length) {
      out.skipped.push({ account_id: id, reason: `never priced: ${never.join(", ")}` });
      continue;
    }
    const worth = holdingsOf(valued, minGainOf(account));
    rows.push({
      account_id: id,
      as_of: today,
      currency: account.currency,
      amount: cents(worth.value),
      cny_rate: rates.rates[account.currency].cny,
      sgd_rate: rates.rates[account.currency].sgd,
      rate_date: rates.date,
      liquid_share: Math.round(worth.liquidity * 1e6) / 1e6,
      note: `Valued from ${valued.length} position${valued.length === 1 ? "" : "s"}`,
    });
  }

  if (repriced.length) {
    const { error } = await db.from("finance_stock_positions").upsert(repriced, { onConflict: "id" });
    if (error) throw error;
    out.priced = repriced.length;
  }
  if (rows.length) {
    const { data, error } = await db.from("finance_balances").upsert(rows, { onConflict: "account_id,as_of" }).select();
    if (error) throw error;
    out.balances = (data ?? []) as FinanceBalance[];
    out.recorded = rows.map((r) => r.account_id as string);
  }
  return out;
}
