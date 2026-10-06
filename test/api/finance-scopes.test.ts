import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";
import { FINANCE_OWNER } from "@/lib/access";
import { sha256Hex } from "@/lib/finance-server";
import { DEFAULT_INPUTS } from "@/lib/housing";
import type { TokenScope } from "@/lib/finance-access";
import { startPostgrest, type StandIn } from "../helpers/postgrest";

const session = vi.hoisted(()=>({current:null as {user:{email:string}} | null}));
vi.mock("@/lib/auth",()=>({auth:async()=>session.current}));
const TOKENS = await import("@/app/api/finance/tokens/route");
const FINANCE = await import("@/app/api/finance/route");
const SUMMARY = await import("@/app/api/finance/summary/route");
const HOUSING = await import("@/app/api/housing/route");
const ANALYSIS = await import("@/app/api/housing/analysis/route");
const CHART = await import("@/app/api/housing/chart/route");
const SPEC = await import("@/app/api/finance/openapi/route");
const HOUSING_SPEC = await import("@/app/api/housing/openapi/route");
const TOKEN="invented-test-scoped-token-over-32-characters";
const ID="00000000-0000-0000-0000-000000000077";
let db: StandIn;
const req=(path: string,body?:unknown,token: string|undefined=TOKEN)=>new NextRequest(`https://example.com${path}`,{
  method:body===undefined ? "GET":"POST",headers:{...(token ? {authorization:`Bearer ${token}`} : {}),"content-type":"application/json"},...(body===undefined ? {} : {body:JSON.stringify(body)}),
});
beforeEach(async()=>{
  session.current=null;
  db=await startPostgrest({finance_api_tokens:[],finance_accounts:[],finance_balances:[],housing_market:[],housing_sources:[],housing_scenarios:[],housing_projects:[]});
  vi.stubEnv("NEXT_PUBLIC_SUPABASE_URL",db.url);vi.stubEnv("SUPABASE_SERVICE_ROLE_KEY","stand-in");vi.stubEnv("FINANCE_API_TOKEN",undefined);
});
afterEach(async()=>{vi.unstubAllEnvs();await db.close();});
const grant=(scope:TokenScope)=>db.tables.finance_api_tokens.push({id:ID,name:"Test",token_sha256:sha256Hex(TOKEN),scope});

