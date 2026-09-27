import { beforeEach, describe, expect, it, vi } from "vitest";

const session = vi.hoisted(() => ({ current: null as { user: { email: string } } | null }));
vi.mock("@/lib/auth", () => ({ auth: async () => session.current }));
// The page is only asked whether it renders the app; the app itself is not rendered.
vi.mock("@/components/finance/finance-app", () => ({ FinanceApp: () => null }));

const { default: FinancePage, generateMetadata } = await import("@/app/finance/page");
const { FinanceApp } = await import("@/components/finance/finance-app");

/** What Next.js's notFound() throws, which it turns into the missing-page answer. */
async function missing(render: () => Promise<unknown>): Promise<boolean> {
  try {
    await render();
    return false;
  } catch (err) {
    return String((err as { digest?: unknown }).digest).endsWith(";404");
  }
}

beforeEach(() => { session.current = null; });

describe("/finance", () => {
  it("is a missing page to anyone but the owner, signed in or not, and says nothing of what it is", async () => {
    expect(await missing(FinancePage)).toBe(true);
    expect(await generateMetadata()).toEqual({});
    session.current = { user: { email: "someone@else.com" } };
    expect(await missing(FinancePage)).toBe(true);
    expect(await generateMetadata()).toEqual({});
  });

  it("is the owner's accounts, to the owner", async () => {
    session.current = { user: { email: "hi@noahyao.me" } };
    const page = (await FinancePage()) as { type: unknown };
    expect(page.type).toBe(FinanceApp);
    expect(await generateMetadata()).toEqual({ title: "Finance | Playground", robots: { index: false, follow: false } });
  });
});
