import { NextRequest, NextResponse } from "next/server";
import { getServerSupabase } from "@/lib/billing";

// Singapore has no daylight saving, so its day always starts at 16:00 UTC the
// previous day. Reading "today" off the server's UTC clock would put the monthly
// billing run — 00:00 UTC on the 1st, which is 08:00 here — on the wrong date.
const TZ = "Asia/Singapore";
const OFFSET = "+08:00";

function dayRange(dateParam: string | null) {
  const date = dateParam ?? new Intl.DateTimeFormat("en-CA", { timeZone: TZ }).format(new Date());
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) return null;
  const start = new Date(`${date}T00:00:00${OFFSET}`);
  if (Number.isNaN(start.getTime())) return null;
  return { date, start, end: new Date(start.getTime() + 86_400_000) };
}

type Row = {
  monthly_cost: number; currency: string; total_cny: number; paid: boolean;
  period_start: string; created_at: string; label: string | null;
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

  const range = dayRange(req.nextUrl.searchParams.get("date"));
  if (!range) {
    return NextResponse.json({ error: "date must be YYYY-MM-DD" }, { status: 400 });
  }

  const supabase = getServerSupabase();
  if (!supabase) {
    return NextResponse.json({ error: "Supabase not configured" }, { status: 500 });
  }

  const { data, error } = await supabase
    .from("charges")
    .select("monthly_cost, currency, total_cny, paid, period_start, created_at, label, subscribers(name), services(name)")
    .gte("created_at", range.start.toISOString())
    .lt("created_at", range.end.toISOString())
    .order("created_at", { ascending: false });

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  const rows = (data ?? []) as unknown as Row[];
  const charges = rows.map((c) => ({
    person: c.subscribers?.name ?? null,
    // A one-off charge has no service and carries its own label instead.
    item: c.services?.name ?? c.label ?? null,
    amount: Number(c.monthly_cost),
    currency: c.currency,
    total_cny: Number(c.total_cny),
    paid: c.paid,
    period: c.period_start,
    recorded_at: c.created_at,
  }));

  return NextResponse.json({
    date: range.date,
    timezone: TZ,
    charged: charges.length > 0,
    count: charges.length,
    total_cny: Number(charges.reduce((sum, c) => sum + c.total_cny, 0).toFixed(2)),
    unpaid_cny: Number(charges.filter((c) => !c.paid).reduce((sum, c) => sum + c.total_cny, 0).toFixed(2)),
    charges,
  });
}
