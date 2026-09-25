import { NextRequest, NextResponse } from "next/server";
import { financeOpenApi } from "@/lib/finance-openapi";

/** What /api/finance takes and returns, for an agent to read before calling it.
 *  Public: it describes shapes, never data, and the repo defining them is public
 *  too. Served for the host it was asked on, so a preview describes itself. */
export function GET(req: NextRequest) {
  return NextResponse.json(financeOpenApi(new URL(req.url).origin), {
    headers: { "Cache-Control": "public, max-age=300" },
  });
}
