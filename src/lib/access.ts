/** Who may do what. The owner may see /finance and /housing; ALLOWED_EMAILS may
 *  edit the split bill. ADMIN_EMAILS -- comma-separated, set on Vercel only --
 *  names more addresses with all of the owner's rights: the repository is
 *  public, so an address written here would be published, and one in the
 *  environment is not. The environment is read on the server only; the browser
 *  is told what the signed-in address may do, through the session (`withRoles`,
 *  which auth.ts runs), never who else may. Kept apart from auth.ts so the pages
 *  and the tests can ask without NextAuth. */
export const FINANCE_OWNER = "hi@noahyao.me";

/** Who may edit the split bill, besides the admins. */
export const ALLOWED_EMAILS = [
  "nicholasyao.sg@gmail.com",
  "hi@noahyao.me",
];

const normal = (email: string | null | undefined) => (email ?? "").trim().toLowerCase();

/** The addresses with the owner's rights besides the owner's own: server only. */
export function adminEmails(): string[] {
  return (process.env.ADMIN_EMAILS ?? "").split(",").map(normal).filter(Boolean);
}

export function isFinanceOwner(email: string | null | undefined): boolean {
  const e = normal(email);
  return !!e && (e === FINANCE_OWNER || adminEmails().includes(e));
}

export function isAllowedEmail(email: string | null | undefined): boolean {
  const e = normal(email);
  return !!e && (ALLOWED_EMAILS.includes(e) || adminEmails().includes(e));
}

/** What a signed-in address may do, for the browser to show. */
export type Roles = { canEdit: boolean; isOwner: boolean };

/** A session with what its address may do: NextAuth's session callback. */
export function withRoles<S extends { user?: { email?: string | null } | null }>(session: S): S {
  if (!session.user) return session;
  const roles: Roles = { canEdit: isAllowedEmail(session.user.email), isOwner: isFinanceOwner(session.user.email) };
  return { ...session, user: { ...session.user, ...roles } };
}
