import { readFileSync } from "node:fs";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";
import { calls, startPostgrest, type StandIn } from "../helpers/postgrest";
import { DAILY_JOBS_CLAIMS, OIDC_AUDIENCE } from "@/lib/cron";
import { AUDIENCE } from "../../scripts/daily-jobs.mjs";

const { GET } = await import("@/app/api/cron/daily/route");

let db: StandIn;
const charge = (id: string, subscriber_id: string, total_cny: number, extra: Record<string, unknown> = {}) =>
  ({ id, subscriber_id, total_cny, period_start: "2026-09", paid: false, deleted_at: null, ...extra });

beforeEach(async () => {
  db = await startPostgrest({
    subscribers: [{ id: "a", name: "Alice" }, { id: "b", name: "Bob" }],
    charges: [
      charge("c1", "a", 400),
      charge("c2", "a", 300, { period_start: "2026-08" }),
      charge("c3", "b", 450),
      // Neither of these is owed: one is paid, one was deleted.
      charge("c4", "b", 900, { paid: true }),
      charge("c5", "b", 900, { deleted_at: "2026-09-10T00:00:00Z" }),
    ],
  });
  vi.stubEnv("NEXT_PUBLIC_SUPABASE_URL", db.url);
  vi.stubEnv("SUPABASE_SERVICE_ROLE_KEY", "stand-in");
  vi.stubEnv("CRON_SECRET", "cron-secret");
  vi.stubEnv("UNPAID_THRESHOLD_CNY", undefined);
});

afterEach(async () => {
  vi.unstubAllEnvs();
  await db.close();
});

// Called as Vercel Cron would; the workflow's GitHub token is test/lib/cron.test.ts's.
const run = async (auth = "Bearer cron-secret", query = "") => {
  const res = await GET(new NextRequest(`http://localhost/api/cron/daily${query}`, { headers: auth ? { authorization: auth } : {} }));
  return { status: res.status, body: await res.json() };
};

describe("the daily check", () => {
  it("answers only a caller it knows", async () => {
    expect((await run("Bearer wrong")).status).toBe(401);
    expect((await run("")).status).toBe(401);
    vi.stubEnv("CRON_SECRET", undefined);
    expect((await run()).status).toBe(500);
    expect(db.requests).toHaveLength(0);
  });

  it("reads what is owed -- the reads keep the database awake -- and reports who is over the line", async () => {
    const { status, body } = await run();
    expect(status).toBe(200);
    expect(body.threshold).toBe(500);
    expect(body.over).toEqual([{ name: "Alice", owed: 700, charges: 2, oldest: "2026-08" }]);
    // Paged, unpaid and undeleted only.
    expect(calls(db, "charges")).toEqual(["GET paid=eq.false&deleted_at=is.null&order=id.asc&offset=0&limit=1000"]);
  });

  it("hands back the alert to send, which the workflow mails with GitHub's SMTP account", async () => {
    const { body } = await run();
    expect(body.mail).toEqual({
      subject: "Split bill: 1 over the unpaid threshold",
      text: expect.stringContaining("Alice: ¥700.00 across 2 charge(s), oldest 2026-08"),
    });
  });

  it("takes the threshold from the environment", async () => {
    vi.stubEnv("UNPAID_THRESHOLD_CNY", "400");
    const { body } = await run();
    expect(body.over.map((o: { name: string }) => o.name)).toEqual(["Alice", "Bob"]);
    expect(body.mail.subject).toBe("Split bill: 2 over the unpaid threshold");
  });

  it("has no mail when nobody is over the line", async () => {
    vi.stubEnv("UNPAID_THRESHOLD_CNY", "10000");
    expect((await run()).body).toMatchObject({ over: [], mail: null });
  });
});

describe("a test run", () => {
  it("asks for a mail even when nobody is over the line, to check the setup end to end", async () => {
    vi.stubEnv("UNPAID_THRESHOLD_CNY", "10000");
    const { body } = await run(undefined, "?test=1");
    expect(body.over).toEqual([]);
    expect(body.mail).toEqual({ subject: "Split bill: unpaid alert test", text: expect.stringContaining("¥10,000") });
  });

  it("is the real alert when somebody is over it", async () => {
    expect((await run(undefined, "?test=1")).body.mail.subject).toBe("Split bill: 1 over the unpaid threshold");
  });

  it("is only ?test=1: anything else is an ordinary run", async () => {
    vi.stubEnv("UNPAID_THRESHOLD_CNY", "10000");
    expect((await run(undefined, "?test=0")).body.mail).toBeNull();
  });
});

describe("who calls it", () => {
  it("is the Daily jobs workflow, every day, as itself: it asks GitHub for the token the site checks", () => {
    const workflow = readFileSync(".github/workflows/daily-jobs.yml", "utf8");
    expect(workflow).toContain("- cron: '23 1 * * *'");
    expect(workflow).toContain("id-token: write");
    expect(workflow).toContain("node scripts/daily-jobs.mjs");
    expect(workflow).not.toContain("CRON_SECRET");
    expect(DAILY_JOBS_CLAIMS.workflow_ref).toBe("noahyao1024/playground/.github/workflows/daily-jobs.yml@refs/heads/main");
    // The audience the script asks for is the one the site accepts.
    expect(AUDIENCE).toBe(OIDC_AUDIENCE);
  });

  it("is not Vercel Cron as well: two callers would mean two mails", () => {
    const { crons } = JSON.parse(readFileSync("vercel.json", "utf8"));
    expect(crons.map((c: { path: string }) => c.path)).not.toContain("/api/cron/daily");
  });
});
