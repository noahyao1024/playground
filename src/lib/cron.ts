import { createHash, timingSafeEqual } from "node:crypto";
import { NextResponse } from "next/server";
import { createRemoteJWKSet, jwtVerify, type JWTVerifyGetKey } from "jose";

const digest = (s: string) => createHash("sha256").update(s).digest();

/** GitHub's OIDC issuer. A workflow asks it for a token naming an audience, and
 *  GitHub signs claims about the run -- which repository, which workflow file,
 *  which branch -- that nobody outside GitHub can forge. */
export const GITHUB_ISSUER = "https://token.actions.githubusercontent.com";
export const OIDC_AUDIENCE = "https://playground.noahyao.me";

/** What a token must say to be the Daily jobs workflow: this repository, by its
 *  numeric id, which survives a rename or transfer; that workflow file; main. A
 *  run on any other branch, or of any other workflow, is turned away. */
export const DAILY_JOBS_CLAIMS: Record<string, string> = {
  repository_id: "1177944536",
  workflow_ref: "noahyao1024/playground/.github/workflows/daily-jobs.yml@refs/heads/main",
  ref: "refs/heads/main",
};

// Fetched on first use and cached by jose for the life of the instance.
let github: JWTVerifyGetKey | undefined;
const githubKeys = () => (github ??= createRemoteJWKSet(new URL(`${GITHUB_ISSUER}/.well-known/jwks`)));

async function isDailyJobs(token: string, keys: JWTVerifyGetKey): Promise<boolean> {
  try {
    const { payload } = await jwtVerify(token, keys, {
      issuer: GITHUB_ISSUER,
      audience: OIDC_AUDIENCE,
      algorithms: ["RS256"],
      clockTolerance: 30,
    });
    return Object.entries(DAILY_JOBS_CLAIMS).every(([claim, value]) => payload[claim] === value);
  } catch {
    return false;
  }
}

/** The scheduled routes answer two callers. Vercel Cron sends CRON_SECRET as a
 *  bearer token by itself. The Daily jobs workflow sends a GitHub OIDC token,
 *  so GitHub holds no copy of any secret for this. The refusal to send back, or
 *  null when the caller may go on. `keys` is for the tests. */
export async function cronRefusal(req: Request, keys: JWTVerifyGetKey = githubKeys()): Promise<NextResponse | null> {
  const given = req.headers.get("authorization") ?? "";
  const bearer = /^Bearer\s+(\S+)\s*$/.exec(given)?.[1];
  // CRON_SECRET is not a JWT, so jose turns it down before looking up a key:
  // Vercel's own calls never wait on GitHub's.
  if (bearer && (await isDailyJobs(bearer, keys))) return null;
  const secret = process.env.CRON_SECRET;
  if (!secret) return NextResponse.json({ error: "CRON_SECRET not configured" }, { status: 500 });
  // Digests first: timingSafeEqual needs equal lengths, and a digest has one.
  if (!timingSafeEqual(digest(given), digest(`Bearer ${secret}`))) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  return null;
}
