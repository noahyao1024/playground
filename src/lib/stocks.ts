/** Stocks held in a brokerage account: so many shares of each symbol at an
 *  average cost, valued at the last price fetched for it.
 *
 *  A position far enough up counts as liquid -- worth selling now -- and one
 *  that is not, or is down, does not: selling it would lock in the loss, or
 *  give up waiting for the gain. How far is the account's `liquid_min_gain`,
 *  in percent. */

/** How far up a position has to be, in percent, to count as liquid, where the
 *  account does not say. */
export const LIQUID_MIN_GAIN = 10;

export interface StockPosition {
  id: string;
  account_id: string;
  /** As the quote source spells it: AAPL, 0700.HK, 600519.SS, D05.SI. */
  symbol: string;
  name: string | null;
  quantity: number;
  /** The average cost of a share, in `currency`. */
  cost: number;
  /** What it trades in, as its quote gives it. */
  currency: string;
  /** The last price it was valued at, in `currency`; null until it has been. */
  price: number | null;
  /** One unit of `currency` in the account's currency, when it was priced. */
  fx: number | null;
  priced_at: string | null;
  note: string | null;
  created_at: string;
}

/** The account's threshold, in percent. PostgREST may hand a numeric over as a string. */
export function minGainOf(a: { liquid_min_gain?: number | string | null }): number {
  const n = a.liquid_min_gain == null ? Number.NaN : Number(a.liquid_min_gain);
  return Number.isFinite(n) ? n : LIQUID_MIN_GAIN;
}

// ─── Symbols ────────────────────────────────────────────────────────

const SYMBOL = /^[A-Z0-9^][A-Z0-9.=-]{0,19}$/;

/** A Hong Kong code as the quote source has it: at least four digits, 0700.HK. */
const hongKong = (code: string) => `${code.replace(/^0+(?=\d{4})/, "")}.HK`;

/** A six-digit A-share code on its exchange: Shanghai's start 5, 6 or 9;
 *  Shenzhen's 0, 1, 2 or 3. Beijing's are not quoted. */
const aShare = (code: string) => (/^[569]/.test(code) ? `${code}.SS` : /^[0-3]/.test(code) ? `${code}.SZ` : code);

/** A symbol as the quote source spells it, from the ways brokers write one:
 *  Futu's US.AAPL, HK.00700, SH.600519, SZ.000001 and SG.D05; a bare six-digit
 *  A-share code, 600519; a five-digit Hong Kong code, 00700. Anything else is
 *  taken as written -- AAPL, 0700.HK, D05.SI, 7203.T. Null when it cannot be a
 *  symbol at all. */
export function normalizeSymbol(raw: string): string | null {
  let s = raw.trim().toUpperCase();
  const futu = /^(US|HK|SH|SZ|SG)\.(.+)$/.exec(s);
  if (futu) {
    const [, market, code] = futu;
    s = market === "US" ? code : market === "HK" ? hongKong(code) : market === "SG" ? `${code}.SI` : `${code}.${market === "SH" ? "SS" : "SZ"}`;
  } else if (/^\d{6}$/.test(s)) {
    s = aShare(s);
  } else if (/^0\d{4}$/.test(s)) {
    s = hongKong(s);
  }
  return SYMBOL.test(s) ? s : null;
}

// ─── Reading what is pasted ─────────────────────────────────────────

/** A position as given, before it is priced. */
export type PositionInput = { symbol: string; quantity: number; cost: number; currency?: string };

/** A line of column headings, in English or Chinese. */
const HEADINGS = /\b(symbol|ticker|code|quantity|qty|shares|cost|price)\b|代码|股票|名称|数量|持仓|成本|均价|现价/i;

const number = (token: string) => {
  const cleaned = token.replace(/[,$¥£€]/g, "");
  return /^-?\d+(\.\d+)?$/.test(cleaned) ? Number(cleaned) : Number.NaN;
};

/** Positions as pasted, a line each: the symbol, the shares and the average
 *  cost -- and the currency, if given -- apart by spaces, tabs or commas, the
 *  way a broker's export lists them. A first line of headings is skipped, as
 *  are blank lines. Or what is wrong with them. */
