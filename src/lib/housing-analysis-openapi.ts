import { ESTIMATED } from "./housing";
import { STRESSES, PATHS, SIMULATED_YEARS } from "./housing-model";
import { CALCULATION_RULES } from "./housing-comparison";

const ref=(name: string) => ({$ref:`#/components/schemas/${name}`});
const object=(properties: Record<string,unknown>, required=Object.keys(properties)) => ({type:"object",properties,required});
const array=(schema: unknown) => ({type:"array",items:schema});
const nullable=(type: string, extra: Record<string,unknown>={}) => ({type:[type,"null"],...extra});
const maybe=(name: string) => ({oneOf:[ref(name),{type:"null"}]});
const number={type:"number"};
const text={type:"string"};
const count={type:"integer",minimum:0};
const day=nullable("string",{format:"date"});
const query=(name: string, schema: unknown, description: string, required=false) => ({name,in:"query",required,schema,description});
const options={
  scenario_id:{type:"string",format:"uuid",description:"A saved scenario id from GET /api/housing; mutually exclusive with inputs."},
  inputs:ref("HousingScenarioInputs"),
  years:{type:"integer",minimum:1,maximum:99,description:"Read-only holding-period override. Requires scenario_id or inputs; does not change saved data."},
  stress:{type:"string",enum:[...STRESSES],default:"none"},
  project:{type:"string",minLength:1,maxLength:80,description:"Restrict project statistics and compare this explicitly selected development's lease / market with the scenario. Does not infer a match from its name."},
  simulation:{type:"boolean",default:true,description:`Draw the same ${PATHS} seeded futures as the page, up to ${SIMULATED_YEARS} years. false skips simulation. Counts and seed cannot be overridden.`},
};
const params=Object.entries(options).filter(([key])=>key !== "inputs").map(([name,schema])=>query(name,schema,"Read-only analysis option; see HousingAnalysisRequest."));
const errors={400:{description:"Invalid options, unconfirmed guided facts, or invalid inputs",content:{"application/json":{schema:ref("HousingError")}}},401:{description:"Unauthorized",content:{"application/json":{schema:ref("HousingError")}}},404:{description:"Saved scenario, followed development or requested chart not found; an unavailable simulation chart or chart without observations is also 404",content:{"application/json":{schema:ref("HousingError")}}},500:{description:"Database unavailable; never substituted with zero observations",content:{"application/json":{schema:ref("HousingError")}}}};
const json={200:{description:"Computed saved-data analysis; private, no-store",content:{"application/json":{schema:ref("HousingAnalysis")}}},...errors};
const image={200:{description:"Self-contained SVG image; private, no-store. Send Authorization when fetching svg_url; never put a token in a URL.",content:{"image/svg+xml":{schema:{type:"string"}}}},...errors};
const body=(schema: string) => ({required:true,content:{"application/json":{schema:ref(schema),examples:{whatIf:{summary:"Compare unsaved inputs without saving them",value:{inputs:{price:1500000,rent:4200,years:15,kind:"private",market:"OCR:non-landed"},simulation:false}}}}}});

export const housingAnalysisPaths = {
  "/api/housing/analysis":{
    get:{operationId:"analyseHousing",summary:"Get project P50 / means, computed comparison and chart data",description:"No scenario_id returns project statistics and all market chart export ids. With scenario_id, returns effective live estimates, the full projection, today's-money gap, seeded futures and checks. Projects are all followed developments unless project selects one. No external refresh and no writes. Read the raw market series and complete URA records separately from GET /api/housing.",parameters:params,responses:json},
    post:{operationId:"analyseHousingWhatIf",summary:"Analyse saved or unsaved inputs without saving",description:"Use scenario_id or inputs; years is a temporary override. The same calculations and chart rows as the page. svg_url is null for POST what-ifs: send the same body to POST /api/housing/chart?chart=<id> to render its image. Missing inputs take defaults; set auto explicitly for live market estimates.",requestBody:body("HousingAnalysisRequest"),responses:json},
  },
  "/api/housing/chart":{
    get:{operationId:"getHousingChart",summary:"Render a saved comparison, project or market chart as SVG",description:"Use an id or svg_url from analysis. Comparison ids: wealth, gap, costs, futures, probability, sora. Project ids: project-price:<URA name>, project-rent:<URA name>. Every saved market series exports as market:<series>:<area>:<segment>. Chart data remains available as JSON; private images require the same bearer token or owner session.",parameters:[...params,query("chart",text,"Export id from charts or market_charts.",true)],responses:image},
    post:{operationId:"renderHousingWhatIfChart",summary:"Render a read-only what-if as SVG",description:"Send the analysis body and select chart in the query or body. Body inputs are kept out of the URL. No data is saved.",parameters:[query("chart",text,"Chart id, overriding the body chart when provided.")],requestBody:{required:true,content:{"application/json":{schema:ref("HousingChartRequest")}}},responses:image},
  },
};

