import { describe, expect, it } from "vitest";
import { sameSitePath } from "@/lib/paths";

describe("sameSitePath", () => {
  it("keeps a path on this site", () => {
    expect(sameSitePath("/finance", "/split-bill")).toBe("/finance");
    expect(sameSitePath("/split-bill?tab=wallets", "/")).toBe("/split-bill?tab=wallets");
  });

  it("falls back for anything that could land elsewhere, or is not a path at all", () => {
    for (const value of ["https://evil.example/", "//evil.example", "/\\evil.example", "\\\\evil.example", "finance", "", "/ spaced", undefined, ["/finance"], 3]) {
      expect(sameSitePath(value, "/split-bill"), String(value)).toBe("/split-bill");
    }
  });
});
