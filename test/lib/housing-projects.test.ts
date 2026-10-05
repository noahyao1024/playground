import { describe, expect, it } from "vitest";
import {
  SQFT_PER_SQM, bandLabel, byBand, byBedrooms, byQuarter, lastYear, projectName, psfOf, summarize,
  type ProjectRent, type ProjectSale,
} from "@/lib/housing-projects";

/** A sale of `sqft` square feet for `price`, in `month`. */
const sale = (month: string, price: number, sqft: number, extra: Partial<ProjectSale> = {}): ProjectSale => ({
  month, price, area_sqm: sqft / SQFT_PER_SQM, floor_range: "06-10", sale_type: "resale", property_type: "Condominium", units: 1, ...extra,
});
/** A lease of a home in a band of square feet. */
const lease = (month: string, rent: number, low: number | null, high: number | null, bedrooms: number | null = null): ProjectRent => ({
  quarter: `${month.slice(0, 5)}${String(Math.floor((Number(month.slice(5, 7)) - 1) / 3) * 3 + 1).padStart(2, "0")}-01`,
  month, rent, sqft_low: low, sqft_high: high, bedrooms,
});

describe("projectName", () => {
  it("writes a development's name as URA does, and nothing that is not one", () => {
    expect(projectName("  watertown ")).toBe("WATERTOWN");
    expect(projectName("the   Tapestry")).toBe("THE TAPESTRY");
    for (const bad of ["", "   ", 42, null, "x".repeat(81)]) expect(projectName(bad)).toBeNull();
  });
});

describe("summarize", () => {
  it("counts, takes the quartiles between neighbours, and the average", () => {
    expect(summarize([4, 1, 3, 2])).toEqual({ count: 4, p25: 1.75, p50: 2.5, p75: 3.25, mean: 2.5 });
    expect(summarize([7])).toEqual({ count: 1, p25: 7, p50: 7, p75: 7, mean: 7 });
    expect(summarize([])).toBeNull();
  });
});

describe("a development's figures", () => {
  // Sales from 2025-03 to 2026-08; leases from 2025-10 to 2026-09.
  const sales = [
    sale("2025-03-01", 900_000, 700),     // more than a year before the latest sale
    sale("2025-09-01", 1_000_000, 750),
    sale("2026-02-01", 1_100_000, 760),
    sale("2026-05-01", 1_500_000, 1_050),
    sale("2026-08-01", 1_550_000, 1_080),
    sale("2026-08-01", 2_000_000, 1_450), // no lease in a band holding it
  ];
  const rents = [
    lease("2025-10-01", 3_200, 700, 800, 2),
    lease("2026-01-01", 3_400, 700, 800, 2),
    lease("2026-04-01", 3_300, 700, 800, 3),
    lease("2026-07-01", 4_500, 1_000, 1_100, 3),
    lease("2026-09-01", 4_700, 1_000, 1_100, 3),
    lease("2026-09-01", 2_500, null, 500, 1),
  ];
  const project = { sales, rents };

  it("takes the latest twelve months of each, sales to the latest sale and leases to the latest lease", () => {
    const year = lastYear(project);
    expect(year.salesFrom).toBe("2025-09-01");
    expect(year.sales.map((s) => s.month)).toEqual(["2025-09-01", "2026-02-01", "2026-05-01", "2026-08-01", "2026-08-01"]);
    expect(year.rentsFrom).toBe("2025-10-01");
    expect(year.rents).toHaveLength(6);
    expect(lastYear({ sales: [], rents: [] })).toEqual({ sales: [], rents: [], salesFrom: null, rentsFrom: null });
  });

  it("puts each sale in the rental band holding its area, or a hundred square feet of its own, and sums each band up", () => {
    const rows = byBand(project);
    expect(rows.map((r) => r.label)).toEqual(["Up to 500 sqft", "700–800 sqft", "1,000–1,100 sqft", "1,400–1,500 sqft"]);
    const [small, two, three, big] = rows;
    expect(small).toMatchObject({ prices: null, psf: null, rents: { count: 1, p50: 2_500 }, bedrooms: 1, yield: null });
    // 750 and 760 sq ft sold, the 700 sq ft sale of March 2025 too old to count.
    expect(two.prices).toMatchObject({ count: 2, p50: 1_050_000, mean: 1_050_000 });
    expect(two.psf!.p50).toBeCloseTo((1_000_000 / 750 + 1_100_000 / 760) / 2, 6);
    expect(two.rents).toMatchObject({ count: 3, p50: 3_300 });
    // Two leases with two bedrooms, one with three: two.
    expect(two.bedrooms).toBe(2);
    expect(two.yield).toBeCloseTo((3_300 * 12) / 1_050_000, 12);
    expect(three).toMatchObject({ prices: { count: 2, p50: 1_525_000 }, rents: { count: 2, p50: 4_600, mean: 4_600 }, bedrooms: 3 });
    expect(big).toMatchObject({ prices: { count: 1, p50: 2_000_000 }, rents: null, bedrooms: null, yield: null });
    expect(big.band).toEqual({ low: 1_400, high: 1_500 });
  });

  it("counts a sale of several units at its price each", () => {
    const rows = byBand({ sales: [sale("2026-08-01", 3_000_000, 1_500, { units: 2 })], rents: [] });
    expect(rows[0].prices!.p50).toBe(1_500_000);
    expect(rows[0].psf!.p50).toBeCloseTo(2_000, 9);
    expect(psfOf(sale("2026-08-01", 1_000_000, 1_000))).toBeCloseTo(1_000, 9);
  });

  it("sums the latest year's leases up by bedrooms, those not saying last", () => {
    expect(byBedrooms(project).map((b) => [b.bedrooms, b.rents.count, b.rents.p50])).toEqual([[1, 1, 2_500], [2, 2, 3_300], [3, 3, 4_500]]);
    expect(byBedrooms({ sales: [], rents: [lease("2026-09-01", 4_000, 1_000, 1_100, null), lease("2026-09-01", 3_000, 700, 800, 2)] }).map((b) => b.bedrooms)).toEqual([2, null]);
  });

  it("sums every quarter up from the first record to the last, the quiet ones too", () => {
    const rows = byQuarter(project);
    expect(rows[0]).toMatchObject({ quarter: "2025-Q1", label: "Q1 2025", psf: { count: 1 }, rents: null });
    expect(rows.map((r) => r.quarter)).toEqual(["2025-Q1", "2025-Q2", "2025-Q3", "2025-Q4", "2026-Q1", "2026-Q2", "2026-Q3"]);
    expect(rows[1]).toMatchObject({ psf: null, rents: null });
    expect(rows[6].psf!.count).toBe(2);
    expect(rows[6].rents).toMatchObject({ count: 3, p50: 4_500 });
    expect(byQuarter({ sales: [], rents: [] })).toEqual([]);
  });

  it("writes a band as people read it", () => {
    expect([bandLabel({ low: 1_000, high: 1_100 }), bandLabel({ low: null, high: 500 }), bandLabel({ low: 3_000, high: null })])
      .toEqual(["1,000–1,100 sqft", "Up to 500 sqft", "3,000 sqft and up"]);
  });
});
