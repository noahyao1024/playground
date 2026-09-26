import type { FinanceAccount, FinanceBalance } from "@/lib/finance";

export type FinanceData = { accounts: FinanceAccount[]; balances: FinanceBalance[] };

/** The route's own message on failure: it says what was wrong, and for a
 *  recording that could not be priced, that nothing was written. */
async function parse<T>(res: Response): Promise<T> {
  const body = await res.json().catch(() => null);
  if (!res.ok) throw new Error(body?.error ?? `Request failed (${res.status})`);
  return body as T;
}

/** Everything, as the route streams it. A failure after the first bytes can
 *  only cut the stream short, which surfaces here as JSON that does not parse:
 *  said as what it is rather than as a parser's complaint. */
export async function loadFinance(): Promise<FinanceData> {
  const res = await fetch("/api/finance", { cache: "no-store" });
  if (!res.ok) return parse(res);
  try {
    return (await res.json()) as FinanceData;
  } catch {
    throw new Error("The data stopped arriving part-way. Try again.");
  }
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

/** A token for the owner's own agents, as the page may see it: never the token
 *  itself, except in the answer that makes it. */
export type ApiToken = { id: string; name: string; created_at?: string };

export async function listTokens(): Promise<ApiToken[]> {
  return (await parse<{ tokens: ApiToken[] }>(await fetch("/api/finance/tokens", { cache: "no-store" }))).tokens;
}

export async function makeToken(name: string): Promise<ApiToken & { token: string }> {
  return parse(await fetch("/api/finance/tokens", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ name }),
  }));
}

export async function revokeToken(id: string): Promise<void> {
  await parse(await fetch(`/api/finance/tokens?id=${encodeURIComponent(id)}`, { method: "DELETE" }));
}
