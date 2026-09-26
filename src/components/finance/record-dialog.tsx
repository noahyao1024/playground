"use client";

import { useMemo, useState } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { NumberInput } from "@/components/ui/number-input";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { todayInSG } from "@/lib/dates";
import {
  KINDS, REGION_LABELS, displayName, draftFor, loanStatus, loanTermsOf, sortAccounts,
  type Draft, type FinanceAccount, type FinanceBalance,
} from "@/lib/finance";
import { dayLabel, original } from "@/lib/finance-format";
import { financeAction, messageOf } from "./api";
import { AccountName } from "./account-name";

/** Recording what every open account holds on one day. `day` null is closed. */
export function RecordDialog({ day, accounts, balances, onClose, onSaved }: {
  day: string | null;
  accounts: FinanceAccount[];
  balances: FinanceBalance[];
  onClose: () => void;
  /** Called with the balances the server wrote, to merge into the page. */
  onSaved: (written: FinanceBalance[]) => void;
}) {
  return (
    <Dialog open={day !== null} onOpenChange={(o) => { if (!o) onClose(); }}>
      <DialogContent className="sm:max-w-lg">
        {day !== null && <RecordForm key={day} initialDay={day} accounts={accounts} balances={balances} onClose={onClose} onSaved={onSaved} />}
      </DialogContent>
    </Dialog>
  );
}

/** Blank for "not recorded": NumberInput shows NaN as an empty field. */
function amountsFrom(open: FinanceAccount[], drafts: Map<string, Draft>): Record<string, number> {
  return Object.fromEntries(open.map((a) => [a.id, drafts.get(a.id)?.amount ?? Number.NaN]));
}

