"use client";

import { useState } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import { Textarea } from "@/components/ui/textarea";
import type { FinanceAccount } from "@/lib/finance";
import { tranchesFromText, type RsuGrant, type RsuRules } from "@/lib/rsu";
import { financeAction, messageOf } from "./api";

type Form = { grantNo: string; label: string; profile: string; grantedOn: string; vestStart: string; signed: boolean; tranches: string; note: string };

function formOf(grant: RsuGrant | null, rules: RsuRules): Form {
  return grant
    ? {
      grantNo: grant.grant_no, label: grant.label ?? "", profile: grant.profile, grantedOn: grant.granted_on ?? "", vestStart: grant.vest_start ?? "",
      signed: grant.signed, tranches: grant.tranches.map((t) => `${t.vests_on} ${t.shares}`).join("\n"), note: grant.note ?? "",
    }
    : { grantNo: "", label: "", profile: Object.keys(rules.profiles)[0], grantedOn: "", vestStart: "", signed: true, tranches: "", note: "" };
}

/** A grant and its vesting schedule, pasted a tranche a line as the employer's
 *  page lists them. Opened with the grant for editing, or with none for a new one. */
export function RsuGrantDialog({ open, grant, account, rules, onClose, onSaved }: {
  open: boolean;
  grant: RsuGrant | null;
  account: FinanceAccount;
  rules: RsuRules;
  onClose: () => void;
  onSaved: (account: FinanceAccount) => void;
}) {
  const [form, setForm] = useState<Form>(() => formOf(grant, rules));
  const [shownFor, setShownFor] = useState<RsuGrant | null | undefined>(undefined);
  const [saving, setSaving] = useState(false);
  // Opening the dialog on another grant starts from that grant.
  if (open && shownFor !== grant) {
    setShownFor(grant);
    setForm(formOf(grant, rules));
  }
  const set = (patch: Partial<Form>) => setForm((f) => ({ ...f, ...patch }));
  const parsed = form.tranches.trim() ? tranchesFromText(form.tranches) : null;
  const total = parsed && "tranches" in parsed ? parsed.tranches.reduce((n, t) => n + t.shares, 0) : 0;

  async function save(e: React.FormEvent) {
    e.preventDefault();
    if (!form.grantNo.trim()) { toast.error("Give the grant's number"); return; }
    if (!parsed || "problem" in parsed) { toast.error(parsed ? parsed.problem : "Add its vesting schedule"); return; }
    const fields = {
      grant_no: form.grantNo.trim(), label: form.label.trim() || null, profile: form.profile, signed: form.signed,
      granted_on: form.grantedOn || null, vest_start: form.vestStart || null, tranches: parsed.tranches, note: form.note.trim() || null,
    };
    setSaving(true);
    try {
      const saved = grant
        ? await financeAction<FinanceAccount>("updateRsuGrant", { id: grant.id, updates: fields })
        : await financeAction<FinanceAccount>("addRsuGrant", { account_id: account.id, ...fields });
      onSaved(saved);
      toast.success(grant ? `Saved ${fields.grant_no}` : `Added ${fields.grant_no}`);
      onClose();
    } catch (err) {
      toast.error(messageOf(err));
    } finally {
      setSaving(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={(o) => { if (!o) onClose(); }}>
      <DialogContent className="max-h-[calc(100dvh-2rem)] overflow-y-auto sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>{grant ? `Edit ${grant.grant_no}` : "Add a grant"}</DialogTitle>
          <DialogDescription>Its number, which rates it sells by, and when each tranche vests.</DialogDescription>
        </DialogHeader>
        <form onSubmit={save} className="grid gap-3">
          <div className="grid grid-cols-2 gap-3">
            <div className="grid gap-1.5">
              <Label htmlFor="grant-no">Grant number</Label>
              <Input id="grant-no" className="h-9" placeholder="ESOP…" value={form.grantNo} onChange={(e) => set({ grantNo: e.target.value })} />
            </div>
            <div className="grid gap-1.5">
              <Label htmlFor="grant-label">Kind <span className="font-normal text-muted-foreground">(optional)</span></Label>
              <Input id="grant-label" className="h-9" placeholder="Entry grant, refresher…" value={form.label} onChange={(e) => set({ label: e.target.value })} />
            </div>
          </div>
          <div className="grid gap-1.5">
            <Label>Sells by</Label>
            <Select value={form.profile} onValueChange={(v) => set({ profile: v as string })}>
              <SelectTrigger className="h-9 w-full">
                <SelectValue>{(v: string | null) => (v ? profileLabel(rules, v) : "Profile")}</SelectValue>
              </SelectTrigger>
              <SelectContent>
                {Object.keys(rules.profiles).map((p) => <SelectItem key={p} value={p}>{profileLabel(rules, p)}</SelectItem>)}
              </SelectContent>
            </Select>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div className="grid gap-1.5">
              <Label htmlFor="grant-on">Granted <span className="font-normal text-muted-foreground">(optional)</span></Label>
              <Input id="grant-on" type="date" className="h-9" value={form.grantedOn} onChange={(e) => set({ grantedOn: e.target.value })} />
            </div>
            <div className="grid gap-1.5">
              <Label htmlFor="grant-start">Vesting from <span className="font-normal text-muted-foreground">(optional)</span></Label>
              <Input id="grant-start" type="date" className="h-9" value={form.vestStart} onChange={(e) => set({ vestStart: e.target.value })} />
            </div>
          </div>
          <div className="grid gap-1.5">
            <Label htmlFor="grant-tranches">
              Tranches <span className="font-normal text-muted-foreground">— a line each, the date and the shares</span>
            </Label>
            <Textarea
              id="grant-tranches" rows={7} className="font-mono" placeholder={"2026-06-15 40\n2026-09-15 40"}
              aria-invalid={parsed !== null && "problem" in parsed}
              value={form.tranches} onChange={(e) => set({ tranches: e.target.value })}
            />
            <p className="text-xs text-muted-foreground" aria-live="polite">
              {!parsed ? "Paste the schedule from the grant's page." : "problem" in parsed ? parsed.problem : `${parsed.tranches.length} tranches, ${total} shares`}
            </p>
          </div>
          <div className="flex items-center justify-between gap-3">
            <div>
              <Label htmlFor="grant-signed">Signed</Label>
              <p className="text-xs text-muted-foreground">Off for a grant offered and not yet accepted: counted only when asked.</p>
            </div>
            <Switch id="grant-signed" checked={form.signed} onCheckedChange={(on) => set({ signed: on })} />
          </div>
          <div className="grid gap-1.5">
            <Label htmlFor="grant-note">Note <span className="font-normal text-muted-foreground">(optional)</span></Label>
            <Input id="grant-note" className="h-9" value={form.note} onChange={(e) => set({ note: e.target.value })} />
          </div>
          <DialogFooter>
            <Button type="button" variant="outline" onClick={onClose}>Cancel</Button>
            <Button type="submit" disabled={saving}>{grant ? "Save" : "Add grant"}</Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

/** A profile as the owner named it, with its rates by years vested. */
function profileLabel(rules: RsuRules, name: string): string {
  const p = rules.profiles[name];
  return `${p?.label ?? name} · ${p?.rates.map((r) => `${r}%`).join(" / ") ?? ""}`;
}
