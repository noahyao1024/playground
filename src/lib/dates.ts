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

/** Today in Singapore, as YYYY-MM-DD. */
export function todayInSG(): string {
  return new Intl.DateTimeFormat("en-CA", { timeZone: SG_TZ }).format(new Date());
}

/** The current month in Singapore, as YYYY-MM. */
export function monthInSG(): string {
  return todayInSG().slice(0, 7);
}
