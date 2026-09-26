import { readdirSync, readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

/** Configuration belongs in Vercel. GitHub keeps two secrets: CRON_SECRET, for
 *  the Daily jobs workflow to call the site with, and SUPABASE_DB_URL, for
 *  Apply Migration. A workflow reaching for anything else is configuration
 *  drifting back into a second place, where it goes stale unnoticed. */
const ALLOWED = new Set(["secrets.CRON_SECRET", "secrets.SUPABASE_DB_URL", "secrets.GITHUB_TOKEN"]);

describe("GitHub's share of the configuration", () => {
  it("is CRON_SECRET and SUPABASE_DB_URL, and nothing else", () => {
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
