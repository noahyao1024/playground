import { describe, expect, it } from "vitest";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { NEW_DRAFT, RentOrBuy } from "@/components/housing/rent-or-buy";
import { GuidedInputs } from "@/components/housing/guided-inputs";
import { DEFAULT_INPUTS, EQUITY_SEGMENT, type MarketData, type MarketSeries } from "@/lib/housing";
import { newGuidance } from "@/lib/housing-guidance";

describe("guided housing form", () => {
  it("starts with empty required prices and hides the verdict and advanced numbers", () => {
    const html = renderToStaticMarkup(createElement(RentOrBuy, {draft:NEW_DRAFT, setDraft:()=>{}, market:{series:[],refreshed_at:null}, scenarios:[], onSaved:()=>{}, onDeleted:()=>{}, onConfirm:()=>{}}));
    expect(html).toContain("完成必填项后显示比较");
    expect(html).toContain("quick-price");
    expect(html).toContain("quick-rent");
    expect(html).toContain("粗估待填写月租");
    expect(html).not.toContain("rb-renovation");
    expect(html).not.toContain("房贷月供");
    expect(html).toMatch(/id="quick-price"[^>]*value=""/);
  });
  it("asks the lease, not the TOP year, and shows the lease left", () => {
    const html = renderToStaticMarkup(createElement(GuidedInputs, { inputs:{...DEFAULT_INPUTS, guidance:{...newGuidance("2026-10-05"),tenure:"leasehold",lease_start:2000,cpf_mode:"manual"}},onChange:()=>{} }));
    expect(html).toContain("剩余地契约 72.2 年");
    expect(html).not.toContain("guide-build_year");
    expect(html).toContain("不是 TOP 年");
    expect(html).toContain("CPF 官方计算器");
  });

  it("says when a comparison looks further ahead than futures are drawn, rather than wait for them for ever", () => {
    // Every series HDB's futures replay, a quarter at a time for 23 years.
    const n = 92;
    const moving = (series: MarketSeries["series"], area: string, segment: string, rate: number, from = 100): MarketSeries => {
      const values = [from];
      for (let k = 1; k < n; k++) values.push(values[k - 1] * (1 + rate + Math.sin(k) / 100));
      return { series, area, segment, start: "2004-Q1", values };
    };
    const yields = (series: MarketSeries["series"], segment: string, premium: number): MarketSeries =>
      ({ series, area: "ALL", segment, start: "2004-Q1", values: Array.from({ length: n }, (_, k) => 1.5 + Math.sin(k / 5) + premium) });
    const market: MarketData = {
      series: [
        moving("hdb_rpi", "ALL", "all", 0.01),
        ...[0, 1, 2, 3, 4].map((t) => moving("hdb_rent", `TOWN ${t}`, "4-room", 0.008, 2_000)),
        moving("cpi", "ALL", "all", 0.005),
        moving("equity", "ALL", EQUITY_SEGMENT, 0.02),
        yields("sora", "3m", 0),
        ...[1, 2, 5, 10].map((t) => yields("sgs", `${t}y`, t / 10)),
      ],
      refreshed_at: null,
    };
    const render = (years: number) => renderToStaticMarkup(createElement(RentOrBuy, {
      draft: { id: null, name: "", inputs: { ...DEFAULT_INPUTS, years, guidance: { ...newGuidance("2026-10-05"), confirmed: true, tenure: "leasehold", lease_start: 2020 } } },
      setDraft: () => {}, market, scenarios: [], onSaved: () => {}, onDeleted: () => {}, onConfirm: () => {},
    }));
    const far = render(99);
    expect(far).toContain("Futures are drawn for up to 35 years ahead");
    expect(far).not.toContain("Drawing futures");
    // At the limit they are drawn -- and a page rendered once has yet to.
    const near = render(35);
    expect(near).toContain("Drawing futures");
    expect(near).not.toContain("Futures are drawn for up to");
  });
});
