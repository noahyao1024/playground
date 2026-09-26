import { NextRequest } from "next/server";
import { loanSchedule, loanTermsOf } from "@/lib/finance";
import { financeDatabase, financeJson as json, isFinanceRequest, isUuid, readAccount, reason } from "@/lib/finance-server";

/** A loan's every repayment, to the cent, with the totals: the lines of the
 *  bank's repayment plan (还款计划), to set beside it one by one. `id` is the
 *  loan's account. The summary's loan figures are read off the same schedule. */
export const dynamic = "force-dynamic";

export async function GET(req: NextRequest) {
  if (!(await isFinanceRequest(req))) return json({ error: "Unauthorized" }, 401);
  const id = req.nextUrl.searchParams.get("id");
  if (!isUuid(id)) return json({ error: "Which loan? Give its account's id as ?id=" }, 400);
  const db = financeDatabase();
  if (!db) return json({ error: "Supabase not configured" }, 500);
  try {
    const account = await readAccount(db, id);
    if (!account) return json({ error: "No such account" }, 404);
    const terms = loanTermsOf(account);
    if (!terms) return json({ error: "That account has no loan terms" }, 404);
    return json({ account_id: account.id, currency: account.currency, method: terms.method, ...loanSchedule(terms) });
  } catch (err) {
    return json({ error: reason(err) }, 500);
  }
}
