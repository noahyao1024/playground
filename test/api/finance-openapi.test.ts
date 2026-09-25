import { describe, expect, it } from "vitest";
import { NextRequest } from "next/server";
import { GET } from "@/app/api/finance/openapi/route";
import { FINANCE_ACTIONS } from "@/lib/finance-openapi";
import { CATEGORIES, KINDS, LOAN_METHODS, REGIONS } from "@/lib/finance";
import { FINANCE_CURRENCIES } from "@/lib/fx";

type Spec = {
  openapi: string;
  servers: Array<{ url: string }>;
  paths: Record<string, Record<string, { responses: Record<string, unknown>; security?: unknown[] }>>;
  components: { schemas: Record<string, { properties?: Record<string, { enum?: string[] }> }> };
};

async function spec(url = "https://playground.noahyao.me/api/finance/openapi"): Promise<{ status: number; cache: string | null; body: Spec }> {
  const res = GET(new NextRequest(url));
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
  it("is public, cacheable, and describes the host it was asked on", async () => {
    const { status, cache, body } = await spec("https://preview.example.vercel.app/api/finance/openapi");
    expect(status).toBe(200);
    expect(cache).toBe("public, max-age=300");
    expect(body.openapi).toBe("3.1.0");
    expect(body.servers).toEqual([{ url: "https://preview.example.vercel.app" }]);
    // The description itself needs no token; everything else does.
    expect(body.paths["/api/finance/openapi"].get.security).toEqual([]);
    expect(body.paths["/api/finance/summary"].get.security).toBeUndefined();
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
  });
});
