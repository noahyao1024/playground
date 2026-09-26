import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { createLocalJWKSet, exportJWK, generateKeyPair, SignJWT, type JWTVerifyGetKey } from "jose";
import { cronRefusal, DAILY_JOBS_CLAIMS, GITHUB_ISSUER, OIDC_AUDIENCE } from "@/lib/cron";

// GitHub's signing key, as far as these tests go, and somebody else's.
let githubKey: CryptoKey;
let strangerKey: CryptoKey;
let keys: JWTVerifyGetKey;

beforeAll(async () => {
  const github = await generateKeyPair("RS256");
  githubKey = github.privateKey;
  strangerKey = (await generateKeyPair("RS256")).privateKey;
  keys = createLocalJWKSet({ keys: [{ ...(await exportJWK(github.publicKey)), kid: "github", alg: "RS256", use: "sig" }] });
});

beforeEach(() => vi.stubEnv("CRON_SECRET", "cron-secret"));
afterEach(() => vi.unstubAllEnvs());

const now = () => Math.floor(Date.now() / 1000);

/** A token as GitHub mints one for a run of the Daily jobs workflow on main,
 *  with `claims` changed. */
function token(claims: Record<string, unknown> = {}, { key = githubKey, expires = now() + 300 } = {}) {
  return new SignJWT({
    iss: GITHUB_ISSUER,
    aud: OIDC_AUDIENCE,
    repository: "noahyao1024/playground",
    event_name: "schedule",
    ...DAILY_JOBS_CLAIMS,
    ...claims,
  })
    .setProtectedHeader({ alg: "RS256", kid: "github" })
    .setIssuedAt(expires - 300)
    .setExpirationTime(expires)
    .sign(key);
}

/** What the check answers: the refusal's status, or "in". */
async function verdict(authorization?: string, withKeys: JWTVerifyGetKey = keys) {
  const req = new Request("http://localhost/api/cron/daily", { headers: authorization ? { authorization } : {} });
  return (await cronRefusal(req, withKeys))?.status ?? "in";
}

describe("the Daily jobs workflow", () => {
  it("is let in by the token GitHub gives its run on main", async () => {
    expect(await verdict(`Bearer ${await token()}`)).toBe("in");
  });

  it("needs no CRON_SECRET for it: nothing is copied into GitHub", async () => {
    vi.stubEnv("CRON_SECRET", undefined);
    expect(await verdict(`Bearer ${await token()}`)).toBe("in");
  });

  it("is turned away as another repository, another workflow, another branch, or for another audience", async () => {
    for (const claims of [
      { repository_id: "1" },
      { workflow_ref: "noahyao1024/playground/.github/workflows/check.yml@refs/heads/main" },
      { ref: "refs/heads/feature", workflow_ref: "noahyao1024/playground/.github/workflows/daily-jobs.yml@refs/heads/feature" },
      { aud: "https://elsewhere.example" },
      { iss: "https://token.actions.githubusercontent.com.example" },
    ]) {
      expect(await verdict(`Bearer ${await token(claims)}`), JSON.stringify(claims)).toBe(401);
    }
  });

  it("is turned away with a token GitHub did not sign, or one out of date", async () => {
    expect(await verdict(`Bearer ${await token({}, { key: strangerKey })}`)).toBe(401);
    expect(await verdict(`Bearer ${await token({}, { expires: now() - 120 })}`)).toBe(401);
  });
});

describe("Vercel Cron", () => {
  it("is let in by CRON_SECRET, without the check ever asking for GitHub's keys", async () => {
    const watched = vi.fn(keys);
    expect(await verdict("Bearer cron-secret", watched)).toBe("in");
    expect(watched).not.toHaveBeenCalled();
  });

  it("is refused a wrong secret, or none", async () => {
    expect(await verdict("Bearer wrong")).toBe(401);
    expect(await verdict("cron-secret")).toBe(401);
    expect(await verdict()).toBe(401);
  });

  it("finds nothing to check against until CRON_SECRET is set", async () => {
    vi.stubEnv("CRON_SECRET", undefined);
    expect(await verdict("Bearer cron-secret")).toBe(500);
  });
});
