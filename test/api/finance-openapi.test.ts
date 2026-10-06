import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";
import { FINANCE_ACTIONS } from "@/lib/finance-openapi";
import { CATEGORIES, KINDS, LOAN_METHODS, REGIONS } from "@/lib/finance";
import { FINANCE_CURRENCIES } from "@/lib/fx";
import { RSU_PLANS } from "@/lib/rsu";

type Spec = {
  openapi: string;
  servers: Array<{ url: string }>;
  paths: Record<string, Record<string, { responses: Record<string, unknown>; security?: unknown[] }>>;
  components: { schemas: Record<string, { properties?: Record<string, { enum?: string[] }> }> };
};

const session = vi.hoisted(() => ({ current: null as { user: { email: string } } | null }));
vi.mock("@/lib/auth", () => ({ auth: async () => session.current }));
const { GET } = await import("@/app/api/finance/openapi/route");

const TOKEN = "3f9a0c1e7b2d4a6f8e0c2b4d6f8a0c1e3b5d7f9a1c3e5b7d9f1a3c5e7b9d1f3a";
beforeEach(() => { session.current = { user: { email: "hi@noahyao.me" } }; });
afterEach(() => { vi.unstubAllEnvs(); });

async function spec(url = "https://playground.noahyao.me/api/finance/openapi", headers: Record<string, string> = {}): Promise<{ status: number; cache: string | null; body: Spec }> {
  const res = await GET(new NextRequest(url, { headers }));
  return { status: res.status, cache: res.headers.get("cache-control"), body: await res.json() };
}

/** Every "$ref" anywhere in the document. */
function refs(node: unknown, found: string[] = []): string[] {
  if (Array.isArray(node)) node.forEach((n) => refs(n, found));
  else if (node && typeof node === "object") {
    for (const [key, value] of Object.entries(node)) {
      if (key === "$ref" && typeof value === "string") found.push(value);
      else refs(value, found);
    }
  }
  return found;
}

describe("the OpenAPI description", () => {
  it("is the owner's, as everything else is: to anyone else it would say the accounts are here", async () => {
    session.current = null;
    expect((await spec()).status).toBe(401);
    session.current = { user: { email: "someone@else.com" } };
    expect((await spec()).status).toBe(401);
    session.current = null;
    vi.stubEnv("FINANCE_API_TOKEN", TOKEN);
    expect((await spec(undefined, { authorization: `Bearer ${TOKEN}` })).status).toBe(200);
  });

  it("is not cached, and describes the host it was asked on", async () => {
    const { status, cache, body } = await spec("https://preview.example.vercel.app/api/finance/openapi");
    expect(status).toBe(200);
    expect(cache).toBe("private, no-store");
    expect(body.openapi).toBe("3.1.0");
    expect(body.servers).toEqual([{ url: "https://preview.example.vercel.app" }]);
    // Every path takes the token, the description's included.
    for (const path of Object.values(body.paths)) for (const op of Object.values(path)) expect(op.security).toBeUndefined();
  });

  it("points nowhere that does not exist", async () => {
    const { body } = await spec();
    const all = refs(body);
    expect(all.length).toBeGreaterThan(10);
    for (const ref of all) {
      const name = ref.replace("#/components/schemas/", "");
      expect(body.components.schemas[name], ref).toBeDefined();
    }
  });

  it("lets an agent discover housing from the existing finance document", async () => {
    const { body } = await spec();
    expect(body.paths["/api/housing"]?.get).toBeDefined();
    expect(body.paths["/api/housing"]?.post).toBeDefined();
    expect(body.paths["/api/housing/openapi"]?.get).toBeDefined();
  });

  it("offers exactly the actions the route takes, each by its own schema", async () => {
    const { body } = await spec();
    const post = body.paths["/api/finance"].post as unknown as {
      requestBody: { content: { "application/json": { schema: { discriminator: { mapping: Record<string, string> } } } } };
    };
    const mapping = post.requestBody.content["application/json"].schema.discriminator.mapping;
    expect(Object.keys(mapping)).toEqual([...FINANCE_ACTIONS]);
    for (const action of FINANCE_ACTIONS) {
      const schema = body.components.schemas[action] as { properties: { action: { const: string } } };
      expect(schema.properties.action.const).toBe(action);
    }
  });

  it("lists the values the route accepts, taken from the code rather than copied", async () => {
    const { body } = await spec();
    const account = body.components.schemas.Account.properties!;
    expect(account.region.enum).toEqual([...REGIONS]);
    expect(account.kind.enum).toEqual([...KINDS]);
    expect(account.currency.enum).toEqual([...FINANCE_CURRENCIES]);
    expect(new Set(account.category.enum)).toEqual(new Set(KINDS.flatMap((k) => Object.keys(CATEGORIES[k]))));
    expect(account.loan_method.enum).toEqual([...LOAN_METHODS, null]);
    expect(account.rsu_plan.enum).toEqual([...RSU_PLANS, null]);
  });
});
