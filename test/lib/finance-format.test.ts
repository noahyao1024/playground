import { describe, expect, it } from "vitest";
import { compactMoney, dayLabel, money, moneyAxis, original, percent, rate, timeTicks } from "@/lib/finance-format";

describe("money", () => {
  it("writes whole units with the unit's symbol and a true minus", () => {
    expect(money(1234567.89, "cny")).toBe("¥1,234,568");
    expect(money(-1500, "sgd")).toBe("−S$1,500");
    expect(money(12.345, "sgd", { decimals: 2 })).toBe("S$12.35");
  });

  it("signs a change, but never a zero", () => {
    expect(money(250, "cny", { sign: true })).toBe("+¥250");
    expect(money(-250, "cny", { sign: true })).toBe("−¥250");
    expect(money(-0.4, "cny", { sign: true })).toBe("¥0");
    expect(money(0.4, "cny", { sign: true })).toBe("¥0");
  });

  it("compacts for tiles and ticks", () => {
    expect(compactMoney(1_234_567, "cny")).toBe("¥1.2M");
    expect(compactMoney(-350_000, "sgd")).toBe("−S$350K");
    expect(compactMoney(0, "sgd")).toBe("S$0");
  });
});

describe("original", () => {
  it("keeps an amount in its own currency, with that currency's decimals", () => {
    expect(original(12345.6, "SGD")).toBe("12,345.60 SGD");
    expect(original(80000, "JPY")).toBe("80,000 JPY");
    expect(original(-20.5, "CNY")).toBe("−20.50 CNY");
  });
});

describe("percent and rate", () => {
  it("signs a percentage both ways", () => {
    expect(percent(0.0321)).toBe("+3.2%");
    expect(percent(-0.015)).toBe("−1.5%");
    expect(percent(0.00001)).toBe("0%");
  });

  it("keeps five significant digits, so a yen rate is not zero", () => {
    expect(rate(5.301234)).toBe("5.3012");
    expect(rate(0.0484567)).toBe("0.048457");
  });
});

describe("dates", () => {
  it("reads a day the same in every timezone", () => {
    expect(dayLabel("2026-09-30")).toBe("30 Sep 2026");
    expect(dayLabel("2026-01-01", { year: false })).toBe("1 Jan");
  });

  it("ticks a few weeks at the records themselves", () => {
    const days = ["2026-09-01", "2026-09-15", "2026-09-30"];
    const { ticks, format } = timeTicks(days);
    expect(ticks.map(format)).toEqual(["1 Sep", "15 Sep", "30 Sep"]);
  });

  it("ticks anything longer at month starts, thinned", () => {
    const { ticks, format } = timeTicks(["2025-09-30", "2026-09-30"], 6);
    const labels = ticks.map(format);
    expect(labels[0]).toBe("Oct ’25");
    expect(labels.length).toBeLessThanOrEqual(6);
    expect(ticks.every((t) => new Date(t).getUTCDate() === 1)).toBe(true);
    expect(timeTicks(["2026-09-01", "2026-12-15"]).ticks.map(format)).toEqual(["Sep ’26", "Oct ’26", "Nov ’26", "Dec ’26"]);
  });
});

describe("moneyAxis", () => {
  it("steps in 1s, 2s and 5s from zero when asked to reach it", () => {
    expect(moneyAxis([578_791, 1_308_371, 729_580]).ticks).toEqual([0, 500_000, 1_000_000, 1_500_000]);
    expect(moneyAxis([-215_200, 553_410]).ticks).toEqual([-400_000, -200_000, 0, 200_000, 400_000, 600_000]);
  });

  it("fits the data otherwise, so a few percent of movement shows", () => {
    const { domain, ticks } = moneyAxis([654_620, 729_580, 708_753], { zero: false });
    expect(ticks).toEqual([640_000, 660_000, 680_000, 700_000, 720_000, 740_000]);
    expect(domain).toEqual([640_000, 740_000]);
  });

  it("does not cross zero to fit, and copes with a single value", () => {
    expect(moneyAxis([10, 1000], { zero: false }).ticks[0]).toBe(0);
    expect(moneyAxis([-1000, -10], { zero: false }).ticks.at(-1)).toBe(0);
    const flat = moneyAxis([5000, 5000], { zero: false });
    expect(flat.ticks[0]).toBeLessThan(5000);
    expect(flat.ticks.at(-1)).toBeGreaterThan(5000);
    expect(moneyAxis([0, 0]).ticks.length).toBeGreaterThan(1);
  });

  it("never lands a tick on a float's crumbs", () => {
    for (const t of moneyAxis([0.1, 0.7], { zero: false }).ticks) expect(String(t).length).toBeLessThan(6);
  });
});
