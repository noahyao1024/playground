import { describe, expect, it } from "vitest";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { parseInputs, readInputs } from "@/lib/housing";
import { EMPTY_PROPERTY, linkHousingProject, listingFilters, listingUrl, parseProperty, propertyComparables, propertyContext, quoteSource, referenceQuote } from "@/lib/housing-property";
import { PropertyInputs } from "@/components/housing/property-inputs";
import { Developments } from "@/components/housing/developments";
import { housingInputs, housingProject } from "../helpers/housing-fixtures";

describe("property identity and comparable quotes", () => {
  const property = { ...EMPTY_PROPERTY, project: "EXAMPLE CONDO", area: 550, bedrooms: 1, bathrooms: 1 };
  it("keeps optional metadata, exact units and URLs through saves and legacy recovery", () => {
    const p = { ...property, buy_url: "https://www.propertyguru.com.sg/listing/for-sale-example-condo-123" };
    expect(parseInputs({ ...housingInputs(), property: p }).property).toEqual(p);
    expect(readInputs({ ...housingInputs(), price: -1, property: p }).property).toEqual(p);
    expect(parseInputs(housingInputs()).property).toBeUndefined();
    expect(parseProperty({})).toEqual(EMPTY_PROPERTY);
  });
  it.each(["javascript:alert(1)", "http://www.propertyguru.com.sg/listing/x", "https://propertyguru.com.sg.evil.example/x", "https://user:password@propertyguru.com.sg/x", "https://127.0.0.1/x", "https://propertyguru.com.sg:8443/x"])("rejects invalid or misleading source links: %s", url => {
    expect(() => listingUrl(url)).toThrow();
  });
  it.each([{ area: 0 }, { area: -1 }, { bedrooms: 1.5 }, { bathrooms: 0 }, { area_unit: "acre" }, { area_band: { low: 600, high: 500 } }])("validates dimensions independently of financial inputs: %j", value => {
    expect(() => parseProperty(value)).toThrow();
  });
  it("interprets search boundaries without inventing an exact property or quote", () => {
    const url = "https://www.propertyguru.com.sg/property-for-rent/2?search=true&listingType=rent&minPrice=2400&maxPrice=3600&minSize=680&bedrooms=1&bedrooms=3";
    expect(listingFilters(url)).toEqual({ search: true, type: "rent", min_price: 2400, max_price: 3600, min_sqft: 680, max_sqft: null, bedrooms: [1, 3] });
    const html = renderToStaticMarkup(createElement(PropertyInputs, { inputs: { ...housingInputs(), property: { ...EMPTY_PROPERTY, rent_url: url } }, projects: [], onChange: () => {} }));
    expect(html).toContain("这是搜索列表");
    expect(html).toMatch(/id="property-area"[^>]*value=""/);
    expect(html).not.toContain("将当前月租标记为此房源报价");
    expect(() => parseProperty({ rent_source: { kind: "listing", amount: 2400, url } })).toThrow("搜索列表");
  });
  it("links the correct market and lease while retaining actual quotes, AV, CPF and manual growth", () => {
    const i = { ...housingInputs(), market: "ALL:non-landed" as const, annual_value: 28000, rent_growth: 1.7, auto: ["growth" as const], guidance: { ...housingInputs().guidance!, lease_start: 2020, annual_value_auto: false } };
    const before = structuredClone(i);
    const linked = linkHousingProject(i, housingProject());
    expect(linked.market).toBe("OCR:non-landed");
    expect(linked.property?.project).toBe("EXAMPLE CONDO");
    expect(linked.guidance).toMatchObject({ lease_start: 2014, lease_term: 99, confirmed: false, annual_value_auto: false, cpf_scheme: i.guidance.cpf_scheme });
    for (const key of ["price", "rent", "rent_growth", "annual_value", "cpf_balance", "cpf_monthly", "auto"] as const) expect(linked[key]).toEqual(i[key]);
    expect(i).toEqual(before);
  });
  it("matches area bands and known rental bedrooms, excluding bulk sales and old observations", () => {
    const project = housingProject();
    project.sales.push({ ...project.sales.at(-1)!, price: 3_000_000, units: 2 });
    project.rents.push({ ...project.rents.at(-1)!, rent: 9900, bedrooms: 2 }, { ...project.rents.at(-1)!, rent: 8800, bedrooms: null });
    const c = propertyComparables(project, property);
    expect(c.band).toEqual({ low: 500, high: 600 });
    expect(c.prices).toMatchObject({ count: 2, p50: 760000 });
    expect(c.rents).toMatchObject({ count: 2, p50: 2500 });
    expect(propertyComparables(project, { ...property, area: 50, area_unit: "sqm" }).prices).toEqual(c.prices);
    expect(propertyComparables(project, { ...property, bedrooms: 2 }).rents).toMatchObject({ count: 1, p50: 9900 });
    expect(propertyComparables(project, { ...property, bathrooms: 4 })).toEqual(c);
    expect(c.notes.join(" ")).toContain("没有卧室和卫数");
  });
  it("does not fill a price from unrelated sizes or bedroom-only data", () => {
    expect(propertyComparables(housingProject(), { ...property, area: 850 }).prices).toBeNull();
    expect(propertyComparables(housingProject(), { ...property, area: null }).rents).toBeNull();
    expect(referenceQuote({ ...property, area: 850 }, housingProject(), "price", "p50")).toBeNull();
    expect(propertyComparables(housingProject(), { ...property, area: null, area_band: { low: 500, high: 600 } }).prices?.count).toBe(2);
  });
  it("stores an adopted reference snapshot and detects manual amount or context changes", () => {
    const source = referenceQuote(property, housingProject(), "price", "p50")!;
    const inputs = { ...housingInputs(), price: source.amount, property: { ...property, price_source: source } };
    expect(quoteSource(inputs, "price")).toMatchObject({ kind: "ura_p50", matches_input: true, context_matches: true });
    expect(quoteSource({ ...inputs, price: 800000 }, "price")).toMatchObject({ kind: "manual", matches_input: false });
    expect(quoteSource({ ...inputs, property: { ...inputs.property, area: 850 } }, "price").context_matches).toBe(false);
    const changed = housingProject();
    changed.sales.at(-1)!.price = 950000;
    const context = propertyContext(inputs, [changed]);
    expect(context.price_source.source?.amount).toBe(760000);
    expect(context.comparables?.prices?.p50).toBe(845000);
    expect(inputs.price).toBe(760000);
  });
  it("never infers a project from a scenario name or marks links as automatically scraped", () => {
    expect(propertyContext(housingInputs(), [housingProject()])).toMatchObject({ details: null, project_available: false, comparables: null, price_source: { kind: "manual" } });
    const html = renderToStaticMarkup(createElement(PropertyInputs, { inputs: housingInputs(), projects: [housingProject()], onChange: () => {} }));
    expect(html).toContain("不会自动抓取挂牌金额");
    expect(html).toContain("property-bathrooms");
  });
  it("does not offer a per-home comparison from only bulk transactions", () => {
    const project = housingProject();
    project.sales = project.sales.map(sale => ({ ...sale, units: 2 }));
    const html = renderToStaticMarkup(createElement(Developments, { projects: [project], ura: true, onFollow: async () => {}, onUnfollow: async () => {}, onCompare: () => {} }));
    expect(html).not.toContain("Rent or buy:");
    expect(html).toContain("更新 URA");
  });
});
