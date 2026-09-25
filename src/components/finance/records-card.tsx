"use client";

import { Fragment, useState } from "react";
import { ChevronRight, Pencil, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  changeBetween, displayName, sortAccounts, valueOf,
  type FinanceAccount, type FinanceBalance, type Position, type Unit,
} from "@/lib/finance";
import { UNIT_CODE, UNIT_SYMBOL, dayLabel, money, original, rate } from "@/lib/finance-format";
import { cn } from "@/lib/utils";
import { AccountName } from "./account-name";

/** Every recorded day, newest first: the chart's numbers, for reading rather
 *  than hovering. A day opens onto the balances recorded on it, each with the
 *  rates it was stored with. */
export function RecordsCard({ history, accounts, balances, unit, onEditDay, onDeleteBalance }: {
  history: Position[];
  accounts: FinanceAccount[];
  balances: FinanceBalance[];
  unit: Unit;
  onEditDay: (day: string) => void;
  onDeleteBalance: (balance: FinanceBalance, account: FinanceAccount | undefined) => void;
}) {
  const [openDay, setOpenDay] = useState<string | null>(null);
  const rows = history.map((p, i) => ({ p, change: changeBetween(history[i - 1]?.net, p.net, unit) })).reverse();

  return (
    <section className="rounded-2xl bg-card p-5 ring-1 ring-foreground/10 sm:p-6">
      <h2 className="text-base font-medium">Records</h2>
      <p className="mt-0.5 text-xs text-muted-foreground">
        Totals in {UNIT_CODE[unit]}. An account not recorded on a day counts at its last balance before it.
      </p>
      <div className="mt-3 overflow-x-auto">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b text-left text-xs text-muted-foreground">
              <th className="py-2 pr-2 font-normal">Day</th>
              <th className="hidden py-2 pr-2 text-right font-normal sm:table-cell">Assets</th>
              <th className="hidden py-2 pr-2 text-right font-normal sm:table-cell">Liabilities</th>
              <th className="py-2 pr-2 text-right font-normal">Net worth</th>
              <th className="py-2 text-right font-normal">Change</th>
            </tr>
          </thead>
          <tbody>
            {rows.map(({ p, change }) => {
              const isOpen = openDay === p.day;
              return (
                <Fragment key={p.day}>
                  <tr className={cn("border-b border-border/60", isOpen && "bg-muted/40")}>
                    <td className="py-2 pr-2">
                      <button
                        type="button"
                        onClick={() => setOpenDay(isOpen ? null : p.day)}
                        aria-expanded={isOpen}
                        className="-ml-1 flex items-center gap-1 rounded px-1 whitespace-nowrap hover:bg-muted"
                      >
                        <ChevronRight className={cn("size-3.5 text-muted-foreground transition-transform", isOpen && "rotate-90")} />
                        {dayLabel(p.day)}
                      </button>
                    </td>
                    <td className="hidden py-2 pr-2 text-right tabular-nums sm:table-cell">{money(p.assets[unit], unit)}</td>
                    <td className="hidden py-2 pr-2 text-right tabular-nums sm:table-cell">{money(p.liabilities[unit], unit)}</td>
                    <td className="py-2 pr-2 text-right font-medium tabular-nums">{money(p.net[unit], unit)}</td>
                    <td className={cn(
                      "py-2 text-right tabular-nums whitespace-nowrap",
                      !change || money(change.amount, unit) === money(0, unit)
                        ? "text-muted-foreground"
                        : change.amount > 0 ? "text-delta-up" : "text-delta-down",
                    )}>
                      {change ? money(change.amount, unit, { sign: true }) : "—"}
                    </td>
                  </tr>
                  {isOpen && (
                    <tr className="border-b border-border/60 bg-muted/40">
                      <td colSpan={5} className="px-1 pb-3">
                        <DayDetail
                          day={p.day}
                          accounts={accounts}
                          balances={balances}
                          onEdit={() => onEditDay(p.day)}
                          onDelete={onDeleteBalance}
                        />
                      </td>
                    </tr>
                  )}
                </Fragment>
              );
            })}
          </tbody>
        </table>
      </div>
    </section>
  );
}

/** What was recorded on one day. Accounts carried into it from earlier days are
 *  not listed: they belong to the day they were recorded on. */
function DayDetail({ day, accounts, balances, onEdit, onDelete }: {
  day: string;
  accounts: FinanceAccount[];
  balances: FinanceBalance[];
  onEdit: () => void;
  onDelete: (balance: FinanceBalance, account: FinanceAccount | undefined) => void;
}) {
  const recorded = new Map(balances.filter((b) => b.as_of === day).map((b) => [b.account_id, b]));
  const ordered = sortAccounts(accounts.filter((a) => recorded.has(a.id)));
  return (
    <div className="space-y-2 pt-1">
      <ul className="divide-y divide-border/60">
        {ordered.map((a) => {
          const b = recorded.get(a.id)!;
          const value = valueOf(b);
          // The rates it was stored with, except the one that is 1 by definition.
          const rates = [
            a.currency !== "CNY" && `${UNIT_SYMBOL.cny}${rate(b.cny_rate)}`,
            a.currency !== "SGD" && `${UNIT_SYMBOL.sgd}${rate(b.sgd_rate)}`,
          ].filter(Boolean).join(" · ");
          return (
            <li key={b.id} className="flex items-start gap-2 py-2 text-xs">
              <div className="min-w-0 flex-1">
                <p className="flex min-w-0 items-center gap-1.5 text-sm">
                  <AccountName account={a} />
                  {a.kind === "liability" && <span className="shrink-0 text-xs text-muted-foreground">owed</span>}
                </p>
                <p className="meta-row flex flex-wrap gap-x-1.5 text-muted-foreground">
                  <span>{rates} per {a.currency}</span>
                  {b.rate_date !== day && <span>rates of {dayLabel(b.rate_date)}</span>}
                  {b.note && <span>{b.note}</span>}
                </p>
              </div>
              <div className="shrink-0 text-right">
                <p className="text-sm tabular-nums">{original(Number(b.amount), a.currency)}</p>
                <p className="text-muted-foreground tabular-nums">
                  {money(value.cny, "cny")} {"·"} {money(value.sgd, "sgd")}
                </p>
              </div>
              <Button variant="ghost" size="icon-xs" aria-label={`Delete ${displayName(a)}'s balance for ${dayLabel(day)}`} onClick={() => onDelete(b, a)} className="shrink-0 text-muted-foreground hover:text-destructive">
                <Trash2 />
              </Button>
            </li>
          );
        })}
      </ul>
      <Button variant="outline" size="sm" onClick={onEdit}><Pencil /> Edit this day</Button>
    </div>
  );
}