export const housingAnalysisSchemas = {
  HousingAnalysisRequest:{...object(options,[]),additionalProperties:false,not:{required:["scenario_id","inputs"]},description:"Read-only options. Omit both scenario_id and inputs for project / market data alone. years requires one of them. Tokens have the same owner scope as finance; revocation closes these routes too."},
  HousingChartRequest:{...object({...options,chart:{...text,description:"Chart id; required in the body or query."}},[]),additionalProperties:false,not:{required:["scenario_id","inputs"]}},
  HousingAnalysis:object({version:text,market_refreshed_at:nullable("string",{format:"date-time"}),scenario:maybe("HousingAnalysedScenario"),comparison:maybe("HousingComparison"),projects:array(ref("HousingProjectAnalysis")),charts:array(ref("HousingChart")),market_charts:array(ref("HousingMarketChart"))}),
  HousingAnalysedScenario:object({id:{type:"string",format:"uuid"},name:text,updated_at:{type:"string",format:"date-time"}}),
  HousingComparison:object({
    inputs:ref("HousingScenarioInputs"),effective_inputs:ref("HousingScenarioInputs"),stress:options.stress,
    estimates:object(Object.fromEntries(ESTIMATED.map(key=>[key,object({value:number,reason:text})])),[]),
    projection:ref("HousingProjection"),summary:ref("HousingComparisonSummary"),simulation:maybe("HousingSimulation"),
    simulation_unavailable:nullable("string",{enum:[null,"horizon_exceeds_35_years","insufficient_joint_history","not_requested"]}),simulation_seed:{type:"integer",const:1},
    history:object({from:nullable("string"),to:nullable("string"),quarters:count}),checks:array(ref("HousingAnalysisCheck")),calculation_rules:array(ref("HousingCalculationRule")),
  }),
  HousingComparisonSummary:object({years:options.years,baseline:day,nominal_gap:{...number,description:"Buying minus renting, S$; positive favours buying."},todays_money_gap:{...number,description:"Nominal gap divided by (1 + inflation/100)^years; S$ at baseline purchasing power."},inflation:{...number,description:"Annual effective cost_growth, percent."},winner:{type:"string",enum:["buy","rent"],description:"At the final year, buy includes an exact tie; not determined by first break-even."},first_month_oa:number,break_even:nullable("integer")}),
  HousingAnalysisCheck:object({code:text,fields:array(text),message:{...text,description:"Chinese explanation of an assumption or a fact to verify. The API does not change inputs or certify mortgage eligibility."}}),
  HousingCalculationRule:object({key:{type:"string",enum:CALCULATION_RULES.map(r=>r.key)},method:{type:"string",enum:[...new Set(CALCULATION_RULES.map(r=>r.method))]},description:text}),
  HousingProjection:object({upfront:object(Object.fromEntries(["down_payment","loan","bsd","absd","buy_costs","renovation","total","from_cpf","from_cash"].map(key=>[key,number]))),instalment:{...number,description:"First-month mortgage repayment, S$."},years:array(ref("HousingProjectionYear")),monthly:array(ref("HousingOwningMonth")),break_even:nullable("integer"),notes:array(text)}),
  HousingProjectionYear:object({...Object.fromEntries(["home_value","loan_balance","sale_costs","buy_net_worth","rent_net_worth","own_monthly","rent_monthly","own_spent","rent_spent","cpf_refund"].map(key=>[key,number])),year:count,loan_rate:nullable("number",{description:"Annual loan rate, percent; null after repayment."})}),
  HousingOwningMonth:object({...Object.fromEntries(["paid","principal","interest","running","one_off","opportunity","appreciation","net","rent"].map(key=>[key,number])),year:count}),
  HousingSimulation:object({paths:{type:"integer",const:PATHS},years:array(ref("HousingSimulationYear")),breakEven:object({early:nullable("integer"),middle:nullable("integer"),late:nullable("integer"),never:{...number,minimum:0,maximum:1}})}),
  HousingSimulationYear:object({year:count,low:number,middle:number,high:number,ahead:{...number,minimum:0,maximum:1,description:"Share of historical-replay futures with buying ahead; not a calibrated real-world probability."},sora:{...array(number),minItems:3,maxItems:3,description:"P10, P50, P90 of year-end SORA, percent/year."}}),
  HousingStatistic:object({count,p25:number,p50:number,p75:number,mean:number}),
  HousingBandAnalysis:object({band:object({low:nullable("number"),high:nullable("number")}),label:text,prices:maybe("HousingStatistic"),psf:maybe("HousingStatistic"),rents:maybe("HousingStatistic"),bedrooms:nullable("integer"),yield:nullable("number",{description:"Gross rental yield as a fraction: rent P50 × 12 / per-home price P50, not a net return."})}),
  HousingQuarterAnalysis:object({quarter:text,label:text,psf:maybe("HousingStatistic"),rents:maybe("HousingStatistic")}),
  HousingProjectAnalysis:object({name:text,read_at:nullable("string",{format:"date-time"}),found:nullable("boolean"),tenure:nullable("string"),lease:{oneOf:[object({tenure:{type:"string",enum:["freehold","leasehold"]},lease_start:nullable("integer"),lease_term:count}),{type:"null"}]},market:text,records:object({sales:count,rents:count}),window:object({sales_from:day,sales_to:day,rents_from:day,rents_to:day}),prices:maybe("HousingStatistic"),psf:maybe("HousingStatistic"),rents:maybe("HousingStatistic"),by_band:array(ref("HousingBandAnalysis")),by_bedrooms:array(object({bedrooms:nullable("integer"),rents:ref("HousingStatistic")})),by_quarter:array(ref("HousingQuarterAnalysis"))}),
  HousingChart:object({id:text,title:text,x_label:text,unit:text,rows:array(ref("HousingChartRow")),lines:array(object({key:text,label:text,color:text,dashed:{type:"boolean"}},["key","label","color"])),band:object({low:text,high:text,label:text,color:text}),note:text,svg_url:nullable("string",{format:"uri",description:"Authenticated GET URL; null for an unsaved POST what-if. Never includes a token."})},["id","title","x_label","unit","rows","lines","note","svg_url"]),
  HousingChartRow:{...object({x:number,title:text}),additionalProperties:{type:["number","string","null"]},description:"Series keys match lines[].key and band.low/high. Null observations are gaps, not zero."},
  HousingMarketChart:object({id:text,title:text,series:text,area:text,segment:text,svg_url:nullable("string",{format:"uri"})}),
};
