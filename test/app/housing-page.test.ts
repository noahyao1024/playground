import { beforeEach, describe, expect, it, vi } from "vitest";

const session = vi.hoisted(() => ({ current: null as { user: { email: string } } | null }));
vi.mock("@/lib/auth", () => ({ auth: async () => session.current }));
// The page is only asked whether it renders the app; the app itself is not rendered.
vi.mock("@/components/housing/housing-app", () => ({ HousingApp: () => null }));

const { default: HousingPage, generateMetadata } = await import("@/app/housing/page");
const { HousingApp } = await import("@/components/housing/housing-app");

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

describe("/housing", () => {
  it("is a missing page to anyone but the owner of /finance, signed in or not, and says nothing of what it is", async () => {
    expect(await missing(HousingPage)).toBe(true);
    expect(await generateMetadata()).toEqual({});
    for (const email of ["someone@else.com", "nicholasyao.sg@gmail.com"]) {
      session.current = { user: { email } };
      expect(await missing(HousingPage)).toBe(true);
      expect(await generateMetadata()).toEqual({});
    }
  });

  it("is the comparison, to the owner", async () => {
    session.current = { user: { email: "hi@noahyao.me" } };
    const page = (await HousingPage()) as { type: unknown };
    expect(page.type).toBe(HousingApp);
    expect(await generateMetadata()).toEqual({ title: "Housing | Playground", robots: { index: false, follow: false } });
  });

  it("is the comparison to an address in ADMIN_EMAILS too", async () => {
    session.current = { user: { email: "partner@example.com" } };
    vi.stubEnv("ADMIN_EMAILS", "partner@example.com");
    try {
      expect(((await HousingPage()) as { type: unknown }).type).toBe(HousingApp);
    } finally {
      vi.unstubAllEnvs();
    }
  });
});
