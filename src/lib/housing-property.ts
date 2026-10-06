import { newGuidance } from "./housing-guidance";
import { SQFT_PER_SQM, bandLabel, lastYear, leaseOf, marketForProject, projectName, psfOf, sqftOf, summarize, type Band, type Project } from "./housing-projects";
import type { ScenarioInputs } from "./housing";
import { dayInSG } from "./dates";

export const QUOTE_KINDS = ["listing", "ura_p50", "ura_mean"] as const;
export type HousingQuote = {
  kind: (typeof QUOTE_KINDS)[number];
  amount: number;
  project: string | null;
  area_sqft: number | null;
  band: Band | null;
  bedrooms: number | null;
  bathrooms: number | null;
  read_at: string | null;
  url: string | null;
};
export type HousingProperty = {
  project: string | null;
  area: number | null;
  area_unit: "sqft" | "sqm";
  /** A selected comparison band is not an exact floor area. */
  area_band: Band | null;
  bedrooms: number | null;
  bathrooms: number | null;
  buy_url: string | null;
  rent_url: string | null;
  price_source: HousingQuote | null;
  rent_source: HousingQuote | null;
};
export const EMPTY_PROPERTY: HousingProperty = {
  project: null, area: null, area_unit: "sqft", area_band: null, bedrooms: null, bathrooms: null,
  buy_url: null, rent_url: null, price_source: null, rent_source: null,
};

export function listingUrl(value: unknown): string | null {
  if (value === null || value === undefined || value === "") return null;
  if (typeof value !== "string" || value.length > 4096) throw new Error("房源链接过长或格式无效");
  let url: URL;
  try { url = new URL(value.trim()); } catch { throw new Error("请填写完整的 PropertyGuru HTTPS 链接"); }
  if (url.protocol !== "https:" || !["propertyguru.com.sg", "www.propertyguru.com.sg"].includes(url.hostname) || url.username || url.password || (url.port && url.port !== "443")) throw new Error("请填写 PropertyGuru 新加坡站的 HTTPS 链接");
  return url.toString();
}
const numeric = (value: unknown, min: number, max: number, integer = false): number | null => {
  if (value === undefined || value === null) return null;
  if (typeof value !== "number" || !Number.isFinite(value) || value < min || value > max || (integer && !Number.isInteger(value))) throw new Error("房源面积或房型数值无效");
  return value;
};
function parseBand(value: unknown): Band | null {
  if (value === undefined || value === null) return null;
  if (typeof value !== "object" || Array.isArray(value)) throw new Error("面积档格式无效");
  const raw = value as Record<string, unknown>;
  const band = { low: numeric(raw.low, 0, 1_000_000), high: numeric(raw.high, 1, 1_000_000) };
  if ((band.low === null && band.high === null) || (band.low !== null && band.high !== null && band.low >= band.high)) throw new Error("面积档范围无效");
  return band;
}
function parseQuote(value: unknown): HousingQuote | null {
  if (value === undefined || value === null) return null;
  if (typeof value !== "object" || Array.isArray(value)) throw new Error("报价来源格式无效");
  const raw = value as Record<string, unknown>;
  if (!QUOTE_KINDS.some(k => k === raw.kind)) throw new Error("报价来源无效");
  const amount = numeric(raw.amount, 0, 100_000_000);
  if (amount === null) throw new Error("报价来源缺少金额");
  const name = raw.project == null ? null : projectName(raw.project);
  if (raw.project != null && !name) throw new Error("报价来源楼盘名无效");
  const url = listingUrl(raw.url);
  if (raw.kind === "listing" && !url) throw new Error("挂牌报价需保存房源链接");
  if (raw.kind === "listing" && listingFilters(url)?.search) throw new Error("搜索列表不能作为单套挂牌报价来源");
  if (raw.kind !== "listing" && !name) throw new Error("URA 参考需保存楼盘名");
  const date = raw.read_at == null ? null : raw.read_at;
  if (date !== null && (typeof date !== "string" || !/^\d{4}-\d\d-\d\dT/.test(date) || !Number.isFinite(Date.parse(date)))) throw new Error("报价读取日期无效");
  return { kind: raw.kind as HousingQuote["kind"], amount, project: name, area_sqft: numeric(raw.area_sqft, 1, 1_000_000), band: parseBand(raw.band), bedrooms: numeric(raw.bedrooms, 0, 20, true), bathrooms: numeric(raw.bathrooms, 1, 20, true), read_at: date as string | null, url };
}
export function parseProperty(value: unknown): HousingProperty {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error("property must be an object");
  const raw = value as Record<string, unknown>;
  const name = raw.project == null || raw.project === "" ? null : projectName(raw.project);
  if (raw.project != null && raw.project !== "" && !name) throw new Error("楼盘名无效");
  if (raw.area_unit !== undefined && !["sqft", "sqm"].includes(raw.area_unit as string)) throw new Error("面积单位无效");
  const property = { project: name, area: numeric(raw.area, 1, 1_000_000), area_unit: (raw.area_unit ?? "sqft") as HousingProperty["area_unit"], area_band: parseBand(raw.area_band),
    bedrooms: numeric(raw.bedrooms, 0, 20, true), bathrooms: numeric(raw.bathrooms, 1, 20, true), buy_url: listingUrl(raw.buy_url), rent_url: listingUrl(raw.rent_url),
    price_source: parseQuote(raw.price_source), rent_source: parseQuote(raw.rent_source) };
  if (property.price_source?.kind === "listing" && listingFilters(property.price_source.url)?.type === "rent") throw new Error("租房链接不能作为买价的挂牌来源");
  if (property.rent_source?.kind === "listing" && listingFilters(property.rent_source.url)?.type === "sale") throw new Error("买房链接不能作为月租的挂牌来源");
  return property;
}
export const propertySqft = (p: HousingProperty): number | null => p.area === null ? null : p.area * (p.area_unit === "sqm" ? SQFT_PER_SQM : 1);
const inBand = (area: number, band: Band) => (band.low === null || area >= band.low) && (band.high === null || area < band.high);
const sameBand = (a: Band, b: Band) => a.low === b.low && a.high === b.high;

