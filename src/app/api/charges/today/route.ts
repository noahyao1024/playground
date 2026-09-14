import { NextRequest, NextResponse } from "next/server";
import { getServerSupabase } from "@/lib/billing";
import { SG_TZ, todayInSG } from "@/lib/dates";


/** The day a charge nominally falls on: the subscription's start day projected onto
 *  the billing month, clamped where the month is too short. Charges store only the
 *  month, so a charge with no subscription behind it keeps the bare YYYY-MM. */
function billingDate(periodStart: string, startDate?: string | null): string {
  if (!startDate) return periodStart;
  const [y, m] = periodStart.split("-").map(Number);
  const day = Number(startDate.slice(8, 10));
  if (!y || !m || !day) return periodStart;
  const lastDay = new Date(y, m, 0).getDate();
  return `${periodStart}-${String(Math.min(day, lastDay)).padStart(2, "0")}`;
}

type SubRow = { subscriber_id: string; service_id: string | null; start_date: string | null; payment_method_id: string | null };
type CardRow = { id: string; label: string; card_type: string; last4: string };

type Row = {
  id: string; subscriber_id: string; service_id: string | null;
  monthly_cost: number; currency: string; total_cny: number; paid: boolean;
  paid_date: string | null; paid_at: string | null; updated_at: string | null;
  billing_date: string | null;
  period_start: string; created_at: string; label: string | null;
  payment_method_id: string | null;
  subscribers: { name: string } | null;
  services: { name: string } | null;
};

export async function GET(req: NextRequest) {
  // Open by default. Set READONLY_TOKEN in the environment to require
  // `Authorization: Bearer <token>` — no code change needed to lock this down.
  const token = process.env.READONLY_TOKEN;
  if (token && req.headers.get("authorization") !== `Bearer ${token}`) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const q = req.nextUrl.searchParams;
  const date = q.get("date");
  const amount = q.get("amount");
  // Default to the whole month, not to today. A debit reaching the card today was
  // almost certainly recorded when the billing run fired on the 1st, so a
  // same-day filter would answer "not recorded" for charges that plainly are.
  const month = q.get("month") ?? (date ?? todayInSG()).slice(0, 7);

  if (date && !/^\d{4}-\d{2}-\d{2}$/.test(date)) {
    return NextResponse.json({ error: "date must be YYYY-MM-DD" }, { status: 400 });
  }
  if (!/^\d{4}-\d{2}$/.test(month)) {
    return NextResponse.json({ error: "month must be YYYY-MM" }, { status: 400 });
  }

  const supabase = getServerSupabase();
  if (!supabase) {
    return NextResponse.json({ error: "Supabase not configured" }, { status: 500 });
  }

  const [{ data: rows, error }, { data: subs }, { data: cards }, { data: settlements }, { data: people }] = await Promise.all([
    supabase
      .from("charges")
      .select("id, subscriber_id, service_id, payment_method_id, monthly_cost, currency, total_cny, paid, paid_date, paid_at, updated_at, billing_date, period_start, created_at, label, subscribers(name), services(name)")
      .eq("period_start", month)
      .order("created_at", { ascending: false }),
    supabase.from("subscriptions").select("subscriber_id, service_id, start_date, payment_method_id"),
    supabase.from("payment_methods").select("id, label, card_type, last4"),
    supabase.from("wallet_entries").select("subscriber_id, charge_id, kind").eq("kind", "charge"),
    supabase.from("subscribers").select("id, name"),
  ]);

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  // Cards live on the subscription, not the charge — only one charge in seventy
  // carries its own. Fall back to whatever the subscription pays with, which is
  // what actually shows up on the statement.
  const subsByPair = new Map(
    (subs ?? []).map((s: SubRow) => [`${s.subscriber_id}::${s.service_id}`, s]),
  );
  const cardById = new Map((cards ?? []).map((c: CardRow) => [c.id, c]));
  // Who settled each charge — not always the person who owes it.
  const paidByCharge = new Map(
    (settlements ?? []).map((e: { subscriber_id: string; charge_id: string | null }) => [e.charge_id, e.subscriber_id]),
  );
  const nameById = new Map((people ?? []).map((p: { id: string; name: string }) => [p.id, p.name]));
  const describeCard = (id: string | null | undefined) => {
    const card = id ? cardById.get(id) : undefined;
    return card ? `${card.label || card.card_type} ****${card.last4}` : null;
  };

  let charges = ((rows ?? []) as unknown as Row[]).map((c) => {
    const sub = subsByPair.get(`${c.subscriber_id}::${c.service_id}`);
    return {
      person: c.subscribers?.name ?? null,
      // A one-off charge has no service and carries its own label instead.
      item: c.services?.name ?? c.label ?? null,
      amount: Number(c.monthly_cost),
      currency: c.currency,
      total_cny: Number(c.total_cny),
      // What to match a bank line against.
      card: describeCard(c.payment_method_id ?? sub?.payment_method_id),
      paid: c.paid,
      // The wallet the money came out of, when it was not the charge's own person.
      paid_by: (() => {
        const payer = paidByCharge.get(c.id);
        return payer && payer !== c.subscriber_id ? nameById.get(payer) ?? null : null;
      })(),
      paid_date: c.paid_date,
      // Stamped by the database when paid flipped, so it carries a time and does
      // not depend on whoever clicked.
      paid_at: c.paid_at,
      // Null means the row has not been edited since it was created.
      updated_at: c.updated_at,
      // Stored when the charge was written; derived only for older rows.
      billing_date: c.billing_date ?? billingDate(c.period_start, sub?.start_date),
      recorded_at: c.created_at,
    };
  });

  if (date) charges = charges.filter((c) => c.billing_date === date || c.recorded_at.slice(0, 10) === date);
  if (amount) {
    const want = Number(amount);
    if (Number.isNaN(want)) return NextResponse.json({ error: "amount must be a number" }, { status: 400 });
    charges = charges.filter((c) => Math.abs(c.amount - want) < 0.005);
  }

  return NextResponse.json({
    month,
    ...(date ? { date } : {}),
    ...(amount ? { amount: Number(amount) } : {}),
    timezone: SG_TZ,
    count: charges.length,
    total_cny: Number(charges.reduce((s, c) => s + c.total_cny, 0).toFixed(2)),
    charges,
  });
}
