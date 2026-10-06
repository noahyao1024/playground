"use client";
import { Input } from "@/components/ui/input";
import { NumberInput } from "@/components/ui/number-input";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { dayInSG } from "@/lib/dates";
import { CPF_PR_RULES, newGuidance, prContributionYear, remainingLease, salaryOa, type HousingGuidance } from "@/lib/housing-guidance";
import type { ScenarioInputs } from "@/lib/housing";
import { Card } from "./market-view";

export function GuidedInputs({ inputs, onChange: changeInputs }: { inputs: ScenarioInputs; onChange: (v: Partial<ScenarioInputs>) => void }) {
  const g = inputs.guidance ?? { ...newGuidance(dayInSG(new Date())), annual_value_auto: false };
  const onChange = (v: Partial<ScenarioInputs>) => changeInputs({ guidance: g, ...v });
  const update = (v: Partial<HousingGuidance>) => onChange({ guidance: {
    ...g,
    ...(v.cpf_mode === "salary" && g.cpf_mode !== "salary" ? { cpf_rules: CPF_PR_RULES, cpf_scheme: "graduated" as const } : {}),
    ...v,
  } });
  const oldCpf = g.cpf_rules === "2026-2027-v1";
  const prYear = inputs.residency === "pr" ? prContributionYear(g.pr_since, g.as_of) : 3;
  const salaryReady = g.cpf_eligible && g.salary !== null && g.age !== null && inputs.residency !== "foreigner" && (inputs.residency !== "pr" || oldCpf || prYear > 0);
  const numeric = (key: "salary" | "age" | "lease_start" | "lease_term" | "retirement_age" | "cpf_limit", label: string, help?: string) => <div className="space-y-1.5" key={key}>
    <Label htmlFor={`guide-${key}`} className="text-xs">{label}</Label>
    <NumberInput id={`guide-${key}`} value={g[key] ?? NaN} emptyValue={NaN} onValueChange={v => update({ [key]: Number.isFinite(v) ? v : null })} step={key === "salary" || key === "cpf_limit" ? 100 : 1} className="h-9" />
    {help && <p className="text-xs text-muted-foreground">{help}</p>}
  </div>;
  const left = remainingLease(g);
  const select = (id: string, label: string, value: string, options: [string,string][], change: (v:string)=>void) => <div className="space-y-1.5">
    <Label htmlFor={id} className="text-xs">{label}</Label>
    <select id={id} value={value} onChange={e=>change(e.target.value)} className="h-9 w-full rounded-md border bg-background px-2 text-sm">{options.map(([v,l])=><option key={v} value={v}>{l}</option>)}</select>
  </div>;
  return <>
    {!inputs.guidance && <p className="text-xs text-muted-foreground">旧方案保留原计算。修改简化输入后将启用地契与 CPF 额度核对；请重新确认身份。</p>}
    <Card title="先填两项金额" sub="必填：目标房屋价格、相似整套房的月租。金额均为新币；报价不是成交价。">
      <div className="grid grid-cols-2 gap-3">
        {(["price", "rent"] as const).map(key=><div key={key} className="space-y-1.5">
          <Label htmlFor={`quick-${key}`}>{key === "price" ? "购房价格 *" : "整套月租 *"}</Label>
          <NumberInput id={`quick-${key}`} value={inputs[key]} emptyValue={NaN} required min={key === "price" ? 10000 : 0} step={key === "price" ? 10000 : 100} onValueChange={v=>onChange({[key]:v})}/>
          <p className="text-xs text-muted-foreground">{key === "price" ? "例如 PropertyGuru 当前挂牌价，可改为议价后的价格。" : "选相近面积、房型及装修的整套租金；不填单间租金。"}</p>
        </div>)}
      </div>
      <div className="mt-3 space-y-1.5">{select("quick-renovation", "装修预算模板（粗估，可在高级设置自定义）", String(inputs.renovation), [["0","无需装修：S$0"],["30000","简单装修：S$30,000"],["80000","较多装修：S$80,000"],...(![0,30000,80000].includes(inputs.renovation) ? [[String(inputs.renovation),`自定义：S$${inputs.renovation.toLocaleString()}`] as [string,string]] : [])],v=>onChange({renovation:Number(v)}))}</div>
      <div className="mt-3 grid grid-cols-2 gap-3">
        {select("quick-residency", "买方身份 *", inputs.residency, [["citizen","新加坡公民"],["pr","永久居民 PR"],["foreigner","外国人"]], v=>onChange({residency:v as ScenarioInputs["residency"]}))}
        {select("quick-nth", "购买后拥有房产数 *", String(inputs.nth), [["1","第一套"],["2","第二套"],["3","第三套及以上"]], v=>onChange({nth:Number(v)}))}
        {select("quick-kind", "房屋类型 *", inputs.kind, [["private","私人住宅 / 公寓"],["hdb","HDB 组屋"]], v=>onChange({kind:v as ScenarioInputs["kind"], maintenance:v === "private" ? 350 : 90}))}
        {select("quick-loan", "贷款方式（可调整）", inputs.loan_share === 0 ? "none" : inputs.loan_type, [["bank","银行贷款"],...(inputs.kind === "hdb" ? [["hdb","HDB 贷款"] as [string,string]] : []),["none","不贷款"]],v=>onChange(v === "none" ? {loan_share:0} : {loan_type:v as ScenarioInputs["loan_type"],loan_share:75}))}
      </div>
      <Label className="mt-3 flex items-start gap-2 text-xs font-normal"><input type="checkbox" checked={g.confirmed} onChange={e=>update({confirmed:e.target.checked})}/>我已确认以上身份、房产数及类型（用于税费估算；联名购房或减免请另核实）。</Label>
      <p className="mt-3 text-xs text-muted-foreground">默认估算：贷款 {inputs.loan_share}% / {inputs.loan_years} 年，装修 S${inputs.renovation.toLocaleString()}，维护 S${inputs.maintenance}/月，法律等费用 S${inputs.buy_costs.toLocaleString()}。均可在高级设置修改。房产税使用 AV {g.annual_value_auto ? (Number.isFinite(inputs.rent) ? `粗估 S$${(Math.min(10000000, inputs.rent * 12)).toLocaleString()}/年（整套月租 × 12，上限一千万）` : "粗估待填写月租") : `手动 S$${inputs.annual_value.toLocaleString()}/年`}：请在 IRAS 核实，挂牌月租 × 12 仅为粗略替代值。</p>
    </Card>
    <Card title="比较多久？房子的地契还剩多久？" sub="持有期、贷款期和地契期是三个不同的年限。99 年是原始地契，不一定是今天的剩余年限。">
      <div className="flex flex-wrap gap-2">{[5,10,15,20,30,99].map(v=><Button type="button" size="sm" variant={inputs.years===v ? "default":"outline"} key={v} onClick={()=>onChange({years:v})}>{v} 年</Button>)}</div>
      <div className="mt-3 space-y-3">
        <Label htmlFor="quick-years" className="text-xs">持有期（必填，1–99 年；默认 15 年）</Label>
        <NumberInput id="quick-years" value={inputs.years} step={1} min={1} max={99} emptyValue={NaN} onValueChange={v=>onChange({years:v})}/>
        {select("quick-tenure", "地契类型（未知时不估算衰减；从关注的楼盘比较时按 URA 记录自动填写）",g.tenure,[["unknown","暂不清楚"],["freehold","永久地契"],["leasehold","有期限地契"]],v=>update({tenure:v as HousingGuidance["tenure"]}))}
        {g.tenure === "leasehold" && <div className="grid grid-cols-2 gap-3">{numeric("lease_start","地契起始年份 *","从地契 / 项目资料查找，不是 TOP 年。")}{numeric("lease_term","原始地契（年） *","通常为 99 或 999 年。")}</div>}
        <Label htmlFor="quick-asof" className="text-xs">计算基准日期（保存后保留，用于复现比较）</Label>
        <Input id="quick-asof" type="date" value={g.as_of} onChange={e=>update({as_of:e.target.value})}/>
        <Button type="button" size="sm" variant="outline" onClick={()=>update({as_of:dayInSG(new Date())})}>更新为今天</Button>
        {left !== null && <p className="text-sm">剩余地契约 {left.toFixed(1)} 年（按起始年 1 月 1 日估算）。<Button type="button" variant="link" size="sm" onClick={()=>onChange({years:Math.max(1,Math.min(99,Math.ceil(left)))})}>比较到地契到期</Button></p>}
        {g.tenure === "leasehold" && <p className="text-xs text-muted-foreground">长期价值采用 3% 折现的居住权衰减假设；到期价值为零，之后改计租房费用。不假设续期、集体出售或政府补偿。</p>}
        {inputs.years > 35 && <p className="text-xs text-muted-foreground">超过 35 年仅探索长期假设，不提供未来胜率预测。</p>}
      </div>
    </Card>
    <Card title="CPF：工资辅助估算（选填）" sub="月薪不能单独决定 OA；还需年龄及缴款资格。现有 OA 余额另填，高级设置可手动填月缴款。">
      <div className="space-y-3">
        {select("quick-cpf", "CPF 方式",g.cpf_mode,[["none","暂不使用 CPF（全按现金）"],["salary","由工资估算 OA"],["manual","手动输入 OA 月缴款"]],v=>update({cpf_mode:v as HousingGuidance["cpf_mode"]}))}
        {g.cpf_mode === "salary" && <>
          <div className="grid grid-cols-2 gap-3">{numeric("salary","税前月薪（S$） *","不含奖金及额外工资。")}{numeric("age","当前年龄 *")}{numeric("retirement_age","停止缴款年龄（默认 65）")}</div>
          {inputs.residency === "pr" && <div className="space-y-2">
            {oldCpf && <p className="text-xs text-muted-foreground">旧方案保留完整费率假设；填写 PR 日期后启用分阶段估算。</p>}
            <Label htmlFor="quick-pr-since" className="text-xs">拿到 PR 的日期 {oldCpf ? "（填写后启用新估算）" : "*"}</Label>
            <Input id="quick-pr-since" type="date" value={g.pr_since ?? ""} max={g.as_of} required={!oldCpf} onChange={e=>update({pr_since:e.target.value || null,cpf_rules:CPF_PR_RULES,...(oldCpf ? {cpf_scheme:"graduated" as const}: {})})}/>
            {!oldCpf && select("quick-cpf-scheme", "PR 缴款方式",g.cpf_scheme,[["graduated","标准分阶段（G/G）"],["full","已获批双方按完整费率（F/F）"]],v=>update({cpf_scheme:v as HousingGuidance["cpf_scheme"]}))}
            {!oldCpf && prYear > 0 && <p className="text-xs text-muted-foreground">当前 PR 费率阶段：{prYear === 3 ? "第三年起" : `第 ${prYear} 年`}。阶段从周年后的下个月切换；55 岁及以下、月薪超过 S$750 时，标准总缴款率为 9% / 24% / 37%，OA 只占其中一部分。</p>}
            <p className="text-xs text-muted-foreground">拿到 PR 当月按自然日粗估应缴工资，之后按整月；工资单的实际分摊、F/G、奖金、自雇或特殊账户分配请手动输入 OA。<a className="underline" href="https://www.cpf.gov.sg/service/article/how-do-i-determine-the-year-of-my-singapore-permanent-resident-status-for-the-purpose-of-cpf-contributions" target="_blank" rel="noreferrer">CPF 阶段规则</a></p>
          </div>}
          <Label className="flex items-start gap-2 text-xs font-normal"><input type="checkbox" checked={g.cpf_eligible} onChange={e=>update({cpf_eligible:e.target.checked})}/>我是受雇公民或 PR，适用标准 CPF 雇员缴款规则。自雇、特殊费率或账户分配请手动输入。</Label>
          <p className="text-sm">当前 OA 估算：{salaryReady ? `S$${salaryOa(g, 0, inputs.residency).toLocaleString()}/月` : `待填写工资、年龄${inputs.residency === "pr" && !oldCpf ? "、PR 日期" : ""}及缴款资格`}</p>
          <p className="text-xs text-muted-foreground">采用 <a className="underline" href="https://www.cpf.gov.sg/employer/infohub/news/cpf-related-announcements/new-contribution-rates" target="_blank" rel="noreferrer">2026 / 2027 CPF 规则</a>，普通工资上限 S$8,000；只计算 OA，每年调整年龄并在设定年龄停缴。2027 年起采用已公布的新规则，之后沿用该规则；不含奖金或退休账户溢出。</p>
        </>}
        {g.cpf_mode !== "none" && <>
          <Label htmlFor="quick-oa" className="text-xs">现有 OA 余额（S$，默认 0，来自 CPF 账户）</Label>
          <NumberInput id="quick-oa" value={inputs.cpf_balance} min={0} onValueChange={v=>onChange({cpf_balance:v})}/>
          {g.cpf_mode === "manual" && <><Label htmlFor="quick-oa-monthly" className="text-xs">OA 月缴款（S$）</Label><NumberInput id="quick-oa-monthly" value={inputs.cpf_monthly} min={0} onValueChange={v=>onChange({cpf_monthly:v})}/>{numeric("age","最年轻买方年龄（选填，地契资格核对）")}</>}
          {numeric("cpf_limit","经核实的 CPF 买房总额度（S$，选填）","不含应计利息；可填比默认额度更低的银行估值限制。")}
          <p className="text-xs text-muted-foreground">永久地契默认最多使用购价的 100%；有期限地契需超过 20 年且覆盖最年轻买方到 95 岁。否则在额度未核实前按现金计算。请用 <a className="underline" href="https://www.cpf.gov.sg/member/tools-and-services/calculators/cpf-housing-usage" target="_blank" rel="noreferrer">CPF 官方计算器</a> 核实；贷款获批及 CPF 使用资格需另外确认。</p>
        </>}
      </div>
    </Card>
  </>;
}
