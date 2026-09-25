import { afterEach, describe, expect, it, vi } from "vitest";
import { isFinanceCurrency, ratesOn } from "@/lib/fx";

/** Answers Frankfurter's URL with `body`, recording what was asked. */
function frankfurter(body: unknown, status = 200) {
  const asked: string[] = [];
  vi.stubGlobal("fetch", vi.fn(async (url: string) => {
    asked.push(String(url));
    return new Response(JSON.stringify(body), { status });
  }));
  return asked;
}

afterEach(() => { vi.unstubAllGlobals(); });

describe("ratesOn", () => {
  it("asks once, with CNY as the base, for every currency needed plus SGD", async () => {
    const asked = frankfurter({ date: "2026-09-30", rates: { SGD: 0.18, USD: 0.14 } });
    await ratesOn("2026-09-30", ["USD", "CNY", "USD"]);
    expect(asked).toEqual(["https://api.frankfurter.dev/v1/2026-09-30?base=CNY&symbols=USD,SGD"]);
  });

  it("turns units-per-CNY into CNY and SGD per unit", async () => {
    frankfurter({ date: "2026-09-30", rates: { SGD: 0.18, USD: 0.14 } });
    const { rates } = await ratesOn("2026-09-30", ["CNY", "SGD", "USD"]);
    expect(rates.CNY).toEqual({ cny: 1, sgd: 0.18 });
    expect(rates.SGD.cny).toBeCloseTo(1 / 0.18, 8);
    expect(rates.SGD.sgd).toBe(1);
    expect(rates.USD.cny).toBeCloseTo(1 / 0.14, 8);
    expect(rates.USD.sgd).toBeCloseTo(0.18 / 0.14, 8);
  });

  it("reports the trading day the rates are from, not the day asked for", async () => {
    frankfurter({ date: "2026-09-25", rates: { SGD: 0.18 } }); // asked on a Sunday
    expect((await ratesOn("2026-09-27", ["SGD"])).date).toBe("2026-09-25");
  });

  it("throws rather than guess when a rate is missing or the source fails", async () => {
    frankfurter({ date: "2026-09-30", rates: { SGD: 0.18 } });
    await expect(ratesOn("2026-09-30", ["HKD"])).rejects.toThrow("No HKD rate");
    frankfurter({ date: "2026-09-30", rates: {} });
    await expect(ratesOn("2026-09-30", ["CNY"])).rejects.toThrow("No SGD rate");
    frankfurter({ message: "not found" }, 404);
    await expect(ratesOn("2026-09-30", ["SGD"])).rejects.toThrow("unavailable (404)");
  });
});

describe("isFinanceCurrency", () => {
  it("takes the currencies an account may be kept in, and nothing else", () => {
    expect(["CNY", "SGD", "USD", "HKD"].every(isFinanceCurrency)).toBe(true);
    expect(["cny", "BTC", "", 1, null].some(isFinanceCurrency)).toBe(false);
  });
});
