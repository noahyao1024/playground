#!/usr/bin/env node
/**
 * Reprice unpaid charges at the rate that held in their billing month.
 *
 *   node scripts/reprice-unpaid.mjs            # show what would change
 *   node scripts/reprice-unpaid.mjs --apply    # write it
 *
 * Only unpaid charges are considered. A settled charge is money someone has
 * already handed over; correcting one silently moves that amount, so if a paid
 * charge is wrong the fix is a wallet entry, not a rewrite. Deleted charges are
 * left out too: nobody owes them, so there is nothing to reprice.
 *
 * Rates come from the deployed app's own /api/exchange-rate, the endpoint the
 * billing run itself asks, so a repriced charge lands on exactly the figure a
 * freshly billed one would: the same source, the same rounding, every currency
 * billing knows, and production's FX_MARKUP rather than a local guess at it. A
 * month the endpoint cannot answer from published history is skipped, not
 * priced from a fallback. PLAYGROUND_URL points it at another deployment.
 *
 * Reads credentials from .env.production (NEXT_PUBLIC_SUPABASE_URL and
 * SUPABASE_SERVICE_ROLE_KEY).
 */
import { readFileSync } from "node:fs";

const APPLY = process.argv.includes("--apply");
const APP = (process.env.PLAYGROUND_URL ?? "https://playground.noahyao.me").replace(/\/$/, "");
const PAGE = 1000;

function env() {
  const out = {};
  for (const line of readFileSync(".env.production", "utf8").split("\n")) {
    const m = line.match(/^([A-Z0-9_]+)=(.*)$/);
    if (!m) continue;
    // Values are quoted and may carry an escaped newline from `vercel env pull`.
    out[m[1]] = m[2].replace(/^"|"$/g, "").replace(/\\n$/, "").trim();
  }
  return out;
}

const { NEXT_PUBLIC_SUPABASE_URL: URL_, SUPABASE_SERVICE_ROLE_KEY: KEY } = env();
if (!URL_ || !KEY) {
  console.error("Missing NEXT_PUBLIC_SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY in .env.production");
  process.exit(1);
}
const base = URL_.replace(/\/$/, "");
const headers = { apikey: KEY, Authorization: `Bearer ${KEY}`, "Content-Type": "application/json" };

// Four decimals near 1, six significant digits below it -- JPY sits near 0.042,
// where four decimals would hide the digits that were just corrected.
const fmtRate = (n) => (n >= 1 ? n.toFixed(4) : n.toPrecision(6));

let markup = null;
const rateCache = new Map();
/** Settlement rates for a billing month, asked the way billing asks: for the 1st,
 *  which the endpoint resolves back to the last trading day before it. Null when
 *  the answer is not published history. */
async function ratesFor(month) {
  if (rateCache.has(month)) return rateCache.get(month);
  const res = await fetch(`${APP}/api/exchange-rate?date=${month}-01`);
  if (!res.ok) throw new Error(`Rate lookup failed for ${month}: ${res.status}`);
  const d = await res.json();
  // Anything but "historical" is a fallback: a cached live rate, the last one
  // recorded, a constant. Good enough to keep billing moving; not good enough
  // to correct a charge with after the fact.
  const out = d.source === "historical" ? d.rates : null;
  if (out && markup === null) markup = d.markup;
  rateCache.set(month, out);
  return out;
}

/** Every unpaid, live charge, a page at a time: PostgREST caps a response and
 *  says nothing when it does. id breaks period_start ties, so a page boundary
 *  cannot fall between tied rows and drop or repeat one. */
async function unpaidCharges() {
  const rows = [];
  for (let offset = 0; ; offset += PAGE) {
    const res = await fetch(
      `${base}/rest/v1/charges?paid=eq.false&deleted_at=is.null` +
        `&select=id,period_start,currency,monthly_cost,months,exchange_rate,total_cny,subscriber_id,service_id,label` +
        `&order=period_start,id&offset=${offset}&limit=${PAGE}`,
      { headers },
    );
    if (!res.ok) { console.error(`Fetch failed: ${res.status} ${await res.text()}`); process.exit(1); }
    const page = await res.json();
    rows.push(...page);
    if (page.length < PAGE) return rows;
  }
}

const charges = await unpaidCharges();

console.log(`${charges.length} unpaid charge(s), priced by ${APP}/api/exchange-rate. ${APPLY ? "APPLYING" : "dry run — nothing will be written"}\n`);
console.log("period   cur   amount    old rate → new rate   old ¥      new ¥      delta");
console.log("-".repeat(78));

const planned = [];
let oldSum = 0, newSum = 0;
for (const c of charges) {
  const rates = await ratesFor(String(c.period_start));
  const rate = rates?.[c.currency];
  if (!rate) {
    console.log(`${c.period_start}  ${c.currency}  — ${rates ? "no rate for this currency" : "no published rate for this month"}, skipped`);
    continue;
  }

  const months = Number(c.months) || 1;
  const newTotal = Number((Number(c.monthly_cost) * months * rate).toFixed(2));
  const oldTotal = Number(c.total_cny);
  oldSum += oldTotal; newSum += newTotal;
  // Both sides come out of the same rounding, so equal means equal.
  if (Math.abs(newTotal - oldTotal) < 0.005 && rate === Number(c.exchange_rate)) continue;

  planned.push({ id: c.id, rate, newTotal });
  const d = newTotal - oldTotal;
  console.log(
    `${c.period_start}  ${c.currency}  ${String(c.monthly_cost).padStart(7)}   ` +
    `${fmtRate(Number(c.exchange_rate))} → ${fmtRate(rate)}   ` +
    `${oldTotal.toFixed(2).padStart(8)}  ${newTotal.toFixed(2).padStart(8)}  ${(d >= 0 ? "+" : "") + d.toFixed(2)}`,
  );
}

console.log("-".repeat(78));
console.log(`${planned.length} would change. Total ¥${oldSum.toFixed(2)} → ¥${newSum.toFixed(2)} (${(newSum - oldSum >= 0 ? "+" : "") + (newSum - oldSum).toFixed(2)})${markup === null ? "" : `. Markup ×${markup}`}`);

if (!APPLY) { console.log("\nRe-run with --apply to write these."); process.exit(0); }
if (planned.length === 0) { console.log("\nNothing to do."); process.exit(0); }

let done = 0;
for (const p of planned) {
  // paid and deleted_at are checked again here on purpose: a charge settled or
  // deleted between the read above and this write must not be repriced.
  const r = await fetch(`${base}/rest/v1/charges?id=eq.${p.id}&paid=eq.false&deleted_at=is.null`, {
    method: "PATCH", headers: { ...headers, Prefer: "return=representation" },
    body: JSON.stringify({ exchange_rate: p.rate, total_cny: p.newTotal }),
  });
  if (!r.ok) { console.error(`  failed ${p.id}: ${r.status} ${await r.text()}`); continue; }
  // An empty answer is the guard matching nothing, which a bare 2xx would hide.
  if ((await r.json()).length > 0) done++;
  else console.log(`  skipped ${p.id}: settled or deleted since it was read`);
}
console.log(`\nUpdated ${done}/${planned.length}.`);
