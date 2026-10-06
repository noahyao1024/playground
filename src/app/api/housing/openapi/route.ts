import { NextRequest } from "next/server";
import { financeJson as json, financeRequestScope } from "@/lib/finance-server";
import { housingOpenApi } from "@/lib/housing-openapi";
import { agentOpenApi } from "@/lib/agent-openapi";

export const dynamic = "force-dynamic";

/** Housing's contract uses the same owner session / bearer token as its data. */
export async function GET(req: NextRequest) {
  const scope = await financeRequestScope(req);
  if (!scope) return json({ error: "Unauthorized" }, 401);
  return json(agentOpenApi(housingOpenApi(req.nextUrl.origin), scope, req.nextUrl.searchParams.get("read_only") === "true"));
}
