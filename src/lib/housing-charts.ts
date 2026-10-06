import { findSeries, pointsOf, quarterFromNumber, quarterLabel, quarterNumber, quarterYear, type MarketData, type MarketSeries, type OwningMonth, type Projection } from "./housing";
import type { Simulation, SoraOutlook, Stress } from "./housing-model";
import { byQuarter, type Project } from "./housing-projects";

/** Numeric chart data shared by the browser and the API, without React. */
export type ChartRow = { x: number; title: string } & Record<string, number | string | null>;
export type ChartBandRow = ChartRow & { low: number | null; high: number | null };
export type Chart = {
  id: string; title: string; x_label: string; unit: string;
  rows: ChartRow[];
  lines: Array<{ key: string; label: string; color: string; dashed?: boolean }>;
  band?: { low: string; high: string; label: string; color: string };
  note: string;
};
// Light-theme --series-1 / --series-2 / --series-3, on the exported white canvas.
const BUY = "#2a78d6", RENT = "#eb6834", THIRD = "#1baf7a";
const yearTitle = (year: number) => year === 0 ? "Now" : `After ${year} year${year === 1 ? "" : "s"}`;

export const wealthRows = (projection: Projection): ChartRow[] => projection.years.map(y => ({ x:y.year,title:yearTitle(y.year),buy:y.buy_net_worth,rent:y.rent_net_worth }));
export const costRows = (months: OwningMonth[]): ChartRow[] => months.map(y => ({ x:y.year,title:`Year ${y.year}, a month`,own:y.net,rent:y.rent,paid:y.paid,principal:y.principal }));
export function futureRows(projection: Projection, simulation: Simulation): ChartBandRow[] {
  const gaps = projection.years.map(y => y.buy_net_worth - y.rent_net_worth);
  return [{ x:0,title:"Now",low:gaps[0],high:gaps[0],middle:gaps[0],expected:gaps[0] }, ...simulation.years.map(y => ({ x:y.year,title:yearTitle(y.year),low:y.low,high:y.high,middle:y.middle,expected:gaps[y.year] ?? null }))];
}
export const chanceRows = (simulation: Simulation): ChartRow[] => simulation.years.map(y => ({x:y.year,title:yearTitle(y.year),ahead:y.ahead}));
export function soraRows(years: number, outlook: SoraOutlook, market: MarketData, simulation: Simulation | null, stress: Stress): ChartBandRow[] {
  const quarter = quarterNumber(outlook.latest.quarter), now = quarterYear(outlook.latest.quarter);
  const history = pointsOf(findSeries(market,"sora","ALL","3m")).filter(p => quarterNumber(p.quarter) > quarter - 40 && quarterNumber(p.quarter) <= quarter);
  return [
    ...history.map(p => ({ x:quarterYear(p.quarter),title:quarterLabel(p.quarter),low:p.quarter === outlook.latest.quarter ? p.value : null,high:p.quarter === outlook.latest.quarter ? p.value : null,sora:p.value,expected:p.quarter === outlook.latest.quarter ? p.value : null })),
    ...Array.from({length:years},(_,k) => k+1).map(y => ({ x:now+y,title:quarterLabel(quarterFromNumber(quarter+4*y)),low:simulation?.years[y-1]?.sora[0] ?? null,high:simulation?.years[y-1]?.sora[2] ?? null,sora:null,expected:outlook.expected[Math.min(4*y,outlook.expected.length-1)] + (stress === "rates" && y >= 1 ? 2 : 0) })),
  ];
}
export const projectPriceRows = (project: Project): ChartRow[] => byQuarter(project).filter(q => q.psf).map(q => ({ x:quarterYear(q.quarter),title:`${q.label}, ${q.psf!.count} sale${q.psf!.count === 1 ? "" : "s"}`,p50:q.psf!.p50,mean:q.psf!.mean }));

