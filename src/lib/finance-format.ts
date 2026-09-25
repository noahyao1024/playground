import type { Unit } from "./finance";

/** How /finance writes numbers. A true minus sign throughout: a hyphen is
 *  narrower than a plus and makes a column of changes look ragged. */
const MINUS = "−";
export const UNIT_SYMBOL: Record<Unit, string> = { cny: "¥", sgd: "S$" };
export const UNIT_CODE: Record<Unit, string> = { cny: "CNY", sgd: "SGD" };

function signed(n: number, body: string, sign: boolean): string {
  // Whatever rounds to zero is shown unsigned: "-¥0" is noise.
  if (/^[^1-9]*$/.test(body)) return body;
  if (n < 0) return MINUS + body;
  return sign ? `+${body}` : body;
}

/** ¥1,234,567 / S$1,234,567: whole units unless asked, the way a total is read. */
export function money(n: number, unit: Unit, { sign = false, decimals = 0 } = {}): string {
  const body = Math.abs(n).toLocaleString("en-US", { minimumFractionDigits: decimals, maximumFractionDigits: decimals });
  return signed(n, UNIT_SYMBOL[unit] + body, sign);
}

/** ¥1.2M / S$350K: tiles and axis ticks. */
export function compactMoney(n: number, unit: Unit, { sign = false, digits = 1 } = {}): string {
  const body = new Intl.NumberFormat("en-US", { notation: "compact", maximumFractionDigits: digits }).format(Math.abs(n));
  return signed(n, UNIT_SYMBOL[unit] + body, sign);
}

const minorDigits = new Map<string, number>();
function digitsOf(currency: string): number {
  let digits = minorDigits.get(currency);
  if (digits === undefined) {
    digits = new Intl.NumberFormat("en-US", { style: "currency", currency }).resolvedOptions().maximumFractionDigits ?? 2;
    minorDigits.set(currency, digits);
  }
  return digits;
}

/** An amount as it is kept, in its own currency: "12,345.67 SGD", "80,000 JPY".
 *  `whole` drops the cents, for sums large enough that they are noise. */
export function original(amount: number, currency: string, { whole = false } = {}): string {
  const digits = whole ? 0 : digitsOf(currency);
  const body = Math.abs(amount).toLocaleString("en-US", { minimumFractionDigits: digits, maximumFractionDigits: digits });
  return `${signed(amount, body, false)} ${currency}`;
}

/** +3.2% / −1.5%. */
export function percent(ratio: number): string {
  const body = Math.abs(ratio).toLocaleString("en-US", { style: "percent", maximumFractionDigits: 1 });
  return signed(ratio, body, true);
}

/** What one unit of a currency was worth: 5 significant digits, enough for a yen. */
export function rate(n: number): string {
  return Number(n).toLocaleString("en-US", { maximumSignificantDigits: 5 });
}

/** A YYYY-MM-DD day as midnight UTC, the one reading of it that is the same everywhere. */
export function dayTime(day: string): number {
  const [y, m, d] = day.split("-").map(Number);
  return Date.UTC(y, m - 1, d);
}

// Spelled out rather than asked of Intl: en-GB's short September is "Sept" in
// some ICU versions and "Sep" in others, so the browser and the server disagree.
const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

function shortDay(t: number): string {
  const d = new Date(t);
  return `${d.getUTCDate()} ${MONTHS[d.getUTCMonth()]}`;
}

/** 30 Sep 2026, or 30 Sep without the year. */
export function dayLabel(day: string, { year = true } = {}): string {
  const t = dayTime(day);
  return year ? `${shortDay(t)} ${new Date(t).getUTCFullYear()}` : shortDay(t);
}

/** Sep ’26. */
function monthLabel(t: number): string {
  const d = new Date(t);
  return `${MONTHS[d.getUTCMonth()]} ’${String(d.getUTCFullYear()).slice(2)}`;
}

/** Where to put the time axis' ticks, and how to write them, for points on
 *  `days` (sorted YYYY-MM-DD). A few weeks of records are labelled by day, at
 *  the records themselves; anything longer by month, at month starts, thinned
 *  to at most `max`. Never a tick at an arbitrary millisecond. */
export function timeTicks(days: string[], max = 6): { ticks: number[]; format: (t: number) => string } {
  const first = dayTime(days[0]);
  const last = dayTime(days[days.length - 1]);
  const thin = <T,>(xs: T[]) => {
    const step = Math.ceil(xs.length / max);
    return xs.filter((_, i) => i % step === 0);
  };
  if (last - first <= 62 * 86_400_000) {
    return { ticks: thin(days.map(dayTime)), format: shortDay };
  }
  const months: number[] = [];
  const start = new Date(first);
  for (let y = start.getUTCFullYear(), m = start.getUTCMonth(); ; m++) {
    const t = Date.UTC(y, m, 1);
    if (t > last) break;
    if (t >= first) months.push(t);
  }
  return { ticks: thin(months), format: monthLabel };
}

/** A money axis: clean ticks (1, 2 or 5 times a power of ten) and the domain
 *  they span. With `zero` the axis reaches zero, as totals that are compared by
 *  size want; without, it fits the data with a margin, so a line that moves a
 *  few percent is seen to move -- but never crosses zero to do it. */
export function moneyAxis(values: number[], { zero = true, count = 5 } = {}): { domain: [number, number]; ticks: number[] } {
  let lo = Math.min(...values);
  let hi = Math.max(...values);
  if (zero) {
    lo = Math.min(lo, 0);
    hi = Math.max(hi, 0);
  } else {
    const pad = (hi - lo) * 0.1 || Math.abs(hi) * 0.05 || 1;
    lo = lo >= 0 ? Math.max(0, lo - pad) : lo - pad;
    hi = hi <= 0 ? Math.min(0, hi + pad) : hi + pad;
  }
  if (lo === hi) hi = lo + 1;
  // Of the clean steps near an even split, the one whose tick count comes
  // closest to `count`; between two equally close, the one wasting less height.
  const power = 10 ** Math.floor(Math.log10((hi - lo) / (count - 1)));
  let best = { start: 0, step: 1, n: Infinity, span: Infinity };
  for (const m of [1, 2, 5, 10]) {
    const step = m * power;
    const start = Math.floor(lo / step) * step;
    const span = Math.ceil(hi / step) * step - start;
    const n = Math.round(span / step) + 1;
    const off = Math.abs(n - count), bestOff = Math.abs(best.n - count);
    if (off < bestOff || (off === bestOff && span < best.span)) best = { start, step, n, span };
  }
  const ticks = Array.from({ length: best.n }, (_, i) => Number((best.start + i * best.step).toPrecision(12)));
  return { domain: [ticks[0], ticks[ticks.length - 1]], ticks };
}
