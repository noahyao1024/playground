import { readFileSync } from "node:fs";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";
import { DEFAULT_INPUTS, INPUT_LIMITS, parseInputs } from "@/lib/housing";
import { CPF_PR_RULES } from "@/lib/housing-guidance";
import { sha256Hex } from "@/lib/finance-server";
import { startPostgrest, type StandIn } from "../helpers/postgrest";

const session = vi.hoisted(() => ({ current:null as {user:{email:string}} | null }));
vi.mock("@/lib/auth", () => ({auth:async()=>session.current}));
const { GET } = await import("@/app/api/housing/openapi/route");
const { GET: FINANCE_SPEC } = await import("@/app/api/finance/openapi/route");
const HOUSING = await import("@/app/api/housing/route");

const TOKEN = "test-housing-agent-token-with-at-least-32-characters";
let db: StandIn;
beforeEach(async () => {
  session.current = {user:{email:"hi@noahyao.me"}};
  db = await startPostgrest({finance_api_tokens:[],housing_market:[],housing_sources:[],housing_scenarios:[],housing_projects:[]});
  vi.stubEnv("NEXT_PUBLIC_SUPABASE_URL",db.url);
  vi.stubEnv("SUPABASE_SERVICE_ROLE_KEY","stand-in");
  vi.stubEnv("FINANCE_API_TOKEN",undefined);
});
afterEach(async () => { vi.unstubAllEnvs(); await db.close(); });

const request = (path = "/api/housing/openapi", token?: string) => new NextRequest(`https://preview.example.vercel.app${path}`,{headers:token ? {authorization:`Bearer ${token}`} : {}});
const spec = async () => (await GET(request())).json();

function refs(node: unknown, found: string[] = []): string[] {
  if (Array.isArray(node)) node.forEach(n=>refs(n,found));
  else if (node && typeof node === "object") for (const [key,value] of Object.entries(node)) {
    if (key === "$ref" && typeof value === "string") found.push(value);
    else refs(value,found);
  }
  return found;
}

