#!/usr/bin/env node
/**
 * The site's scheduled jobs, as the Daily jobs workflow runs them.
 *
 *   CRON_SECRET=... node scripts/daily-jobs.mjs [--test-mail]
 *
 * The work happens on the site, next to its configuration: on the 1st to 3rd
 * in Singapore /api/cron/bill fills in the month's charges, and every day
 * /api/cron/daily mails the owner about anyone owing more than the threshold,
 * its reads keeping the database awake. This calls them and judges the
 * answers. The run fails -- and GitHub mails the owner -- when a job did not
 * do its work: no answer, an error, a refused secret, a mail that could not go
 * or had nowhere to go, charges left unbilled.
 *
 * --test-mail sends the alert even when nobody is over the threshold, to check
 * the mail setup end to end.
 *
 * The log is public, as the repository is. It carries counts and states, never
 * names or amounts, and any address in a quoted error is blanked.
 *
 * PLAYGROUND_URL points it at another deployment. RETRY_DELAY_MS and NOW are
 * for the tests.
 */
import { appendFileSync } from "node:fs";
import { pathToFileURL } from "node:url";

const SITE = (process.env.PLAYGROUND_URL ?? "https://playground.noahyao.me").replace(/\/$/, "");
// Three tries a minute apart ride out a cold start or a brief upstream outage --
// Supabase has answered 504 here before -- without hiding a real failure.
const ATTEMPTS = 3;
const RETRY_DELAY_MS = Number(process.env.RETRY_DELAY_MS ?? 60_000);
const TIMEOUT_MS = 90_000;

/** GET a cron route with the secret. Tries again on what may pass by itself --
 *  no answer, or a 5xx -- but not on anything else, which asking again will not
 *  change. Redirects are answers too: Vercel Cron does not follow them either. */
export async function call(url, secret, { attempts = ATTEMPTS, delay = RETRY_DELAY_MS } = {}) {
  for (let attempt = 1; ; attempt++) {
    let answer;
    try {
      const res = await fetch(url, {
        headers: { authorization: `Bearer ${secret}` },
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

const REFUSED = "the site refused CRON_SECRET: the value here is not the one Vercel holds";
const failure = ({ status, body }) =>
  `${status ? `HTTP ${status}` : "no answer"}${body?.error ? ` -- ${quote(body.error)}` : ""}`;

/** Whether the unpaid check did its work, in counts. Anything it does not
 *  recognise fails: a quiet pass is the one outcome this must never invent. */
export function judgeDaily(answer) {
  const { status, body } = answer;
  if (status === 401) return { ok: false, text: REFUSED };
  const mailFailed = status === 502 && body?.email === "failed";
  if (status !== 200 && !mailFailed) return { ok: false, text: `failed: ${failure(answer)}` };
  const over = Array.isArray(body.over) ? body.over.length : 0;
  const who = `${over || "nobody"} over ¥${body.threshold}`;
  switch (body.email) {
    case "sent": return { ok: true, text: `${who}; mail sent` };
    case "not needed": return { ok: true, text: `${who}; no mail needed` };
    case "not configured": return { ok: false, text: `${who}, but SMTP is not set in Vercel, so no mail went out` };
    case "failed": return { ok: false, text: `${who}, but the mail failed -- ${quote(body.error)}` };
    // Not the body itself: it may carry names.
    default: return { ok: false, text: `unexpected answer: HTTP ${status}, mail ${quote(JSON.stringify(body.email ?? null))}` };
  }
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
  const secret = process.env.CRON_SECRET;
  if (!secret) {
    console.log("::error title=CRON_SECRET::Not set. Add it under Settings > Secrets and variables > Actions, with the value Vercel holds.");
    process.exitCode = 1;
    return;
  }
  const testMail = process.argv.includes("--test-mail");
  const now = process.env.NOW ? new Date(process.env.NOW) : new Date();

  const results = [];
  // Billing first, so that on the 1st the alert counts the month just billed.
  if (isBillingDay(now)) results.push(["Billing", judgeBill(await call(`${SITE}/api/cron/bill`, secret))]);
  results.push(["Unpaid alert", judgeDaily(await call(`${SITE}/api/cron/daily${testMail ? "?test=1" : ""}`, secret))]);

  for (const [job, { ok, text }] of results) console.log(ok ? `${job}: ${text}` : `::error title=${job}::${text}`);
  if (process.env.GITHUB_STEP_SUMMARY) {
    const rows = results.map(([job, { ok, text }]) => `| ${job} | ${ok ? "✅" : "❌"} ${text.replace(/\|/g, "\\|")} |`);
    appendFileSync(process.env.GITHUB_STEP_SUMMARY, ["| Job | Result |", "|---|---|", ...rows, ""].join("\n"));
  }
  if (results.some(([, r]) => !r.ok)) process.exitCode = 1;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) await main();
