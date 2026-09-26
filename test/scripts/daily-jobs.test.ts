import { execFile } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import http from "node:http";
import type { AddressInfo } from "node:net";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { promisify } from "node:util";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { startPostgrest, type StandIn } from "../helpers/postgrest";
import { call, isBillingDay, judgeBill, judgeDaily, quote } from "../../scripts/daily-jobs.mjs";

const exec = promisify(execFile);
const SCRIPT = resolve("scripts/daily-jobs.mjs");

type Reply = { status: number; body?: unknown; headers?: Record<string, string> };

const alerted = { threshold: 500, over: [{ name: "Alice", owed: 700, charges: 2, oldest: "2026-08" }], email: "sent" };
const billed = { message: "Generated 2 charge(s)", month: "2026-10", generated: 2, skipped: [], details: [{ subscriber: "Alice", total_cny: 53 }] };

let site: StandIn;
// Per path, the answers in turn; the last one repeats.
let replies: Record<string, Reply[]>;
let dir: string;
let summary: string;

beforeEach(async () => {
  replies = {
    "/api/cron/daily": [{ status: 200, body: alerted }],
    "/api/cron/bill": [{ status: 200, body: billed }],
  };
  site = await startPostgrest({}, {
    other: (req) => {
      const queue = replies[req.path];
      if (!queue) return undefined;
      return queue.length > 1 ? queue.shift() : queue[0];
    },
  });
  dir = mkdtempSync(join(tmpdir(), "daily-jobs-"));
  summary = join(dir, "summary.md");
});

afterEach(async () => {
  await site.close();
  rmSync(dir, { recursive: true, force: true });
});

const paths = () => site.requests.map((r) => `${r.path}${r.params.size ? `?${r.params}` : ""}`);

/** The script as the workflow runs it: its own process, its exit code, its log. */
async function runScript(overrides: Record<string, string | undefined> = {}, args: string[] = []) {
  const env: NodeJS.ProcessEnv = {
    ...process.env,
    PLAYGROUND_URL: site.url,
    CRON_SECRET: "cron-secret",
    RETRY_DELAY_MS: "0",
    NOW: "2026-10-15T02:00:00Z", // mid-month: no billing
    GITHUB_STEP_SUMMARY: summary,
    ...overrides,
  };
  // An override of undefined removes the variable, as unset in the workflow.
  for (const [name, value] of Object.entries(env)) if (value === undefined) delete env[name];
  try {
    const { stdout } = await exec(process.execPath, [SCRIPT, ...args], { env });
    return { code: 0, stdout };
  } catch (err) {
    const { code, stdout } = err as { code: number; stdout: string };
    return { code, stdout };
  }
}

describe("judging the unpaid check", () => {
  it("passes when the mail went, or none was needed", () => {
    expect(judgeDaily({ status: 200, body: alerted })).toEqual({ ok: true, text: "1 over ¥500; mail sent" });
    expect(judgeDaily({ status: 200, body: { threshold: 500, over: [], email: "not needed" } }))
      .toEqual({ ok: true, text: "nobody over ¥500; no mail needed" });
  });

  it("fails when a mail was due and did not go, whichever the reason", () => {
    expect(judgeDaily({ status: 200, body: { ...alerted, email: "not configured" } }))
      .toEqual({ ok: false, text: "1 over ¥500, but SMTP is not set in Vercel, so no mail went out" });
    expect(judgeDaily({ status: 502, body: { ...alerted, email: "failed", error: "535 Username and Password not accepted" } }))
      .toEqual({ ok: false, text: "1 over ¥500, but the mail failed -- 535 Username and Password not accepted" });
  });

  it("fails on a refused secret, an error, or no answer, saying which", () => {
    expect(judgeDaily({ status: 401, body: { error: "Unauthorized" } }).text).toContain("refused CRON_SECRET");
    expect(judgeDaily({ status: 500, body: { error: "relation \"charges\" does not exist" } }))
      .toEqual({ ok: false, text: "failed: HTTP 500 -- relation \"charges\" does not exist" });
    expect(judgeDaily({ status: 0, body: { error: "fetch failed (ECONNREFUSED)" } }))
      .toEqual({ ok: false, text: "failed: no answer -- fetch failed (ECONNREFUSED)" });
  });

  it("fails on an answer it does not recognise, rather than pass it quietly", () => {
    expect(judgeDaily({ status: 200, body: {} }).ok).toBe(false);
    expect(judgeDaily({ status: 200, body: { ...alerted, email: "queued" } }).ok).toBe(false);
    expect(judgeDaily({ status: 307, body: {} }).ok).toBe(false);
  });

  it("never repeats a name: the log is public", () => {
    for (const email of ["sent", "not configured", "failed", "queued"]) {
      expect(judgeDaily({ status: email === "failed" ? 502 : 200, body: { ...alerted, email, error: "x" } }).text).not.toContain("Alice");
    }
  });
});

