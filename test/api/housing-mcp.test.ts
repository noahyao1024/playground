import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";
import { sha256Hex } from "@/lib/finance-server";
import { SNAPSHOT_VERSION } from "@/lib/housing-data";
import { analyseHousing } from "@/lib/housing-analysis";
import { chartSvg } from "@/lib/housing-chart-svg";
import { housingInputs, housingMarket, housingProject } from "../helpers/housing-fixtures";
import { startPostgrest, type StandIn } from "../helpers/postgrest";

vi.mock("@/lib/auth",()=>({auth:async()=>null}));
const MCP=await import("@/app/api/housing/mcp/route");
const ID="00000000-0000-0000-0000-000000000067";
const TOKEN="invented-read-only-mcp-token-at-least-32-characters";
const URL_="https://preview.example.vercel.app/api/housing/mcp";
let db: StandIn;
let client: Client|undefined;
beforeEach(async()=>{
  const p=housingProject(),{sales,rents,...metadata}=p;
  db=await startPostgrest({finance_api_tokens:[{id:ID,name:"MCP test",token_sha256:sha256Hex(TOKEN),scope:"housing:read"}],
    housing_snapshot:[{id:"market",version:SNAPSHOT_VERSION,market:housingMarket()}],
    housing_scenarios:[{id:ID,name:"Invented example",inputs:housingInputs(),created_at:"2026-01-01T00:00:00Z",updated_at:"2026-01-02T00:00:00Z"}],
    housing_projects:[metadata],housing_project_sales:sales.map((s,k)=>({id:`s${k}`,project:p.name,...s})),housing_project_rents:rents.map((r,k)=>({id:`r${k}`,project:p.name,...r})),
  });
  vi.stubEnv("NEXT_PUBLIC_SUPABASE_URL",db.url);vi.stubEnv("SUPABASE_SERVICE_ROLE_KEY","stand-in");vi.stubEnv("FINANCE_API_TOKEN",undefined);
});
afterEach(async()=>{await client?.close();client=undefined;vi.unstubAllEnvs();await db.close();});
const request=(body?:unknown,headers:Record<string,string>={},method="POST")=>new NextRequest(URL_,{method,headers:{authorization:`Bearer ${TOKEN}`,"content-type":"application/json",accept:"application/json, text/event-stream",...headers},...(body===undefined ? {} : {body:JSON.stringify(body)})});
const rpc=(name:string,args:unknown={})=>({jsonrpc:"2.0",id:1,method:"tools/call",params:{name,arguments:args}});
async function connect() {
  client=new Client({name:"standard-sdk-test",version:"1.0.0"});
  const transport=new StreamableHTTPClientTransport(new URL(URL_),{
    requestInit:{headers:{authorization:`Bearer ${TOKEN}`}},
    fetch:async(input,init)=>{
      const r=new NextRequest(new Request(input,init));
      const method=r.method as "POST"|"GET"|"DELETE";
      return MCP[method](r);
    },
  });
  await client.connect(transport);
  return client;
}

