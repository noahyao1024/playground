"use client";

import { Check } from "lucide-react";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import type { Lens } from "@/lib/finance";
import { cn } from "@/lib/utils";

const EVERYONE = "__everyone__";
const NOBODY = "__nobody__";

/** What the filters leave out, in words, for beside the figures they change. */
export function describeLens(lens: Lens): string | null {
  const parts = [
    lens.owner != null && (lens.owner === "" ? "accounts with no owner" : `${lens.owner}’s accounts`),
    lens.excludeLongTerm && "excluding long-term loans",
    lens.liquidOnly && "liquid share only",
  ].filter(Boolean) as string[];
  if (parts.length === 0) return null;
  const text = parts.join(" · ");
  return text.charAt(0).toUpperCase() + text.slice(1);
}

/** The filters every figure on the page is worked out through. Each shows only
 *  where it would change something: no mortgage, no long-term switch. */
export function LensBar({ lens, onChange, owners, hasUnowned, hasLongTerm, hasIlliquid }: {
  lens: Lens;
  onChange: (lens: Lens) => void;
  /** Everyone named as an owner, sorted. */
  owners: string[];
  /** Whether some accounts name no owner. */
  hasUnowned: boolean;
  hasLongTerm: boolean;
  hasIlliquid: boolean;
}) {
  if (!hasLongTerm && !hasIlliquid && owners.length === 0) return null;
  const ownerValue = lens.owner == null ? EVERYONE : lens.owner === "" ? NOBODY : lens.owner;
  const ownerLabel = (v: string | null) => (v == null || v === EVERYONE ? "Everyone" : v === NOBODY ? "No owner" : v);
  return (
    <div role="group" aria-label="Filters" className="flex flex-wrap items-center gap-2">
      {owners.length > 0 && (
        <Select
          value={ownerValue}
          onValueChange={(v) => onChange({ ...lens, owner: v === EVERYONE ? null : v === NOBODY ? "" : (v as string) })}
        >
          <SelectTrigger size="sm" aria-label="Whose accounts" className="rounded-full px-3">
            <SelectValue>{ownerLabel}</SelectValue>
          </SelectTrigger>
          <SelectContent>
            <SelectItem value={EVERYONE}>Everyone</SelectItem>
            {owners.map((o) => <SelectItem key={o} value={o}>{o}</SelectItem>)}
            {hasUnowned && <SelectItem value={NOBODY}>No owner</SelectItem>}
          </SelectContent>
        </Select>
      )}
      {hasLongTerm && (
        <Chip pressed={!!lens.excludeLongTerm} onClick={() => onChange({ ...lens, excludeLongTerm: !lens.excludeLongTerm })}>
          Exclude long-term loans
        </Chip>
      )}
      {hasIlliquid && (
        <Chip pressed={!!lens.liquidOnly} onClick={() => onChange({ ...lens, liquidOnly: !lens.liquidOnly })}>
          Liquid share only
        </Chip>
      )}
    </div>
  );
}

function Chip({ pressed, onClick, children }: { pressed: boolean; onClick: () => void; children: React.ReactNode }) {
  return (
    <button
      type="button"
      aria-pressed={pressed}
      onClick={onClick}
      className={cn(
        "inline-flex h-7 items-center gap-1 rounded-full border px-3 text-[0.8rem] font-medium whitespace-nowrap transition-colors outline-none focus-visible:ring-3 focus-visible:ring-ring/50",
        pressed
          ? "border-foreground bg-foreground text-background"
          : "border-border bg-background text-muted-foreground hover:text-foreground dark:border-input dark:bg-input/30",
      )}
    >
      {pressed && <Check aria-hidden className="-ml-0.5 size-3.5" />}
      {children}
    </button>
  );
}
