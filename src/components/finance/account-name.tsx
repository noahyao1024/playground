import { displayName, type FinanceAccount } from "@/lib/finance";
import { cn } from "@/lib/utils";

/** Whose an account is, set beside its name rather than in it: "Daisy" and
 *  "微信余额" read as one phrase, and the name stays the account's own. */
export function OwnerTag({ owner, className }: { owner?: string | null; className?: string }) {
  if (!owner) return null;
  return (
    <span className={cn("inline-flex shrink-0 items-center rounded-md bg-muted px-1.5 text-[11px] leading-[18px] font-medium text-muted-foreground", className)}>
      {owner}
    </span>
  );
}

/** An account as the page names it everywhere: owner, then institution and name. */
export function AccountName({ account, className }: { account: FinanceAccount; className?: string }) {
  return (
    <span className={cn("flex min-w-0 items-center gap-1.5", className)}>
      <OwnerTag owner={account.owner} />
      <span className="truncate">{displayName(account)}</span>
    </span>
  );
}