describe("judging billing", () => {
  it("passes with the month and the count, and nothing about who", () => {
    expect(judgeBill({ status: 200, body: billed })).toEqual({ ok: true, text: "2026-10: 2 charge(s) generated" });
    expect(judgeBill({ status: 200, body: { ...billed, generated: 0 } }).ok).toBe(true);
  });

  it("fails when a charge was skipped for want of a rate", () => {
    const skipped = [{ subscriber: "Alice", service: "Svc", month: "2026-10", currency: "JPY" }];
    expect(judgeBill({ status: 200, body: { ...billed, skipped } }))
      .toEqual({ ok: false, text: "2026-10: 2 charge(s) generated, 1 skipped with no rate for their currency" });
  });

  it("fails on a refused secret, an error, or an answer without a count", () => {
    expect(judgeBill({ status: 401, body: {} }).text).toContain("refused CRON_SECRET");
    expect(judgeBill({ status: 500, body: { error: "boom" } })).toEqual({ ok: false, text: "failed: HTTP 500 -- boom" });
    expect(judgeBill({ status: 200, body: {} }).ok).toBe(false);
  });
});

describe("quote", () => {
  it("keeps an error on one line, so it cannot start a workflow command", () => {
    expect(quote("bad\n::set-env name=X::1\r\nmore")).toBe("bad ::set-env name=X::1 more");
  });

  it("blanks addresses and caps the length", () => {
    expect(quote("Mail from me.name+tag@example.co.uk rejected")).toBe("Mail from <address> rejected");
    expect(quote("x".repeat(1000))).toHaveLength(300);
  });
});

describe("isBillingDay", () => {
  it("is the 1st to 3rd in Singapore, whatever the date in UTC", () => {
    expect(isBillingDay(new Date("2026-09-30T15:59:59Z"))).toBe(false); // 30 Sep, 23:59 in Singapore
    expect(isBillingDay(new Date("2026-09-30T16:00:00Z"))).toBe(true); // 1 Oct
    expect(isBillingDay(new Date("2026-10-03T15:59:59Z"))).toBe(true); // 3 Oct, 23:59
    expect(isBillingDay(new Date("2026-10-03T16:00:00Z"))).toBe(false); // 4 Oct
  });
});

describe("call", () => {
  it("sends the secret as a bearer token and hands back the status and body", async () => {
    expect(await call(`${site.url}/api/cron/daily`, "s3cret", { delay: 0 })).toEqual({ status: 200, body: alerted });
    expect(site.requests[0].headers.authorization).toBe("Bearer s3cret");
  });

  it("tries a 5xx again, up to three times in all", async () => {
    replies["/api/cron/daily"] = [{ status: 503 }, { status: 504 }, { status: 200, body: alerted }];
    expect((await call(`${site.url}/api/cron/daily`, "s", { delay: 0 })).status).toBe(200);
    expect(site.requests).toHaveLength(3);

    replies["/api/cron/daily"] = [{ status: 500, body: { error: "still down" } }];
    expect(await call(`${site.url}/api/cron/daily`, "s", { delay: 0 })).toEqual({ status: 500, body: { error: "still down" } });
    expect(site.requests).toHaveLength(6);
  });

  it("does not ask again what asking again will not change", async () => {
    replies["/api/cron/daily"] = [{ status: 401, body: { error: "Unauthorized" } }];
    expect((await call(`${site.url}/api/cron/daily`, "s", { delay: 0 })).status).toBe(401);
    expect(site.requests).toHaveLength(1);
  });

  it("takes a redirect as the answer, as Vercel Cron does", async () => {
    replies["/api/cron/daily"] = [{ status: 307, headers: { location: "/login" } }];
    expect((await call(`${site.url}/api/cron/daily`, "s", { delay: 0 })).status).toBe(307);
    expect(paths()).toEqual(["/api/cron/daily"]);
  });

  it("reports no answer as status 0, with the reason", async () => {
    const closed = http.createServer();
    await new Promise<void>((done) => closed.listen(0, "127.0.0.1", done));
    const { port } = closed.address() as AddressInfo;
    await new Promise<void>((done) => closed.close(() => done()));
    const answer = await call(`http://127.0.0.1:${port}/api/cron/daily`, "s", { delay: 0, attempts: 2 });
    expect(answer.status).toBe(0);
    expect(answer.body.error).toContain("ECONNREFUSED");
  });
});

