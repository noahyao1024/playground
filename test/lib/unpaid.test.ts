import { describe, expect, it } from "vitest";
import { alertMail, overThreshold } from "@/lib/unpaid";

const people = [{ id: "a", name: "Alice" }, { id: "b", name: "Bob" }, { id: "c", name: "Cara" }];

describe("overThreshold", () => {
  it("adds up each person's unpaid charges and keeps those over the line, most owed first", () => {
    const over = overThreshold([
      { subscriber_id: "a", total_cny: 300, period_start: "2026-08" },
      { subscriber_id: "a", total_cny: "250.50", period_start: "2026-07" },
      { subscriber_id: "b", total_cny: 900, period_start: "2026-09" },
      { subscriber_id: "c", total_cny: 500, period_start: "2026-09" },
    ], people, 500);
    expect(over).toEqual([
      { name: "Bob", owed: 900, charges: 1, oldest: "2026-09" },
      { name: "Alice", owed: 550.5, charges: 2, oldest: "2026-07" },
    ]);
  });

  it("names someone it has no name for by their id, and owes nothing for no charges", () => {
    expect(overThreshold([{ subscriber_id: "x", total_cny: 600, period_start: "2026-09" }], people, 500)[0].name).toBe("x");
    expect(overThreshold([], people, 0)).toEqual([]);
  });
});

describe("alertMail", () => {
  it("says who owes what, as the GitHub workflow's mail did", () => {
    const { subject, text } = alertMail([{ name: "Bob", owed: 1234.5, charges: 3, oldest: "2026-07" }], 500, "https://x/split-bill");
    expect(subject).toBe("Split bill: 1 over the unpaid threshold");
    expect(text).toBe([
      "1 person(s) owe more than ¥500.",
      "",
      "  Bob: ¥1,234.50 across 3 charge(s), oldest 2026-07",
      "",
      "https://x/split-bill",
    ].join("\n"));
  });
});
