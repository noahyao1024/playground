"use client";

import { useRef, useState } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { NumberInput } from "@/components/ui/number-input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import { todayInSG } from "@/lib/dates";
import {
  CATEGORIES, ILLIQUID_CATEGORIES, LOAN_METHODS, LOAN_METHOD_LABELS, REGIONS, REGION_LABELS, displayName, isCategory, loanStatus, loanTermsOf,
  type FinanceAccount, type Kind, type LoanMethod, type Region,
} from "@/lib/finance";
import { dayLabel, original } from "@/lib/finance-format";
import { FINANCE_CURRENCIES } from "@/lib/fx";
import { financeAction, messageOf } from "./api";
import { Segmented } from "./segmented";

type Form = {
  kind: Kind;
  name: string;
  institution: string;
  owner: string;
  region: Region;
  currency: string;
  category: string;
  note: string;
  /** An asset's liquid share, 0 to 1; null follows the category. */
  liquidity: number | null;
  /** Whether a debt is long-term; null follows the category. */
  longTerm: boolean | null;
  /** A loan's terms, blank (NaN, "") until filled in. */
  hasLoan: boolean;
  principal: number;
  rate: number;
  start: string;
  months: number;
  method: LoanMethod;
};

const NO_LOAN = { loan_principal: null, loan_rate: null, loan_start: null, loan_term_months: null, loan_method: null };
const TERM_YEARS = [10, 15, 20, 25, 30];
const METHOD_OPTIONS = LOAN_METHODS.map((m) => ({ value: m, label: LOAN_METHOD_LABELS[m] }));

const KIND_OPTIONS = [
  { value: "asset", label: "Asset" },
  { value: "liability", label: "Liability" },
] as const;

/** A new account's currency follows its region until chosen by hand. */
const HOME_CURRENCY: Record<Region, string> = { CN: "CNY", SG: "SGD", OTHER: "USD" };

const blankLoan = { hasLoan: false, principal: Number.NaN, rate: Number.NaN, start: "", months: 360, method: "annuity" as LoanMethod };

function formOf(account: FinanceAccount | null): Form {
  if (!account) {
    return {
      kind: "asset", name: "", institution: "", owner: "", region: "SG", currency: "SGD", category: "cash", note: "",
      liquidity: null, longTerm: null, ...blankLoan,
    };
  }
  const terms = loanTermsOf(account);
  return {
    kind: account.kind,
    name: account.name,
    institution: account.institution ?? "",
    owner: account.owner ?? "",
    region: account.region,
    currency: account.currency,
    category: account.category,
    note: account.note ?? "",
    liquidity: account.liquidity == null ? null : Number(account.liquidity),
    longTerm: account.long_term ?? null,
    ...(terms
      ? { hasLoan: true, principal: terms.principal, rate: terms.rate, start: terms.start, months: terms.months, method: terms.method }
      : blankLoan),
  };
}

/** What the form's loan terms still lack, or null when they make a loan. */
function loanProblem(f: Form): string | null {
  if (!(f.principal > 0)) return "Enter the amount borrowed";
  if (!(f.rate >= 0 && f.rate < 100)) return "Enter the annual rate, in percent";
  if (!f.start) return "Enter the first repayment date";
  if (!(Number.isInteger(f.months) && f.months >= 1 && f.months <= 600)) return "Enter the term, in whole months";
  return null;
}

/** Adding an account, or changing one. `account` null adds. */
export function AccountDialog({ open, account, hasBalances, owners, onClose, onSaved }: {
  open: boolean;
  account: FinanceAccount | null;
  /** Whether the account has recorded balances, which pins its currency. */
  hasBalances: boolean;
  /** Everyone already named as an owner, offered as the owner is typed. */
  owners: string[];
  onClose: () => void;
  onSaved: () => Promise<void> | void;
}) {
  const nameRef = useRef<HTMLInputElement>(null);
  return (
    <Dialog open={open} onOpenChange={(o) => { if (!o) onClose(); }}>
      {/* Straight to the name -- except by touch, where focusing a field would
          throw up the keyboard over the form before it has been read. */}
      <DialogContent
        className="max-h-[calc(100dvh-2rem)] overflow-y-auto sm:max-w-md"
        initialFocus={(type) => (type === "touch" ? true : nameRef.current ?? true)}
      >
        {/* Keyed, so each opening starts from the account it opened on. */}
        {open && (
          <AccountForm
            key={account?.id ?? "new"}
            account={account}
            hasBalances={hasBalances}
            owners={owners}
            nameRef={nameRef}
            onClose={onClose}
            onSaved={onSaved}
          />
        )}
      </DialogContent>
    </Dialog>
  );
}

