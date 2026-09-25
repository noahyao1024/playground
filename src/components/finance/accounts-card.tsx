"use client";

import { useState } from "react";
import { Archive, ArchiveRestore, ChevronDown, MoreHorizontal, Pencil, Plus, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import {
  CATEGORIES, KINDS, LOAN_METHOD_LABELS, REGIONS, REGION_LABELS, displayName, isLongTerm, liquidityOf, loanStatus, loanTermsOf,
  sortAccounts, valueOf, weightOf,
  type FinanceAccount, type FinanceBalance, type Lens, type Position, type Unit,
} from "@/lib/finance";
import { UNIT_CODE, dayLabel, money, original } from "@/lib/finance-format";
import { dayInSG, todayInSG } from "@/lib/dates";
import { cn } from "@/lib/utils";
import { AccountName } from "./account-name";

const UNITS: Unit[] = ["cny", "sgd"];

export type AccountActions = {
  onAdd: () => void;
  onEdit: (account: FinanceAccount) => void;
  onArchive: (account: FinanceAccount, archived: boolean) => void;
  onDelete: (account: FinanceAccount) => void;
};

/** Every account, by kind and then region, each with its last balance as kept
 *  and what that is in CNY and SGD. What it holds, whatever the filters count:
 *  an account they leave out is dimmed, not hidden. */
export function AccountsCard({ accounts, last, position, lens, unit, actions }: {
  accounts: FinanceAccount[];
  /** Each account's newest balance. */
  last: Map<string, FinanceBalance>;
  /** The latest recorded day, unfiltered, for the group totals. */
  position: Position | undefined;
  lens: Lens;
  unit: Unit;
  actions: AccountActions;
}) {
  const [showArchived, setShowArchived] = useState(false);
  const open = sortAccounts(accounts.filter((a) => !a.archived_at));
  const archived = sortAccounts(accounts.filter((a) => a.archived_at));

  return (
    <section className="rounded-2xl bg-card p-5 ring-1 ring-foreground/10 sm:p-6">
      <div className="mb-2 flex items-center justify-between gap-3">
        <h2 className="text-base font-medium">Accounts</h2>
        <Button variant="outline" size="sm" onClick={actions.onAdd}><Plus /> Add account</Button>
      </div>

      {KINDS.map((kind) => {
        const ofKind = open.filter((a) => a.kind === kind);
        if (ofKind.length === 0) return null;
        const total = position?.[kind === "asset" ? "assets" : "liabilities"][unit];
        return (
          <div key={kind} className="mt-4">
            <div className="flex items-baseline justify-between border-b pb-1.5">
              <h3 className="text-sm font-medium">{kind === "asset" ? "Assets" : "Liabilities"}</h3>
              {total !== undefined && <span className="text-sm font-medium tabular-nums">{money(total, unit)}</span>}
            </div>
            {REGIONS.map((region) => {
              const group = ofKind.filter((a) => a.region === region);
              if (group.length === 0) return null;
              const subtotal = position?.byRegion[region][kind === "asset" ? "assets" : "liabilities"][unit];
              return (
                <div key={region} className="mt-2">
                  <div className="flex items-baseline justify-between py-1 text-xs text-muted-foreground">
                    <span>{REGION_LABELS[region]}</span>
                    {subtotal !== undefined && <span className="tabular-nums">{money(subtotal, unit)}</span>}
                  </div>
                  <ul className="divide-y divide-border/60">
                    {group.map((a) => (
                      <AccountRow key={a.id} account={a} balance={last.get(a.id)} latestDay={position?.day} lens={lens} unit={unit} actions={actions} />
                    ))}
                  </ul>
                </div>
              );
            })}
          </div>
        );
      })}

      {archived.length > 0 && (
        <div className="mt-5">
          <button
            type="button"
            onClick={() => setShowArchived((s) => !s)}
            aria-expanded={showArchived}
            className="flex items-center gap-1 text-xs text-muted-foreground transition-colors hover:text-foreground"
          >
            <ChevronDown className={cn("size-3.5 transition-transform", !showArchived && "-rotate-90")} />
            Archived ({archived.length})
          </button>
          {showArchived && (
            <ul className="mt-1 divide-y divide-border/60 opacity-70">
              {archived.map((a) => (
                <AccountRow key={a.id} account={a} balance={last.get(a.id)} latestDay={position?.day} lens={lens} unit={unit} actions={actions} />
              ))}
            </ul>
          )}
        </div>
      )}
    </section>
  );
}

/** What the meta line says about liquidity, debt length and a loan's schedule. */
function traits(a: FinanceAccount): string[] {
  const out: string[] = [];
  if (a.kind === "asset") {
    const share = liquidityOf(a);
    if (share === 0) out.push("not liquid");
    else if (share < 1) out.push(`${Math.round(share * 1000) / 10}% liquid`);
  } else {
    if (isLongTerm(a)) out.push("long-term");
    const terms = loanTermsOf(a);
    if (terms) {
      const s = loanStatus(terms, todayInSG());
      out.push(`${terms.rate}% ${LOAN_METHOD_LABELS[terms.method]}`, s.payments_left ? `${s.payments_left} of ${terms.months} left` : "repaid");
    }
  }
  return out;
}

function AccountRow({ account: a, balance: b, latestDay, lens, unit, actions }: {
  account: FinanceAccount;
  balance: FinanceBalance | undefined;
  latestDay: string | undefined;
  lens: Lens;
  unit: Unit;
  actions: AccountActions;
}) {
  const value = b ? valueOf(b) : undefined;
  const leftOut = !a.archived_at && weightOf(a, lens) === 0;
  // Worth in whichever of CNY and SGD the account is not already kept in: both,
  // for any other currency. The chosen unit first.
  const others = (unit === "cny" ? UNITS : [...UNITS].reverse()).filter((u) => UNIT_CODE[u] !== a.currency);
  return (
    <li className={cn("flex items-start gap-2 py-2.5", leftOut && "opacity-50")} title={leftOut ? "Left out by the filters above" : undefined}>
      <div className="min-w-0 flex-1">
        <AccountName account={a} className="text-sm" />
        <p className="meta-row flex min-w-0 flex-wrap gap-x-1.5 text-xs text-muted-foreground">
          <span>{CATEGORIES[a.kind][a.category] ?? a.category}</span>
          {traits(a).map((t) => <span key={t}>{t}</span>)}
          {a.archived_at && <span>archived {dayLabel(dayInSG(a.archived_at))}</span>}
          {/* Carried forward: it was not recorded on the latest day. */}
          {b && !a.archived_at && latestDay && b.as_of !== latestDay && <span>as of {dayLabel(b.as_of)}</span>}
        </p>
      </div>
      <div className="shrink-0 text-right">
        <p className="text-sm font-medium tabular-nums">{b ? original(Number(b.amount), a.currency) : "—"}</p>
        {value && others.length > 0 && (
          <p className="text-xs text-muted-foreground tabular-nums">
            {"≈ "}{others.map((u) => money(value[u], u)).join(" · ")}
          </p>
        )}
        {!b && <p className="text-xs text-muted-foreground">No balance yet</p>}
      </div>
      <DropdownMenu>
        <DropdownMenuTrigger render={<Button variant="ghost" size="icon-sm" aria-label={`Actions for ${displayName(a)}`} className="-mr-1.5 shrink-0" />}>
          <MoreHorizontal />
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end" className="w-40">
          <DropdownMenuItem onClick={() => actions.onEdit(a)}><Pencil /> Edit</DropdownMenuItem>
          {a.archived_at ? (
            <DropdownMenuItem onClick={() => actions.onArchive(a, false)}><ArchiveRestore /> Restore</DropdownMenuItem>
          ) : (
            <DropdownMenuItem onClick={() => actions.onArchive(a, true)}><Archive /> Archive</DropdownMenuItem>
          )}
          {!b && (
            <DropdownMenuItem variant="destructive" onClick={() => actions.onDelete(a)}><Trash2 /> Delete</DropdownMenuItem>
          )}
        </DropdownMenuContent>
      </DropdownMenu>
    </li>
  );
}
