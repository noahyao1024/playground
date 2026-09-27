/** Everything in this app is billed and paid in Singapore, so dates are Singapore's.
 *
 *  Neither of the obvious shortcuts works here. `toISOString()` is UTC by
 *  definition, so between midnight and 08:00 local it reports yesterday. The
 *  `getMonth()` family reads whatever timezone the code happens to run in — the
 *  browser's for a user, UTC for a Vercel function — so the same call means two
 *  different things on the two sides of the app.
 *
 *  Intl takes the timezone explicitly, which makes these agree everywhere.
 */
export const SG_TZ = "Asia/Singapore";

const sgDay = new Intl.DateTimeFormat("en-CA", { timeZone: SG_TZ });

/** Today in Singapore, as YYYY-MM-DD. */
export function todayInSG(): string {
  return sgDay.format(new Date());
}

/** The day a moment fell on in Singapore, as YYYY-MM-DD. */
export function dayInSG(at: Date | string): string {
  return sgDay.format(new Date(at));
}

/** The current month in Singapore, as YYYY-MM. */
export function monthInSG(): string {
  return todayInSG().slice(0, 7);
}

/** Days in a month, `month` counted from 1. */
const daysIn = (year: number, month: number) => new Date(Date.UTC(year, month, 0)).getUTCDate();

/** `day` moved on by `months`, to the same day of the month -- or the month's
 *  last day when it is shorter: 31 January plus a month is 28 February. */
export function addMonths(day: string, months: number): string {
  const [y, m, d] = day.split("-").map(Number);
  const total = y * 12 + (m - 1) + months;
  const year = Math.floor(total / 12);
  const month = total - year * 12 + 1;
  const date = Math.min(d, daysIn(year, month));
  return `${year}-${String(month).padStart(2, "0")}-${String(date).padStart(2, "0")}`;
}

/** A real calendar day, YYYY-MM-DD: 2026-02-30 has the shape and is not one. */
export function isRealDay(day: unknown): day is string {
  return typeof day === "string" && /^\d{4}-\d{2}-\d{2}$/.test(day) && new Date(`${day}T00:00:00Z`).toISOString().startsWith(day);
}
