/** Who may see /finance: one address, narrower than ALLOWED_EMAILS in auth.ts,
 *  which lets both addresses edit the split bill. Kept apart from auth.ts so the
 *  navbar and home page can ask without pulling NextAuth into the browser. */
export const FINANCE_OWNER = "hi@noahyao.me";

export function isFinanceOwner(email: string | null | undefined): boolean {
  return !!email && email.trim().toLowerCase() === FINANCE_OWNER;
}
