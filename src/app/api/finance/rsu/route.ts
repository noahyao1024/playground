import { NextRequest } from "next/server";
import { isRealDay, todayInSG } from "@/lib/dates";
import { rsuTermsOf } from "@/lib/finance";
import { financeDatabase, financeJson as json, isFinanceRequest, isUuid, readAccount, reason } from "@/lib/finance-server";
import { nextWindow, rsuOutlook, rsuPosition, rsuProceeds, rsuWindow, windowCutoffs } from "@/lib/rsu";

/** One RSU account worked out for a window: which tranches count and at what
 *  rate, what the window may buy, and -- given the price, and a tax rate if
 *  known -- what that comes to. A proposed grant is left out, as the employer's
 *  own estimate leaves it out, and what it would add is given beside. */
export const dynamic = "force-dynamic";

/** How many windows the outlook runs to. */
const OUTLOOK = 8;

export async function GET(req: NextRequest) {
  if (!(await isFinanceRequest(req))) return json({ error: "Unauthorized" }, 401);
  const params = req.nextUrl.searchParams;
  const id = params.get("id");
  if (!isUuid(id)) return json({ error: "id is required: the RSU account's" }, 400);

  const price = params.has("price") ? Number(params.get("price")) : null;
  if (price !== null && !(price > 0)) return json({ error: "price must be the price per share, above 0" }, 400);
  const taxRate = params.has("tax_rate") ? Number(params.get("tax_rate")) : null;
  if (taxRate !== null && !(taxRate >= 0 && taxRate < 1)) return json({ error: "tax_rate must be a share, 0 to under 1: 0.22 for 22%" }, 400);

  const db = financeDatabase();
  if (!db) return json({ error: "Supabase not configured" }, 500);
  try {
    const account = await readAccount(db, id);
    const terms = account ? rsuTermsOf(account) : null;
    if (!account || !terms) return json({ error: "No such account, or it holds no RSUs" }, 404);

    const today = todayInSG();
    const cutoff = params.get("window") ?? nextWindow(terms.rules, today);
    if (!isRealDay(cutoff) || windowCutoffs(terms.rules, cutoff, cutoff).length === 0) {
      return json({ error: "window must be a window's cutoff, YYYY-MM-DD" }, 400);
    }
    const window = rsuWindow(terms, cutoff);
    const proposed = terms.grants.some((g) => !g.signed);
    const withProposed = proposed ? rsuWindow(terms, cutoff, { includeProposed: true }) : null;
    return json({
      account_id: account.id,
      plan: terms.plan,
      currency: terms.rules.currency,
      position: rsuPosition(terms, today),
      window,
      with_proposed: withProposed && {
        vested: withProposed.vested, cumulative: withProposed.cumulative, quota: withProposed.quota, remaining: withProposed.remaining,
      },
      proceeds: price === null ? null : { price, tax_rate: taxRate, ...rsuProceeds(window.remaining, price, taxRate) },
      outlook: rsuOutlook(terms, today, OUTLOOK),
      outlook_with_proposed: proposed ? rsuOutlook(terms, today, OUTLOOK, { includeProposed: true }) : null,
    });
  } catch (err) {
    return json({ error: reason(err) }, 500);
  }
}
