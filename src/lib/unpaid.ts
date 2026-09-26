/** Who owes more than the threshold: what the daily alert reports. */

export type UnpaidCharge = { subscriber_id: string; total_cny: number | string; period_start: string };
export type Person = { id: string; name: string };
export type Owing = { name: string; owed: number; charges: number; oldest: string };

/** Unpaid charges added up per person, those over `threshold` kept, largest
 *  first. PostgREST may hand numerics over as strings; Number() takes either. */
export function overThreshold(charges: UnpaidCharge[], people: Person[], threshold: number): Owing[] {
  const names = new Map(people.map((p) => [p.id, p.name]));
  const byPerson = new Map<string, Owing>();
  for (const c of charges) {
    const o = byPerson.get(c.subscriber_id) ?? { name: names.get(c.subscriber_id) ?? c.subscriber_id, owed: 0, charges: 0, oldest: c.period_start };
    o.owed += Number(c.total_cny);
    o.charges += 1;
    if (c.period_start < o.oldest) o.oldest = c.period_start;
    byPerson.set(c.subscriber_id, o);
  }
  return [...byPerson.values()].filter((o) => o.owed > threshold).sort((a, b) => b.owed - a.owed);
}

const yuan = (n: number, digits: number) =>
  `¥${n.toLocaleString("en-US", { minimumFractionDigits: digits, maximumFractionDigits: digits })}`;

/** The alert as a mail: the same words the GitHub workflow sent. */
export function alertMail(over: Owing[], threshold: number, link: string): { subject: string; text: string } {
  const lines = [`${over.length} person(s) owe more than ${yuan(threshold, 0)}.`, ""];
  for (const o of over) lines.push(`  ${o.name}: ${yuan(o.owed, 2)} across ${o.charges} charge(s), oldest ${o.oldest}`);
  lines.push("", link);
  return { subject: `Split bill: ${over.length} over the unpaid threshold`, text: lines.join("\n") };
}