describe("a run", () => {
  it("checks who owes, bills nothing mid-month, and passes", async () => {
    const { code, stdout } = await runScript();
    expect(code).toBe(0);
    expect(paths()).toEqual(["/api/cron/daily"]);
    expect(stdout).toContain("Unpaid alert: 1 over ¥500; mail sent");
    expect(readFileSync(summary, "utf8")).toContain("| Unpaid alert | ✅ 1 over ¥500; mail sent |");
  });

  it("bills first on the 1st to 3rd in Singapore, so the check counts the new month", async () => {
    const { code, stdout } = await runScript({ NOW: "2026-09-30T20:00:00Z" }); // 1 Oct, 04:00 in Singapore
    expect(code).toBe(0);
    expect(paths()).toEqual(["/api/cron/bill", "/api/cron/daily"]);
    expect(stdout).toContain("Billing: 2026-10: 2 charge(s) generated");
  });

  it("logs no names or amounts, in the log or the summary", async () => {
    const { stdout } = await runScript({ NOW: "2026-10-01T02:00:00Z" });
    for (const text of [stdout, readFileSync(summary, "utf8")]) {
      expect(text).not.toContain("Alice");
      expect(text).not.toMatch(/700|53/);
    }
  });

  it("fails with an annotation when a mail was due and had nowhere to go", async () => {
    replies["/api/cron/daily"] = [{ status: 200, body: { ...alerted, email: "not configured" } }];
    const { code, stdout } = await runScript();
    expect(code).toBe(1);
    expect(stdout).toContain("::error title=Unpaid alert::1 over ¥500, but SMTP is not set in Vercel");
    expect(readFileSync(summary, "utf8")).toContain("| Unpaid alert | ❌ ");
  });

  it("fails when billing fails, and still checks who owes", async () => {
    replies["/api/cron/bill"] = [{ status: 500, body: { error: "boom" } }];
    const { code, stdout } = await runScript({ NOW: "2026-10-02T02:00:00Z" });
    expect(code).toBe(1);
    expect(paths()).toEqual(["/api/cron/bill", "/api/cron/bill", "/api/cron/bill", "/api/cron/daily"]);
    expect(stdout).toContain("::error title=Billing::failed: HTTP 500 -- boom");
    expect(stdout).toContain("Unpaid alert: 1 over ¥500; mail sent");
  });

  it("rides out a brief outage", async () => {
    replies["/api/cron/daily"] = [{ status: 503 }, { status: 200, body: alerted }];
    expect((await runScript()).code).toBe(0);
    expect(paths()).toEqual(["/api/cron/daily", "/api/cron/daily"]);
  });

  it("asks for a test mail with --test-mail", async () => {
    await runScript({}, ["--test-mail"]);
    expect(paths()).toEqual(["/api/cron/daily?test=1"]);
  });

  it("says so when the site refuses the secret", async () => {
    replies["/api/cron/daily"] = [{ status: 401, body: { error: "Unauthorized" } }];
    const { code, stdout } = await runScript();
    expect(code).toBe(1);
    expect(stdout).toContain("::error title=Unpaid alert::the site refused CRON_SECRET");
  });

  it("fails at once without CRON_SECRET, calling nothing", async () => {
    const { code, stdout } = await runScript({ CRON_SECRET: undefined });
    expect(code).toBe(1);
    expect(stdout).toContain("::error title=CRON_SECRET::Not set.");
    expect(site.requests).toHaveLength(0);
  });
});
