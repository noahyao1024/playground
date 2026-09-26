import { execFile } from "node:child_process";
import { existsSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import http from "node:http";
import type { AddressInfo } from "node:net";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { promisify } from "node:util";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { startPostgrest, type StandIn } from "../helpers/postgrest";
import { AUDIENCE, call, isBillingDay, judgeBill, judgeDaily, oidcToken, quote } from "../../scripts/daily-jobs.mjs";

const exec = promisify(execFile);
const SCRIPT = resolve("scripts/daily-jobs.mjs");
const TOKEN = "header.payload.signature";

type Reply = { status: number; body?: unknown; headers?: Record<string, string> };

const alertText = "1 person(s) owe more than ¥500.\n\n  Alice: ¥700.00 across 2 charge(s), oldest 2026-08\n\nhttps://x/split-bill";
const alerted = {
  threshold: 500,
  over: [{ name: "Alice", owed: 700, charges: 2, oldest: "2026-08" }],
  mail: { subject: "Split bill: 1 over the unpaid threshold", text: alertText },
};
const quiet = { threshold: 500, over: [], mail: null };
const billed = { message: "Generated 2 charge(s)", month: "2026-10", generated: 2, skipped: [], details: [{ subscriber: "Alice", total_cny: 53 }] };

let site: StandIn;
// Per path, the answers in turn; the last one repeats.
let replies: Record<string, Reply[]>;
let dir: string;

beforeEach(async () => {
  replies = {
    "/api/cron/daily": [{ status: 200, body: alerted }],
    "/api/cron/bill": [{ status: 200, body: billed }],
    // GitHub's token endpoint, as the runner offers it.
    "/_oidc": [{ status: 200, body: { value: TOKEN } }],
  };
  site = await startPostgrest({}, {
    other: (req) => {
      const queue = replies[req.path];
      if (!queue) return undefined;
      return queue.length > 1 ? queue.shift() : queue[0];
    },
  });
  dir = mkdtempSync(join(tmpdir(), "daily-jobs-"));
});

afterEach(async () => {
  await site.close();
  rmSync(dir, { recursive: true, force: true });
});

const siteCalls = () => site.requests.filter((r) => r.path.startsWith("/api/"))
  .map((r) => `${r.path}${r.params.size ? `?${r.params}` : ""}`);
const oidcEnv = () => ({ ACTIONS_ID_TOKEN_REQUEST_URL: `${site.url}/_oidc?api-version=2.0`, ACTIONS_ID_TOKEN_REQUEST_TOKEN: "runner-token" });

/** The script as the workflow runs it: its own process, its exit code, its log,
 *  and the files it leaves for the next step. */
async function runScript(overrides: Record<string, string | undefined> = {}, args: string[] = []) {
  const files = { summary: join(dir, "summary.md"), output: join(dir, "output.txt"), mail: join(dir, "mail.txt") };
  const env: NodeJS.ProcessEnv = {
    ...process.env,
    PLAYGROUND_URL: site.url,
    ...oidcEnv(),
    RETRY_DELAY_MS: "0",
    NOW: "2026-10-15T02:00:00Z", // mid-month: no billing
    GITHUB_STEP_SUMMARY: files.summary,
    GITHUB_OUTPUT: files.output,
    MAIL_FILE: files.mail,
    ...overrides,
  };
  // An override of undefined removes the variable, as unset in the workflow.
  for (const [name, value] of Object.entries(env)) if (value === undefined) delete env[name];
  const read = (path: string) => (existsSync(path) ? readFileSync(path, "utf8") : "");
  let code = 0, stdout = "";
  try {
    ({ stdout } = await exec(process.execPath, [SCRIPT, ...args], { env }));
  } catch (err) {
    ({ code, stdout } = err as { code: number; stdout: string });
  }
  return { code, stdout, summary: read(files.summary), output: read(files.output), mail: read(files.mail), mailFile: files.mail };
}

describe("judging the unpaid check", () => {
  it("passes with the mail to send, or none needed", () => {
    expect(judgeDaily({ status: 200, body: alerted })).toEqual({ ok: true, text: "1 over ¥500; mail to send", mail: alerted.mail });
    expect(judgeDaily({ status: 200, body: quiet })).toEqual({ ok: true, text: "nobody over ¥500; no mail needed" });
  });

  it("fails when somebody is over the line and no mail came with the report", () => {
    expect(judgeDaily({ status: 200, body: { ...alerted, mail: null } }).ok).toBe(false);
    expect(judgeDaily({ status: 200, body: { ...alerted, mail: { subject: 1 } } }).ok).toBe(false);
  });

  it("fails on a refusal, an error, or no answer, saying which", () => {
    expect(judgeDaily({ status: 401, body: { error: "Unauthorized" } }).text).toContain("refused this run");
    expect(judgeDaily({ status: 500, body: { error: "relation \"charges\" does not exist" } }))
      .toEqual({ ok: false, text: "failed: HTTP 500 -- relation \"charges\" does not exist" });
    expect(judgeDaily({ status: 0, body: { error: "fetch failed (ECONNREFUSED)" } }))
      .toEqual({ ok: false, text: "failed: no answer -- fetch failed (ECONNREFUSED)" });
  });

  it("fails on an answer it does not recognise, rather than pass it quietly", () => {
    expect(judgeDaily({ status: 200, body: {} }).ok).toBe(false);
    expect(judgeDaily({ status: 200, body: { over: "Alice", threshold: 500, mail: null } }).ok).toBe(false);
    expect(judgeDaily({ status: 307, body: {} }).ok).toBe(false);
  });

  it("never repeats a name: the log is public", () => {
    for (const body of [alerted, { ...alerted, mail: null }, { ...alerted, mail: { subject: 1 } }]) {
      expect(judgeDaily({ status: 200, body }).text).not.toContain("Alice");
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

  it("fails on a refusal, an error, or an answer without a count", () => {
    expect(judgeBill({ status: 401, body: {} }).text).toContain("refused this run");
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

describe("oidcToken", () => {
  it("asks GitHub for a token for the site's audience, with the runner's own credential", async () => {
    expect(await oidcToken(oidcEnv())).toBe(TOKEN);
    const [asked] = site.requests;
    expect(asked.params.get("audience")).toBe(AUDIENCE);
    expect(asked.params.get("api-version")).toBe("2.0");
    expect(asked.headers.authorization).toBe("Bearer runner-token");
  });

  it("says what is missing when GitHub offers none, or will not give one", async () => {
    await expect(oidcToken({})).rejects.toThrow("id-token: write");
    replies["/_oidc"] = [{ status: 403, body: { message: "no" } }];
    await expect(oidcToken(oidcEnv())).rejects.toThrow("HTTP 403");
  });
});

describe("call", () => {
  const url = () => `${site.url}/api/cron/daily`;

  it("sends a fresh token each try as the bearer, and hands back the status and body", async () => {
    let minted = 0;
    const token = async () => `t${++minted}`;
    replies["/api/cron/daily"] = [{ status: 503 }, { status: 200, body: alerted }];
    expect(await call(url(), { token, delay: 0 })).toEqual({ status: 200, body: alerted });
    expect(site.requests.map((r) => r.headers.authorization)).toEqual(["Bearer t1", "Bearer t2"]);
  });

  it("tries a 5xx again, up to three times in all, and no more", async () => {
    const token = async () => TOKEN;
    replies["/api/cron/daily"] = [{ status: 500, body: { error: "still down" } }];
    expect(await call(url(), { token, delay: 0 })).toEqual({ status: 500, body: { error: "still down" } });
    expect(site.requests).toHaveLength(3);
  });

  it("does not ask again what asking again will not change", async () => {
    replies["/api/cron/daily"] = [{ status: 401, body: { error: "Unauthorized" } }];
    expect((await call(url(), { token: async () => TOKEN, delay: 0 })).status).toBe(401);
    expect(site.requests).toHaveLength(1);
  });

  it("takes a redirect as the answer, as Vercel Cron does", async () => {
    replies["/api/cron/daily"] = [{ status: 307, headers: { location: "/login" } }];
    expect((await call(url(), { token: async () => TOKEN, delay: 0 })).status).toBe(307);
    expect(siteCalls()).toEqual(["/api/cron/daily"]);
  });

  it("reports no answer as status 0, with the reason -- including a token it could not get", async () => {
    const closed = http.createServer();
    await new Promise<void>((done) => closed.listen(0, "127.0.0.1", done));
    const { port } = closed.address() as AddressInfo;
    await new Promise<void>((done) => closed.close(() => done()));
    const down = await call(`http://127.0.0.1:${port}/api/cron/daily`, { token: async () => TOKEN, delay: 0, attempts: 2 });
    expect(down.status).toBe(0);
    expect(down.body.error).toContain("ECONNREFUSED");

    const tokenless = await call(url(), { token: () => Promise.reject(new Error("no token today")), delay: 0, attempts: 2 });
    expect(tokenless).toEqual({ status: 0, body: { error: "no token today" } });
    expect(siteCalls()).toEqual([]);
  });
});

describe("a run", () => {
  it("checks who owes as this run, with GitHub's token, and bills nothing mid-month", async () => {
    const { code, stdout, summary } = await runScript();
    expect(code).toBe(0);
    expect(siteCalls()).toEqual(["/api/cron/daily"]);
    expect(site.requests.find((r) => r.path === "/api/cron/daily")?.headers.authorization).toBe(`Bearer ${TOKEN}`);
    expect(stdout).toContain("Unpaid alert: 1 over ¥500; mail to send");
    expect(summary).toContain("| Unpaid alert | ✅ 1 over ¥500; mail to send |");
  });

  it("leaves the mail in a file for the next step, and its subject in the outputs -- never in the log", async () => {
    const { mail, output, stdout, summary, mailFile } = await runScript();
    expect(mail).toBe(alertText);
    expect(output).toBe(`mail=true\nsubject=Split bill: 1 over the unpaid threshold\nmail_file=${mailFile}\n`);
    for (const text of [stdout, summary]) {
      expect(text).not.toContain("Alice");
      expect(text).not.toMatch(/700|53/);
    }
  });

  it("leaves nothing to send when nobody is over the line", async () => {
    replies["/api/cron/daily"] = [{ status: 200, body: quiet }];
    const { code, mail, output } = await runScript();
    expect(code).toBe(0);
    expect([mail, output]).toEqual(["", ""]);
  });

  it("bills first on the 1st to 3rd in Singapore, so the check counts the new month", async () => {
    const { code, stdout } = await runScript({ NOW: "2026-09-30T20:00:00Z" }); // 1 Oct, 04:00 in Singapore
    expect(code).toBe(0);
    expect(siteCalls()).toEqual(["/api/cron/bill", "/api/cron/daily"]);
    expect(stdout).toContain("Billing: 2026-10: 2 charge(s) generated");
    expect(stdout).not.toContain("Alice");
  });

  it("fails when billing fails, and still checks who owes and leaves the mail", async () => {
    replies["/api/cron/bill"] = [{ status: 500, body: { error: "boom" } }];
    const { code, stdout, output } = await runScript({ NOW: "2026-10-02T02:00:00Z" });
    expect(code).toBe(1);
    expect(siteCalls()).toEqual(["/api/cron/bill", "/api/cron/bill", "/api/cron/bill", "/api/cron/daily"]);
    expect(stdout).toContain("::error title=Billing::failed: HTTP 500 -- boom");
    expect(output).toContain("mail=true");
  });

  it("rides out a brief outage", async () => {
    replies["/api/cron/daily"] = [{ status: 503 }, { status: 200, body: alerted }];
    expect((await runScript()).code).toBe(0);
    expect(siteCalls()).toEqual(["/api/cron/daily", "/api/cron/daily"]);
  });

  it("asks for a test mail with --test-mail", async () => {
    await runScript({}, ["--test-mail"]);
    expect(siteCalls()).toEqual(["/api/cron/daily?test=1"]);
  });

  it("says so when the site refuses it", async () => {
    replies["/api/cron/daily"] = [{ status: 401, body: { error: "Unauthorized" } }];
    const { code, stdout } = await runScript();
    expect(code).toBe(1);
    expect(stdout).toContain("::error title=Unpaid alert::the site refused this run");
  });

  it("fails at once when GitHub offers it no token, calling nothing", async () => {
    const { code, stdout } = await runScript({ ACTIONS_ID_TOKEN_REQUEST_URL: undefined, ACTIONS_ID_TOKEN_REQUEST_TOKEN: undefined });
    expect(code).toBe(1);
    expect(stdout).toContain("::error title=OIDC::");
    expect(site.requests).toHaveLength(0);
  });
});
