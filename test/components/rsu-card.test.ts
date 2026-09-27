import { describe, expect, it } from "vitest";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { RsuCard } from "@/components/finance/rsu-card";
import type { FinanceAccount } from "@/lib/finance";
import type { RsuGrant, RsuRules } from "@/lib/rsu";

// A made-up plan and grants, as in the engine's own tests: the owner's real
// ones live in the database only.
const rules: RsuRules = {
  currency: "USD",
  windows: { months: [3, 9], cutoff_day: 15 },
  profiles: { standard: { label: "Standard", rates: [40, 50, 60] }, full: { rates: [100] } },
  verified_through: "2027-03-15",
};
const grant = (grant_no: string, profile: string, tranches: Array<[string, number]>, signed = true): RsuGrant => ({
  id: grant_no, account_id: "equity", grant_no, label: null, profile, granted_on: null, vest_start: null, signed,
  tranches: tranches.map(([vests_on, shares]) => ({ vests_on, shares })), note: null, created_at: "2026-01-01T00:00:00Z",
});
const account = (extra: Partial<FinanceAccount> = {}): FinanceAccount => ({
  id: "equity", name: "Equity", institution: "Acme", region: "SG", currency: "SGD", kind: "asset", category: "investment",
  note: null, sort_order: 0, archived_at: null, created_at: "2026-01-01T00:00:00Z",
  rsu_plan: "tiktok", rsu_rules: rules, rsu_sales: [],
  rsu_grants: [
    grant("G1", "standard", [["2025-03-15", 100], ["2025-09-16", 30], ["2026-03-14", 7]]),
    grant("G2", "full", [["2025-05-20", 12]]),
    grant("G3", "standard", [["2025-09-15", 20]], false),
  ],
  ...extra,
} as FinanceAccount);

const render = (accounts: FinanceAccount[], today = "2025-12-31") => renderToStaticMarkup(createElement(RsuCard, {
  accounts, today, onSaved: () => {}, onRecorded: () => {}, onConfirm: () => {},
}));
/** The page's words, without the markup between them. */
const text = (html: string) => html.replace(/<[^>]+>/g, " ").replace(/&#x27;|&rsquo;/g, "'").replace(/\s+/g, " ");

describe("the RSU card", () => {
  it("shows where the shares stand and what the next window may buy, window by window", () => {
    const shown = text(render([account()]));
    expect(shown).toContain("142 held");
    expect(shown).toContain("7 still to vest");
    expect(shown).toContain("20 in a grant not yet signed");
    // March 2026: 100 × 50% + 12 × 100% + 30 × 40% + 7 × 40% = 76.8, rounded down.
    expect(shown).toMatch(/This window 76 shares/);
    expect(shown).toContain("Mar 2026 · cutoff");
    // The outlook: March's 76, September's nothing new, March 2027's 90 less 76.
    // From September G2 has outlived its profile's one rate, so the rows after
    // are projections.
    expect(shown).toMatch(/Mar 2026 76 76 Sept? 2026 \* 76 0 Mar 2027 \* 90 14/);
    expect(shown).toContain("Grants (3)");
  });

  it("leaves out accounts that hold no RSUs, or whose rules do not read", () => {
    expect(render([account({ rsu_plan: null, rsu_rules: null })])).toBe("");
    expect(render([account({ rsu_rules: { ...rules, windows: { months: [13], cutoff_day: 1 } } })])).toBe("");
    expect(render([account({ kind: "liability", category: "loan" })])).toBe("");
    expect(render([account({ archived_at: "2026-01-01T00:00:00Z" })])).toBe("");
  });

  it("asks for a grant when there is none yet", () => {
    expect(text(render([account({ rsu_grants: [] })]))).toContain("No grants yet");
  });
});
