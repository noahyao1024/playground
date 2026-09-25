import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

type Call = { url: string; body: { action: string; table: string; id?: string; data?: unknown; updates?: Record<string, unknown> } };
let sent: Call[];
let refuse: (body: Call["body"]) => string | undefined;

// The store only reaches the server when a Supabase client exists, and that is
// decided when src/lib/supabase.ts is first imported -- so the environment is
// set before the store is.
let store: typeof import("@/lib/store");
beforeAll(async () => {
  vi.stubEnv("NEXT_PUBLIC_SUPABASE_URL", "http://127.0.0.1:1");
  vi.stubEnv("NEXT_PUBLIC_SUPABASE_ANON_KEY", "anon");
  vi.stubGlobal("fetch", vi.fn(async (url: string, init: RequestInit) => {
    const body = JSON.parse(String(init.body));
    sent.push({ url, body });
    const error = refuse(body);
    return new Response(JSON.stringify(error ? { error } : { ok: true }), { status: error ? 400 : 200 });
  }));
  store = await import("@/lib/store");
});
afterAll(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
});
beforeEach(() => {
  sent = [];
  refuse = () => undefined;
});

describe("clearing a value", () => {
  it("sends null for a detached card, which JSON keeps, where undefined would vanish", async () => {
    await store.updateCharge("c1", { payment_method_id: null });
    await store.updateSubscription("s1", { payment_method_id: null });
    expect(sent.map((c) => c.body.updates)).toEqual([{ payment_method_id: null }, { payment_method_id: null }]);
    // The failure this guards against, spelled out.
    expect(JSON.parse(JSON.stringify({ payment_method_id: undefined }))).toEqual({});
  });

  it("sends null for an emptied note", async () => {
    await store.updateCharge("c1", { note: null });
    expect(sent[0].body.updates).toEqual({ note: null });
  });
});

describe("default card", () => {
  it("clears every default before setting the new one", async () => {
    await store.updatePaymentMethod("pm2", { is_default: true });
    expect(sent.map((c) => [c.body.id, c.body.updates])).toEqual([
      ["__all__", { is_default: false }],
      ["pm2", { is_default: true }],
    ]);
  });

  it("fails the save when clearing the old default fails, instead of adding a second default", async () => {
    refuse = (body) => (body.id === "__all__" ? "clear failed" : undefined);
    await expect(store.addPaymentMethod({
      label: "Visa ****1111", cardholder_name: "Ann", card_type: "visa", last4: "1111",
      expiry_month: 1, expiry_year: 2030, is_default: true,
    })).rejects.toThrow("clear failed");
    expect(sent.map((c) => c.body.action)).toEqual(["update"]);
  });

  it("leaves other cards alone when the new card is not the default", async () => {
    await store.addPaymentMethod({
      label: "", cardholder_name: "Ann", card_type: "visa", last4: "2222", expiry_month: 1, expiry_year: 2030, is_default: false,
    });
    expect(sent.map((c) => c.body.action)).toEqual(["insert"]);
  });
});

describe("deleting a charge", () => {
  it("marks it deleted rather than removing it, and restoring unmarks it", async () => {
    await store.deleteCharge("c1");
    await store.restoreCharge("c1");
    expect(sent.map((c) => c.body.action)).toEqual(["update", "update"]);
    expect(typeof sent[0].body.updates?.deleted_at).toBe("string");
    expect(sent[1].body.updates).toEqual({ deleted_at: null });
  });
});

describe("walletBalance", () => {
  it("nets one person's entries and ignores everyone else's", () => {
    const entries = [
      { id: "1", subscriber_id: "a", amount_cny: 100, kind: "topup" as const },
      { id: "2", subscriber_id: "a", amount_cny: -30, kind: "charge" as const },
      { id: "3", subscriber_id: "b", amount_cny: 500, kind: "topup" as const },
      { id: "4", subscriber_id: "a", amount_cny: 30, kind: "adjustment" as const },
    ];
    expect(store.walletBalance(entries, "a")).toBe(100);
    expect(store.walletBalance(entries, "nobody")).toBe(0);
  });
});
