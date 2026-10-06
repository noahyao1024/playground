import { afterEach, describe, expect, it, vi } from "vitest";
import { ALLOWED_EMAILS, FINANCE_OWNER, adminEmails, isAllowedEmail, isFinanceOwner, withRoles } from "@/lib/access";

// Made-up addresses: the admins' real ones live in Vercel's environment only.
const PARTNER = "partner@example.com";
afterEach(() => { vi.unstubAllEnvs(); });

describe("who may do what", () => {
  it("lets the owner see /finance and both addresses edit the split bill, and no one else either", () => {
    expect(isFinanceOwner(FINANCE_OWNER)).toBe(true);
    expect(ALLOWED_EMAILS.every(isAllowedEmail)).toBe(true);
    expect(isFinanceOwner("nicholasyao.sg@gmail.com")).toBe(false);
    for (const nobody of [PARTNER, "", null, undefined]) {
      expect(isFinanceOwner(nobody)).toBe(false);
      expect(isAllowedEmail(nobody)).toBe(false);
    }
  });

  it("gives an address in ADMIN_EMAILS all of the owner's rights, however it is written", () => {
    vi.stubEnv("ADMIN_EMAILS", ` Partner@Example.com ,, other@example.com `);
    expect(adminEmails()).toEqual([PARTNER, "other@example.com"]);
    for (const email of [PARTNER, "PARTNER@example.com ", "other@example.com"]) {
      expect(isFinanceOwner(email)).toBe(true);
      expect(isAllowedEmail(email)).toBe(true);
    }
    expect(isFinanceOwner("someone@else.com")).toBe(false);
    vi.stubEnv("ADMIN_EMAILS", "");
    expect(isFinanceOwner(PARTNER)).toBe(false);
    expect(adminEmails()).toEqual([]);
  });

  it("tells the browser what the signed-in address may do, and nothing of who else may", () => {
    vi.stubEnv("ADMIN_EMAILS", PARTNER);
    const session = { user: { email: PARTNER, name: "P" }, expires: "2026-11-01T00:00:00Z" };
    const told = withRoles(session);
    expect(told).toEqual({ user: { email: PARTNER, name: "P", canEdit: true, isOwner: true }, expires: session.expires });
    expect(withRoles({ user: { email: "nicholasyao.sg@gmail.com" } }).user).toMatchObject({ canEdit: true, isOwner: false });
    expect(withRoles({ user: { email: "someone@else.com" } }).user).toMatchObject({ canEdit: false, isOwner: false });
    expect(withRoles({ user: null, expires: "x" })).toEqual({ user: null, expires: "x" });
    // Only booleans are added: no list, no other address.
    expect(JSON.stringify(withRoles({ user: { email: "someone@else.com" } }))).not.toContain(PARTNER);
  });
});
