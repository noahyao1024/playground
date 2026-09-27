import { describe, expect, it } from "vitest";
import { LIQUID_MIN_GAIN, holdingsOf, minGainOf, normalizeSymbol, positionsFromText, type StockPosition } from "@/lib/stocks";

// Made-up holdings: the owner's live in the database only.
const position = (symbol: string, quantity: number, cost: number, price: number | null, fx: number | null = 1, currency = "USD"): StockPosition => ({
  id: symbol, account_id: "acct", symbol, name: null, quantity, cost, currency, price, fx, priced_at: price === null ? null : "2026-09-28T06:00:00Z",
  note: null, created_at: "2026-09-28T00:00:00Z",
});

describe("a symbol", () => {
  it("is taken as the market spells it", () => {
    for (const s of ["AAPL", "BRK-B", "0700.HK", "600519.SS", "000001.SZ", "D05.SI", "7203.T", "^GSPC", "VOD.L"]) expect(normalizeSymbol(s)).toBe(s);
    expect(normalizeSymbol("  aapl ")).toBe("AAPL");
  });

  it("is read from the ways brokers write one", () => {
    expect(normalizeSymbol("US.AAPL")).toBe("AAPL");
    expect(normalizeSymbol("HK.00700")).toBe("0700.HK");
    expect(normalizeSymbol("HK.09988")).toBe("9988.HK");
    expect(normalizeSymbol("SH.600519")).toBe("600519.SS");
    expect(normalizeSymbol("SZ.000001")).toBe("000001.SZ");
    expect(normalizeSymbol("SG.D05")).toBe("D05.SI");
    // Bare codes: six digits an A-share, on the exchange its first digit says;
    // five from 0 Hong Kong's.
    expect(normalizeSymbol("600519")).toBe("600519.SS");
    expect(normalizeSymbol("510300")).toBe("510300.SS");
    expect(normalizeSymbol("000001")).toBe("000001.SZ");
    expect(normalizeSymbol("300750")).toBe("300750.SZ");
    expect(normalizeSymbol("00700")).toBe("0700.HK");
    expect(normalizeSymbol("00005")).toBe("0005.HK");
  });

  it("is refused when it cannot be one", () => {
    for (const s of ["", " ", "AA PL", ".HK", "TOO-LONG-A-SYMBOL-FOR-ANY-MARKET", "日经"]) expect(normalizeSymbol(s), s).toBeNull();
  });
});

describe("pasted positions", () => {
  it("read a line each -- symbol, shares, average cost, currency if given -- past headings and blanks", () => {
    const text = "Symbol  Quantity  Cost\n\nAAPL 100 150.25\nHK.00700\t200\t310\n600519,10,1500.5,CNY\nMSFT 1,000 $98\n";
    expect(positionsFromText(text)).toEqual({
      positions: [
        { symbol: "AAPL", quantity: 100, cost: 150.25 },
        { symbol: "0700.HK", quantity: 200, cost: 310 },
        { symbol: "600519.SS", quantity: 10, cost: 1500.5, currency: "CNY" },
        { symbol: "MSFT", quantity: 1000, cost: 98 },
      ],
    });
    expect(positionsFromText("代码 数量 成本\n00700 100 300")).toEqual({ positions: [{ symbol: "0700.HK", quantity: 100, cost: 300 }] });
  });

  it("say which line will not do, and why", () => {
    expect(positionsFromText("AAPL 100 150\nMSFT ten 98")).toEqual({ problem: "Line 2: write the symbol, the shares and the average cost, as AAPL 100 150.25" });
    expect(positionsFromText("AAPL 0 150")).toEqual({ problem: "Line 1: write the symbol, the shares and the average cost, as AAPL 100 150.25" });
    expect(positionsFromText("AAPL 10 -1")).toMatchObject({ problem: expect.stringMatching(/^Line 1:/) });
    expect(positionsFromText("AAPL 10 1 US DOLLAR")).toMatchObject({ problem: expect.stringMatching(/^Line 1:/) });
    expect(positionsFromText("AAPL 10 1\nUS.AAPL 5 1")).toEqual({ problem: "Line 2: AAPL is already listed" });
    expect(positionsFromText("\n  \n")).toEqual({ problem: "Nothing to import: a line each, as AAPL 100 150.25" });
  });
});

describe("holdings", () => {
  it("value each position in the account's currency, and count as liquid those up by more than the threshold", () => {
    const held = holdingsOf([
      position("UP", 10, 100, 120), // +20%: liquid
      position("EDGE", 10, 100, 110), // +10% exactly: not more than 10
      position("DOWN", 10, 100, 90), // -10%
      position("HKD", 100, 10, 12, 0.13, "HKD"), // +20%, at 0.13 of the account's currency a dollar
    ]);
    // 1200 + 1100 + 900 + 100 × 12 × 0.13 = 156.
    expect(held.value).toBeCloseTo(3356, 10);
    expect(held.cost).toBeCloseTo(3000 + 130, 10);
    expect(held.liquid_value).toBeCloseTo(1200 + 156, 10);
    expect(held.liquidity).toBeCloseTo(1356 / 3356, 12);
    expect(held.holdings.map((h) => [h.position.symbol, h.liquid])).toEqual([["UP", true], ["EDGE", false], ["DOWN", false], ["HKD", true]]);
    expect(held.holdings.find((h) => h.position.symbol === "HKD")!.gain).toBeCloseTo(0.2, 12);
    expect(held.gain).toBeCloseTo(3356 / 3130 - 1, 12);
  });

  it("follow the account's threshold, and count a position held at no cost as liquid", () => {
    const positions = [position("UP", 10, 100, 120), position("FREE", 5, 0, 50)];
    expect(holdingsOf(positions, 25).liquid_value).toBe(250);
    expect(holdingsOf(positions, 15).liquid_value).toBe(1450);
    expect(holdingsOf(positions).holdings.find((h) => h.position.symbol === "FREE")).toMatchObject({ gain: null, liquid: true });
    // A negative threshold: a position down less than it counts.
    expect(holdingsOf([position("DOWN", 10, 100, 95)], -10).liquidity).toBe(1);
  });

  it("leave out a position never priced, and say so", () => {
    const held = holdingsOf([position("UP", 10, 100, 120), position("NEW", 10, 100, null, null)]);
    expect(held).toMatchObject({ value: 1200, unpriced: ["NEW"], liquidity: 1 });
    expect(holdingsOf([]).liquidity).toBe(0);
  });

  it("take the account's threshold, or 10", () => {
    expect(LIQUID_MIN_GAIN).toBe(10);
    expect(minGainOf({})).toBe(10);
    expect(minGainOf({ liquid_min_gain: null })).toBe(10);
    expect(minGainOf({ liquid_min_gain: "12.5" })).toBe(12.5);
    expect(minGainOf({ liquid_min_gain: 0 })).toBe(0);
  });
});
