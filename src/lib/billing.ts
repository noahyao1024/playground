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

/** Fetch live exchange rates from our API, with fallback defaults */
export async function fetchExchangeRates(baseUrl?: string): Promise<Record<string, number>> {
  const defaults: Record<string, number> = { USD: 7.25, SGD: 5.39 };
  try {
    const url = baseUrl ? `${baseUrl}/api/exchange-rate` : "/api/exchange-rate";
    const res = await fetch(url, { next: { revalidate: 600 } });
    if (!res.ok) return defaults;
    const data = await res.json();
    return { ...defaults, ...data };
  } catch {
    return defaults;
  }
}

export async function generateChargesForMonth(
  supabase: SupabaseClient,
  month: string,
  exchangeRates: Record<string, number> = { USD: 7.25, SGD: 5.39 }
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

      const rate = exchangeRates[service.currency] ?? exchangeRates.USD ?? 7.25;
      const totalCny = Number((monthlyCost * rate).toFixed(2));
      const note = "Auto-generated";

      newCharges.push({
        subscriber_id: sub.subscriber_id,
        service_id: sub.service_id,
        period_start: m,
        period_end: m,
        months: 1,
        monthly_cost: monthlyCost,
        currency: service.currency,
        exchange_rate: rate,
        total_cny: totalCny,
        paid: false,
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
