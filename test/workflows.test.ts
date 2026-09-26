import { readdirSync, readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

/** Configuration belongs in Vercel. GitHub holds only what its own workflows
 *  use: the SMTP account the unpaid alert goes out through, and SUPABASE_DB_URL
 *  for Apply Migration. The Daily jobs workflow reaches the site with its OIDC
 *  token, so no site secret is copied here. A workflow reaching for anything
 *  else is configuration drifting back into a second place, where it goes stale
 *  unnoticed. */
const ALLOWED = new Set([
  "secrets.SMTP_USERNAME", "secrets.SMTP_PASSWORD", "secrets.ALERT_TO",
  "vars.SMTP_SERVER", "vars.SMTP_PORT", "vars.MAIL_FROM",
  "secrets.SUPABASE_DB_URL",
  "secrets.GITHUB_TOKEN",
]);

describe("GitHub's share of the configuration", () => {
  it("is the SMTP account and SUPABASE_DB_URL, and nothing else", () => {
    const strays: string[] = [];
    for (const file of readdirSync(".github/workflows").filter((f) => /\.ya?ml$/.test(f))) {
      const text = readFileSync(`.github/workflows/${file}`, "utf8");
      for (const [ref] of text.matchAll(/\b(?:secrets|vars)\.[A-Za-z_][A-Za-z0-9_]*/g)) {
        if (!ALLOWED.has(ref)) strays.push(`${file}: ${ref}`);
      }
    }
    expect([...new Set(strays)]).toEqual([]);
  });
});
