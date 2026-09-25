import { afterEach, describe, expect, it, vi } from "vitest";
import { monthInSG, todayInSG } from "@/lib/dates";

describe("dates in Singapore", () => {
  afterEach(() => { vi.useRealTimers(); });

  it("is already the 1st in Singapore while UTC is still on the 30th", () => {
    // 16:30 UTC on 30 Sep is 00:30 on 1 Oct in Singapore (UTC+8): the case where
    // a billing run using UTC dates would bill the wrong month.
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-09-30T16:30:00Z"));
    expect(todayInSG()).toBe("2026-10-01");
    expect(monthInSG()).toBe("2026-10");
  });

  it("agrees with UTC once both are past midnight", () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-09-30T08:00:00Z"));
    expect(todayInSG()).toBe("2026-09-30");
    expect(monthInSG()).toBe("2026-09");
  });

  it("turns the year in Singapore first", () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-12-31T16:00:00Z"));
    expect(monthInSG()).toBe("2027-01");
  });
});
