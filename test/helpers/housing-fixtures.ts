import { DEFAULT_INPUTS, EQUITY_SEGMENT, type MarketData, type MarketSeries, type ScenarioInputs } from "@/lib/housing";
import { newGuidance } from "@/lib/housing-guidance";
import type { Project } from "@/lib/housing-projects";

/** Invented observations and buyer inputs, never copied from production. */
export function housingMarket(): MarketData {
  const series=(name: MarketSeries["series"], area: string, segment: string, growth: number): MarketSeries => ({series:name,area,segment,start:"2010-Q1",values:Array.from({length:60},(_,k)=>100*(1+growth)**(k/4)*Math.exp(Math.sin(k)*0.01))});
  return {refreshed_at:"2026-02-03T04:05:06Z",series:[
    series("ura_ppi","OCR","non-landed",0.03),series("ura_rri","OCR","non-landed",0.02),series("cpi","ALL","all",0.02),series("equity","ALL",EQUITY_SEGMENT,0.06),
    {series:"sora",area:"ALL",segment:"3m",start:"2010-Q1",values:Array.from({length:60},(_,k)=>1.3+Math.sin(k)*0.15)},
    ...[1,2,5,10].map(term=>({series:"sgs" as const,area:"ALL",segment:`${term}y`,start:"2010-Q1",values:Array.from({length:60},(_,k)=>1.6+term*0.015+Math.sin(k)*0.12)})),
  ]};
}

export function housingInputs(): ScenarioInputs {
  return {...DEFAULT_INPUTS,residency:"citizen",kind:"private",loan_type:"bank",loan_years:30,market:"OCR:non-landed",price:840000,rent:2700,years:20,loan_rate:2.9,cpf_balance:4200,auto:["loan_rate","cost_growth"],guidance:{...newGuidance("2026-02-01"),tenure:"leasehold",lease_start:2014,lease_term:99,age:36,salary:6500,cpf_mode:"salary",cpf_eligible:true,confirmed:true}};
}

export function housingProject(name="EXAMPLE CONDO"): Project {
  return {name,street:"Example Street",district:"18",segment:"OCR",added_at:"2026-02-01T00:00:00Z",read_at:"2026-02-02T00:00:00Z",found:true,tenure:"99 yrs lease commencing from 2014",
    sales:[
      {month:"2024-01-01",price:400000,area_sqm:50,floor_range:"01-05",sale_type:"resale",property_type:"Condominium",units:1},
      {month:"2025-04-01",price:740000,area_sqm:50,floor_range:"01-05",sale_type:"resale",property_type:"Condominium",units:1},
      {month:"2026-01-01",price:780000,area_sqm:50,floor_range:"06-10",sale_type:"resale",property_type:"Condominium",units:1},
    ],
    rents:[
      {quarter:"2024-01-01",month:"2024-02-01",rent:1900,sqft_low:500,sqft_high:600,bedrooms:1},
      {quarter:"2025-04-01",month:"2025-05-01",rent:2400,sqft_low:500,sqft_high:600,bedrooms:1},
      {quarter:"2026-01-01",month:"2026-02-01",rent:2600,sqft_low:500,sqft_high:600,bedrooms:1},
    ],
  };
}
