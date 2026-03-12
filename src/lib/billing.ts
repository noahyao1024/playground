import { createClient, SupabaseClient } from "@supabase/supabase-js";

export function getServerSupabase(): SupabaseClient | null {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  if (!url || !key) return null;
  return createClient(url, key);
}

/** Days in a given month (YYYY-MM) */
function daysInMonth(month: string): number {
  const [y, m] = month.split("-").map(Number);
  return new Date(y, m, 0).getDate();
}

/** Prorate ratio: 1 if start <= month start, 0 if start > month end, else fraction */
function prorateRatio(startDate: string, billingMonth: string): number {
  const monthStart = `${billingMonth}-01`;
  const totalDays = daysInMonth(billingMonth);
  const monthEnd = `${billingMonth}-${String(totalDays).padStart(2, "0")}`;
  if (startDate <= monthStart) return 1;
  if (startDate > monthEnd) return 0;
  const startDay = parseInt(startDate.split("-")[2], 10);
  return (totalDays - startDay + 1) / totalDays;
}

export async function generateChargesForMonth(
  supabase: SupabaseClient,
  month: string,
  exchangeRate: number = 7.25
): Promise<{ generated: number; details: Array<{ subscriber: string; service: string; total_cny: number }> }> {
  const [
    { data: subscriptions },
    { data: existingCharges },
    { data: services },
    { data: subscribers },
  ] = await Promise.all([
    supabase.from("subscriptions").select("*").eq("active", true),
    supabase.from("charges").select("subscriber_id, service_id").eq("period_start", month),
    supabase.from("services").select("*"),
    supabase.from("subscribers").select("*"),
  ]);

  if (!subscriptions || !services || !subscribers) {
    throw new Error("Failed to fetch data");
  }

  const billed = new Set(
    (existingCharges ?? []).map((c: { subscriber_id: string; service_id: string }) => `${c.subscriber_id}::${c.service_id}`)
  );

  const newCharges: Array<Record<string, unknown>> = [];
  const details: Array<{ subscriber: string; service: string; total_cny: number }> = [];

  for (const sub of subscriptions) {
    const key = `${sub.subscriber_id}::${sub.service_id}`;
    if (billed.has(key)) continue;

    const startDate = sub.start_date ?? sub.created_at?.slice(0, 10) ?? `${month}-01`;
    const ratio = prorateRatio(startDate, month);
    if (ratio === 0) continue;

    const service = services.find((s: { id: string }) => s.id === sub.service_id);
    if (!service) continue;

    const monthlyCost = Number(service.monthly_cost);
    const totalCny = Number((monthlyCost * ratio * exchangeRate).toFixed(2));
    const note = ratio < 1 ? `Prorated (${Math.round(ratio * 100)}%)` : "Auto-generated";

    newCharges.push({
      subscriber_id: sub.subscriber_id,
      service_id: sub.service_id,
      period_start: month,
      period_end: month,
      months: ratio < 1 ? Number(ratio.toFixed(2)) : 1,
      monthly_cost: monthlyCost,
      currency: service.currency,
      exchange_rate: exchangeRate,
      total_cny: totalCny,
      paid: false,
      note,
    });

    const subscriberName = subscribers.find((s: { id: string }) => s.id === sub.subscriber_id)?.name ?? "Unknown";
    details.push({ subscriber: subscriberName, service: service.name, total_cny: totalCny });
  }

  if (newCharges.length > 0) {
    const { error } = await supabase.from("charges").insert(newCharges);
    if (error) throw error;
  }

  return { generated: newCharges.length, details };
}
