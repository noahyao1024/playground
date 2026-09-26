import { readFileSync } from "node:fs";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";
import { calls, startPostgrest, type StandIn } from "../helpers/postgrest";

// No mail leaves a test: the transport is a recorder.
const sent = vi.hoisted(() => ({ mails: [] as unknown[], transports: [] as unknown[], fail: null as Error | null }));
vi.mock("nodemailer", () => ({
  default: {
    createTransport: (options: unknown) => {
      sent.transports.push(options);
      return { sendMail: async (mail: unknown) => { if (sent.fail) throw sent.fail; sent.mails.push(mail); } };
    },
  },
}));

const { GET } = await import("@/app/api/cron/daily/route");

let db: StandIn;
const charge = (id: string, subscriber_id: string, total_cny: number, extra: Record<string, unknown> = {}) =>
  ({ id, subscriber_id, total_cny, period_start: "2026-09", paid: false, deleted_at: null, ...extra });

beforeEach(async () => {
  sent.mails = []; sent.transports = []; sent.fail = null;
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
  for (const name of ["SMTP_USERNAME", "SMTP_PASSWORD", "ALERT_TO", "MAIL_FROM", "SMTP_SERVER", "SMTP_PORT", "UNPAID_THRESHOLD_CNY"]) {
    vi.stubEnv(name, undefined);
  }
});

afterEach(async () => {
  vi.unstubAllEnvs();
  await db.close();
});

const run = async (auth = "Bearer cron-secret", query = "") => {
  const res = await GET(new NextRequest(`http://localhost/api/cron/daily${query}`, { headers: auth ? { authorization: auth } : {} }));
  return { status: res.status, body: await res.json() };
};
const smtp = () => {
  vi.stubEnv("SMTP_USERNAME", "me@example.com");
  vi.stubEnv("SMTP_PASSWORD", "app-password");
};

describe("the daily job", () => {
  it("answers only a caller holding CRON_SECRET", async () => {
    expect((await run("Bearer wrong")).status).toBe(401);
    expect((await run("")).status).toBe(401);
    expect((await run("cron-secret")).status).toBe(401);
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

  it("sends nothing until SMTP is configured in Vercel, and says so", async () => {
    const { body } = await run();
    expect(body.email).toBe("not configured");
    expect(sent.mails).toHaveLength(0);
  });

  it("mails the owner through the configured server once it is", async () => {
    vi.stubEnv("SMTP_USERNAME", "me@example.com");
    vi.stubEnv("SMTP_PASSWORD", "app-password");
    vi.stubEnv("ALERT_TO", "owner@example.com");
    const { status, body } = await run();
    expect(status).toBe(200);
    expect(body.email).toBe("sent");
    expect(sent.transports).toEqual([{ host: "smtp.gmail.com", port: 465, secure: true, auth: { user: "me@example.com", pass: "app-password" } }]);
    expect(sent.mails).toEqual([{
      from: "Split Bill <me@example.com>",
      to: "owner@example.com",
      subject: "Split bill: 1 over the unpaid threshold",
      text: expect.stringContaining("Alice: ¥700.00 across 2 charge(s), oldest 2026-08"),
    }]);
  });

  it("takes the threshold, server and sender from the environment, and mails the account itself by default", async () => {
    vi.stubEnv("UNPAID_THRESHOLD_CNY", "400");
    vi.stubEnv("SMTP_USERNAME", "me@example.com");
    vi.stubEnv("SMTP_PASSWORD", "app-password");
    vi.stubEnv("SMTP_SERVER", "smtp.example.com");
    vi.stubEnv("SMTP_PORT", "587");
    vi.stubEnv("MAIL_FROM", "alerts@example.com");
    const { body } = await run();
    expect(body.over.map((o: { name: string }) => o.name)).toEqual(["Alice", "Bob"]);
    expect(sent.transports[0]).toMatchObject({ host: "smtp.example.com", port: 587, secure: false });
    expect(sent.mails[0]).toMatchObject({ from: "Split Bill <alerts@example.com>", to: "me@example.com" });
  });

  it("mails nobody when nobody is over the line", async () => {
    vi.stubEnv("UNPAID_THRESHOLD_CNY", "10000");
    vi.stubEnv("SMTP_USERNAME", "me@example.com");
    vi.stubEnv("SMTP_PASSWORD", "app-password");
    const { body } = await run();
    expect(body).toMatchObject({ over: [], email: "not needed" });
    expect(sent.mails).toHaveLength(0);
  });

  it("answers as a failed run when the mail does not go, so the workflow calling it fails too", async () => {
    vi.stubEnv("SMTP_USERNAME", "me@example.com");
    vi.stubEnv("SMTP_PASSWORD", "wrong");
    sent.fail = new Error("535 Username and Password not accepted");
    const { status, body } = await run();
    expect(status).toBe(502);
    expect(body).toMatchObject({ email: "failed", error: expect.stringContaining("535") });
    expect(body.over).toHaveLength(1);
  });
});

describe("a test run", () => {
  it("mails even when nobody is over the line, to check the setup end to end", async () => {
    vi.stubEnv("UNPAID_THRESHOLD_CNY", "10000");
    smtp();
    const { status, body } = await run(undefined, "?test=1");
    expect(status).toBe(200);
    expect(body).toMatchObject({ over: [], email: "sent" });
    expect(sent.mails).toEqual([expect.objectContaining({ subject: "Split bill: unpaid alert test", text: expect.stringContaining("¥10,000") })]);
  });

  it("sends the real alert when somebody is over it", async () => {
    smtp();
    await run(undefined, "?test=1");
    expect(sent.mails).toEqual([expect.objectContaining({ subject: "Split bill: 1 over the unpaid threshold" })]);
  });

  it("says so when there is no mail setup to test", async () => {
    vi.stubEnv("UNPAID_THRESHOLD_CNY", "10000");
    const { body } = await run(undefined, "?test=1");
    expect(body).toMatchObject({ over: [], email: "not configured" });
  });

  it("is only ?test=1: anything else is an ordinary run", async () => {
    vi.stubEnv("UNPAID_THRESHOLD_CNY", "10000");
    smtp();
    expect((await run(undefined, "?test=0")).body.email).toBe("not needed");
    expect(sent.mails).toHaveLength(0);
  });
});

describe("who calls it", () => {
  it("is the Daily jobs workflow, every day, with the secret", () => {
    const workflow = readFileSync(".github/workflows/daily-jobs.yml", "utf8");
    expect(workflow).toContain("- cron: '23 1 * * *'");
    expect(workflow).toContain("node scripts/daily-jobs.mjs");
    expect(workflow).toContain("CRON_SECRET: ${{ secrets.CRON_SECRET }}");
    expect(readFileSync("scripts/daily-jobs.mjs", "utf8")).toContain("/api/cron/daily");
  });

  it("is not Vercel Cron as well: two callers would mean two mails", () => {
    const { crons } = JSON.parse(readFileSync("vercel.json", "utf8"));
    expect(crons.map((c: { path: string }) => c.path)).not.toContain("/api/cron/daily");
  });
});
