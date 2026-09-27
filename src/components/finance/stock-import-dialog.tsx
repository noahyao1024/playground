"use client";

import { useState } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import { Textarea } from "@/components/ui/textarea";
import { displayName, type FinanceAccount } from "@/lib/finance";
import { original } from "@/lib/finance-format";
import { positionsFromText } from "@/lib/stocks";
import { financeAction, messageOf } from "./api";
import type { StocksReply } from "./stocks-card";

/** Positions pasted from a broker's statement into an account: checked as they
 *  are typed, then priced and valued by the server. */
export function StockImportDialog({ open, accounts, initial, onClose, onImported }: {
  open: boolean;
  /** The accounts it may go into: open assets holding no RSUs. */
  accounts: FinanceAccount[];
  /** The account to start on. */
  initial: string | null;
  onClose: () => void;
  onImported: (reply: StocksReply) => void;
}) {
  const [accountId, setAccountId] = useState<string | null>(initial);
  const [text, setText] = useState("");
  const [replace, setReplace] = useState(true);
  const [saving, setSaving] = useState(false);
  const [shownFor, setShownFor] = useState<string | null | undefined>(undefined);
  // Opening it again starts from the account it was opened on.
  if (open && shownFor !== initial) {
    setShownFor(initial);
    setAccountId(initial ?? accounts[0]?.id ?? null);
  }
  const account = accounts.find((a) => a.id === accountId) ?? null;
  const held = account?.stock_positions?.length ?? 0;
  const parsed = text.trim() ? positionsFromText(text) : null;

  async function save() {
    if (!account) { toast.error("Choose the account they are in"); return; }
    if (!parsed || "problem" in parsed) { toast.error(parsed ? parsed.problem : "Paste the positions, a line each"); return; }
    setSaving(true);
    try {
      const reply = await financeAction<StocksReply>("importStockPositions", { account_id: account.id, positions: parsed.positions, replace });
      onImported(reply);
      const value = reply.balances?.[0]?.amount;
      toast.success(`Imported ${parsed.positions.length} position${parsed.positions.length === 1 ? "" : "s"}${value != null ? `: ${original(Number(value), account.currency)}` : ""}`);
      setText("");
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
          <DialogTitle>Import positions</DialogTitle>
          <DialogDescription>
            A line each: the symbol, the shares and the average cost, as your broker lists them. Each is priced now, and the
            account&rsquo;s balance for today recorded from them.
          </DialogDescription>
        </DialogHeader>
        <div className="grid gap-3">
          <div className="grid gap-1.5">
            <Label>Account</Label>
            <Select value={accountId ?? ""} onValueChange={(v) => setAccountId(v as string)}>
              <SelectTrigger className="h-9 w-full">
                <SelectValue>{(v: string | null) => {
                  const a = accounts.find((x) => x.id === v);
                  return a ? displayName(a) : "Choose the account";
                }}</SelectValue>
              </SelectTrigger>
              <SelectContent>
                {accounts.map((a) => <SelectItem key={a.id} value={a.id}>{displayName(a)}</SelectItem>)}
              </SelectContent>
            </Select>
          </div>
          <div className="grid gap-1.5">
            <Label htmlFor="stock-import-text">Positions</Label>
            <Textarea
              id="stock-import-text" rows={8} spellCheck={false} className="font-mono md:text-xs"
              placeholder={"AAPL 100 150.25\n0700.HK 200 310\n600519 10 1500\nUS.MSFT 5 380"}
              aria-invalid={parsed !== null && "problem" in parsed}
              value={text} onChange={(e) => setText(e.target.value)}
            />
            <p className="text-xs text-muted-foreground" aria-live="polite">
              {!parsed
                ? "US: AAPL. Hong Kong: 0700.HK or 00700. Shanghai: 600519.SS or 600519. Shenzhen: 000001.SZ. Singapore: D05.SI. Futu's HK.00700 works too."
                : "problem" in parsed
                  ? parsed.problem
                  : `${parsed.positions.length} position${parsed.positions.length === 1 ? "" : "s"}: ${parsed.positions.map((p) => p.symbol).join(", ")}`}
            </p>
          </div>
          {held > 0 && (
            <div className="flex items-center justify-between gap-3">
              <div>
                <Label htmlFor="stock-import-replace">Replace what it holds</Label>
                <p className="text-xs text-muted-foreground">
                  {replace ? `The ${held} positions it holds and are not listed go.` : "Listed ones are added, or their shares and cost updated; the rest stay."}
                </p>
              </div>
              <Switch id="stock-import-replace" checked={replace} onCheckedChange={setReplace} />
            </div>
          )}
        </div>
        <DialogFooter>
          <Button type="button" variant="outline" onClick={onClose}>Cancel</Button>
          <Button type="button" disabled={saving || !parsed || "problem" in parsed} onClick={save}>{saving ? "Pricing…" : "Import"}</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
