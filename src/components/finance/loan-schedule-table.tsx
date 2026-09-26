"use client";

import { Fragment, useEffect, useMemo, useRef } from "react";
import { loanSchedule, repaymentsMade, type LoanTerms } from "@/lib/finance";
import { dayLabel, original } from "@/lib/finance-format";
import { cn } from "@/lib/utils";

/** A loan's every repayment, to the cent, in the columns of the bank's
 *  repayment plan (还款计划): to set beside the bank's app line by line. The
 *  repayments already made are dimmed, the next is marked and scrolled to, and
 *  a rate change gets a line of its own where it starts. Where there is no
 *  room for six columns -- a phone -- the payment goes, being principal plus
 *  interest; a change of payment is still said on the rate change's line. */
export function LoanScheduleTable({ terms, currency, today, className }: {
  terms: LoanTerms;
  currency: string;
  today: string;
  className?: string;
}) {
  const { periods, totals } = useMemo(() => loanSchedule(terms), [terms]);
  const made = repaymentsMade(periods, today);
  const scroller = useRef<HTMLDivElement>(null);
  const nextRow = useRef<HTMLTableRowElement>(null);
  const amount = (n: number) => original(n, currency, { code: false });

  // Open on the next repayment, a couple of the last ones above it for context.
  useEffect(() => {
    const box = scroller.current, row = nextRow.current;
    if (box && row) box.scrollTop = Math.max(0, row.offsetTop - 3 * row.offsetHeight);
  }, [made]);

  // A changed payment is worth a word only where it is level: 等额本金's falls anyway.
  const level = terms.method === "annuity";
  return (
    <div className={cn("grid gap-2", className)}>
      <div ref={scroller} className="@container max-h-96 overflow-auto rounded-lg ring-1 ring-foreground/10">
        <table className="w-full text-xs tabular-nums [&_td]:px-1 [&_th]:px-1 [&_tr>*:first-child]:pl-1.5 [&_tr>*:last-child]:pr-1.5 @md:[&_td]:px-2 @md:[&_th]:px-2">
          <thead className="text-muted-foreground [&_th]:sticky [&_th]:top-0 [&_th]:z-10 [&_th]:bg-card [&_th]:py-2 [&_th]:font-normal">
            <tr className="text-right">
              <th className="text-left">#</th>
              <th className="text-left">Date</th>
              <th className="hidden @md:table-cell">Payment</th>
              <th>Principal</th>
              <th>Interest</th>
              <th>Balance</th>
            </tr>
          </thead>
          <tbody className="[&_td]:py-1.5">
            {periods.map((p, i) => (
              <Fragment key={p.n}>
                {i > 0 && p.rate !== periods[i - 1].rate && (
                  <tr className="border-t border-border/60">
                    <td colSpan={6} className="text-muted-foreground">
                      From {dayLabel(p.date)}: {p.rate}% a year{level && p.payment !== periods[i - 1].payment && `, ${amount(p.payment)} a month`}
                    </td>
                  </tr>
                )}
                <tr
                  ref={i === made ? nextRow : undefined}
                  aria-current={i === made ? "step" : undefined}
                  className={cn("border-t border-border/60 text-right", i < made && "text-muted-foreground", i === made && "bg-muted font-medium")}
                >
                  <td className="text-left">{p.n}</td>
                  <td className="text-left whitespace-nowrap">{p.date}</td>
                  <td className="hidden @md:table-cell">{amount(p.payment)}</td>
                  <td>{amount(p.principal)}</td>
                  <td>{amount(p.interest)}</td>
                  <td>{amount(p.balance)}</td>
                </tr>
              </Fragment>
            ))}
          </tbody>
        </table>
      </div>
      {/* Beneath rather than in a last row: sums that long would widen every column. */}
      <p className="text-xs text-muted-foreground tabular-nums">
        In all <span className="font-medium text-foreground">{amount(totals.payment)}</span>: {amount(totals.principal)} principal
        and <span className="font-medium text-foreground">{amount(totals.interest)}</span> interest, over {periods.length} repayments.
      </p>
    </div>
  );
}