function AccountForm({ account, hasBalances, owners, nameRef, onClose, onSaved }: {
  account: FinanceAccount | null;
  hasBalances: boolean;
  owners: string[];
  nameRef: React.RefObject<HTMLInputElement | null>;
  onClose: () => void;
  onSaved: () => Promise<void> | void;
}) {
  const [form, setForm] = useState<Form>(() => formOf(account));
  const [currencyChosen, setCurrencyChosen] = useState(account !== null);
  const [saving, setSaving] = useState(false);
  const set = (patch: Partial<Form>) => setForm((f) => ({ ...f, ...patch }));
  const categories = CATEGORIES[form.kind];
  // What the switches show when nothing was chosen: the category's default.
  const liquidShare = form.liquidity ?? (ILLIQUID_CATEGORIES.has(form.category) ? 0 : 1);
  const longTerm = form.longTerm ?? form.category === "mortgage";
  const problem = form.hasLoan ? loanProblem(form) : null;
  const preview = form.kind === "liability" && form.hasLoan && !problem
    ? loanStatus({ principal: form.principal, rate: form.rate, start: form.start, months: form.months, method: form.method }, todayInSG())
    : null;

  async function save(e: React.FormEvent) {
    e.preventDefault();
    if (!form.name.trim()) { toast.error("Give the account a name"); return; }
    if (form.kind === "liability" && problem) { toast.error(problem); return; }
    setSaving(true);
    try {
      const fields: Record<string, unknown> = {
        kind: form.kind,
        name: form.name,
        institution: form.institution,
        owner: form.owner,
        region: form.region,
        currency: form.currency,
        category: form.category,
        note: form.note,
        // Each kind keeps only what applies to it: an asset that used to be a
        // debt sheds its loan terms, a debt its liquidity.
        ...(form.kind === "asset"
          ? { liquidity: form.liquidity, long_term: null, ...NO_LOAN }
          : {
            liquidity: null,
            long_term: form.longTerm,
            ...(form.hasLoan
              ? { loan_principal: form.principal, loan_rate: form.rate, loan_start: form.start, loan_term_months: form.months, loan_method: form.method }
              : NO_LOAN),
          }),
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

      <div className="grid grid-cols-2 gap-3">
        <div className="grid gap-1.5">
          <Label htmlFor="account-institution">Institution <span className="font-normal text-muted-foreground">(optional)</span></Label>
          <Input id="account-institution" value={form.institution} maxLength={80} onChange={(e) => set({ institution: e.target.value })} placeholder="DBS, 微信" />
        </div>
        <div className="grid gap-1.5">
          <Label htmlFor="account-owner">Owner <span className="font-normal text-muted-foreground">(optional)</span></Label>
          <Input id="account-owner" list="finance-owners" value={form.owner} maxLength={40} onChange={(e) => set({ owner: e.target.value })} placeholder="Daisy" />
          <datalist id="finance-owners">{owners.map((o) => <option key={o} value={o} />)}</datalist>
        </div>
      </div>
      <p className="-mt-2 text-xs text-muted-foreground">
        Shown as {form.owner.trim() && <span className="font-medium text-foreground">{form.owner.trim()} </span>}
        <span className="font-medium text-foreground">{displayPreview(form)}</span>.
      </p>

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

      {form.kind === "asset" ? (
        <div className="grid gap-2 rounded-lg border px-3 py-2.5">
          <div className="flex items-center justify-between gap-3">
            <div>
              <Label htmlFor="account-liquid">Liquid</Label>
              <p className="text-xs text-muted-foreground">Could be spent or sold now. Off for CPF, 公积金, property.</p>
            </div>
            <Switch
              id="account-liquid"
              checked={liquidShare > 0}
              onCheckedChange={(on) => set({ liquidity: on ? 1 : 0 })}
            />
          </div>
          {liquidShare > 0 && (
            <div className="flex items-center justify-between gap-3">
              <p className="text-xs text-muted-foreground">
                Share that is: less than 100 for shares partly under water, counting only what you would sell today.
              </p>
              <div className="flex shrink-0 items-center gap-1.5">
                <NumberInput
                  aria-label="Liquid share, percent"
                  value={Math.round(liquidShare * 1000) / 10}
                  emptyValue={Number.NaN}
                  step="any"
                  inputMode="decimal"
                  className="h-8 w-20 text-right tabular-nums"
                  // Above 0 only: "0.5" passes through "0" as it is typed, and
                  // turning it off is the switch's job, not the field's.
                  onValueChange={(pct) => { if (pct > 0 && pct <= 100) set({ liquidity: pct / 100 }); }}
                />
                <span className="text-sm text-muted-foreground">%</span>
              </div>
            </div>
          )}
        </div>
      ) : (
        <>
          <div className="flex items-center justify-between gap-3 rounded-lg border px-3 py-2.5">
            <div>
              <Label htmlFor="account-long-term">Long-term debt</Label>
              <p className="text-xs text-muted-foreground">Left out when the page excludes long-term loans. A mortgage is, unless you say not.</p>
            </div>
            <Switch id="account-long-term" checked={longTerm} onCheckedChange={(on) => set({ longTerm: on })} />
          </div>

          <div className="grid gap-3 rounded-lg border px-3 py-2.5">
            <div className="flex items-center justify-between gap-3">
              <div>
                <Label htmlFor="account-loan">Repayment schedule</Label>
                <p className="text-xs text-muted-foreground">Rate and term, to work out the monthly payment and the interest to come.</p>
              </div>
              <Switch id="account-loan" checked={form.hasLoan} onCheckedChange={(on) => set({ hasLoan: on })} />
            </div>
            {form.hasLoan && (
              <>
                <div className="grid grid-cols-2 gap-3">
                  <div className="grid gap-1.5">
                    <Label htmlFor="loan-principal">Borrowed, {form.currency}</Label>
                    <NumberInput id="loan-principal" value={form.principal} emptyValue={Number.NaN} step="any" inputMode="decimal" className="h-9 text-right tabular-nums" onValueChange={(v) => set({ principal: v })} />
                  </div>
                  <div className="grid gap-1.5">
                    <Label htmlFor="loan-rate">Annual rate, %</Label>
                    <NumberInput id="loan-rate" value={form.rate} emptyValue={Number.NaN} step="any" inputMode="decimal" className="h-9 text-right tabular-nums" onValueChange={(v) => set({ rate: v })} />
                  </div>
                  <div className="grid gap-1.5">
                    <Label htmlFor="loan-start">First repayment</Label>
                    <Input id="loan-start" type="date" value={form.start} onChange={(e) => set({ start: e.target.value })} className="h-9" />
                  </div>
                  <div className="grid gap-1.5">
                    <Label htmlFor="loan-months">Term, months</Label>
                    <NumberInput id="loan-months" value={form.months} emptyValue={Number.NaN} step={1} inputMode="numeric" className="h-9 text-right tabular-nums" onValueChange={(v) => set({ months: v })} />
                  </div>
                </div>
                <div className="flex flex-wrap items-center gap-1.5">
                  <span className="text-xs text-muted-foreground">Years:</span>
                  {TERM_YEARS.map((y) => (
                    <button
                      key={y}
                      type="button"
                      aria-pressed={form.months === y * 12}
                      onClick={() => set({ months: y * 12 })}
                      className="rounded-md border px-2 py-0.5 text-xs tabular-nums transition-colors hover:bg-muted aria-pressed:border-foreground aria-pressed:bg-foreground aria-pressed:text-background"
                    >
                      {y}
                    </button>
                  ))}
                </div>
                <Segmented label="Repayment method" value={form.method} options={METHOD_OPTIONS} onChange={(method) => set({ method })} className="w-full" />
                <p className="text-xs text-muted-foreground">
                  {form.method === "annuity"
                    ? "等额本息: the same payment every month, mostly interest at first."
                    : "等额本金: the same principal every month, so the payment falls as the interest does."}
                </p>
                {preview ? (
                  <p className="rounded-md bg-muted/60 px-2.5 py-2 text-xs">
                    <span className="font-medium tabular-nums">{original(preview.payment, form.currency)}</span> a month now
                    {" · "}{preview.payments_left} payments left, the last on {dayLabel(preview.last_payment)}
                    {" · "}<span className="tabular-nums">{original(preview.total_interest, form.currency, { whole: true })}</span> interest over the loan
                  </p>
                ) : (
                  <p className="text-xs text-muted-foreground">{problem}.</p>
                )}
              </>
            )}
          </div>
        </>
      )}

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

/** The name the account will be shown by, as it is typed. */
function displayPreview(f: Form): string {
  return displayName({ name: f.name || "…", institution: f.institution });
}
