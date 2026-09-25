/** Mid-market rates for valuing balances.
 *
 *  No markup, unlike the billing rates: a balance is worth what the market says,
 *  not what a card charges to convert it. Same source as billing -- ECB data via
 *  Frankfurter -- asked with CNY as the base, so every currency comes back as
 *  "units per one CNY" and both conversions fall out of one request. */
const FX = "https://api.frankfurter.dev/v1";

/** Currencies an account may be kept in. All published by the ECB, so each has a
 *  rate on any trading day. */
export const FINANCE_CURRENCIES = ["CNY", "SGD", "USD", "HKD", "JPY", "EUR", "GBP", "AUD", "MYR"] as const;
export type FinanceCurrency = (typeof FINANCE_CURRENCIES)[number];

export function isFinanceCurrency(value: unknown): value is FinanceCurrency {
  return typeof value === "string" && (FINANCE_CURRENCIES as readonly string[]).includes(value);
}

/** What one unit of a currency is worth in CNY and in SGD. */
export type UnitValue = { cny: number; sgd: number };

export type DayRates = {
  /** The trading day the rates were published for: `day`, or the last one before
   *  it when `day` fell on a weekend or holiday. */
  date: string;
  rates: Record<string, UnitValue>;
};

// Ten significant digits: far past anything a balance can show, short enough to
// read back from the database as it went in.
const tidy = (n: number) => Number(n.toPrecision(10));

/** CNY and SGD per one unit of each currency, as published for `day` (YYYY-MM-DD).
 *  Throws rather than guess: a balance priced from a made-up rate would be stored
 *  with it, and nothing would ever correct it. */
export async function ratesOn(day: string, currencies: readonly string[]): Promise<DayRates> {
  const wanted = [...new Set(currencies)];
  const symbols = [...new Set([...wanted, "SGD"])].filter((c) => c !== "CNY");
  const res = await fetch(`${FX}/${day}?base=CNY&symbols=${symbols.join(",")}`, { cache: "no-store" });
  if (!res.ok) throw new Error(`Exchange rates for ${day} are unavailable (${res.status})`);
  const body = (await res.json()) as { date?: string; rates?: Record<string, number> };
  const perCny: Record<string, number> = { CNY: 1, ...(body.rates ?? {}) };
  const sgdPerCny = perCny.SGD;
  if (!(sgdPerCny > 0)) throw new Error(`No SGD rate for ${day}`);
  const rates: Record<string, UnitValue> = {};
  for (const currency of wanted) {
    const unitsPerCny = perCny[currency];
    if (!(unitsPerCny > 0)) throw new Error(`No ${currency} rate for ${day}`);
    rates[currency] = { cny: tidy(1 / unitsPerCny), sgd: tidy(sgdPerCny / unitsPerCny) };
  }
  return { date: body.date ?? day, rates };
}