describe("native read-only housing MCP",()=>{
  it("initializes with a standard SDK client, advertises standalone schemas and only read-only tools",async()=>{
    const c=await connect();
    const tools=(await c.listTools()).tools;
    expect(tools.map(t=>t.name)).toEqual(["get_housing_data","analyse_housing","get_housing_chart"]);
    expect(JSON.stringify(tools)).not.toContain("$ref");
    for(const tool of tools) expect(tool.annotations).toMatchObject({readOnlyHint:true,destructiveHint:false,idempotentHint:true});
    expect(tools.find(t=>t.name==="analyse_housing")?.inputSchema.properties).toHaveProperty("inputs");
    expect(db.requests.every(r=>r.table==="finance_api_tokens")).toBe(true);
  });
  it("returns complete saved data and exactly the page's read-only analysis, including chart rows and checks",async()=>{
    const c=await connect();
    const before=structuredClone(db.tables.housing_scenarios);
    const raw=await c.callTool({name:"get_housing_data",arguments:{}});
    const data=raw.structuredContent as {projects:{sales:unknown[];rents:unknown[]}[];market:{series:unknown[]}};
    expect(data.projects[0].sales).toHaveLength(3);expect(data.projects[0].rents).toHaveLength(3);
    expect(data.market.series).toHaveLength(housingMarket().series.length);
    const result=await c.callTool({name:"analyse_housing",arguments:{scenario_id:ID,years:1,simulation:false,project:"EXAMPLE CONDO"}});
    expect(result.isError).toBeUndefined();
    const body=result.structuredContent as ReturnType<typeof analyseHousing>;
    const expected=analyseHousing(housingMarket(),[housingProject()],{...housingInputs(),years:1},"none",false,housingProject());
    expect(body.comparison).toEqual(expected.comparison);
    expect(body.projects).toEqual(expected.projects);
    expect(body.charts.map(chart=>chart.rows)).toEqual(expected.charts.map(chart=>chart.rows));
    expect(db.tables.housing_scenarios).toEqual(before);
    expect(db.requests.every(r=>r.method==="GET")).toBe(true);
  });
  it("returns the same SVG as the shared chart renderer, as an embedded private resource",async()=>{
    const c=await connect();
    const result=await c.callTool({name:"get_housing_chart",arguments:{scenario_id:ID,years:1,chart:"wealth"}});
    const blocks=result.content as Array<{type:string;resource?:{mimeType:string;text:string;uri:string}}>;
    const resource=blocks.find(b=>b.type==="resource")!.resource!;
    expect(resource.mimeType).toBe("image/svg+xml");
    const expected=analyseHousing(housingMarket(),[housingProject()],{...housingInputs(),years:1},"none",false).charts.find(c=>c.id==="wealth")!;
    expect(resource.text).toBe(chartSvg(expected));
    expect(resource.text).not.toContain(TOKEN);expect(resource.uri).not.toContain(TOKEN);
  });
  it("runs unsaved what-ifs without writes, and reports validation failures as tool errors",async()=>{
    const c=await connect();
    const result=await c.callTool({name:"analyse_housing",arguments:{inputs:{...housingInputs(),price:910000,years:1},simulation:false}});
    expect((result.structuredContent as ReturnType<typeof analyseHousing>).comparison?.effective_inputs.price).toBe(910000);
    const invalid=await c.callTool({name:"analyse_housing",arguments:{scenario_id:ID,inputs:housingInputs()}});
    expect(invalid.isError).toBe(true);expect(JSON.stringify(invalid)).toContain("not both");
    expect((await c.callTool({name:"delete_scenario",arguments:{id:ID}})).isError).toBe(true);
    expect((await c.callTool({name:"get_housing_data",arguments:{token:TOKEN}})).isError).toBe(true);
    expect(db.requests.every(r=>r.method==="GET")).toBe(true);
  });
  it("checks authentication before parsing or business reads, and revocation immediately closes tool calls",async()=>{
    const denied=await MCP.POST(request(rpc("get_housing_data"),{authorization:""}));
    expect(denied.status).toBe(401);expect(denied.headers.get("www-authenticate")).toContain("Bearer");
    expect(db.requests).toHaveLength(0);
    expect((await MCP.POST(request(rpc("get_housing_data")))).status).toBe(200);
    db.tables.finance_api_tokens.length=0;db.requests.length=0;
    const revoked=await MCP.POST(request(rpc("get_housing_data")));
    expect(revoked.status).toBe(401);expect(revoked.headers.get("cache-control")).toBe("private, no-store");
    expect(db.requests.every(r=>r.table==="finance_api_tokens")).toBe(true);
  });
  it("validates Origin, HTTP negotiation, notification acknowledgements and protocol errors",async()=>{
    expect((await MCP.POST(request(rpc("get_housing_data"),{origin:"https://untrusted.example"}))).status).toBe(403);
    expect((await MCP.POST(request(rpc("get_housing_data"),{accept:"application/json"}))).status).toBe(406);
    expect((await MCP.POST(request(rpc("get_housing_data"),{"mcp-protocol-version":"unknown"}))).status).toBe(400);
    const notification=await MCP.POST(request({jsonrpc:"2.0",method:"notifications/initialized"}));
    expect(notification.status).toBe(202);expect(await notification.text()).toBe("");
    const bad=await MCP.POST(request({jsonrpc:"2.0",id:7,method:"missing_method"}));
    expect((await bad.json()).error.code).toBe(-32601);
    const get=await MCP.GET(request(undefined,{},"GET"));expect(get.status).toBe(405);expect(get.headers.get("allow")).toBe("POST");
  });
});
