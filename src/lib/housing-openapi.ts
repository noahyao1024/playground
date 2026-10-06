import { DEFAULT_INPUTS, ESTIMATED, HOME_KINDS, INPUT_LIMITS, LOAN_TYPES, PRIVATE_MARKETS, RESIDENCIES, SERIES } from "./housing";
import { CPF_PR_RULES, CPF_RULES, GUIDANCE_LIMITS, newGuidance } from "./housing-guidance";
import { MAX_PROJECTS } from "./housing-projects";
import { housingAnalysisPaths, housingAnalysisSchemas } from "./housing-analysis-openapi";

/** Keep this inventory aligned with POST /api/housing; the contract test reads
 * the route's switch, so a new action cannot disappear from the description. */
export const HOUSING_ACTIONS = ["saveScenario", "deleteScenario", "followProject", "unfollowProject", "refresh"] as const;
const ref = (name: string) => ({ $ref: `#/components/schemas/${name}` });
const actionName = (name: string) => `Housing_${name}`;
const nullable = (type: string, extra: Record<string, unknown> = {}) => ({ type: [type, "null"], ...extra });
const day = { type: "string", format: "date" };
const timestamp = { type: "string", format: "date-time" };
const uuid = { type: "string", format: "uuid" };
const array = (schema: unknown) => ({ type: "array", items: schema });
const object = (properties: Record<string, unknown>, required = Object.keys(properties)) => ({ type: "object", properties, required });
const ok = (description: string, schema: unknown) => ({ description, content: { "application/json": { schema } } });
const error = (description: string) => ok(description, ref("HousingError"));
const projectName = { type: "string", minLength: 1, maxLength: 80, description: "The development's URA name. Whitespace is normalized and letters uppercased." };

const inputDescriptions: Record<keyof typeof INPUT_LIMITS, string> = {
  nth: "Property count after buying: 1 first, 2 second, 3 third or later. Determines ABSD with residency.",
  price: "Purchase / asking price, S$.",
  loan_share: "Share of the purchase price borrowed, percent; 0 means no mortgage.",
  loan_rate: "Annual loan interest, percent; for a bank loan, the fixed rate during lock-in.",
  loan_years: "Mortgage term, years; separate from holding period and lease tenure.",
  lock_years: "Bank loan's fixed-rate period, years.",
  spread: "Percentage points over 3-month compounded SORA after a bank loan's lock-in.",
  buy_costs: "One-time legal, valuation and other buying costs, S$; excludes stamp duties.",
  renovation: "One-time renovation budget, S$.",
  maintenance: "Monthly S&CC / condo maintenance, S$.",
  upkeep: "Annual repairs and insurance, S$.",
  cost_growth: "Annual CPI inflation / running-cost growth, percent; also discounts the displayed final gap into baseline purchasing power.",
  annual_value: "IRAS annual value, S$/year, for owner-occupier property tax. Guided annual_value_auto uses rent × 12 as a rough proxy.",
  growth: "Annual home-price growth, percent.",
  sell_costs: "Selling agent and legal costs, percent of sale price.",
  rent: "Comparable whole-home monthly rent, S$; not room rent.",
  rent_growth: "Annual rent growth, percent.",
  rent_costs: "Annual rental agent fees and lease stamp duty, S$.",
  invest_return: "Annual return on money invested outside the home, percent.",
  cpf_balance: "Existing CPF Ordinary Account balance, S$.",
  cpf_monthly: "Monthly OA contribution, S$; used in manual or legacy comparisons, overridden by guidance salary / none modes.",
  cpf_rate: "Annual interest on CPF OA, percent.",
  years: "Holding / comparison period, years; simulations stop at 35 years, with the central projection alone beyond that.",
};

const guidanceDefaults = newGuidance("2026-10-06");
const guidanceDescriptions = {
  lease_start: "Lease's starting year, not TOP; expiry is January 1 of lease_start + lease_term.",
  lease_term: "Original lease term, years; usually 99 or 999.",
  lease_discount_rate: "Illustrative annual effective discount rate for lease decay, percent; default 3, 0 means linear decay. Not an official valuation.",
  salary: "Gross ordinary monthly wages, S$, excluding bonuses; CPF wage cap S$8,000.",
  age: "Buyer's age at as_of; also used to check lease-to-age-95 CPF housing eligibility.",
  retirement_age: "Age at which projected salary CPF contributions stop.",
  cpf_limit: "Verified total CPF housing usage allowance, S$, excluding accrued interest; null means unverified.",
};

/** Housing-only contract, also composed into the finance contract. All schema
 * names and operation IDs are distinct from finance's. No owner's data or
 * credentials are embedded; authentication still matches /api/housing. */
