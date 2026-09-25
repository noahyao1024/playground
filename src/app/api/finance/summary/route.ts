import { NextRequest } from "next/server";
import { summarize } from "@/lib/finance";
import { financeDatabase, financeJson as json, isFinanceRequest, readFinance, reason } from "@/lib/finance-server";

/** Where things stand, worked out: the latest recorded day's totals, the change
 *  since the record before, every account's newest balance and the history.
 *  The same arithmetic as the page, for an agent to read instead of redoing. */
export const dynamic = "force-dynamic";

export async function GET(req: NextRequest) {
  if (!(await isFinanceRequest(req))) return json({ error: "Unauthorized" }, 401);
  const db = financeDatabase();
  if (!db) return json({ error: "Supabase not configured" }, 500);
  try {
    const { accounts, balances } = await readFinance(db);
    return json(summarize(accounts, balances));
  } catch (err) {
    return json({ error: reason(err) }, 500);
  }
}
