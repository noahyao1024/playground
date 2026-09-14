import { createClient, SupabaseClient } from "@supabase/supabase-js";

export function getServerSupabase(): SupabaseClient | null {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  if (!url || !key) return null;
  return createClient(url, key);
}

/** Check if a subscription should be billed for a given month.
 *  Returns true if the start date falls within or before the billing month. */
function shouldBillMonth(startDate: string, billingMonth: string): boolean {
  const startMonth = startDate.slice(0, 7);
  return startMonth <= billingMonth;
}

/** Generate list of YYYY-MM strings from startMonth to endMonth inclusive */
function monthRange(startMonth: string, endMonth: string): string[] {
  const months: string[] = [];
  const [sy, sm] = startMonth.split("-").map(Number);
  const [ey, em] = endMonth.split("-").map(Number);
  let y = sy, m = sm;
  while (y < ey || (y === ey && m <= em)) {
    months.push(`${y}-${String(m).padStart(2, "0")}`);
    m++;
    if (m > 12) { m = 1; y++; }
  }
  return months;
}

/** Settlement rates — mid-market with the FX markup already applied.
 *
 *  Pass the billing month to price it at the rate that held then. Billing March
 *  in September at September's rate is how the first half of this year was
 *  under-collected by up to 3.8%: one rate stayed pinned across five months while
 *  the real one fell 3.5%.
 *
 *  The endpoint owns the markup and its own fallbacks; these constants only cover
 *  it being unreachable entirely. */
export async function fetchExchangeRates(baseUrl?: string, month?: string): Promise<Record<string, number>> {
  const defaults: Record<string, number> = { USD: 6.79, SGD: 5.35 };
  try {
    const base = baseUrl ? `${baseUrl}/api/exchange-rate` : "/api/exchange-rate";
    // The 1st of the billing month; the source resolves a non-trading day back to
    // the last one before it.
    const url = month ? `${base}?date=${month}-01` : base;
    const res = await fetch(url, { next: { revalidate: 600 } });
    if (!res.ok) return defaults;
    const data = await res.json();
    return Object.keys(data?.rates ?? {}).length > 0 ? { ...defaults, ...data.rates } : defaults;
  } catch {
    return defaults;
  }
}

/** Rates for one billing month. A catch-up run spans several months, and each has
 *  to be priced at its own — one shared rate is how February through June all went
 *  out at 5.2744 while the market moved 3.5% underneath them. Memoised, so a run
 *  fetches each month once however many subscriptions it touches. */
export function monthlyRates(baseUrl?: string, override?: Record<string, number>) {
  const seen = new Map<string, Record<string, number>>();
  return async (month: string): Promise<Record<string, number>> => {
    if (override) return override;
    const hit = seen.get(month);
    if (hit) return hit;
    const fetched = await fetchExchangeRates(baseUrl, month);
    seen.set(month, fetched);
    return fetched;
  };
}

export async function generateChargesForMonth(
  supabase: SupabaseClient,
  month: string,
  ratesFor: (month: string) => Promise<Record<string, number>>
): Promise<{ generated: number; details: Array<{ subscriber: string; service: string; total_cny: number }> }> {
  const [
    { data: subscriptions },
    { data: allExistingCharges },
    { data: services },
    { data: subscribers },
  ] = await Promise.all([
    supabase.from("subscriptions").select("*").eq("active", true),
    supabase.from("charges").select("subscriber_id, service_id, period_start"),
    supabase.from("services").select("*"),
    supabase.from("subscribers").select("*"),
  ]);

  if (!subscriptions || !services || !subscribers) {
    throw new Error("Failed to fetch data");
  }

  // Build a set of "subscriber::service::month" keys for all existing charges
  const billed = new Set(
    (allExistingCharges ?? []).map((c: { subscriber_id: string; service_id: string; period_start: string }) =>
      `${c.subscriber_id}::${c.service_id}::${c.period_start}`
    )
  );

  const newCharges: Array<Record<string, unknown>> = [];
  const details: Array<{ subscriber: string; service: string; total_cny: number }> = [];

  for (const sub of subscriptions) {
    const startDate = sub.start_date ?? sub.created_at?.slice(0, 10) ?? `${month}-01`;
    const startMonth = startDate.slice(0, 7); // YYYY-MM
    const service = services.find((s: { id: string }) => s.id === sub.service_id);
    if (!service) continue;

    const monthlyCost = Number(service.monthly_cost);
    const subscriberName = subscribers.find((s: { id: string }) => s.id === sub.subscriber_id)?.name ?? "Unknown";

    // Generate charges for every month from subscription start to the target month
    for (const m of monthRange(startMonth, month)) {
      const key = `${sub.subscriber_id}::${sub.service_id}::${m}`;
      if (billed.has(key)) continue;

      if (!shouldBillMonth(startDate, m)) continue;

      const monthRates = await ratesFor(m);
      const rate = monthRates[service.currency] ?? monthRates.USD ?? 6.79;
      const totalCny = Number((monthlyCost * rate).toFixed(2));
      const note = "Auto-generated";

      // Store the day rather than leaving it to be re-derived: the subscription it
      // would be derived from may be deleted later, and its charges outlive it.
      const [by, bm] = m.split("-").map(Number);
      const startDay = Number(startDate.slice(8, 10)) || 1;
      const lastDay = new Date(by, bm, 0).getDate();
      const billingDay = `${m}-${String(Math.min(startDay, lastDay)).padStart(2, "0")}`;

      newCharges.push({
        subscriber_id: sub.subscriber_id,
        service_id: sub.service_id,
        period_start: m,
        billing_date: billingDay,
        period_end: m,
        months: 1,
        monthly_cost: monthlyCost,
        currency: service.currency,
        exchange_rate: rate,
        total_cny: totalCny,
        paid: false,
        origin: "auto",
        note,
      });

      details.push({ subscriber: subscriberName, service: service.name, total_cny: totalCny });
    }
  }

  if (newCharges.length > 0) {
    const { error } = await supabase.from("charges").insert(newCharges);
    if (error) throw error;
  }

  return { generated: newCharges.length, details };
}
