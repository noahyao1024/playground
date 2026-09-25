import { NextRequest } from "next/server";
import { summarize } from "@/lib/finance";
import { financeDatabase, financeJson as json, isFinanceRequest, readFinance, reason } from "@/lib/finance-server";

/** Where things stand, worked out: the latest recorded day's totals, the change
 *  since the record before, every account's newest balance and the history.
 *  The same arithmetic as the page, for an agent to read instead of redoing.
 *
 *  The page's filters are query parameters: `exclude_long_term=1` leaves out
 *  long-term debt, `liquid_only=1` counts only each asset's liquid share, and
 *  `owner=Daisy` keeps one person's accounts (`owner=` alone: nobody's in
 *  particular). */
export const dynamic = "force-dynamic";

const flag = (value: string | null) => value === "1" || value === "true";

export async function GET(req: NextRequest) {
  if (!(await isFinanceRequest(req))) return json({ error: "Unauthorized" }, 401);
  const db = financeDatabase();
  if (!db) return json({ error: "Supabase not configured" }, 500);
  try {
    const { accounts, balances } = await readFinance(db);
    const q = new URL(req.url).searchParams;
    return json(summarize(accounts, balances, {
      excludeLongTerm: flag(q.get("exclude_long_term")),
      liquidOnly: flag(q.get("liquid_only")),
      owner: q.get("owner"),
    }));
  } catch (err) {
    return json({ error: reason(err) }, 500);
  }
}
