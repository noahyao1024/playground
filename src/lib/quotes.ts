/** Stock prices, from Yahoo Finance's chart endpoint: free, keyless, and one
 *  spelling of a symbol across the US, Hong Kong, Shanghai, Shenzhen and
 *  Singapore markets. It is not an official API, so a failure is reported
 *  symbol by symbol and a position keeps the last price it was valued at.
 *
 *  Server-side only: the endpoint answers no browser from another site. */

export type Quote = {
  symbol: string;
  /** The last price, in `currency`: the market's now if open, else its close. */
  price: number;
  currency: string;
  name: string | null;
  /** When the market set the price. */
  time: string;
  /** The close of the trading day before. */
  previous_close: number | null;
  exchange: string | null;
};

/** Why a symbol has no quote: not found, which asking again will not change,
 *  or anything else, which it may. */
export class QuoteError extends Error {
  constructor(readonly symbol: string, message: string, readonly final = false) {
    super(message);
  }
}

const HOSTS = ["https://query1.finance.yahoo.com", "https://query2.finance.yahoo.com"];
// Yahoo answers a browser's full user agent, and none at all, with 429 Too
// Many Requests; this short one gets the chart.
const USER_AGENT = "Mozilla/5.0";
const TIMEOUT_MS = 6_000;
/** How many symbols are asked for at once: a few dozen priced in seconds. */
const AT_ONCE = 8;

/** A chart answer read as a quote. London quotes in pence (GBp) come back in
 *  pounds. */
export function parseChart(symbol: string, body: unknown): Quote {
  const meta = (body as { chart?: { result?: Array<{ meta?: Record<string, unknown> }> } })?.chart?.result?.[0]?.meta;
  let price = Number(meta?.regularMarketPrice);
  let currency = typeof meta?.currency === "string" ? meta.currency : "";
  let previous = Number(meta?.chartPreviousClose ?? meta?.previousClose);
  if (!(price > 0) || !currency) throw new QuoteError(symbol, "no price in the answer");
  if (currency === "GBp" || currency === "GBX") {
    price /= 100;
    previous /= 100;
    currency = "GBP";
  }
  const time = Number(meta?.regularMarketTime);
  const name = [meta?.longName, meta?.shortName].find((n): n is string => typeof n === "string" && n.trim() !== "");
  return {
    symbol,
    price,
    currency: currency.toUpperCase(),
    name: name?.trim().slice(0, 120) ?? null,
    time: new Date(Number.isFinite(time) && time > 0 ? time * 1000 : Date.now()).toISOString(),
    previous_close: previous > 0 ? previous : null,
    exchange: typeof meta?.exchangeName === "string" ? meta.exchangeName : null,
  };
}

/** One symbol's quote, from the first host that answers. */
export async function quoteOf(symbol: string, fetcher: typeof fetch = fetch): Promise<Quote> {
  let last = "no answer";
  for (const host of HOSTS) {
    try {
      const res = await fetcher(`${host}/v8/finance/chart/${encodeURIComponent(symbol)}?interval=1d&range=1d`, {
        headers: { "user-agent": USER_AGENT, accept: "application/json" },
        cache: "no-store",
        signal: AbortSignal.timeout(TIMEOUT_MS),
      });
      const body = await res.json().catch(() => null);
      const code = (body as { chart?: { error?: { code?: string } } } | null)?.chart?.error?.code;
      if (res.status === 404 || code === "Not Found") throw new QuoteError(symbol, "no such symbol", true);
      if (!res.ok) throw new QuoteError(symbol, `HTTP ${res.status}`);
      return parseChart(symbol, body);
    } catch (err) {
      if (err instanceof QuoteError && err.final) throw err;
      last = err instanceof Error ? err.message : String(err);
    }
  }
  throw new QuoteError(symbol, last);
}

/** Quotes for every symbol, a few at a time; each failure apart, as the reason. */
/** A symbol with no quote: why, and whether asking again could change it. */
export type NoQuote = { error: string; final: boolean };

export async function quotesFor(symbols: string[], fetcher: typeof fetch = fetch): Promise<Map<string, Quote | NoQuote>> {
  const unique = [...new Set(symbols)];
  const out = new Map<string, Quote | NoQuote>();
  for (let i = 0; i < unique.length; i += AT_ONCE) {
    const batch = unique.slice(i, i + AT_ONCE);
    const answers = await Promise.allSettled(batch.map((s) => quoteOf(s, fetcher)));
    answers.forEach((a, j) => out.set(batch[j], a.status === "fulfilled"
      ? a.value
      : { error: a.reason instanceof Error ? a.reason.message : String(a.reason), final: a.reason instanceof QuoteError && a.reason.final }));
  }
  return out;
}