describe("housing OpenAPI for agents", () => {
  it("uses the same owner and environment-token authentication as housing", async () => {
    session.current = null;
    expect((await GET(request())).status).toBe(401);
    session.current = {user:{email:"someone@else.com"}};
    expect((await GET(request())).status).toBe(401);
    expect(db.requests).toHaveLength(0);
    session.current = null;
    vi.stubEnv("FINANCE_API_TOKEN",TOKEN);
    expect((await GET(request(undefined,TOKEN))).status).toBe(200);
    expect((await GET(request(undefined,`${TOKEN}wrong`))).status).toBe(401);
  });

  it("accepts a stored finance token for both documents and housing, and revocation closes all three", async () => {
    db.tables.finance_api_tokens.push({id:"00000000-0000-0000-0000-000000000001",token_sha256:sha256Hex(TOKEN)});
    session.current = null;
    for (const route of [GET,FINANCE_SPEC,HOUSING.GET]) expect((await route(request(undefined,TOKEN))).status).toBe(200);
    db.tables.finance_api_tokens.length = 0;
    for (const route of [GET,FINANCE_SPEC,HOUSING.GET]) expect((await route(request(undefined,TOKEN))).status).toBe(401);
  });

  it("is private, describes the requested host and offers only housing operations", async () => {
    const response = await GET(request());
    const body = await response.json();
    expect(response.status).toBe(200);
    expect(response.headers.get("cache-control")).toBe("private, no-store");
    expect(body.openapi).toBe("3.1.0");
    expect(body.servers).toEqual([{url:"https://preview.example.vercel.app"}]);
    expect(body.security).toEqual([{token:[]}]);
    expect(body.components.securitySchemes.token).toMatchObject({type:"http",scheme:"bearer"});
    expect(Object.keys(body.paths).sort()).toEqual(["/api/housing","/api/housing/analysis","/api/housing/chart","/api/housing/openapi"]);
    expect(body.paths["/api/housing"].get.operationId).toBe("getHousing");
    expect(body.paths["/api/housing"].post.operationId).toBe("actOnHousing");
    expect(JSON.stringify(body)).not.toContain(TOKEN);
  });

  it("documents every action actually handled by the route, with its own request schema", async () => {
    const body = await spec();
    const route = readFileSync("src/app/api/housing/route.ts","utf8");
    const actual = Array.from(route.matchAll(/case "([^"]+)":/g),m=>m[1]);
    const schema = body.paths["/api/housing"].post.requestBody.content["application/json"].schema;
    expect(Object.keys(schema.discriminator.mapping)).toEqual(actual);
    for (const action of actual) {
      const ref = schema.discriminator.mapping[action];
      expect(schema.oneOf).toContainEqual({$ref:ref});
      const actionSchema = body.components.schemas[ref.split("/").at(-1)];
      expect(actionSchema.required).toContain("action");
      expect(actionSchema.properties.action).toMatchObject({type:"string",const:action});
    }
    expect(body.paths["/api/housing"].post.responses[200].description).toContain("failures");
    expect(body.info.description).toContain("same projections and chart rows as the page");
  });

  it("has no broken references or duplicate operation IDs in either document", async () => {
    for (const route of [GET,FINANCE_SPEC]) {
      const body = await (await route(request())).json();
      for (const ref of refs(body)) expect(body.components.schemas[ref.split("/").at(-1)!],ref).toBeDefined();
      const operations = Object.values(body.paths).flatMap(path=>Object.values(path as Record<string,{operationId:string}>).map(op=>op.operationId));
      expect(new Set(operations).size).toBe(operations.length);
    }
    const housing = await spec();
    const combined = await (await FINANCE_SPEC(request())).json();
    for (const [name,schema] of Object.entries(housing.components.schemas)) expect(combined.components.schemas[name]).toEqual(schema);
  });

  it("describes accepted input defaults and the PR-date fields", async () => {
    const body = await spec();
    const fields = body.components.schemas.HousingScenarioInputs.properties;
    const defaults = Object.fromEntries(Object.keys(DEFAULT_INPUTS).map(key=>[key,fields[key].default]));
    expect(parseInputs(defaults)).toEqual(DEFAULT_INPUTS);
    for (const [key,[min,max,whole]] of Object.entries(INPUT_LIMITS)) expect(fields[key]).toMatchObject({minimum:min,maximum:max,type:whole ? "integer" : "number"});
    const guidance = body.components.schemas.HousingGuidance;
    expect(guidance.required).toEqual(["as_of"]);
    expect(guidance.properties.cpf_rules.enum).toEqual(["2026-2027-v1",CPF_PR_RULES]);
    expect(guidance.properties.pr_since).toMatchObject({type:["string","null"],format:"date"});
    expect(guidance.properties.cpf_scheme.enum).toEqual(["graduated","full"]);
  });

  it("lets a sessionless agent save the documented example and read it back", async () => {
    vi.stubEnv("FINANCE_API_TOKEN",TOKEN);
    session.current = null;
    const body = await (await GET(request(undefined,TOKEN))).json();
    const example = body.paths["/api/housing"].post.requestBody.content["application/json"].examples.save.value;
    const saved = await HOUSING.POST(new NextRequest("https://preview.example.vercel.app/api/housing",{method:"POST",headers:{authorization:`Bearer ${TOKEN}`,"content-type":"application/json"},body:JSON.stringify(example)}));
    expect(saved.status).toBe(200);
    const written = await saved.json();
    expect(written.scenario.inputs.guidance.cpf_rules).toBe(CPF_PR_RULES);
    const read = await HOUSING.GET(request("/api/housing",TOKEN));
    const data = await read.json();
    expect(data.scenarios[0].id).toBe(written.scenario.id);
    expect(data.scenarios[0].inputs).toMatchObject(example.inputs);
    expect(Object.keys(data).sort()).toEqual(body.components.schemas.HousingData.required.sort());
  });
});
