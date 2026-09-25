"use client";

import { useRef, useState } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { CATEGORIES, REGIONS, REGION_LABELS, isCategory, type FinanceAccount, type Kind, type Region } from "@/lib/finance";
import { FINANCE_CURRENCIES } from "@/lib/fx";
import { financeAction, messageOf } from "./api";
import { Segmented } from "./segmented";

type Form = {
  kind: Kind;
  name: string;
  institution: string;
  region: Region;
  currency: string;
  category: string;
  note: string;
};

const KIND_OPTIONS = [
  { value: "asset", label: "Asset" },
  { value: "liability", label: "Liability" },
] as const;

/** A new account's currency follows its region until chosen by hand. */
const HOME_CURRENCY: Record<Region, string> = { CN: "CNY", SG: "SGD", OTHER: "USD" };

function formOf(account: FinanceAccount | null): Form {
  if (!account) {
    return { kind: "asset", name: "", institution: "", region: "SG", currency: "SGD", category: "cash", note: "" };
  }
  return {
    kind: account.kind,
    name: account.name,
    institution: account.institution ?? "",
    region: account.region,
    currency: account.currency,
    category: account.category,
    note: account.note ?? "",
  };
}

/** Adding an account, or changing one. `account` null adds. */
export function AccountDialog({ open, account, hasBalances, onClose, onSaved }: {
  open: boolean;
  account: FinanceAccount | null;
  /** Whether the account has recorded balances, which pins its currency. */
  hasBalances: boolean;
  onClose: () => void;
  onSaved: () => Promise<void> | void;
}) {
  const nameRef = useRef<HTMLInputElement>(null);
  return (
    <Dialog open={open} onOpenChange={(o) => { if (!o) onClose(); }}>
      {/* Straight to the name -- except by touch, where focusing a field would
          throw up the keyboard over the form before it has been read. */}
      <DialogContent className="sm:max-w-md" initialFocus={(type) => (type === "touch" ? true : nameRef.current ?? true)}>
        {/* Keyed, so each opening starts from the account it opened on. */}
        {open && <AccountForm key={account?.id ?? "new"} account={account} hasBalances={hasBalances} nameRef={nameRef} onClose={onClose} onSaved={onSaved} />}
      </DialogContent>
    </Dialog>
  );
}

function AccountForm({ account, hasBalances, nameRef, onClose, onSaved }: {
  account: FinanceAccount | null;
  hasBalances: boolean;
  nameRef: React.RefObject<HTMLInputElement | null>;
  onClose: () => void;
  onSaved: () => Promise<void> | void;
}) {
  const [form, setForm] = useState<Form>(() => formOf(account));
  const [currencyChosen, setCurrencyChosen] = useState(account !== null);
  const [saving, setSaving] = useState(false);
  const set = (patch: Partial<Form>) => setForm((f) => ({ ...f, ...patch }));
  const categories = CATEGORIES[form.kind];

  async function save(e: React.FormEvent) {
    e.preventDefault();
    if (!form.name.trim()) { toast.error("Give the account a name"); return; }
    setSaving(true);
    try {
      const fields = {
        kind: form.kind,
        name: form.name,
        institution: form.institution,
        region: form.region,
        currency: form.currency,
        category: form.category,
        note: form.note,
      };
      if (account) await financeAction("updateAccount", { id: account.id, updates: fields });
      else await financeAction("createAccount", { account: fields });
      toast.success(account ? "Account updated" : `Added ${form.name.trim()}`);
      onClose();
      await onSaved();
    } catch (err) {
      toast.error(messageOf(err));
    } finally {
      setSaving(false);
    }
  }

  return (
    <form onSubmit={save} className="grid gap-4">
      <DialogHeader>
        <DialogTitle>{account ? "Edit account" : "Add an account"}</DialogTitle>
        <DialogDescription>
          {form.kind === "asset"
            ? "Something that holds money: a bank account, CPF, 公积金, a brokerage, a property."
            : "Money owed: a card, a loan, a mortgage. Its balance is recorded as what is owed."}
        </DialogDescription>
      </DialogHeader>

      <Segmented
        label="Kind"
        value={form.kind}
        options={KIND_OPTIONS}
        onChange={(kind) => set({ kind, category: isCategory(kind, form.category) ? form.category : Object.keys(CATEGORIES[kind])[0] })}
        className="w-full"
      />

      <div className="grid gap-1.5">
        <Label htmlFor="account-name">Name</Label>
        <Input id="account-name" ref={nameRef} value={form.name} maxLength={80} onChange={(e) => set({ name: e.target.value })} placeholder={form.kind === "asset" ? "DBS Multiplier" : "Citi Rewards card"} />
      </div>

      <div className="grid gap-1.5">
        <Label htmlFor="account-institution">Institution <span className="font-normal text-muted-foreground">(optional)</span></Label>
        <Input id="account-institution" value={form.institution} maxLength={80} onChange={(e) => set({ institution: e.target.value })} placeholder="DBS" />
      </div>

      <div className="grid grid-cols-2 gap-3">
        <div className="grid gap-1.5">
          <Label>Region</Label>
          <Select
            value={form.region}
            onValueChange={(v) => {
              const region = v as Region;
              set(currencyChosen ? { region } : { region, currency: HOME_CURRENCY[region] });
            }}
          >
            <SelectTrigger className="h-9 w-full"><SelectValue>{(v: string | null) => (v ? REGION_LABELS[v as Region] : "Region")}</SelectValue></SelectTrigger>
            <SelectContent>
              {REGIONS.map((r) => <SelectItem key={r} value={r}>{REGION_LABELS[r]}</SelectItem>)}
            </SelectContent>
          </Select>
        </div>
        <div className="grid gap-1.5">
          <Label>Currency</Label>
          <Select
            value={form.currency}
            disabled={hasBalances}
            onValueChange={(v) => { setCurrencyChosen(true); set({ currency: v as string }); }}
          >
            <SelectTrigger className="h-9 w-full"><SelectValue /></SelectTrigger>
            <SelectContent>
              {FINANCE_CURRENCIES.map((c) => <SelectItem key={c} value={c}>{c}</SelectItem>)}
            </SelectContent>
          </Select>
        </div>
      </div>
      {hasBalances && (
        <p className="-mt-2 text-xs text-muted-foreground">
          Its balances are recorded in {form.currency}, so the currency stays. For money moved to another currency, add a new account.
        </p>
      )}

      <div className="grid gap-1.5">
        <Label>Category</Label>
        <Select value={form.category} onValueChange={(v) => set({ category: v as string })}>
          <SelectTrigger className="h-9 w-full"><SelectValue>{(v: string | null) => (v ? categories[v] ?? v : "Category")}</SelectValue></SelectTrigger>
          <SelectContent>
            {Object.entries(categories).map(([key, label]) => <SelectItem key={key} value={key}>{label}</SelectItem>)}
          </SelectContent>
        </Select>
      </div>

      <div className="grid gap-1.5">
        <Label htmlFor="account-note">Note <span className="font-normal text-muted-foreground">(optional)</span></Label>
        <Input id="account-note" value={form.note} maxLength={500} onChange={(e) => set({ note: e.target.value })} placeholder="Joint with…, rate until…" />
      </div>

      <DialogFooter>
        <Button type="button" variant="outline" onClick={onClose}>Cancel</Button>
        <Button type="submit" disabled={saving}>{saving ? "Saving…" : account ? "Save" : "Add account"}</Button>
      </DialogFooter>
    </form>
  );
}
