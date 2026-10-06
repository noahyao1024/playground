import type { NextRequest } from "next/server";
import { financeDatabase, financeJson, financeAccessResponse, isUuid, reason } from "./finance-server";
import { InputError, comparisonReady, parseInputs, readInputs, type ScenarioInputs } from "./housing";
import { marketOf } from "./housing-data";
import { projectName } from "./housing-projects";
import { readProjects } from "./ura";
import { STRESSES, type Stress } from "./housing-model";
import { analyseHousing } from "./housing-analysis";
import { marketChart, marketChartId } from "./housing-charts";
import { chartSvg } from "./housing-chart-svg";

class Invalid extends Error {}
class Missing extends Error {}
const FIELDS = ["scenario_id","inputs","years","stress","project","simulation","chart"];

/** Both image and JSON requests check permission before parsing or reading
 * private records. POST is a read-only what-if, never a scenario write. */
export async function housingAnalysisResponse(req: NextRequest, format: "json" | "svg") {
  const denied = await financeAccessResponse(req, "housing");
  if (denied) return denied;
  const db=financeDatabase();
  if (!db) return financeJson({error:"Supabase not configured"},500);
  try {
    let raw: Record<string,unknown>;
    if (req.method === "POST") {
      try { raw=await req.json(); } catch { throw new Invalid("Expected a JSON body"); }
      if (!raw || Array.isArray(raw) || typeof raw !== "object") throw new Invalid("Expected a JSON object");
      // The chart is also selectable in the query when the same what-if body
      // is sent to both endpoints.
      if (format === "svg" && req.nextUrl.searchParams.has("chart")) raw={...raw,chart:req.nextUrl.searchParams.get("chart")};
    } else {
      raw=Object.fromEntries(req.nextUrl.searchParams);
      if (raw.years !== undefined) raw.years=typeof raw.years === "string" && /^\d+$/.test(raw.years) ? Number(raw.years) : NaN;
      if (raw.simulation !== undefined) raw.simulation=raw.simulation === "true" ? true : raw.simulation === "false" ? false : raw.simulation;
    }
    for (const key of Object.keys(raw)) if (!FIELDS.includes(key)) throw new Invalid(`Unknown option: ${key}`);
    if (raw.scenario_id !== undefined && !isUuid(raw.scenario_id)) throw new Invalid("scenario_id must be a UUID");
    if (raw.scenario_id !== undefined && raw.inputs !== undefined) throw new Invalid("Use scenario_id or inputs, not both");
    if (raw.inputs !== undefined && req.method !== "POST") throw new Invalid("Use POST for a what-if with inputs");
    if (raw.years !== undefined && (typeof raw.years !== "number" || !Number.isInteger(raw.years) || raw.years < 1 || raw.years > 99)) throw new Invalid("years must be an integer from 1 to 99");
    if (raw.stress !== undefined && !STRESSES.includes(raw.stress as Stress)) throw new Invalid("Unknown stress; use none, rates, rents or prices");
    if (raw.simulation !== undefined && typeof raw.simulation !== "boolean") throw new Invalid("simulation must be true or false");
    if (raw.project !== undefined && !projectName(raw.project)) throw new Invalid("project must be a development's name, at most 80 characters");
    if (raw.chart !== undefined && (typeof raw.chart !== "string" || raw.chart.length > 256)) throw new Invalid("chart must be an export id");
    if (format === "svg" && !raw.chart) throw new Invalid("Specify chart using an id from the analysis response");

    let inputs: ScenarioInputs | null=raw.inputs !== undefined ? parseInputs(raw.inputs) : null;
    let scenario: {id:string;name:string;updated_at:string} | null=null;
    if (raw.scenario_id !== undefined) {
      const {data,error}=await db.from("housing_scenarios").select("id,name,inputs,updated_at").eq("id",raw.scenario_id).limit(1);
      if (error) throw error;
      if (!data?.length) throw new Missing("No such scenario");
      inputs=readInputs(data[0].inputs);
      scenario={id:data[0].id,name:data[0].name,updated_at:data[0].updated_at};
    }
    if (raw.years !== undefined) {
      if (!inputs) throw new Invalid("years requires scenario_id or inputs");
      inputs={...inputs,years:raw.years as number};
    }
    if (inputs && !comparisonReady(inputs)) throw new Invalid("Confirm the required buyer, lease and CPF details before comparing");
    const [market,allProjects]=await Promise.all([marketOf(db),readProjects(db)]);
    const selected=raw.project !== undefined ? allProjects.find(p=>p.name === projectName(raw.project)) : undefined;
    if (raw.project !== undefined && !selected) throw new Missing("Development not followed");
    const projects=selected ? [selected] : allProjects;
    const draw=raw.simulation !== false && (format === "json" || ["futures","probability","sora"].includes(raw.chart as string));
    const result=analyseHousing(market,projects,inputs,(raw.stress ?? "none") as Stress,draw,selected);
    if (format === "svg") {
      const series=market.series.find(s=>marketChartId(s) === raw.chart);
      const chart=result.charts.find(c=>c.id === raw.chart) ?? (series ? marketChart(series) : null);
      if (!chart) throw new Missing("Chart unavailable; inspect charts and simulation_unavailable in the analysis response");
      if (!chart.rows.some(row=>chart.lines.some(line=>typeof row[line.key] === "number"))) throw new Missing("This chart has no observations");
      return new Response(chartSvg(chart),{headers:{"content-type":"image/svg+xml; charset=utf-8","cache-control":"private, no-store","x-content-type-options":"nosniff","content-security-policy":"default-src 'none'; sandbox"}});
    }
    const svgUrl=(id: string) => {
      // An unsaved what-if must be sent again with POST, never rendered using
      // an unrelated saved scenario or by putting private inputs in a URL.
      if (req.method === "POST") return null;
      const url=new URL("/api/housing/chart",req.nextUrl.origin);
      for (const [key,value] of req.nextUrl.searchParams) if (key !== "chart") url.searchParams.set(key,value);
      url.searchParams.set("chart",id);
      return url.toString();
    };
    return financeJson({...result,scenario,charts:result.charts.map(chart=>({...chart,svg_url:svgUrl(chart.id)})),market_charts:result.market_charts.map(chart=>({...chart,svg_url:svgUrl(chart.id)}))});
  } catch (err) {
    if (err instanceof Missing) return financeJson({error:err.message},404);
    if (err instanceof Invalid || err instanceof InputError) return financeJson({error:err.message},400);
    return financeJson({error:reason(err)},500);
  }
}
