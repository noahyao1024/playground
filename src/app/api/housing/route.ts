import { NextRequest } from "next/server";
import type { SupabaseClient } from "@supabase/supabase-js";
import { financeDatabase, financeJson as json, isFinanceRequest, isUuid, reason } from "@/lib/finance-server";
import { InputError, parseInputs, readInputs, type ScenarioInputs } from "@/lib/housing";
import { readMarket, refreshMarket } from "@/lib/housing-data";

/** /housing's data: Singapore's market figures and the owner's rent-or-buy
 *  scenarios. It answers whoever /api/finance answers -- the owner's session,
 *  or a token an agent carries -- and nobody else, and is never cached. */
export const dynamic = "force-dynamic";
// Refreshing reads whole datasets from data.gov.sg.
export const maxDuration = 60;

export type Scenario = { id: string; name: string; inputs: ScenarioInputs; created_at: string; updated_at: string };

class Invalid extends Error {}

type ScenarioRow = { id: string; name: string; inputs: unknown; created_at: string; updated_at: string };

/** A kept scenario as the page takes it: one kept under limits since narrowed
 *  opens with what still passes, the rest at their defaults, rather than not at all. */
function scenarioOf(row: ScenarioRow): Scenario {
  return { id: row.id, name: row.name, inputs: readInputs(row.inputs), created_at: row.created_at, updated_at: row.updated_at };
}

async function readScenarios(db: SupabaseClient): Promise<Scenario[]> {
  const { data, error } = await db.from("housing_scenarios").select("*").order("updated_at", { ascending: false }).order("id").limit(200);
  if (error) throw error;
  return ((data ?? []) as ScenarioRow[]).map(scenarioOf);
}

export async function GET(req: NextRequest) {
  if (!(await isFinanceRequest(req))) return json({ error: "Unauthorized" }, 401);
  const db = financeDatabase();
  if (!db) return json({ error: "Supabase not configured" }, 500);
  try {
    const [market, scenarios] = await Promise.all([readMarket(db), readScenarios(db)]);
    return json({ market, scenarios });
  } catch (err) {
    return json({ error: reason(err) }, 500);
  }
}

export async function POST(req: NextRequest) {
  if (!(await isFinanceRequest(req))) return json({ error: "Unauthorized" }, 401);
  const db = financeDatabase();
  if (!db) return json({ error: "Supabase not configured" }, 500);

  let body: Record<string, unknown>;
  try {
    body = await req.json();
  } catch {
    return json({ error: "Expected a JSON body" }, 400);
  }

  try {
    switch (body.action) {
      case "saveScenario": {
        const scenario = await saveScenario(db, body);
        return scenario ? json({ scenario }) : json({ error: "No such scenario" }, 404);
      }
      case "deleteScenario": {
        if (!isUuid(body.id)) throw new Invalid("id must be a scenario's id");
        const { data, error } = await db.from("housing_scenarios").delete().eq("id", body.id).select("id");
        if (error) throw error;
        if (!data?.length) return json({ error: "No such scenario" }, 404);
        return json({ ok: true });
      }
      case "refresh": {
        // The owner asking now, as the daily job does: only what has changed
        // is read again, unless `force`.
        const refresh = await refreshMarket(db, { force: body.force === true });
        return json({ refresh, market: await readMarket(db) });
      }
      default:
        return json({ error: "Unknown action" }, 400);
    }
  } catch (err) {
    if (err instanceof Invalid || err instanceof InputError) return json({ error: err.message }, 400);
    return json({ error: reason(err) }, 500);
  }
}

/** A scenario kept: a new one, or with an id, that one changed; null if there
 *  is no such one to change. */
async function saveScenario(db: SupabaseClient, body: Record<string, unknown>): Promise<Scenario | null> {
  if (typeof body.name !== "string" || !body.name.trim()) throw new Invalid("A scenario needs a name");
  const name = body.name.trim();
  if (name.length > 80) throw new Invalid("A name is at most 80 characters");
  const inputs = parseInputs(body.inputs);
  if (body.id === undefined || body.id === null) {
    const { data, error } = await db.from("housing_scenarios").insert({ name, inputs }).select().single();
    if (error) throw error;
    return scenarioOf(data as ScenarioRow);
  }
  if (!isUuid(body.id)) throw new Invalid("id must be a scenario's id");
  const { data, error } = await db.from("housing_scenarios")
    .update({ name, inputs, updated_at: new Date().toISOString() }).eq("id", body.id).select();
  if (error) throw error;
  return data?.length ? scenarioOf(data[0] as ScenarioRow) : null;
}
