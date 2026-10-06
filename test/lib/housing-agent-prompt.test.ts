import { describe, expect, it } from "vitest";
import { housingAgentPrompt } from "@/lib/housing-agent-prompt";

describe("copyable housing agent instructions",()=>{
  it("uses the actual deployment host, encoded selection and both working protocols",()=>{
    const prompt=housingAgentPrompt("https://preview.example.vercel.app","00000000-0000-0000-0000-000000000088","EXAMPLE & CONDO");
    expect(prompt).toContain("https://preview.example.vercel.app/api/housing/mcp");
    expect(prompt).toContain("/api/housing/openapi?read_only=true");
    expect(prompt).toContain("scenario_id=00000000-0000-0000-0000-000000000088&project=EXAMPLE+%26+CONDO");
    for(const instruction of ["effective_inputs","P50","平均值","今天的钱","SVG","历史重放","未保存","401/403","仅做只读分析"]) expect(prompt).toContain(instruction);
  });
  it("asks which scenario and project when unspecified, and keeps credentials out of prompt parameters",()=>{
    const prompt=housingAgentPrompt("https://example.com");
    expect(prompt).toContain("不能擅自选第一个");expect(prompt).not.toContain("scenario_id=");
    expect(prompt).toContain("已在客户端的凭据设置中配置");expect(prompt).not.toContain("pgf_");
  });
});
