import type { NextRequest } from "next/server";
import { housingAnalysisResponse } from "@/lib/housing-analysis-server";

export const dynamic = "force-dynamic";
export const maxDuration = 60;
export const GET = (req: NextRequest) => housingAnalysisResponse(req,"json");
export const POST = (req: NextRequest) => housingAnalysisResponse(req,"json");
