"use client";

import { useState } from "react";
import { Copy, Download } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { housingAgentPrompt } from "@/lib/housing-agent-prompt";

export type HousingAgentContext = { scenarioId?: string | null; projects?: string[] };

export function HousingAgentGuide({ scenarioId, projects = [] }: HousingAgentContext) {
  const [project, setProject] = useState("");
  const origin = typeof window === "undefined" ? "" : window.location.origin;
  const prompt = housingAgentPrompt(origin, scenarioId, project);
  const codex = `[mcp_servers.playground_housing]\nurl = "${origin}/api/housing/mcp"\nbearer_token_env_var = "FINANCE_TOKEN"`;
  const claude = JSON.stringify({ mcpServers: { playground_housing: {
    type: "http", url: `${origin}/api/housing/mcp`, headers: { Authorization: "Bearer ${FINANCE_TOKEN}" },
  } } }, null, 2);
  async function copy(value: string) {
    try { await navigator.clipboard.writeText(value); toast.success("已复制"); }
    catch { toast.error("复制失败，请选中文本手动复制"); }
  }
  async function download() {
    try {
      const response = await fetch("/api/housing/openapi?read_only=true", { cache: "no-store" });
      if (!response.ok) throw new Error(`OpenAPI 下载失败 (${response.status})`);
      const href = URL.createObjectURL(new Blob([JSON.stringify(await response.json(), null, 2)], { type: "application/json" }));
      const a = document.createElement("a");
      a.href = href; a.download = "playground-housing-read-only.openapi.json"; a.click();
      URL.revokeObjectURL(href);
    } catch (err) { toast.error(err instanceof Error ? err.message : "下载失败"); }
  }
  return <section className="grid gap-3 border-t pt-4">
    <h3 className="text-sm font-medium">让 AI 分析住房数据与走势图</h3>
    <p className="text-xs text-muted-foreground">先生成只读 Token，再在 AI 客户端配置工具。Token 单独放在凭据或本机环境变量中；下面的 prompt 不含 Token。AI 读取已保存版本，未保存的改动请先保存。</p>
    <details className="rounded-lg border p-3">
      <summary className="cursor-pointer text-sm font-medium">连接方式：Codex / Claude Code / GPT Actions</summary>
      <div className="mt-3 grid gap-3 text-xs">
        <p>MCP 地址：<span className="break-all font-mono">{origin}/api/housing/mcp</span>。使用 Streamable HTTP，三个工具均只读，可返回完整数据、计算结果和 SVG 图表。客户端需要支持此协议及 Bearer 认证。</p>
        <p>Codex：将下面配置加入本机用户配置，并在启动客户端前设置 <code>FINANCE_TOKEN</code> 环境变量。</p>
        <pre className="overflow-auto rounded bg-muted p-2">{codex}</pre>
        <Button variant="outline" size="sm" className="justify-self-start" onClick={()=>void copy(codex)}><Copy/>复制 Codex 配置</Button>
        <p>Claude Code：使用用户级 MCP 配置（环境变量由客户端展开），不要提交到公共仓库。</p>
        <pre className="overflow-auto rounded bg-muted p-2">{claude}</pre>
        <Button variant="outline" size="sm" className="justify-self-start" onClick={()=>void copy(claude)}><Copy/>复制 Claude Code 配置</Button>
        <p>GPT Actions：下载下方只读 OpenAPI JSON，导入自定义 GPT 的 Actions；Authentication 选择 API Key → Bearer，并单独填入 Token。文档本身也需认证，直接用 URL 导入失败时请粘贴下载文件内容。</p>
        <Button variant="outline" size="sm" className="justify-self-start" onClick={()=>void download()}><Download/>下载只读 OpenAPI</Button>
        <p>普通聊天里贴链接或 prompt 不会自动连接工具。部分云端 MCP 客户端只接受 OAuth，此接口使用 Bearer Token；这类客户端可使用支持 Bearer 的 MCP 客户端或 GPT Actions。</p>
      </div>
    </details>
    {projects.length > 0 && <div className="grid gap-1.5">
      <Label htmlFor="agent-project">Prompt 中指定的楼盘（选填）</Label>
      <select id="agent-project" value={project} onChange={e=>setProject(e.target.value)} className="h-9 rounded-md border bg-background px-2 text-sm">
        <option value="">让 AI 列出关注楼盘后选择</option>
        {projects.map(name=><option key={name} value={name}>{name}</option>)}
      </select>
    </div>}
    <Label htmlFor="housing-agent-prompt">中文 AI prompt</Label>
    <textarea id="housing-agent-prompt" readOnly value={prompt} rows={8} onFocus={e=>e.currentTarget.select()} className="w-full resize-y rounded-md border bg-muted/30 p-3 text-xs leading-relaxed"/>
    <Button variant="outline" size="sm" className="justify-self-start" onClick={()=>void copy(prompt)}><Copy/>复制 AI prompt</Button>
  </section>;
}
