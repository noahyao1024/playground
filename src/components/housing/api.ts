import type { MarketData, ScenarioInputs } from "@/lib/housing";

export type Scenario = { id: string; name: string; inputs: ScenarioInputs; created_at: string; updated_at: string };
export type HousingData = { market: MarketData; scenarios: Scenario[] };
export type Refresh = { checked: number; refreshed: number; points: number; failures: Array<{ dataset: string; reason: string }> };

/** The route's own message on failure. */
async function parse<T>(res: Response): Promise<T> {
  const body = await res.json().catch(() => null);
  if (!res.ok) throw new Error(body?.error ?? `Request failed (${res.status})`);
  return body as T;
}

export async function loadHousing(): Promise<HousingData> {
  return parse(await fetch("/api/housing", { cache: "no-store" }));
}

export async function housingAction<T = unknown>(action: string, payload: Record<string, unknown> = {}): Promise<T> {
  return parse(await fetch("/api/housing", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ action, ...payload }),
  }));
}

export function messageOf(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}
