import { NextRequest } from "next/server";
import { financeOpenApi } from "@/lib/finance-openapi";
import { financeJson as json, financeRequestScope } from "@/lib/finance-server";
import { agentOpenApi } from "@/lib/agent-openapi";

/** What finance and housing take and return, for an agent to read before calling,
 *  with the same token as every other call: to anyone else it would only say
 *  that the owner's accounts are here. Served for the host it was asked on, so
 *  a preview describes itself. */
export const dynamic = "force-dynamic";

export async function GET(req: NextRequest) {
  const scope = await financeRequestScope(req);
  if (!scope) return json({ error: "Unauthorized" }, 401);
  return json(agentOpenApi(financeOpenApi(req.nextUrl.origin), scope, req.nextUrl.searchParams.get("read_only") === "true"));
}
