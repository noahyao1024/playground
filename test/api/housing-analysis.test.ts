import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";
import { readFileSync } from "node:fs";
import { FINANCE_OWNER } from "@/lib/access";
import { sha256Hex } from "@/lib/finance-server";
import { housingOpenApi } from "@/lib/housing-openapi";
import { SNAPSHOT_VERSION } from "@/lib/housing-data";
import { inTodaysMoney } from "@/lib/housing";
import { resolveComparison } from "@/lib/housing-comparison";
import { PATHS, simulate, summarize } from "@/lib/housing-model";
import { housingInputs, housingMarket, housingProject } from "../helpers/housing-fixtures";
import { startPostgrest, type StandIn } from "../helpers/postgrest";

const session=vi.hoisted(()=>({current:null as {user:{email:string}} | null}));
vi.mock("@/lib/auth",()=>({auth:async()=>session.current}));
const ANALYSIS=await import("@/app/api/housing/analysis/route");
const CHART=await import("@/app/api/housing/chart/route");
const RAW=await import("@/app/api/housing/route");
const ID="00000000-0000-0000-0000-000000000012";
const TOKEN="fictional-housing-analysis-token-32-characters";
let db: StandIn;

beforeEach(async()=>{
  session.current={user:{email:FINANCE_OWNER}};
  const p=housingProject();
  const {sales,rents,...metadata}=p;
  db=await startPostgrest({
    housing_snapshot:[{id:"market",version:SNAPSHOT_VERSION,market:housingMarket()}],
    housing_scenarios:[{id:ID,name:"Fixture comparison",inputs:housingInputs(),created_at:"2026-02-01T00:00:00Z",updated_at:"2026-02-02T00:00:00Z"}],
    housing_projects:[metadata],housing_project_sales:sales.map((sale,k)=>({id:`sale-${k}`,project:p.name,...sale})),housing_project_rents:rents.map((rent,k)=>({id:`rent-${k}`,project:p.name,...rent})),finance_api_tokens:[],
  });
  vi.stubEnv("NEXT_PUBLIC_SUPABASE_URL",db.url);
  vi.stubEnv("SUPABASE_SERVICE_ROLE_KEY","stand-in");
  vi.stubEnv("FINANCE_API_TOKEN",undefined);
});
afterEach(async()=>{vi.unstubAllEnvs();await db.close();});
const req=(path="/api/housing/analysis",body?: unknown,token?: string) => new NextRequest(`https://preview.example.vercel.app${path}`,{method:body === undefined ? "GET" : "POST",headers:{...(body !== undefined ? {"content-type":"application/json"} : {}),...(token ? {authorization:`Bearer ${token}`} : {})},...(body !== undefined ? {body:JSON.stringify(body)} : {})});
const get=async(query="")=>ANALYSIS.GET(req(`/api/housing/analysis${query}`));

