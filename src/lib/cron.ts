import { createHash, timingSafeEqual } from "node:crypto";
import { NextResponse } from "next/server";

const digest = (s: string) => createHash("sha256").update(s).digest();

/** The scheduled routes answer only a caller holding CRON_SECRET: Vercel Cron,
 *  which sends it by itself, and the Daily jobs workflow, which has it as a
 *  GitHub secret. The refusal to send back, or null when the caller may go on. */
export function cronRefusal(req: Request): NextResponse | null {
  const secret = process.env.CRON_SECRET;
  if (!secret) return NextResponse.json({ error: "CRON_SECRET not configured" }, { status: 500 });
  // Digests first: timingSafeEqual needs equal lengths, and a digest has one.
  const given = req.headers.get("authorization") ?? "";
  if (!timingSafeEqual(digest(given), digest(`Bearer ${secret}`))) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  return null;
}
