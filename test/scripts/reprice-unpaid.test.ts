import { execFile } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { promisify } from "node:util";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { calls, startPostgrest, type Row, type StandIn } from "../helpers/postgrest";

const run = promisify(execFile);
const SCRIPT = resolve("scripts/reprice-unpaid.mjs");

const unpaid = (id: string, period_start: string, currency: string, monthly_cost: number, exchange_rate: number, total_cny: number): Row =>
  ({ id, period_start, currency, monthly_cost, months: 1, exchange_rate, total_cny, paid: false, deleted_at: null });

let db: StandIn;
let dir: string;
beforeEach(async () => {
  const charges: Row[] = Array.from({ length: 1000 }, (_, i) =>
    unpaid(`f${String(i).padStart(4, "0")}`, "2026-01", "SGD", 10, 5.3, 53)); // already right
  charges.push(
    unpaid("c-jpy", "2026-01", "JPY", 12000, 0.0425, 510),
    unpaid("c-usd", "2026-02", "USD", 20, 7.25, 145),
    unpaid("c-eur", "2026-02", "EUR", 10, 7.8, 78),
    unpaid("c-mar", "2026-03", "SGD", 10, 5.1, 51),
    unpaid("c-raced", "2026-02", "SGD", 10, 5.0, 50),
    { ...unpaid("c-paid", "2026-02", "SGD", 10, 1, 10), paid: true },
    { ...unpaid("c-deleted", "2026-02", "SGD", 10, 1, 10), deleted_at: "2026-02-10T00:00:00Z" },
  );
  const rates: Record<string, Row> = {
    "2026-01-01": { rates: { USD: 7.2, SGD: 5.3, JPY: 0.0461234 }, source: "historical", markup: 1.01 },
    "2026-02-01": { rates: { USD: 7.1, SGD: 5.25, JPY: 0.0459876 }, source: "historical", markup: 1.01 },
    "2026-03-01": { rates: { USD: 6.72, SGD: 5.3, JPY: 0.0425 }, source: "last-resort", markup: 1.01 },
  };
  db = await startPostgrest({ charges }, {
    other: (req) => req.path === "/api/exchange-rate"
      ? { status: 200, body: rates[req.params.get("date") ?? ""] ?? {} }
      : undefined,
    // Settled by someone else between the script's read and its write.
    intercept: (req) => req.method === "PATCH" && req.params.get("id") === "eq.c-raced"
      ? { status: 200, body: [] }
      : undefined,
  });
  dir = mkdtempSync(join(tmpdir(), "reprice-"));
  writeFileSync(join(dir, ".env.production"), `NEXT_PUBLIC_SUPABASE_URL="${db.url}"\nSUPABASE_SERVICE_ROLE_KEY="stand-in"\n`);
});
afterEach(async () => {
  await db.close();
  rmSync(dir, { recursive: true, force: true });
});

const reprice = (...args: string[]) =>
  run(process.execPath, [SCRIPT, ...args], { cwd: dir, env: { ...process.env, PLAYGROUND_URL: db.url } });

describe("scripts/reprice-unpaid.mjs", () => {
  it("prices from the app's own rate endpoint, JPY included, and skips what it cannot price honestly", async () => {
    const { stdout } = await reprice();
    expect(stdout).toContain("1005 unpaid charge(s)");
    expect(stdout).toMatch(/2026-01 {2}JPY {4}12000 {3}0\.0425000 → 0\.0461234 {5}510\.00 {4}553\.48 {2}\+43\.48/);
    expect(stdout).toMatch(/2026-02 {2}USD .* 145\.00 {4}142\.00 {2}-3\.00/);
    expect(stdout).toContain("2026-02  EUR  — no rate for this currency, skipped");
    expect(stdout).toContain("2026-03  SGD  — no published rate for this month, skipped");
    expect(stdout).toContain("3 would change.");
    expect(stdout).toContain("Markup ×1.01");
    // A dry run writes nothing.
    expect(calls(db, "charges").filter((c) => c.startsWith("PATCH"))).toHaveLength(0);
  });

  it("reads unpaid, undeleted charges a page at a time", async () => {
    await reprice();
    expect(calls(db, "charges")).toEqual([
      "GET paid=eq.false&deleted_at=is.null&order=period_start,id&offset=0&limit=1000",
      "GET paid=eq.false&deleted_at=is.null&order=period_start,id&offset=1000&limit=1000",
    ]);
  });

  it("writes with the paid and deleted guards, and reports a charge settled in between as skipped", async () => {
    const { stdout } = await reprice("--apply");
    const patches = calls(db, "charges").filter((c) => c.startsWith("PATCH"));
    // In the order read: period_start, then id.
    expect(patches).toEqual([
      "PATCH id=eq.c-jpy&paid=eq.false&deleted_at=is.null",
      "PATCH id=eq.c-raced&paid=eq.false&deleted_at=is.null",
      "PATCH id=eq.c-usd&paid=eq.false&deleted_at=is.null",
    ]);
    expect(stdout).toContain("skipped c-raced: settled or deleted since it was read");
    expect(stdout).toContain("Updated 2/3.");
    const jpy = db.tables.charges.find((c) => c.id === "c-jpy")!;
    expect([jpy.exchange_rate, jpy.total_cny]).toEqual([0.0461234, 553.48]);
  });
});
