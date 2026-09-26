import { readFileSync } from "node:fs";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";
import { calls, startPostgrest, type StandIn } from "../helpers/postgrest";

const { GET } = await import("@/app/api/cron/keepalive/route");

let db: StandIn;
let down: boolean;
beforeEach(async () => {
  down = false;
  db = await startPostgrest({ subscribers: [{ id: "a", name: "Alice" }] }, {
    intercept: () => (down ? { status: 503, body: { message: "upstream unavailable" } } : undefined),
  });
  vi.stubEnv("NEXT_PUBLIC_SUPABASE_URL", db.url);
  vi.stubEnv("SUPABASE_SERVICE_ROLE_KEY", "stand-in");
  vi.stubEnv("CRON_SECRET", "cron-secret");
});

afterEach(async () => {
  vi.unstubAllEnvs();
  await db.close();
});

const run = async (auth = "Bearer cron-secret") => {
  const res = await GET(new NextRequest("http://localhost/api/cron/keepalive", { headers: auth ? { authorization: auth } : {} }));
  return { status: res.status, body: await res.json() };
};

describe("the keepalive", () => {
  it("answers only a caller holding CRON_SECRET", async () => {
    expect((await run("Bearer wrong")).status).toBe(401);
    expect((await run("")).status).toBe(401);
    vi.stubEnv("CRON_SECRET", undefined);
    expect((await run()).status).toBe(500);
    expect(db.requests).toHaveLength(0);
  });

  it("reads one row -- any query resets the project's idle clock -- and says it did", async () => {
    expect(await run()).toEqual({ status: 200, body: { ok: true } });
    expect(calls(db, "subscribers")).toEqual(["GET limit=1"]);
  });

  it("fails when the database does not answer, so a paused project is not reported as awake", async () => {
    down = true;
    const { status, body } = await run();
    expect(status).toBe(500);
    expect(body.error).toContain("upstream unavailable");
  });
});

describe("vercel.json", () => {
  it("runs the keepalive once a day, the most the Hobby plan allows, as a backstop to the workflow", () => {
    const { crons } = JSON.parse(readFileSync("vercel.json", "utf8"));
    expect(crons).toContainEqual({ path: "/api/cron/keepalive", schedule: "23 13 * * *" });
  });
});
