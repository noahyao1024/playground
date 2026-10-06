"use client";

import { useEffect, useState } from "react";
import { toast } from "sonner";
import { Check, Copy, KeyRound, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { dayInSG } from "@/lib/dates";
import { dayLabel } from "@/lib/finance-format";
import { listTokens, makeToken, messageOf, revokeToken, type ApiToken } from "./api";
import { DEFAULT_TOKEN_SCOPE, TOKEN_SCOPES, scopeLabel, type TokenScope } from "@/lib/finance-access";
import { HousingAgentGuide, type HousingAgentContext } from "@/components/housing/agent-guide";

/** Tokens for the owner's own agents to use the API as them: made here, shown
 *  once, revoked here. Nothing to set up anywhere else. */
export function ApiAccessDialog({ open, onClose, defaultScope = DEFAULT_TOKEN_SCOPE, context }: { open: boolean; onClose: () => void; defaultScope?: TokenScope; context?: HousingAgentContext }) {
  return (
    <Dialog open={open} onOpenChange={(o) => { if (!o) onClose(); }}>
      <DialogContent className="max-h-[90dvh] overflow-y-auto sm:max-w-2xl">
        {open && <ApiAccess defaultScope={defaultScope} context={context} />}
      </DialogContent>
    </Dialog>
  );
}

function ApiAccess({ defaultScope, context }: { defaultScope: TokenScope; context?: HousingAgentContext }) {
  const [tokens, setTokens] = useState<ApiToken[] | null>(null);
  const [name, setName] = useState("");
  const [made, setMade] = useState<(ApiToken & { token: string }) | null>(null);
  const [copied, setCopied] = useState(false);
  const [busy, setBusy] = useState(false);
  const [scope, setScope] = useState<TokenScope>(defaultScope);
  // The token whose revoking is waiting to be confirmed.
  const [revoking, setRevoking] = useState<string | null>(null);
  const [spec] = useState(() => (typeof window === "undefined" ? "/api/finance/openapi" : `${window.location.origin}/api/finance/openapi`));
  const housingSpec = spec.replace("/api/finance/openapi", "/api/housing/openapi");

  useEffect(() => {
    listTokens().then(setTokens, (err) => {
      setTokens([]);
      toast.error(messageOf(err));
    });
  }, []);

  async function generate(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    try {
      const fresh = await makeToken(name.trim(), scope);
      setMade(fresh);
      setCopied(false);
      setName("");
      setTokens((list) => [{ id: fresh.id, name: fresh.name, created_at: fresh.created_at, scope: fresh.scope }, ...(list ?? [])]);
    } catch (err) {
      toast.error(messageOf(err));
    } finally {
      setBusy(false);
    }
  }

  async function copy(token: string) {
    try {
      await navigator.clipboard.writeText(token);
      setCopied(true);
    } catch {
      toast.error("Could not copy: select the token and copy it by hand");
    }
  }

  async function revoke(token: ApiToken) {
    try {
      await revokeToken(token.id);
      setTokens((list) => (list ?? []).filter((t) => t.id !== token.id));
      if (made?.id === token.id) setMade(null);
      toast.success(`Revoked ${token.name}`);
    } catch (err) {
      toast.error(messageOf(err));
    } finally {
      setRevoking(null);
    }
  }

  return (
    <div className="grid gap-4">
      <DialogHeader>
        <DialogTitle>AI / API access</DialogTitle>
        <DialogDescription>
          为你的 AI 选择访问权限，默认只读。Token 仅生成时显示一次，可随时撤销。已有 Token 保留原权限；需要限制权限时请撤销旧 Token 并重新生成。
        </DialogDescription>
      </DialogHeader>

      <p className="text-xs text-muted-foreground">
        Give your agent the token and an API description.<br />
        Finance + housing: <a href={spec} className="break-all font-mono underline">{spec}</a><br />
        Housing only: <a href={housingSpec} className="break-all font-mono underline">{housingSpec}</a><br />
        It sends <span className="font-mono">Authorization: Bearer &hellip;</span> with every request, the description&rsquo;s too.
        <br />Housing includes saved inputs, calculated comparisons, project P50 and averages, and chart data / SVG images.
      </p>

      {made ? (
        <section className="grid gap-2 rounded-lg bg-muted/60 p-3">
          <p className="text-sm font-medium">Copy it now: it will not be shown again.</p>
          <div className="flex gap-2">
            <Input
              readOnly
              value={made.token}
              onFocus={(e) => e.currentTarget.select()}
              aria-label={`Token for ${made.name}`}
              className="h-9 font-mono text-xs"
            />
            <Button className="shrink-0" onClick={() => copy(made.token)}>
              {copied ? <Check /> : <Copy />} {copied ? "Copied" : "Copy"}
            </Button>
          </div>
          <Button variant="outline" size="sm" className="justify-self-start" onClick={() => setMade(null)}>Done</Button>
        </section>
      ) : (
        <form onSubmit={generate} className="grid gap-3">
          <div className="grid flex-1 gap-1.5">
            <Label htmlFor="token-name">Name <span className="font-normal text-muted-foreground">(what it is for)</span></Label>
            <Input id="token-name" value={name} maxLength={60} placeholder="Laptop agent" onChange={(e) => setName(e.target.value)} className="h-9" />
          </div>
          <div className="grid gap-1.5">
            <Label htmlFor="token-scope">权限</Label>
            <select id="token-scope" value={scope} onChange={e=>setScope(e.target.value as TokenScope)} className="h-9 rounded-md border bg-background px-2 text-sm">
              {TOKEN_SCOPES.map(s=><option key={s} value={s}>{scopeLabel[s]}</option>)}
            </select>
            <p className="text-xs text-muted-foreground">只读权限也可运行临时分析和下载图表；不能保存、删除、关注楼盘或刷新外部数据。</p>
          </div>
          <Button type="submit" disabled={busy}><KeyRound /> {busy ? "Making…" : "Generate token"}</Button>
        </form>
      )}

      <section>
        <h3 className="text-xs font-medium text-muted-foreground">Tokens in use</h3>
        {tokens === null ? (
          <p className="py-2 text-sm text-muted-foreground">Loading…</p>
        ) : tokens.length === 0 ? (
          <p className="py-2 text-sm text-muted-foreground">None yet.</p>
        ) : (
          <ul className="divide-y divide-border/60">
            {tokens.map((t) => (
              <li key={t.id} className="flex items-center gap-2 py-2">
                <div className="min-w-0 flex-1">
                  <p className="truncate text-sm">{t.name}</p>
                  <p className="text-xs text-muted-foreground">{scopeLabel[t.scope]}</p>
                  {t.created_at && <p className="text-xs text-muted-foreground">made {dayLabel(dayInSG(t.created_at))}</p>}
                </div>
                {revoking === t.id ? (
                  <>
                    <Button variant="outline" size="sm" onClick={() => setRevoking(null)}>Keep</Button>
                    <Button variant="destructive" size="sm" onClick={() => revoke(t)}>Revoke</Button>
                  </>
                ) : (
                  <Button variant="ghost" size="sm" aria-label={`Revoke ${t.name}`} onClick={() => setRevoking(t.id)} className="text-muted-foreground hover:text-destructive">
                    <Trash2 /> Revoke
                  </Button>
                )}
              </li>
            ))}
          </ul>
        )}
      </section>
      <HousingAgentGuide {...context} />
    </div>
  );
}
