import { describe, expect, it, vi } from "vitest";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";

const state = vi.hoisted(() => ({ session: null as unknown, path: "/finance" }));
vi.mock("next-auth/react", () => ({ useSession: () => ({ data: state.session }), signOut: () => {} }));
vi.mock("next/navigation", () => ({ usePathname: () => state.path }));
vi.mock("next-themes", () => ({ useTheme: () => ({ theme: "light", setTheme: () => {} }) }));

const { Navbar } = await import("@/components/navbar");
const render = () => renderToStaticMarkup(createElement(Navbar));
/** The breadcrumb's name for the page, lower-cased as the navbar writes it. */
const NAMED = ">finance</span>";

describe("the navbar on /finance", () => {
  it("names the page for an address the session says is an owner, whichever it is", () => {
    // Made-up: an admin's real address lives in Vercel's environment only.
    state.session = { user: { email: "partner@example.com", name: "P", isOwner: true } };
    expect(render()).toContain(NAMED);
  });

  it("names it for no one else: the browser goes by the session, not by an address it knows", () => {
    state.session = { user: { email: "hi@noahyao.me", name: "N" } };
    expect(render()).not.toContain(NAMED);
    state.session = { user: { email: "someone@else.com", name: "S", isOwner: false } };
    expect(render()).not.toContain(NAMED);
    state.session = null;
    expect(render()).not.toContain(NAMED);
  });
});
