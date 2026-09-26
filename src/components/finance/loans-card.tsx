"use client";

import { useState } from "react";
import { TableProperties } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import {
  LOAN_METHOD_LABELS, displayName, loanStatus, loanTermsOf, sortAccounts,
  type FinanceAccount, type FinanceBalance, type LoanTerms,
} from "@/lib/finance";
import { dayLabel, original } from "@/lib/finance-format";
import { AccountName } from "./account-name";
import { LoanScheduleTable } from "./loan-schedule-table";

/** How long a term reads best: whole years as years, anything else in months. */
function termLabel(months: number): string {
  return months % 12 === 0 ? `${months / 12} years` : `${months} months`;
}

/** Every loan with terms, where its schedule stands today: what goes out each
 *  month, how far through it is, and what is still to pay, principal and
 *  interest (本息). In each loan's own currency, as its bank states it. */
export function LoansCard({ accounts, last, today }: {
  accounts: FinanceAccount[];
  /** Each account's newest balance, to set beside what the schedule expects. */
  last: Map<string, FinanceBalance>;
  today: string;
}) {
  const [plan, setPlan] = useState<{ account: FinanceAccount; terms: LoanTerms } | null>(null);
  const loans = sortAccounts(accounts.filter((a) => !a.archived_at))
    .map((account) => ({ account, terms: loanTermsOf(account) }))
    .filter((l): l is { account: FinanceAccount; terms: LoanTerms } => l.terms !== null);
  if (loans.length === 0) return null;

  return (
    <section className="rounded-2xl bg-card p-5 ring-1 ring-foreground/10 sm:p-6">
      <h2 className="text-base font-medium">Loans</h2>
      <p className="mt-0.5 text-xs text-muted-foreground">Where each repayment schedule stands today, in the loan&rsquo;s own currency.</p>
      <ul className="mt-1 divide-y divide-border/60">
        {loans.map(({ account: a, terms }) => {
          const s = loanStatus(terms, today);
          const recorded = last.get(a.id);
          const owed = recorded ? Number(recorded.amount) : null;
          // Off the schedule by more than a rounding: prepaid, or terms mistyped.
          const drift = owed === null ? 0 : owed - s.principal_left;
          const off = owed !== null && Math.abs(drift) > Math.max(1, s.principal_left * 0.01);
          return (
            <li key={a.id} className="py-4">
              <div className="flex items-start justify-between gap-3">
                <AccountName account={a} className="text-sm font-medium" />
                <p className="shrink-0 text-right text-sm">
                  <span className="font-medium tabular-nums">{original(s.payment, a.currency)}</span>
                  <span className="text-muted-foreground"> / month</span>
                </p>
              </div>
              <p className="meta-row mt-0.5 flex flex-wrap gap-x-1.5 text-xs text-muted-foreground">
                <span>{s.rate}% a year</span>
                <span>{LOAN_METHOD_LABELS[terms.method]}</span>
                <span>{original(terms.principal, a.currency, { whole: true })} over {termLabel(terms.months)}</span>
              </p>

              {/* Square where it starts, rounded where the progress ends. */}
              <div className="mt-3 h-1.5 bg-muted" aria-hidden>
                <div className="h-full rounded-r-[3px] bg-foreground/55" style={{ width: `${(s.payments_made / terms.months) * 100}%` }} />
              </div>
              <p className="mt-1.5 flex flex-wrap justify-between gap-x-3 text-xs text-muted-foreground">
                <span>{s.payments_made} of {terms.months} payments made</span>
                <span>
                  {s.next_payment ? `Next ${dayLabel(s.next_payment)} · last ${dayLabel(s.last_payment)}` : "Repaid"}
                </span>
              </p>

              <dl className="mt-3 grid grid-cols-2 gap-x-4 gap-y-2 sm:grid-cols-3">
                <Figure label="Principal left" value={original(s.principal_left, a.currency, { whole: true })} />
                <Figure label="Interest left" value={original(s.interest_left, a.currency, { whole: true })} />
                <Figure label="Still to repay (本息)" value={original(s.total_left, a.currency, { whole: true })} />
              </dl>
              {off && (
                <p className="mt-2 text-xs text-muted-foreground">
                  The balance recorded on {dayLabel(recorded!.as_of)}, {original(owed!, a.currency, { whole: true })}, is{" "}
                  {drift < 0 ? "below" : "above"} the schedule&rsquo;s principal. Prepaid? These figures follow the original schedule.
                </p>
              )}
              <Button variant="outline" size="sm" className="mt-3" onClick={() => setPlan({ account: a, terms })}>
                <TableProperties /> Repayment plan
              </Button>
            </li>
          );
        })}
      </ul>

      <Dialog open={plan !== null} onOpenChange={(o) => { if (!o) setPlan(null); }}>
        <DialogContent className="max-h-[calc(100dvh-2rem)] overflow-y-auto sm:max-w-2xl">
          {plan && (
            <>
              <DialogHeader>
                <DialogTitle>{displayName(plan.account)}: repayment plan</DialogTitle>
                <DialogDescription>
                  Every repayment to the cent, in {plan.account.currency}, as the bank&rsquo;s 还款计划 lists them. The next is marked.
                </DialogDescription>
              </DialogHeader>
              <LoanScheduleTable terms={plan.terms} currency={plan.account.currency} today={today} />
            </>
          )}
        </DialogContent>
      </Dialog>
    </section>
  );
}

function Figure({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <dt className="text-xs text-muted-foreground">{label}</dt>
      <dd className="text-sm font-medium tabular-nums">{value}</dd>
    </div>
  );
}
