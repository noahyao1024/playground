import { NextRequest } from "next/server";
import { financeJson as json, isFinanceRequest } from "@/lib/finance-server";
import { housingOpenApi } from "@/lib/housing-openapi";

export const dynamic = "force-dynamic";

/** Housing's contract uses the same owner session / bearer token as its data. */
export async function GET(req: NextRequest) {
  if (!(await isFinanceRequest(req))) return json({ error:"Unauthorized" }, 401);
  return json(housingOpenApi(new URL(req.url).origin));
}