describe("housing analysis API",()=>{
  it("refuses anonymous / non-owner requests before reading data and accepts a bearer without a session",async()=>{
    session.current=null;
    for (const route of [ANALYSIS.GET,ANALYSIS.POST,CHART.GET,CHART.POST]) {
      const response=await route(req());
      expect(response.status).toBe(401);
      expect(response.headers.get("cache-control")).toBe("private, no-store");
    }
    session.current={user:{email:"someone@else.com"}};
    expect((await get()).status).toBe(401);
    expect(db.requests).toHaveLength(0);
    session.current=null;
    vi.stubEnv("FINANCE_API_TOKEN",TOKEN);
    expect((await ANALYSIS.GET(req(undefined,undefined,TOKEN))).status).toBe(200);
  });

  it("revokes stored-token access to both JSON and images immediately",async()=>{
    session.current=null;
    db.tables.finance_api_tokens.push({id:ID,token_sha256:sha256Hex(TOKEN),scope:"finance:write"});
    const routes=[{call:ANALYSIS.GET,path:"/api/housing/analysis"},{call:CHART.GET,path:"/api/housing/chart?chart=market:ura_ppi:OCR:non-landed"}];
    for (const route of routes) expect((await route.call(req(route.path,undefined,TOKEN))).status).toBe(200);
    db.tables.finance_api_tokens.length=0;
    db.requests.length=0;
    for (const route of routes) expect((await route.call(req(route.path,undefined,TOKEN))).status).toBe(401);
    expect(db.requests.every(r=>r.table === "finance_api_tokens")).toBe(true);
  });

  it("returns the same effective inputs, projection, chart rows and seeded futures as the page",async()=>{
    const response=await get(`?scenario_id=${ID}&project=EXAMPLE%20CONDO`);
    expect(response.status).toBe(200);
    expect(response.headers.get("cache-control")).toBe("private, no-store");
    const body=await response.json();
    const c=resolveComparison(housingInputs(),housingMarket());
    expect(body.comparison.effective_inputs).toEqual(c.resolved);
    expect(body.comparison.projection).toEqual(c.projection);
    expect(body.comparison.effective_inputs.loan_rate).not.toBe(body.comparison.inputs.loan_rate);
    expect(body.comparison.effective_inputs.annual_value).toBe(housingInputs().rent*12);
    expect(body.comparison.simulation).toEqual(summarize(simulate(c.resolved,c.model)));
    expect(body.comparison.simulation.paths).toBe(PATHS);
    const final=c.projection.years.at(-1)!;
    expect(body.comparison.summary.nominal_gap).toBe(final.buy_net_worth-final.rent_net_worth);
    expect(body.comparison.summary.todays_money_gap).toBe(inTodaysMoney(final.buy_net_worth-final.rent_net_worth,c.resolved.cost_growth,c.resolved.years));
    expect(body.comparison.summary.winner).toBe(final.buy_net_worth >= final.rent_net_worth ? "buy" : "rent");
    expect(body.charts.find((chart:{id:string})=>chart.id === "wealth").rows.at(-1)).toMatchObject({buy:final.buy_net_worth,rent:final.rent_net_worth});
    expect(body.market_charts).toHaveLength(housingMarket().series.length);
    expect(body.charts.map((chart:{id:string})=>chart.id)).toEqual(expect.arrayContaining(["wealth","gap","costs","futures","probability","sora","project-price:EXAMPLE CONDO","project-rent:EXAMPLE CONDO"]));
    expect(body.scenario).toEqual({id:ID,name:"Fixture comparison",updated_at:"2026-02-02T00:00:00Z"});
    const schemas=housingOpenApi("https://example.com").components.schemas;
    expect(Object.keys(body).sort()).toEqual([...schemas.HousingAnalysis.required].sort());
    expect(Object.keys(body.comparison.projection.years[0]).sort()).toEqual([...schemas.HousingProjectionYear.required].sort());
    expect(readFileSync("src/components/housing/rent-or-buy.tsx","utf8")).toContain("resolveComparison(typed, market, stress, model)");
    expect(readFileSync("src/components/housing/developments.tsx","utf8")).toContain("projectPriceRows(p)");
  });

  it("uses the latest twelve months of sales and rents separately, with counts and full raw records still readable",async()=>{
    const body=await (await get()).json();
    expect(body.comparison).toBeNull();
    const p=body.projects[0];
    expect(p.records).toEqual({sales:3,rents:3});
    expect(p.window).toEqual({sales_from:"2025-02-01",sales_to:"2026-01-01",rents_from:"2025-03-01",rents_to:"2026-02-01"});
    expect(p.prices).toMatchObject({count:2,p50:760000,mean:760000});
    expect(p.rents).toMatchObject({count:2,p50:2500,mean:2500});
    expect(p.by_band[0].prices).toMatchObject({count:2,p50:760000});
    expect(p.by_quarter).toHaveLength(9);
    const raw=await (await RAW.GET(req("/api/housing"))).json();
    expect(raw.projects[0].sales).toHaveLength(3);
    expect(raw.projects[0].rents).toHaveLength(3);
  });

  it("compares saved and unsaved what-ifs without any write or token in chart URLs",async()=>{
    const before=structuredClone(db.tables.housing_scenarios);
    const response=await get(`?scenario_id=${ID}&years=15&stress=prices&simulation=false`);
    const body=await response.json();
    expect(body.comparison.summary.years).toBe(15);
    expect(body.comparison.stress).toBe("prices");
    expect(body.comparison.simulation_unavailable).toBe("not_requested");
    const wealth=body.charts.find((c:{id:string})=>c.id === "wealth");
    const url=new URL(wealth.svg_url);
    expect(url.origin).toBe("https://preview.example.vercel.app");
    expect(url.searchParams.get("years")).toBe("15");
    expect(url.searchParams.get("stress")).toBe("prices");
    expect(url.searchParams.has("token")).toBe(false);
    const image=await CHART.GET(new NextRequest(url));
    expect(image.status).toBe(200);
    expect(await image.text()).toContain(`${wealth.rows.at(-1).buy} SGD`);
    const inputs={...housingInputs(),price:900000,years:15};
    const post=await ANALYSIS.POST(req(undefined,{inputs,simulation:false}));
    expect(post.status).toBe(200);
    const whatIf=await post.json();
    expect(whatIf.comparison.inputs.price).toBe(900000);
    expect(whatIf.scenario).toBeNull();
    expect(whatIf.charts.every((c:{svg_url:null})=>c.svg_url === null)).toBe(true);
    const rendered=await CHART.POST(req("/api/housing/chart?chart=wealth",{inputs,simulation:false}));
    expect(rendered.status).toBe(200);
    expect(await rendered.text()).toContain(`${whatIf.comparison.projection.years.at(-1).buy_net_worth} SGD`);
    expect(db.tables.housing_scenarios).toEqual(before);
    expect(db.requests.every(r=>r.method === "GET")).toBe(true);
  });

  it("keeps a 91-year central projection but refuses a fabricated simulation chart",async()=>{
    const body=await (await get(`?scenario_id=${ID}&years=91`)).json();
    expect(body.comparison.projection.years).toHaveLength(92);
    expect(body.comparison.simulation).toBeNull();
    expect(body.comparison.simulation_unavailable).toBe("horizon_exceeds_35_years");
    expect(body.comparison.checks.some((c:{code:string})=>c.code === "long_horizon")).toBe(true);
    expect((await CHART.GET(req(`/api/housing/chart?scenario_id=${ID}&years=91&chart=futures`))).status).toBe(404);
    db.tables.housing_snapshot[0].market={series:[],refreshed_at:null};
    const missing=await (await get(`?scenario_id=${ID}&years=15`)).json();
    expect(missing.comparison.simulation_unavailable).toBe("insufficient_joint_history");
    expect(missing.comparison.projection.years).toHaveLength(16);
  });

  it.each(["?years=15","?scenario_id=no-id","?scenario_id=00000000-0000-0000-0000-00000000dead","?project=NOT%20FOLLOWED","?scenario_id="+ID+"&years=100","?scenario_id="+ID+"&years=1.5","?simulation=no","?stress=unknown","?paths=100000"])("validates options: %s",async query=>{
    const response=await get(query);
    expect(response.status).toBe(query.includes("dead") || query.includes("NOT%20FOLLOWED") ? 404 : 400);
  });

  it("rejects invalid inputs / unconfirmed guidance before reading private data",async()=>{
    for (const body of [{inputs:{price:-1}},{inputs:null},{scenario_id:ID,inputs:housingInputs()},{inputs:{...housingInputs(),guidance:{...housingInputs().guidance,confirmed:false}}},[],null]) expect((await ANALYSIS.POST(req(undefined,body))).status).toBe(400);
    expect(db.requests).toHaveLength(0);
  });

  it("exports every market series and keeps SVG private and passive",async()=>{
    const body=await (await get()).json();
    for (const chart of body.market_charts) {
      const image=await CHART.GET(new NextRequest(chart.svg_url));
      expect(image.status).toBe(200);
      expect(image.headers.get("content-type")).toBe("image/svg+xml; charset=utf-8");
      expect(image.headers.get("cache-control")).toBe("private, no-store");
      expect(image.headers.get("x-content-type-options")).toBe("nosniff");
      expect(image.headers.get("content-security-policy")).toContain("sandbox");
      expect(await image.text()).toContain("<svg");
    }
    expect((await CHART.GET(req("/api/housing/chart"))).status).toBe(400);
    expect((await CHART.GET(req("/api/housing/chart?chart=unknown"))).status).toBe(404);
    db.tables.housing_project_sales.length=0;
    expect((await CHART.GET(req("/api/housing/chart?chart=project-price:EXAMPLE%20CONDO"))).status).toBe(404);
  });

  it("returns database failures rather than invented zero statistics",async()=>{
    vi.stubEnv("SUPABASE_SERVICE_ROLE_KEY",undefined);
    expect((await get()).status).toBe(500);
    vi.stubEnv("SUPABASE_SERVICE_ROLE_KEY","stand-in");
    const failing=await startPostgrest({}, {intercept:()=>({status:503,body:{message:"unavailable"}})});
    try { vi.stubEnv("NEXT_PUBLIC_SUPABASE_URL",failing.url); expect((await get()).status).toBe(500); }
    finally { await failing.close(); }
  });
});
