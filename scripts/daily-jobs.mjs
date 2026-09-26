#!/usr/bin/env node
/**
 * The site's scheduled jobs, as the Daily jobs workflow runs them.
 *
 *   node scripts/daily-jobs.mjs [--test-mail]
 *
 * The work happens on the site, next to its configuration: on the 1st to 3rd
 * in Singapore /api/cron/bill fills in the month's charges, and every day
 * /api/cron/daily works out who owes more than the threshold, its reads keeping
 * the database awake. This calls them and judges the answers. A mail due goes
 * to a file for the workflow's next step, which sends it with the SMTP account
 * GitHub holds. The run fails -- and GitHub mails the owner -- when a job did
 * not do its work: no answer, an error, a refusal, charges left unbilled. The
 * mail step fails the run too if the mail cannot go.
 *
 * It proves which run it is with a GitHub OIDC token, which the site checks, so
 * no secret is copied into GitHub for this. --test-mail asks for the alert even
 * when nobody is over the threshold, to check the mail setup end to end.
 *
 * The log is public, as the repository is. It carries counts and states, never
 * names or amounts; the mail itself goes only to the file.
 *
 * PLAYGROUND_URL points it at another deployment. RETRY_DELAY_MS, NOW and
 * MAIL_FILE are for the tests.
 */
import { appendFileSync, writeFileSync } from "node:fs";
import { pathToFileURL } from "node:url";

const SITE = (process.env.PLAYGROUND_URL ?? "https://playground.noahyao.me").replace(/\/$/, "");
// The audience the site accepts: OIDC_AUDIENCE in src/lib/cron.ts.
export const AUDIENCE = "https://playground.noahyao.me";
const MAIL_FILE = process.env.MAIL_FILE ?? "daily-jobs-mail.txt";
// Three tries a minute apart ride out a cold start or a brief upstream outage --
// Supabase has answered 504 here before -- without hiding a real failure.
const ATTEMPTS = 3;
const RETRY_DELAY_MS = Number(process.env.RETRY_DELAY_MS ?? 60_000);
const TIMEOUT_MS = 90_000;

/** A GitHub OIDC token for the site: the run's own proof of which repository,
 *  workflow and branch it is, in place of a shared secret. GitHub offers one
 *  only to a job with `permissions: id-token: write`.
 *  @param {Record<string, string | undefined>} [env] */
export async function oidcToken(env = process.env) {
  const url = env.ACTIONS_ID_TOKEN_REQUEST_URL;
  const bearer = env.ACTIONS_ID_TOKEN_REQUEST_TOKEN;
  if (!url || !bearer) throw new Error("GitHub offers no OIDC token: the job needs `permissions: id-token: write`");
  const res = await fetch(`${url}&audience=${encodeURIComponent(AUDIENCE)}`, {
    headers: { authorization: `Bearer ${bearer}` },
    signal: AbortSignal.timeout(TIMEOUT_MS),
  });
  const value = res.ok ? (await res.json().catch(() => null))?.value : undefined;
  if (typeof value !== "string" || !value) throw new Error(`GitHub's OIDC token request failed: HTTP ${res.status}`);
  return value;
}

/** GET a cron route as this run, with a fresh token each try. Tries again on
 *  what may pass by itself -- no answer, or a 5xx -- but not on anything else,
 *  which asking again will not change. Redirects are answers too: Vercel Cron
 *  does not follow them either. */
export async function call(url, { token = oidcToken, attempts = ATTEMPTS, delay = RETRY_DELAY_MS } = {}) {
  for (let attempt = 1; ; attempt++) {
    let answer;
    try {
      const res = await fetch(url, {
        headers: { authorization: `Bearer ${await token()}` },
        redirect: "manual",
        signal: AbortSignal.timeout(TIMEOUT_MS),
      });
      answer = { status: res.status, body: (await res.json().catch(() => null)) ?? {} };
      if (res.status < 500) return answer;
    } catch (err) {
      const cause = err?.cause?.code ?? err?.cause?.message;
      answer = { status: 0, body: { error: `${err?.message ?? err}${cause ? ` (${cause})` : ""}` } };
    }
    if (attempt >= attempts) return answer;
    await new Promise((resolve) => setTimeout(resolve, delay));
  }
}

/** An error as the public log may show it: on one line, so it cannot start a
 *  workflow command of its own, with addresses blanked and the length capped. */
