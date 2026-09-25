import type { FinanceAccount, FinanceBalance } from "@/lib/finance";

export type FinanceData = { accounts: FinanceAccount[]; balances: FinanceBalance[] };

/** The route's own message on failure: it says what was wrong, and for a
 *  recording that could not be priced, that nothing was written. */
async function parse<T>(res: Response): Promise<T> {
  const body = await res.json().catch(() => null);
  if (!res.ok) throw new Error(body?.error ?? `Request failed (${res.status})`);
  return body as T;
}

export async function loadFinance(): Promise<FinanceData> {
  return parse(await fetch("/api/finance", { cache: "no-store" }));
}

export async function financeAction<T = unknown>(action: string, payload: Record<string, unknown>): Promise<T> {
  return parse(await fetch("/api/finance", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ action, ...payload }),
  }));
}

export function messageOf(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}