/** Local URL interpretation only: a search boundary is never a property's price or area. */
export function listingFilters(value: string | null) {
  if (!value) return null;
  let url: URL;
  try { url = new URL(listingUrl(value)!); } catch { return null; }
  const q = url.searchParams;
  const number = (key: string) => { const v = q.get(key); return v !== null && /^\d+(\.\d+)?$/.test(v) ? Number(v) : null; };
  const bedrooms = q.getAll("bedrooms").filter(v => /^\d+$/.test(v)).map(Number);
  return { search: q.get("search") === "true" || /\/property-for-(rent|sale)(\/|$)/.test(url.pathname),
    type: q.get("listingType") === "rent" || /for-rent/.test(url.pathname) ? "rent" : q.get("listingType") === "sale" || /for-sale/.test(url.pathname) ? "sale" : null,
    min_price: number("minPrice"), max_price: number("maxPrice"), min_sqft: number("minSize"), max_sqft: number("maxSize"), bedrooms };
}

/** Link a project explicitly, retaining the buyer's prices, fees and manual growth assumptions. */
export function linkHousingProject(inputs: ScenarioInputs, project: Project): ScenarioInputs {
  const guidance = inputs.guidance ?? { ...newGuidance(dayInSG(new Date())), annual_value_auto: false, cpf_mode: inputs.cpf_balance + inputs.cpf_monthly > 0 ? "manual" as const : "none" as const };
  const lease = leaseOf(project.tenure);
  return { ...inputs, kind: "private", loan_type: "bank", market: marketForProject(project), property: { ...EMPTY_PROPERTY, ...inputs.property, project: project.name },
    guidance: { ...guidance, confirmed: false, ...(lease ?? { tenure: "unknown" as const, lease_start: null }) } };
}

