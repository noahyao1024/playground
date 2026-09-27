import { describe, expect, it } from "vitest";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { StocksCard } from "@/components/finance/stocks-card";
import type { FinanceAccount } from "@/lib/finance";
import type { StockPosition } from "@/lib/stocks";

// Made-up holdings: the owner's live in the database only.
const position = (symbol: string, quantity: number, cost: number, price: number | null, fx = 1.6, currency = "USD", name: string | null = null): StockPosition => ({
  id: symbol, account_id: "broker", symbol, name, quantity, cost, currency, price, fx: price === null ? null : fx,
  priced_at: price === null ? null : "2026-09-28T03:00:00Z", note: null, created_at: "2026-09-01T00:00:00Z",
});
const account = (extra: Partial<FinanceAccount> = {}): FinanceAccount => ({
  id: "broker", name: "Broker", institution: null, region: "SG", currency: "SGD", kind: "asset", category: "investment",
  note: null, sort_order: 0, archived_at: null, created_at: "2026-01-01T00:00:00Z", stock_positions: [], ...extra,
} as FinanceAccount);

const render = (accounts: FinanceAccount[]) => renderToStaticMarkup(createElement(StocksCard, { accounts, onChanged: () => {}, onConfirm: () => {} }));
const text = (html: string) => html.replace(/<[^>]+>/g, " ").replace(/&#x27;|&rsquo;/g, "'").replace(/\s+/g, " ");

describe("the stocks card", () => {
  it("values each position, largest first, and says how much is liquid", () => {
    const shown = text(render([account({
      stock_positions: [
        position("AAPL", 10, 150, 200, 1.6, "USD", "Apple Inc."),
        position("MSFT", 5, 380, 400, 1.6, "USD", "Microsoft Corporation"),
        position("0700.HK", 100, 300, 400, 0.2, "HKD"),
      ],
    })]));
    // 3,200 + 3,200 + 8,000; 11,200 of it in positions up more than 10%.
    expect(shown).toContain("14,400.00 SGD");
    expect(shown).toContain("Liquid 11,200.00 SGD (77.8%): 2 of 3 up more than");
    expect(shown).toMatch(/0700\.HK 100 × 400\.00 HKD · cost 300\.00 8,000\.00 \+33\.3% Liquid/);
    expect(shown).toMatch(/MSFT Microsoft Corporation 5 × 400\.00 USD · cost 380\.00 3,200\.00 \+5\.3%/);
    expect(shown.indexOf("0700.HK")).toBeLessThan(shown.indexOf("AAPL"));
  });

  it("leaves a position not yet priced out, and says so", () => {
    const shown = text(render([account({ stock_positions: [position("AAPL", 10, 150, 200), position("NEW", 1, 10, null)] })]));
    expect(shown).toContain("Not priced yet, so left out: NEW");
    expect(shown).toContain("3,200.00 SGD");
  });

  it("offers to import when nothing is held, and is not there without an account to hold anything", () => {
    expect(text(render([account()]))).toContain("No positions yet. Import them from your broker");
    expect(render([account({ kind: "liability", category: "loan" })])).toBe("");
    expect(render([account({ rsu_plan: "tiktok" })])).toBe("");
  });
});
