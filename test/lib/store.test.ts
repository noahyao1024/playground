import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

type Call = { url: string; body: { action: string; table: string; id?: string; data?: unknown; updates?: Record<string, unknown> } };
let sent: Call[];
let read: string[];
let refuse: (body: Call["body"]) => string | undefined;
const DETAILS = [{ id: "pm1", cardholder_name: "Ann Lee", expiry_month: 4, expiry_year: 2031 }];

// The store only reaches the server when a Supabase client exists, and that is
// decided when src/lib/supabase.ts is first imported -- so the environment is
// set before the store is.
let store: typeof import("@/lib/store");
beforeAll(async () => {
  vi.stubEnv("NEXT_PUBLIC_SUPABASE_URL", "http://127.0.0.1:1");
  vi.stubEnv("NEXT_PUBLIC_SUPABASE_ANON_KEY", "anon");
  vi.stubGlobal("fetch", vi.fn(async (url: string, init: RequestInit = {}) => {
    // Reads -- Supabase's REST, and the card details -- carry no body.
    if (init.body == null) {
      read.push(String(url));
      const json = String(url).startsWith("/api/data") ? { payment_methods: DETAILS } : [];
      return new Response(JSON.stringify(json), { status: 200, headers: { "Content-Type": "application/json" } });
    }
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
  read = [];
  refuse = () => undefined;
});

describe("reading cards", () => {
  it("asks the public key for the columns it may read, never the holder's name or the expiry", async () => {
    await store.fetchSubscriptionData();
    const cards = read.filter((u) => u.includes("/rest/v1/payment_methods"));
    expect(cards).toHaveLength(1);
    expect(new URL(cards[0]).searchParams.get("select")).toBe("id,label,card_type,last4,is_default,created_at");
  });

  it("asks the server for the holder's name and the expiry, which checks who is asking", async () => {
    expect(await store.fetchCardDetails()).toEqual(DETAILS);
    expect(read).toEqual(["/api/data?details=payment_methods"]);
  });
});

describe("saving a card from the form", () => {
  const form = { label: "", cardholderName: " Ann Lee ", cardNumber: "", expiryMonth: 4, expiryYear: 2031, isDefault: false };
  const saved = { card_type: "amex" as const, last4: "1005" };

  it("keeps the brand while the number is still shown masked: its last four say nothing of it", () => {
    // 1005 alone reads as no brand at all, and 4242 as Visa.
    expect(store.cardFromForm({ ...form, cardNumber: store.maskedCard("1005") }, saved, { amex: "Amex" })).toMatchObject({
      card_type: "amex", last4: "1005", cardholder_name: "Ann Lee", label: "Amex ****1005",
    });
    expect(store.cardTypeOfForm(store.maskedCard("4242"), { card_type: "mastercard", last4: "4242" })).toBe("mastercard");
  });

  it("reads the brand from a number typed in, new card or old", () => {
    expect(store.cardFromForm({ ...form, cardNumber: "4242 4242 4242 4242" }, null, { visa: "Visa" })).toMatchObject({ card_type: "visa", last4: "4242" });
    expect(store.cardTypeOfForm("5555 5555 5555 4444", saved)).toBe("mastercard");
  });
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

describe("whose wallet pays", () => {
  // Wal and Zed share Wal's wallet; Ann has a wallet of their own.
  const people = [
    { id: "wal", name: "Wal", pays_from: null },
    { id: "zed", name: "Zed", pays_from: "wal" },
    { id: "ann", name: "Ann" },
  ];

  it("is a person's own unless they pay from someone else's", () => {
    expect(store.walletOf(people, "zed")).toBe("wal");
    expect(store.walletOf(people, "wal")).toBe("wal");
    expect(store.walletOf(people, "ann")).toBe("ann");
    expect(store.walletOf(people, "unknown")).toBe("unknown");
    expect(store.payersFrom(people, "wal").map((p) => p.name)).toEqual(["Zed"]);
    expect(store.payersFrom(people, "ann")).toEqual([]);
  });

  it("offers only wallets of their own, one level deep, and none to a wallet others pay from", () => {
    expect(store.walletChoices(people, "ann").map((p) => p.id)).toEqual(["wal"]);
    expect(store.walletChoices(people, "zed").map((p) => p.id)).toEqual(["wal", "ann"]);
    expect(store.walletChoices(people, "wal")).toEqual([]);
  });

  it("says what a write paid from the wallet, or why it could not, or nothing", () => {
    expect(store.autoSettledText({ settled: 2, total: 106 })).toBe("2 charges, ¥106.00, paid from the wallet");
    expect(store.autoSettledText({ settled: 1, total: 53.5 }, "the wallets")).toBe("1 charge, ¥53.50, paid from the wallets");
    expect(store.autoSettledText({ settled: 0, total: 0 })).toBe("");
    expect(store.autoSettledText(undefined)).toBe("");
    expect(store.autoSettledText({ error: "boom" })).toBe("Paying from the wallet failed: boom");
  });
});