function RecordForm({ initialDay, accounts, balances, onClose, onSaved }: {
  initialDay: string;
  accounts: FinanceAccount[];
  balances: FinanceBalance[];
  onClose: () => void;
  onSaved: (written: FinanceBalance[]) => void;
}) {
  const open = useMemo(() => sortAccounts(accounts.filter((a) => !a.archived_at)), [accounts]);
  const today = todayInSG();
  const [day, setDay] = useState(initialDay);
  const drafts = useMemo(() => draftFor(accounts, balances, day), [accounts, balances, day]);
  const [amounts, setAmounts] = useState(() => amountsFrom(open, draftFor(accounts, balances, initialDay)));
  // What has been typed survives a change of day; everything else follows it.
  const [touched, setTouched] = useState<ReadonlySet<string>>(new Set());
  const [saving, setSaving] = useState(false);

  function changeDay(next: string) {
    if (!next) return;
    setDay(next);
    const nextDrafts = draftFor(accounts, balances, next);
    setAmounts((current) => {
      const fresh = amountsFrom(open, nextDrafts);
      for (const id of touched) fresh[id] = current[id];
      return fresh;
    });
  }

  const entries = open.filter((a) => Number.isFinite(amounts[a.id])).map((a) => ({ account_id: a.id, amount: amounts[a.id] }));
  const alreadyRecorded = open.filter((a) => drafts.get(a.id)?.from === day).length;
  const future = day > today;

  async function save(e: React.FormEvent) {
    e.preventDefault();
    setSaving(true);
    try {
      const result = await financeAction<{ balances: FinanceBalance[]; rate_date: string }>("recordBalances", { as_of: day, entries });
      const rates = result.rate_date === day ? "" : ` at the rates of ${dayLabel(result.rate_date)}, the last published`;
      toast.success(`Recorded ${entries.length} balance${entries.length === 1 ? "" : "s"} for ${dayLabel(day)}${rates}`);
      onClose();
      onSaved(result.balances);
    } catch (err) {
      toast.error(messageOf(err));
    } finally {
      setSaving(false);
    }
  }

  return (
    <form onSubmit={save} className="grid gap-4">
      <DialogHeader>
        <DialogTitle>Record balances</DialogTitle>
        <DialogDescription>
          What each account holds on the day, in its own currency. Each is stored with that day&rsquo;s CNY and SGD rates,
          so the day keeps its value when rates move. Leave one blank to carry its last balance forward.
        </DialogDescription>
      </DialogHeader>

      <div className="grid gap-1.5">
        <Label htmlFor="record-day">Day</Label>
        <Input id="record-day" type="date" value={day} max={today} onChange={(e) => changeDay(e.target.value)} className="h-9 w-44" />
        {alreadyRecorded > 0 && (
          <p className="text-xs text-muted-foreground">
            This day already has {alreadyRecorded} balance{alreadyRecorded === 1 ? "" : "s"}, filled in below. Saving replaces them.
          </p>
        )}
      </div>

      <div className="-mx-4 max-h-[55vh] space-y-4 overflow-y-auto border-y px-4 py-3">
        {KINDS.map((kind) => {
          const ofKind = open.filter((a) => a.kind === kind);
          if (ofKind.length === 0) return null;
          return (
            <section key={kind} className="space-y-1">
              <h3 className="text-xs font-medium text-muted-foreground">
                {kind === "asset" ? "Assets" : "Liabilities — what is owed, as a positive amount"}
              </h3>
              {ofKind.map((a) => {
                const draft = drafts.get(a.id);
                // A loan with terms can fill itself in: what its schedule has
                // owing on the day, to the cent.
                const terms = loanTermsOf(a);
                const scheduled = terms ? Math.round(loanStatus(terms, day).principal_left * 100) / 100 : null;
                const hint = !draft
                  ? "No balance yet"
                  : draft.from === day
                    ? `Recorded for this day`
                    : `Last ${original(draft.amount, a.currency)} on ${dayLabel(draft.from)}`;
                return (
                  <div key={a.id} className="flex items-center gap-3 py-1.5">
                    <div className="min-w-0 flex-1">
                      <AccountName account={a} className="text-sm font-medium" />
                      <p className="meta-row flex min-w-0 flex-wrap gap-x-1.5 text-xs text-muted-foreground">
                        <span>{REGION_LABELS[a.region]}</span>
                        <span className="truncate">{hint}</span>
                        {scheduled !== null && amounts[a.id] !== scheduled && (
                          <button
                            type="button"
                            className="underline underline-offset-2 hover:text-foreground"
                            onClick={() => {
                              setAmounts((current) => ({ ...current, [a.id]: scheduled }));
                              setTouched((t) => new Set(t).add(a.id));
                            }}
                          >
                            Use schedule, {original(scheduled, a.currency)}
                          </button>
                        )}
                      </p>
                    </div>
                    <div className="flex shrink-0 items-center gap-1.5">
                      <NumberInput
                        value={amounts[a.id]}
                        emptyValue={Number.NaN}
                        step="any"
                        inputMode="decimal"
                        aria-label={`${displayName(a)}, in ${a.currency}`}
                        className="h-9 w-32 text-right tabular-nums sm:w-36"
                        onValueChange={(v) => {
                          setAmounts((current) => ({ ...current, [a.id]: v }));
                          setTouched((t) => new Set(t).add(a.id));
                        }}
                      />
                      <span className="w-8 text-xs text-muted-foreground">{a.currency}</span>
                    </div>
                  </div>
                );
              })}
            </section>
          );
        })}
      </div>

      <DialogFooter className="items-center sm:justify-between">
        <p className="text-xs text-muted-foreground">{entries.length} of {open.length} accounts</p>
        <div className="flex flex-col-reverse gap-2 sm:flex-row">
          <Button type="button" variant="outline" onClick={onClose}>Cancel</Button>
          <Button type="submit" disabled={saving || entries.length === 0 || future}>
            {saving ? "Recording…" : `Record ${dayLabel(day, { year: false })}`}
          </Button>
        </div>
      </DialogFooter>
    </form>
  );
}