export function comparisonCharts(projection: Projection, simulation: Simulation | null, outlook: SoraOutlook | null, market: MarketData, stress: Stress): Chart[] {
  const years = projection.years.length - 1;
  const charts: Chart[] = [
    { id:"wealth",title:"Buying and renting: net worth",x_label:"Years from baseline",unit:"SGD",rows:wealthRows(projection),lines:[{key:"buy",label:"Buying",color:BUY},{key:"rent",label:"Renting",color:RENT}],note:"Nominal net worth after selling, including investments and OA. Cash differences are reinvested." },
    { id:"gap",title:"Buying minus renting",x_label:"Years from baseline",unit:"SGD",rows:projection.years.map(y => ({x:y.year,title:yearTitle(y.year),gap:y.buy_net_worth-y.rent_net_worth})),lines:[{key:"gap",label:"Nominal gap",color:BUY}],note:"Positive means buying leaves more net worth; negative means renting does." },
    { id:"costs",title:"Monthly cost breakdown",x_label:"Year",unit:"SGD/month",rows:costRows(projection.monthly),lines:[{key:"own",label:"Owning cost",color:BUY},{key:"rent",label:"Renting cost",color:RENT}],note:"Average month of each year; excludes principal and includes opportunity cost. This accounting breakdown does not compound." },
  ];
  if (simulation) charts.push(
    { id:"futures",title:"Buying minus renting across futures",x_label:"Years from baseline",unit:"SGD",rows:futureRows(projection,simulation),lines:[{key:"middle",label:"P50 future",color:BUY},{key:"expected",label:"Central projection",color:THIRD,dashed:true}],band:{low:"low",high:"high",label:"P10–P90",color:BUY},note:"500 seeded joint-history replays, not guaranteed outcomes. The central projection differs from the median future." },
    { id:"probability",title:"Share of futures with buying ahead",x_label:"Year",unit:"fraction",rows:chanceRows(simulation),lines:[{key:"ahead",label:"Buying ahead",color:BUY}],note:"Share between 0 and 1 of historical replay futures with a non-negative gap; not a calibrated real-world probability." },
  );
  if (outlook) charts.push({ id:"sora",title:"SORA history and outlook",x_label:"Calendar year",unit:"percent/year",rows:soraRows(years,outlook,market,simulation,stress),lines:[{key:"sora",label:"Historical SORA",color:THIRD},{key:"expected",label:"Expected SORA",color:THIRD,dashed:true}],band:{low:"low",high:"high",label:"P10–P90",color:THIRD},note:"3-month compounded SORA; expected path inferred from government bond yields, with the selected stress." });
  return charts;
}

export function projectCharts(project: Project): Chart[] {
  const quarters = byQuarter(project);
  return [
    { id:`project-price:${project.name}`,title:`${project.name}: sale price per square foot`,x_label:"Calendar year",unit:"SGD/sqft",rows:projectPriceRows(project),lines:[{key:"p50",label:"P50",color:BUY},{key:"mean",label:"Average",color:THIRD}],note:"Stored URA caveats by quarter, all sizes combined; changes in the mix of homes affect the curve." },
    { id:`project-rent:${project.name}`,title:`${project.name}: monthly rental contracts`,x_label:"Calendar year",unit:"SGD/month",rows:quarters.filter(q => q.rents).map(q => ({x:quarterYear(q.quarter),title:`${q.label}, ${q.rents!.count} contracts`,p50:q.rents!.p50,mean:q.rents!.mean})),lines:[{key:"p50",label:"P50",color:RENT},{key:"mean",label:"Average",color:THIRD}],note:"Stored URA rental contracts by quarter, all sizes combined; use by_band for comparable sizes." },
  ];
}

/** Every saved series can be exported using its id, including HDB towns. */
export const marketChartId = (series: Pick<MarketSeries,"series"|"area"|"segment">) => `market:${series.series}:${series.area}:${series.segment}`;
export function marketChart(series: MarketSeries): Chart {
  const unit = series.series === "sora" || series.series === "sgs" ? "percent/year" : series.series === "hdb_resale" ? "SGD" : series.series === "hdb_rent" ? "SGD/month" : "index";
  return { id:marketChartId(series),title:`${series.series}: ${series.area} / ${series.segment}`,x_label:"Calendar year",unit,rows:series.values.map((value,k) => { const quarter=quarterFromNumber(quarterNumber(series.start)+k); return {x:quarterYear(quarter),title:quarterLabel(quarter),value}; }),lines:[{key:"value",label:series.series,color:BUY}],note:"Saved source observations; missing quarters are null and are not joined." };
}