describe("scoped agent access",()=>{
  it("defaults newly minted tokens to finance and housing read-only",async()=>{
    session.current={user:{email:FINANCE_OWNER}};
    const made=await TOKENS.POST(req("/api/finance/tokens",{},undefined));
    expect(made.status).toBe(201);
    const body=await made.json();
    expect(body.scope).toBe("finance:read");
    session.current=null;
    expect((await FINANCE.GET(req("/api/finance",undefined,body.token))).status).toBe(200);
    expect((await FINANCE.POST(req("/api/finance",{action:"createAccount"},body.token))).status).toBe(403);
    expect(db.tables.finance_accounts).toHaveLength(0);
  });
  it.each(["housing:read","finance:read"] as TokenScope[])("%s can read and run POST what-ifs, but every mutation is refused before business data is touched",async(scope)=>{
    grant(scope);
    expect((await HOUSING.GET(req("/api/housing"))).status).toBe(200);
    expect((await ANALYSIS.POST(req("/api/housing/analysis",{inputs:{...DEFAULT_INPUTS,years:1},simulation:false}))).status).toBe(200);
    const chart=await CHART.POST(req("/api/housing/chart",{inputs:{...DEFAULT_INPUTS,years:1},chart:"wealth"}));
    expect(chart.status).toBe(200);expect(await chart.text()).toContain("<svg");
    db.requests.length=0;
    for(const action of ["saveScenario","deleteScenario","followProject","unfollowProject","refresh"]) expect((await HOUSING.POST(req("/api/housing",{action}))).status).toBe(403);
    expect((await FINANCE.POST(req("/api/finance",{action:"deleteAccount"}))).status).toBe(403);
    expect(db.requests.every(r=>r.table==="finance_api_tokens" && r.method==="GET")).toBe(true);
    expect((await TOKENS.POST(req("/api/finance/tokens",{}))).status).toBe(401);
    expect((await TOKENS.DELETE(new NextRequest(`https://example.com/api/finance/tokens?id=${ID}`,{method:"DELETE",headers:{authorization:`Bearer ${TOKEN}`}}))).status).toBe(401);
  });
  it("housing-only cannot read finance, and a limited bearer cannot borrow authority from an owner cookie",async()=>{
    grant("housing:read");session.current={user:{email:FINANCE_OWNER}};
    db.requests.length=0;
    expect((await FINANCE.GET(req("/api/finance"))).status).toBe(403);
    expect((await SUMMARY.GET(req("/api/finance/summary"))).status).toBe(403);
    expect(db.requests.every(r=>r.table==="finance_api_tokens")).toBe(true);
    expect((await FINANCE.GET(req("/api/finance",undefined,"a-revoked-or-invalid-token-over-32-characters"))).status).toBe(401);
  });
  it("exposes only allowed operations, retaining read-only POSTs and valid schema references",async()=>{
    grant("housing:read");
    for(const get of [SPEC.GET,HOUSING_SPEC.GET]) {
      const spec=await (await get(req("/api/housing/openapi"))).json();
      expect(Object.keys(spec.paths).every(p=>p.startsWith("/api/housing"))).toBe(true);
      expect(spec.paths["/api/housing"].post).toBeUndefined();
      expect(spec.paths["/api/housing/analysis"].post["x-openai-isConsequential"]).toBe(false);
      expect(spec.paths["/api/housing/chart"].post).toBeDefined();
      expect(spec.components.schemas.Housing_saveScenario).toBeUndefined();
      const refs=JSON.stringify(spec).matchAll(/"\$ref":"#\/components\/schemas\/([^"\s]+)"/g);
      for(const ref of refs) expect(spec.components.schemas[ref[1]]).toBeDefined();
    }
    session.current={user:{email:FINANCE_OWNER}};
    const doc=await (await HOUSING_SPEC.GET(new NextRequest("https://example.com/api/housing/openapi?read_only=true"))).json();
    expect(doc.paths["/api/housing"].post).toBeUndefined();
    expect(JSON.stringify(doc)).not.toContain(TOKEN);
  });
  it("preserves old tokens before the additive migration, but refuses to mint downgraded read-only tokens",async()=>{
    db.tables.finance_api_tokens.push({id:ID,name:"Legacy",token_sha256:sha256Hex(TOKEN)});
    const legacy=await startPostgrest(db.tables,{intercept:r=>r.table==="finance_api_tokens" && (r.params.get("select")?.includes("scope") || r.method==="POST") ? {status:400,body:{code:"42703",message:"column finance_api_tokens.scope does not exist"}} : undefined});
    vi.stubEnv("NEXT_PUBLIC_SUPABASE_URL",legacy.url);
    try {
      expect((await HOUSING.GET(req("/api/housing"))).status).toBe(200);
      expect((await FINANCE.POST(req("/api/finance",{action:"not-real"}))).status).toBe(400);
      session.current={user:{email:FINANCE_OWNER}};
      const tokens=await (await TOKENS.GET()).json();expect(tokens.tokens[0].scope).toBe("finance:write");
      const made=await TOKENS.POST(req("/api/finance/tokens",{scope:"housing:read"},undefined));
      expect(made.status).toBe(503);expect(await made.text()).not.toContain("pgf_");
      expect(db.tables.finance_api_tokens).toHaveLength(1);
    } finally {await legacy.close();}
  });
  it("fails closed for corrupt scopes and every other lookup error, and rejects arbitrary scopes when minting",async()=>{
    grant("finance:read");db.tables.finance_api_tokens[0].scope="unexpected";
    expect((await HOUSING.GET(req("/api/housing"))).status).toBe(401);
    const broken=await startPostgrest(db.tables,{intercept:r=>r.table==="finance_api_tokens" ? {status:500,body:{code:"42703",message:"another column failed"}} : undefined});
    vi.stubEnv("NEXT_PUBLIC_SUPABASE_URL",broken.url);
    try {expect((await HOUSING.GET(req("/api/housing"))).status).toBe(401);expect(broken.requests).toHaveLength(1);} finally {await broken.close();}
    vi.stubEnv("NEXT_PUBLIC_SUPABASE_URL",db.url);session.current={user:{email:FINANCE_OWNER}};
    expect((await TOKENS.POST(req("/api/finance/tokens",{scope:"all"},undefined))).status).toBe(400);
  });
});