export function housingOpenApi(origin: string) {
  return {
    openapi: "3.1.0",
    info: {
      title: "Playground Housing",
      version: "3",
      description: [
        "Singapore housing market data, followed private developments and saved rent-or-buy scenario inputs.",
        "Use Authorization: Bearer <token>, generated in /housing → AI access or /finance → API access (or FINANCE_API_TOKEN). The owner's signed-in session also works. housing:read permits housing reads; finance:read permits finance and housing reads; finance:write permits both reads and writes. New tokens default to read-only; older tokens retain read/write permission. The contract omits operations outside the token's scope; ?read_only=true returns a compact read-only contract for GPT Actions even with an owner session. All responses are private, no-store. The description requires authentication too: download it from the page for import if your agent cannot authenticate its schema fetch.",
        "Money is S$, rates are percent unless stated otherwise. GET /api/housing reads saved data without contacting URA. A project's sales cover up to five years; rental records cover six quarters. Size is sqm for sales and sqft bands for rentals. GET /api/housing/analysis returns project P50 / means and, with scenario_id, the same projections and chart rows as the page. GET /api/housing/chart renders an authenticated SVG image. POST analysis / chart support read-only what-ifs, without saving inputs.",
        "Agent workflow: GET /api/housing for the complete raw data and scenario ids; GET /api/housing/analysis?scenario_id=<id>&project=<optional URA name>&years=15 for calculations, checks, assumptions, 500 seeded historical replay scenarios and chart export URLs; fetch svg_url with the same Authorization header. Compare 10 / 15 / 20 / 30 years or POST unsaved input variants for sensitivity. Over 35 years, simulation is unavailable and the central projection still works. CPF uses monthly accrual and annual compounding on modelled transactions, not a CPF statement. Replay shares are not calibrated future probabilities. Native read-only MCP: POST /api/housing/mcp using Streamable HTTP and the same bearer header. The page includes client setup and a copyable Chinese analysis prompt.",
        "For bank loans, financing.outstanding_loans is independent of the ABSD property count. financing.borrower_age is the bank-assessed borrower age; absent this, guidance.age is assumed to describe a single borrower, or the lower LTV band is used conservatively when age is unknown. Eligibility sets minimum cash downpayment (5/10/25%), not the voluntarily chosen loan_share. Inputs exceeding estimated LTV / term limits are flagged, never certified as approved or silently overwritten.",
        "Save scenario inputs with the buyer's actual residency, property count and home / loan kind. Omitted inputs take the documented defaults. With guidance, confirm required buyer, lease and CPF facts before setting confirmed=true; salary CPF for a PR on the new rules also requires pr_since on or before as_of.",
        "Following a development persists its name before reading URA. A 200 can still report refresh.failures or state=no key: inspect the refresh result, found and read_at before treating data as current. Market refresh likewise reports partial source failures in refresh.failures. The shared finance document is /api/finance/openapi.",
      ].join("\n\n"),
    },
    servers: [{ url: origin }],
    security: [{ token: [] }],
    paths: {
      ...housingAnalysisPaths,
      "/api/housing": {
        get: {
          operationId: "getHousing",
          summary: "Read saved housing market data, scenarios and followed developments",
          description: "Scenarios are ordered by most recently updated, limited to 200. Projects include stored raw URA sales and rental contracts; ura only reports whether the server has its URA key configured. No external refresh occurs.",
          responses: { 200: ok("Saved housing data", ref("HousingData")), 401: error("Not the owner"), 403:error("Token scope excludes this operation"), 500: error("Database unavailable or not configured") },
        },
        post: {
          operationId: "actOnHousing",
          summary: "Save / delete a scenario, follow / unfollow a development, or refresh the market",
          description: `Send one action. At most ${MAX_PROJECTS} developments may be followed. followProject reads URA immediately, even if already followed; avoid repeated calls just to read data. refresh updates market series from changed sources; force=true rereads them all. External reads may take up to 60 seconds. Save returns inputs, not a comparison calculation.`,
          requestBody: {
            required: true,
            content: { "application/json": { schema: {
              oneOf: HOUSING_ACTIONS.map(a => ref(actionName(a))),
              discriminator: { propertyName: "action", mapping: Object.fromEntries(HOUSING_ACTIONS.map(a => [a, `#/components/schemas/${actionName(a)}`])) },
            }, examples: {
              save: { summary: "Save a guided private-home comparison with no CPF", value: { action:"saveScenario", name:"Condo example", inputs:{ price:1500000, rent:4200, residency:"pr", nth:1, kind:"private", loan_type:"bank", guidance:{ as_of:"2026-10-06", confirmed:true, tenure:"leasehold", lease_start:2011, lease_term:99, cpf_mode:"none", cpf_rules:CPF_PR_RULES } } } },
              follow: { summary: "Follow a development by its URA name (replace the example)", value:{action:"followProject",name:"EXAMPLE CONDO"} },
              refresh: { summary: "Read only changed market datasets", value:{action:"refresh",force:false} },
            } } },
          },
          responses: {
            200: ok("saveScenario: scenario; deleteScenario / unfollowProject: ok; followProject: project and refresh; refresh: market and refresh. Inspect failures even on 200.", {
              oneOf: [object({ scenario:ref("HousingScenario") }), object({ ok:{type:"boolean",const:true} }), object({ project:{oneOf:[ref("HousingProject"),{type:"null"}]},refresh:ref("HousingProjectRefresh") }), object({ market:ref("HousingMarket"),refresh:ref("HousingMarketRefresh") })],
            }),
            400: error("Invalid action / inputs, unconfirmed guided facts, or project limit reached"),
            401: error("Not the owner"),
            403: error("Read-only token cannot save, delete, follow or refresh"),
            404: error("Scenario id not found, or development not followed"),
            500: error("Database unavailable or an unhandled source error; following may already have persisted the name"),
          },
        },
      },
      "/api/housing/openapi": {
        get: { operationId:"getHousingOpenApi", summary:"Read this housing-only OpenAPI description using the same token", responses:{200:ok("OpenAPI 3.1",{type:"object"}),401:error("Not the owner")} },
      },
    },
    components: {
      securitySchemes: { token:{type:"http",scheme:"bearer",description:"The same token used for finance: generated on /finance → API access, or FINANCE_API_TOKEN"} },
      schemas: {
        ...housingAnalysisSchemas,
        HousingError: object({ error:{type:"string"} }),
        HousingData: object({ market:ref("HousingMarket"),scenarios:array(ref("HousingScenario")),projects:array(ref("HousingProject")),ura:{type:"boolean",description:"Whether URA_ACCESS_KEY is configured; never the key itself."} }),
        HousingMarket: object({ series:array(ref("HousingMarketSeries")),refreshed_at:nullable("string",{format:"date-time"}) }),
        HousingMarketSeries: object({ series:{type:"string",enum:[...SERIES]},area:{type:"string"},segment:{type:"string"},start:{type:"string",pattern:"^\\d{4}-Q[1-4]$"},values:array(nullable("number")) }),
        HousingScenario: object({ id:uuid,name:{type:"string"},inputs:ref("HousingScenarioInputs"),created_at:timestamp,updated_at:timestamp }),
        HousingScenarioInputs: {
          ...object({
            ...Object.fromEntries(Object.entries(INPUT_LIMITS).map(([key,[minimum,maximum,whole]]) => [key,{type:whole ? "integer" : "number",minimum,maximum,default:DEFAULT_INPUTS[key as keyof typeof INPUT_LIMITS],description:inputDescriptions[key as keyof typeof INPUT_LIMITS]}])),
            residency:{type:"string",enum:[...RESIDENCIES],default:DEFAULT_INPUTS.residency},
            kind:{type:"string",enum:[...HOME_KINDS],default:DEFAULT_INPUTS.kind},
            loan_type:{type:"string",enum:[...LOAN_TYPES],default:DEFAULT_INPUTS.loan_type},
            market:{type:"string",enum:[...PRIVATE_MARKETS],default:DEFAULT_INPUTS.market},
            auto:{type:"array",items:{type:"string",enum:[...ESTIMATED]},default:[],description:"Inputs that the page resolves from live market estimates; the saved numeric values are fallbacks."},
            guidance:ref("HousingGuidance"),
            financing:ref("HousingFinancing"),
          }, []),
          description:"Optional input fields default as documented. Existing saved values are preserved; bank cash requirements and CPF are recalculated under the corrected rules. Without guidance CPF contributions are manual, and the monthly model starts in January 2026. This endpoint saves inputs only.",
        },
        HousingGuidance: object({
          ...Object.fromEntries(Object.entries(GUIDANCE_LIMITS).map(([key,[minimum,maximum]]) => [key,{
            type:[...(["salary","cpf_limit","lease_discount_rate"].includes(key) ? ["number"] : ["integer"]),...(["lease_term","retirement_age","lease_discount_rate"].includes(key) ? [] : ["null"])],minimum,maximum,
            default:guidanceDefaults[key as keyof typeof GUIDANCE_LIMITS],description:guidanceDescriptions[key as keyof typeof GUIDANCE_LIMITS],
          }])),
          version:{type:"integer",const:1,default:1},
          cpf_rules:{type:"string",enum:[...CPF_RULES],description:`Send ${CPF_PR_RULES} for new PR-stage estimates. v1 keeps full-rate assumptions; unversioned legacy JSON without PR fields also retains v1.`},
          as_of:{...day,description:"Saved assessment / purchasing-power baseline date; remaining lease and salary CPF use it."},
          confirmed:{type:"boolean",default:false,description:"Must be true to save guided inputs, after confirming the buyer, lease and CPF facts."},
          annual_value_auto:{type:"boolean",default:true,description:"The page uses rent × 12 as a rough AV proxy (capped at S$10m); saveScenario preserves the submitted annual_value."},
          tenure:{type:"string",enum:["unknown","freehold","leasehold"],default:"unknown",description:"Required to be known when comparing beyond 35 years. Leasehold requires a start year and unexpired lease."},
          cpf_mode:{type:"string",enum:["none","manual","salary"],default:"none"},
          cpf_eligible:{type:"boolean",default:false,description:"Salary mode requires an eligible employed citizen / PR, salary, age and a retirement age at least the current age."},
          pr_since:nullable("string",{format:"date",default:null,description:"PR grant date, required for salary-mode PRs on v2; must be on or before as_of. Stages change after the anniversary month; grant-month wages are prorated by calendar day as an estimate."}),
          cpf_scheme:{type:"string",enum:["graduated","full"],description:"v2 defaults to graduated G/G; full selects an approved F/F arrangement. v1 preserves full rates. F/G, bonuses and special allocation need manual OA."},
        }, ["as_of"]),
        HousingFinancing:object({
          outstanding_loans:{type:"integer",enum:[0,1,2],default:0,description:"Outstanding housing loans: 0, 1 or 2+; do not infer from nth (ABSD property count)."},
          borrower_age:nullable("number",{minimum:18,maximum:100,default:null,description:"Bank-assessed borrower age, including joint-borrower assessment. Fallback: guidance.age as a single borrower; if unknown, use the lower LTV band conservatively."}),
        },[]),
        HousingProject: object({
          name:projectName,street:nullable("string"),district:nullable("string"),segment:nullable("string",{enum:["CCR","RCR","OCR",null]}),
          added_at:timestamp,read_at:nullable("string",{format:"date-time"}),found:nullable("boolean"),tenure:nullable("string",{description:"URA tenure text; null until read, empty when omitted by URA."}),
          sales:array(ref("HousingSale")),rents:array(ref("HousingRent")),
        }),
        HousingSale: object({ month:day,price:{type:"number",description:"Total caveated price, S$; divide by units for per-unit price."},area_sqm:{type:"number",description:"Caveated area, sqm; multiply by 10.7639 for sqft."},floor_range:nullable("string"),sale_type:nullable("string",{enum:["new","sub","resale",null]}),property_type:nullable("string"),units:{type:"integer",minimum:1} }),
        HousingRent: object({ quarter:{...day,description:"First day of the quarter read."},month:{...day,description:"First day of the contract month."},rent:{type:"number",description:"Monthly rent, S$."},sqft_low:nullable("number"),sqft_high:nullable("number"),bedrooms:nullable("integer") }),
        HousingMarketRefresh: object({ checked:{type:"integer"},refreshed:{type:"integer"},points:{type:"integer"},snapshot:{type:"string",enum:["built","kept","unavailable"]},failures:array(object({ dataset:{type:"string"},reason:{type:"string"} })) }),
        HousingProjectRefresh: object({ state:{type:"string",enum:["read","not due","no key","none followed","unavailable"]},followed:{type:"integer"},read:{type:"integer"},sales:{type:"integer"},rents:{type:"integer"},failures:array(object({ source:{type:"string"},reason:{type:"string"} })) }),
        Housing_saveScenario: object({ action:{type:"string",const:"saveScenario"},id:nullable("string",{format:"uuid",description:"Omit or null to create; existing id to update. Updates replace inputs using defaults for omitted fields."}),name:{type:"string",minLength:1,maxLength:80},inputs:ref("HousingScenarioInputs") },["action","name","inputs"]),
        Housing_deleteScenario: object({ action:{type:"string",const:"deleteScenario"},id:uuid }),
        Housing_followProject: object({ action:{type:"string",const:"followProject"},name:projectName }),
        Housing_unfollowProject: object({ action:{type:"string",const:"unfollowProject"},name:projectName }),
        Housing_refresh: object({ action:{type:"string",const:"refresh"},force:{type:"boolean",default:false} },["action"]),
      },
    },
  };
}
