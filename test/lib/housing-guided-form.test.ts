import { describe, expect, it } from "vitest";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { NEW_DRAFT, RentOrBuy } from "@/components/housing/rent-or-buy";
import { GuidedInputs } from "@/components/housing/guided-inputs";
import { DEFAULT_INPUTS } from "@/lib/housing";
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
  it("explains that TOP is separate and shows a dynamic remaining lease", () => {
    const html = renderToStaticMarkup(createElement(GuidedInputs, { inputs:{...DEFAULT_INPUTS, guidance:{...newGuidance("2026-10-05"),tenure:"leasehold",lease_start:2000,build_year:2017,cpf_mode:"manual"}},onChange:()=>{} }));
    expect(html).toContain("剩余地契约 72.2 年");
    expect(html).toContain("基准年份楼龄约 9 年");
    expect(html).toContain("不是 TOP 年");
    expect(html).toContain("CPF 官方计算器");
  });
});