export function quote(text) {
  return String(text)
    .replace(/\s+/g, " ")
    .replace(/[\w.%+-]+@[\w-]+(\.[\w-]+)+/g, "<address>")
    .slice(0, 300);
}

const REFUSED = "the site refused this run: only daily-jobs.yml on main, in this repository, may call it";
const failure = ({ status, body }) =>
  `${status ? `HTTP ${status}` : "no answer"}${body?.error ? ` -- ${quote(body.error)}` : ""}`;

/** Whether the unpaid check did its work, in counts, and the mail it asks to
 *  send if any. Anything it does not recognise fails: a quiet pass is the one
 *  outcome this must never invent. */
export function judgeDaily(answer) {
  const { status, body } = answer;
  if (status === 401) return { ok: false, text: REFUSED };
  if (status !== 200) return { ok: false, text: `failed: ${failure(answer)}` };
  if (!Array.isArray(body.over) || typeof body.threshold !== "number") {
    return { ok: false, text: `unexpected answer: HTTP ${status}, no report` };
  }
  const over = body.over.length;
  const who = `${over || "nobody"} over ¥${body.threshold}`;
  const { mail } = body;
  if (mail === null && !over) return { ok: true, text: `${who}; no mail needed` };
  // Not the body itself in the text: it names people.
  if (typeof mail?.subject !== "string" || typeof mail?.text !== "string") {
    return { ok: false, text: `${who}; unexpected answer about the mail` };
  }
  return { ok: true, text: `${who}; mail to send`, mail };
}

/** Whether billing did its work. A charge skipped for want of a rate fails the
 *  run: the next run fills it in, but after the 3rd's there is no next run. */
export function judgeBill(answer) {
  const { status, body } = answer;
  if (status === 401) return { ok: false, text: REFUSED };
  if (status !== 200) return { ok: false, text: `failed: ${failure(answer)}` };
  if (typeof body.generated !== "number") return { ok: false, text: `unexpected answer: HTTP ${status}, no count of charges` };
  const skipped = Array.isArray(body.skipped) ? body.skipped.length : 0;
  const text = `${body.month}: ${body.generated} charge(s) generated`;
  return skipped
    ? { ok: false, text: `${text}, ${skipped} skipped with no rate for their currency` }
    : { ok: true, text };
}

/** The 1st to 3rd of the month in Singapore: the days vercel.json bills on. */
export function isBillingDay(now) {
  const day = Number(new Intl.DateTimeFormat("en-GB", { timeZone: "Asia/Singapore", day: "numeric" }).format(now));
  return day <= 3;
}

async function main() {
  if (!process.env.ACTIONS_ID_TOKEN_REQUEST_URL) {
    console.log("::error title=OIDC::GitHub offers this run no OIDC token. The job needs `permissions: id-token: write`.");
    process.exitCode = 1;
    return;
  }
  const testMail = process.argv.includes("--test-mail");
  const now = process.env.NOW ? new Date(process.env.NOW) : new Date();

  const results = [];
  // Billing first, so that on the 1st the alert counts the month just billed.
  if (isBillingDay(now)) results.push(["Billing", judgeBill(await call(`${SITE}/api/cron/bill`))]);
  const daily = judgeDaily(await call(`${SITE}/api/cron/daily${testMail ? "?test=1" : ""}`));
  results.push(["Unpaid alert", daily]);

  // The mail names people, so it goes to a file for the next step, not the log.
  if (daily.mail) {
    writeFileSync(MAIL_FILE, daily.mail.text, { mode: 0o600 });
    if (process.env.GITHUB_OUTPUT) {
      const subject = daily.mail.subject.replace(/[\r\n]+/g, " ");
      appendFileSync(process.env.GITHUB_OUTPUT, `mail=true\nsubject=${subject}\nmail_file=${MAIL_FILE}\n`);
    }
  }

  for (const [job, { ok, text }] of results) console.log(ok ? `${job}: ${text}` : `::error title=${job}::${text}`);
  if (process.env.GITHUB_STEP_SUMMARY) {
    const rows = results.map(([job, { ok, text }]) => `| ${job} | ${ok ? "✅" : "❌"} ${text.replace(/\|/g, "\\|")} |`);
    appendFileSync(process.env.GITHUB_STEP_SUMMARY, ["| Job | Result |", "|---|---|", ...rows, ""].join("\n"));
  }
  if (results.some(([, r]) => !r.ok)) process.exitCode = 1;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) await main();
