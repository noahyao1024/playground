import type { MarketData, ScenarioInputs } from "@/lib/housing";
import type { Project } from "@/lib/housing-projects";

export type Scenario = { id: string; name: string; inputs: ScenarioInputs; created_at: string; updated_at: string };
export type HousingData = {
  market: MarketData;
  scenarios: Scenario[];
  /** The developments followed, with what URA recorded of them. */
  projects: Project[];
  /** Whether URA's key is set on the site. */
  ura: boolean;
};
/** What following a development read of URA, in counts and a state. */
export type ProjectsRefresh = {
  state: "read" | "not due" | "no key" | "none followed" | "unavailable";
  followed: number;
  read: number;
  sales: number;
  rents: number;
  failures: Array<{ source: string; reason: string }>;
};
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