/** Comparable sales have area but no bedrooms; rentals have bands and bedrooms, neither has bathrooms. */
export function propertyComparables(project: Project, property: HousingProperty) {
  const window = lastYear(project);
  const area = propertySqft(property);
  const bands = window.rents.filter(r => r.sqft_low !== null || r.sqft_high !== null).map(r => ({ low: r.sqft_low, high: r.sqft_high }));
  const band = area !== null ? bands.find(b => inBand(area, b)) ?? { low: Math.floor(area / 100) * 100, high: Math.floor(area / 100) * 100 + 100 } : property.area_band;
  const sales = band ? window.sales.filter(s => s.units === 1 && inBand(sqftOf(s), band)) : [];
  const rents = band ? window.rents.filter(r => sameBand({ low: r.sqft_low, high: r.sqft_high }, band) && (property.bedrooms === null || r.bedrooms === property.bedrooms)) : [];
  const latest = (months: string[]) => months.length ? months.reduce((a, b) => a > b ? a : b) : null;
  return { project: project.name, read_at: project.read_at, found: project.found, market: marketForProject(project), lease: leaseOf(project.tenure), band, band_label: band ? bandLabel(band) : null, bedrooms: property.bedrooms,
    prices: summarize(sales.map(s => s.price)), psf: summarize(sales.map(psfOf)), rents: summarize(rents.map(r => r.rent)),
    window: { sales_from: window.salesFrom, sales_to: latest(window.sales.map(s => s.month)), rents_from: window.rentsFrom, rents_to: latest(window.rents.map(r => r.month)) },
    notes: ["成交价仅按面积匹配，排除多套合并交易；URA 成交记录没有卧室和卫数。", "租金按面积档及已填写的卧室数匹配；URA 不提供卫数、装修或家具，仍需核对具体房源。", "统计窗口分别截至已存储的最新成交月和最新租赁月，不表示挂牌报价或实时成交。", ...(band ? [] : ["请填写实际面积，或从市场页选择面积档后查看同类参考。"]), ...(property.bedrooms === null ? ["未填写卧室数，租金参考包含该面积档的所有房型。"] : [])] };
}

export function quoteSource(inputs: ScenarioInputs, key: "price" | "rent") {
  const property = inputs.property;
  const source = property?.[key === "price" ? "price_source" : "rent_source"] ?? null;
  const matches = source !== null && source.amount === inputs[key];
  const area = property ? propertySqft(property) : null;
  const context = !source || !property ? true : source.project === property.project && source.area_sqft === area && source.bedrooms === property.bedrooms && (area !== null || source.band === null || (property.area_band !== null && sameBand(source.band, property.area_band))) && (source.kind !== "listing" || (source.url === property[key === "price" ? "buy_url" : "rent_url"] && source.bathrooms === property.bathrooms));
  return { kind: matches ? source.kind : "manual", source, matches_input: matches, context_matches: context,
    label: !matches ? "手动输入 / 未标记来源" : source.kind === "listing" ? "手动核对的挂牌报价" : source.kind === "ura_p50" ? "采用 URA P50 参考快照" : "采用 URA 平均值参考快照" };
}
export function propertyContext(inputs: ScenarioInputs, projects: Project[]) {
  const details = inputs.property ?? null;
  const project = projects.find(p => p.name === details?.project);
  return { details, project_available: !!project, comparables: project && details ? propertyComparables(project, details) : null, price_source: quoteSource(inputs, "price"), rent_source: quoteSource(inputs, "rent") };
}
export function referenceQuote(property: HousingProperty, project: Project, key: "price" | "rent", statistic: "p50" | "mean"): HousingQuote | null {
  const c = propertyComparables(project, property);
  const stat = key === "price" ? c.prices : c.rents;
  if (!stat) return null;
  return { kind: statistic === "p50" ? "ura_p50" : "ura_mean", amount: Math.round(stat[statistic]), project: project.name, area_sqft: propertySqft(property), band: c.band, bedrooms: property.bedrooms, bathrooms: null, read_at: project.read_at, url: null };
}
