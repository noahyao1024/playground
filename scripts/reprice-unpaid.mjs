#!/usr/bin/env node
/**
 * Reprice unpaid charges at the rate that held in their billing month.
 *
 *   node scripts/reprice-unpaid.mjs            # show what would change
 *   node scripts/reprice-unpaid.mjs --apply    # write it
 *
 * Only unpaid charges are considered. A settled charge is money someone has
 * already handed over; correcting one silently moves that amount, so if a paid
 * charge is wrong the fix is a wallet entry, not a rewrite.
 *
 * Reads credentials from .env.production (NEXT_PUBLIC_SUPABASE_URL and
 * SUPABASE_SERVICE_ROLE_KEY).
 */
import { readFileSync } from "node:fs";

const APPLY = process.argv.includes("--apply");
const MARKUP = Number(process.env.FX_MARKUP ?? 1.01);
const FX = "https://api.frankfurter.dev/v1";

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
const round4 = (n) => Math.round(n * 10000) / 10000;

const rateCache = new Map();
/** Settlement rates for a billing month: the published mid rate on its 1st, times
 *  the markup. A non-trading day resolves back to the last trading day before it. */
async function ratesFor(month) {
  if (rateCache.has(month)) return rateCache.get(month);
  const res = await fetch(`${FX}/${month}-01?base=USD&symbols=CNY,SGD`);
  if (!res.ok) throw new Error(`FX lookup failed for ${month}: ${res.status}`);
  const d = await res.json();
  const out = {
    USD: round4(d.rates.CNY * MARKUP),
    SGD: round4((d.rates.CNY / d.rates.SGD) * MARKUP),
    asOf: d.date,
  };
  rateCache.set(month, out);
  return out;
}

const res = await fetch(
  `${base}/rest/v1/charges?paid=eq.false&select=id,period_start,currency,monthly_cost,months,exchange_rate,total_cny,subscriber_id,service_id,label&order=period_start`,
  { headers },
);
if (!res.ok) { console.error(`Fetch failed: ${res.status} ${await res.text()}`); process.exit(1); }
const charges = await res.json();

console.log(`${charges.length} unpaid charge(s). Markup ×${MARKUP}. ${APPLY ? "APPLYING" : "dry run — nothing will be written"}\n`);
console.log("period   cur   amount    old rate → new rate   old ¥      new ¥      delta");
console.log("-".repeat(78));

const planned = [];
let oldSum = 0, newSum = 0;
for (const c of charges) {
  const rates = await ratesFor(String(c.period_start));
  const rate = rates[c.currency];
  if (!rate) { console.log(`${c.period_start}  ${c.currency}  — no rate, skipped`); continue; }

  const months = Number(c.months) || 1;
  const newTotal = Number((Number(c.monthly_cost) * months * rate).toFixed(2));
  const oldTotal = Number(c.total_cny);
  oldSum += oldTotal; newSum += newTotal;
  if (Math.abs(newTotal - oldTotal) < 0.005 && Math.abs(rate - Number(c.exchange_rate)) < 0.00005) continue;

  planned.push({ id: c.id, rate, newTotal });
  const d = newTotal - oldTotal;
  console.log(
    `${c.period_start}  ${c.currency}  ${String(c.monthly_cost).padStart(7)}   ` +
    `${Number(c.exchange_rate).toFixed(4)} → ${rate.toFixed(4)}   ` +
    `${oldTotal.toFixed(2).padStart(8)}  ${newTotal.toFixed(2).padStart(8)}  ${(d >= 0 ? "+" : "") + d.toFixed(2)}`,
  );
}

console.log("-".repeat(78));
console.log(`${planned.length} would change. Total ¥${oldSum.toFixed(2)} → ¥${newSum.toFixed(2)} (${(newSum - oldSum >= 0 ? "+" : "") + (newSum - oldSum).toFixed(2)})`);

if (!APPLY) { console.log("\nRe-run with --apply to write these."); process.exit(0); }
if (planned.length === 0) { console.log("\nNothing to do."); process.exit(0); }

let done = 0;
for (const p of planned) {
  // paid=eq.false is repeated here on purpose: if something settled a charge
  // between the read above and this write, it must not be repriced.
  const r = await fetch(`${base}/rest/v1/charges?id=eq.${p.id}&paid=eq.false`, {
    method: "PATCH", headers: { ...headers, Prefer: "return=minimal" },
    body: JSON.stringify({ exchange_rate: p.rate, total_cny: p.newTotal }),
  });
  if (r.ok) done++; else console.error(`  failed ${p.id}: ${r.status} ${await r.text()}`);
}
console.log(`\nUpdated ${done}/${planned.length}.`);