export function positionsFromText(text: string): { positions: PositionInput[] } | { problem: string } {
  const positions: PositionInput[] = [];
  const lines = text.split(/\r?\n/);
  for (const [i, raw] of lines.entries()) {
    const line = raw.trim();
    if (!line || line.startsWith("#")) continue;
    let fields = line.split(/\s+/);
    // No spaces to go by: commas, as in a CSV.
    if (fields.length < 3) fields = line.split(/\s*[,;]\s*/);
    fields = fields.filter(Boolean);
    // Headings, above the first position: Symbol Quantity Cost, 代码 数量 成本.
    if (positions.length === 0 && HEADINGS.test(line)) continue;
    const [rawSymbol, rawQuantity, rawCost, rawCurrency] = fields;
    const symbol = rawSymbol ? normalizeSymbol(rawSymbol) : null;
    const quantity = rawQuantity ? number(rawQuantity) : Number.NaN;
    const cost = rawCost ? number(rawCost) : Number.NaN;
    if (!symbol || !(quantity > 0) || !(cost >= 0) || fields.length > 4 || (rawCurrency && !/^[A-Za-z]{3}$/.test(rawCurrency))) {
      return { problem: `Line ${i + 1}: write the symbol, the shares and the average cost, as AAPL 100 150.25` };
    }
    if (positions.some((p) => p.symbol === symbol)) return { problem: `Line ${i + 1}: ${symbol} is already listed` };
    positions.push({ symbol, quantity, cost, ...(rawCurrency ? { currency: rawCurrency.toUpperCase() } : {}) });
  }
  if (positions.length === 0) return { problem: "Nothing to import: a line each, as AAPL 100 150.25" };
  if (positions.length > 500) return { problem: "Up to 500 positions at a time" };
  return { positions };
}

// ─── Worked out ─────────────────────────────────────────────────────

/** One position, worked out. Values are in the account's currency. */
export type Holding = {
  position: StockPosition;
  /** quantity × price × fx; null until priced. */
  value: number | null;
  /** quantity × cost × fx: what it cost, at the rate it was last priced at. */
  cost_value: number | null;
  /** How far the price is from the cost, as a share of the cost, in the
   *  currency it trades in; null until priced, or at no cost. */
  gain: number | null;
  /** Up more than the account's threshold -- or held at no cost. */
  liquid: boolean;
};

export type Holdings = {
  holdings: Holding[];
  /** Of the positions priced, in the account's currency. */
  value: number;
  cost: number;
  /** value against cost; null at no cost. */
  gain: number | null;
  liquid_value: number;
  /** liquid_value as a share of value; 0 with nothing priced. */
  liquidity: number;
  /** Symbols never priced, left out of the sums. */
  unpriced: string[];
};

const num = (v: number | string | null | undefined) => (v == null ? null : Number(v));

/** Positions valued and split into liquid and not, largest first. */
export function holdingsOf(positions: StockPosition[], minGain: number = LIQUID_MIN_GAIN): Holdings {
  let value = 0, cost = 0, liquidValue = 0;
  const unpriced: string[] = [];
  const holdings = positions.map((position): Holding => {
    const quantity = Number(position.quantity), unitCost = Number(position.cost);
    const price = num(position.price), fx = num(position.fx);
    if (price === null || fx === null || !(price > 0) || !(fx > 0)) {
      unpriced.push(position.symbol);
      return { position, value: null, cost_value: null, gain: null, liquid: false };
    }
    const v = quantity * price * fx, c = quantity * unitCost * fx;
    const gain = unitCost > 0 ? price / unitCost - 1 : null;
    // More than the threshold: up exactly 10% is not more than 10, though
    // 110 / 100 - 1 comes out a hair over 0.1 in floating point.
    const liquid = gain === null ? true : gain * 100 > minGain + 1e-9;
    value += v;
    cost += c;
    if (liquid) liquidValue += v;
    return { position, value: v, cost_value: c, gain, liquid };
  });
  holdings.sort((a, b) => (b.value ?? -1) - (a.value ?? -1) || a.position.symbol.localeCompare(b.position.symbol));
  return {
    holdings,
    value,
    cost,
    gain: cost > 0 ? value / cost - 1 : null,
    liquid_value: liquidValue,
    liquidity: value > 0 ? liquidValue / value : 0,
    unpriced,
  };
}
