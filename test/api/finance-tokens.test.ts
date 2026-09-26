import { createHash } from "node:crypto";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";
import { startPostgrest, type Row, type StandIn } from "../helpers/postgrest";

const session = vi.hoisted(() => ({ current: null as { user: { email: string } } | null }));
vi.mock("@/lib/auth", () => ({ auth: async () => session.current }));

const TOKENS = await import("@/app/api/finance/tokens/route");
const FINANCE = await import("@/app/api/finance/route");
const { GET: SUMMARY } = await import("@/app/api/finance/summary/route");

const OWNER = { user: { email: "hi@noahyao.me" } };
const sha256 = (s: string) => createHash("sha256").update(s).digest("hex");
const account = { name: "DBS", region: "SG", currency: "SGD", kind: "asset", category: "cash" };

let db: StandIn;
beforeEach(async () => {
  session.current = OWNER;
  db = await startPostgrest({ finance_accounts: [], finance_balances: [], finance_api_tokens: [] });
  vi.stubEnv("NEXT_PUBLIC_SUPABASE_URL", db.url);
  vi.stubEnv("SUPABASE_SERVICE_ROLE_KEY", "stand-in");
  vi.stubEnv("FINANCE_API_TOKEN", undefined);
});

afterEach(async () => {
  vi.unstubAllEnvs();
  await db.close();
});

const request = (method: string, path: string, { body, token }: { body?: unknown; token?: string } = {}) =>
  new NextRequest(`http://localhost${path}`, {
    method,
    headers: { ...(body ? { "content-type": "application/json" } : {}), ...(token ? { authorization: `Bearer ${token}` } : {}) },
    body: body ? JSON.stringify(body) : undefined,
  });
const answer = async (res: Response) => ({ status: res.status, body: await res.json() });
const make = async (body: unknown = {}) => answer(await TOKENS.POST(request("POST", "/api/finance/tokens", { body })));
const list = async () => answer(await TOKENS.GET());
const revoke = async (id: string) => answer(await TOKENS.DELETE(request("DELETE", `/api/finance/tokens?id=${id}`)));

/** What an agent holding `token`, and no session, gets back from each finance route. */
async function asAgent(token: string) {
  const was = session.current;
  session.current = null;
  try {
    return [
      (await FINANCE.GET(request("GET", "/api/finance", { token }))).status,
      (await SUMMARY(request("GET", "/api/finance/summary", { token }))).status,
      (await FINANCE.POST(request("POST", "/api/finance", { token, body: { action: "createAccount", account } }))).status,
    ];
  } finally {
    session.current = was;
  }
}

describe("making a token", () => {
  it("shows the token once, and keeps only its hash", async () => {
    const { status, body } = await make({ name: " Laptop agent " });
    expect(status).toBe(201);
    expect(body.token).toMatch(/^pgf_[A-Za-z0-9_-]{43}$/);
    expect(body.name).toBe("Laptop agent");
    const [stored] = db.tables.finance_api_tokens;
    expect(stored.token_sha256).toBe(sha256(body.token));
    expect(JSON.stringify(db.tables.finance_api_tokens)).not.toContain(body.token);
  });

  it("never shows it, or its hash, again", async () => {
    const made = (await make({ name: "Laptop agent" })).body;
    const { status, body } = await list();
    expect(status).toBe(200);
    expect(body.tokens).toEqual([{ id: made.id, name: "Laptop agent" }]);
    expect(JSON.stringify(body)).not.toMatch(/pgf_|token_sha256|[0-9a-f]{64}/);
  });

  it("makes a different one each time, named Agent when not named", async () => {
    const a = (await make()).body, b = (await make({ name: "   " })).body;
    expect([a.name, b.name]).toEqual(["Agent", "Agent"]);
    expect(a.token).not.toBe(b.token);
    expect((await make({ name: "x".repeat(61) })).status).toBe(400);
  });
});

describe("a token made here", () => {
  it("lets an agent read and write as the owner, with no session", async () => {
    const { token } = (await make()).body;
    expect(await asAgent(token)).toEqual([200, 200, 200]);
    expect(db.tables.finance_accounts).toHaveLength(1);
  });

  it("stops working the moment it is revoked, and the others go on", async () => {
    const kept = (await make({ name: "kept" })).body, gone = (await make({ name: "gone" })).body;
    expect(await revoke(gone.id)).toEqual({ status: 200, body: { revoked: gone.id } });
    expect(await asAgent(gone.token)).toEqual([401, 401, 401]);
    expect(await asAgent(kept.token)).toEqual([200, 200, 200]);
    expect((await revoke(gone.id)).status).toBe(404);
    expect((await revoke("not-an-id")).status).toBe(400);
  });

  it("lets nobody in when it cannot be looked up -- the table not there yet, the database down", async () => {
    const { token } = (await make()).body;
    const broken = await startPostgrest(db.tables, {
      intercept: (req) => (req.table === "finance_api_tokens"
        ? { status: 404, body: { code: "42P01", message: "relation \"finance_api_tokens\" does not exist" } }
        : undefined),
    });
    vi.stubEnv("NEXT_PUBLIC_SUPABASE_URL", broken.url);
    expect(await asAgent(token)).toEqual([401, 401, 401]);
    await broken.close();
  });

  it("is looked up only when one is offered, and one too short to be ours is never looked up", async () => {
    session.current = null;
    await FINANCE.GET(request("GET", "/api/finance"));
    await FINANCE.GET(request("GET", "/api/finance", { token: "short" }));
    expect(db.requests.filter((r: { table: string }) => r.table === "finance_api_tokens")).toHaveLength(0);
  });
});

describe("managing tokens", () => {
  it("takes the owner signed in -- not a stranger, not signed out, and not a token, which could otherwise outlive its revoking", async () => {
    const { token, id } = (await make()).body;
    for (const who of [null, { user: { email: "someone@else.com" } }]) {
      session.current = who;
      expect((await list()).status).toBe(401);
      expect((await make()).status).toBe(401);
      expect((await revoke(id)).status).toBe(401);
    }
    session.current = null;
    const withToken = await TOKENS.POST(request("POST", "/api/finance/tokens", { token, body: {} }));
    expect(withToken.status).toBe(401);
    expect(db.tables.finance_api_tokens as Row[]).toHaveLength(1);
  });
});
