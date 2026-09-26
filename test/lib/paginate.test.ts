import { describe, expect, it } from "vitest";
import { fetchAllRows, pagesOf } from "@/lib/paginate";

/** A page function over an in-memory table, recording each range it was asked for. */
function pager(total: number) {
  const asked: Array<[number, number]> = [];
  const page = async (from: number, to: number) => {
    asked.push([from, to]);
    const data = Array.from({ length: Math.max(0, Math.min(total, to + 1) - from) }, (_, i) => from + i);
    return { data, error: null };
  };
  return { page, asked };
}

describe("fetchAllRows", () => {
  it("keeps asking until a page comes back short", async () => {
    const { page, asked } = pager(2500);
    const rows = await fetchAllRows(page, 1000);
    expect(rows).toHaveLength(2500);
    expect(rows.at(-1)).toBe(2499);
    expect(asked).toEqual([[0, 999], [1000, 1999], [2000, 2999]]);
  });

  it("asks once more after an exactly full last page, and stops on the empty one", async () => {
    const { page, asked } = pager(2000);
    expect(await fetchAllRows(page, 1000)).toHaveLength(2000);
    expect(asked).toEqual([[0, 999], [1000, 1999], [2000, 2999]]);
  });

  it("returns nothing for an empty table after one request", async () => {
    const { page, asked } = pager(0);
    expect(await fetchAllRows(page)).toEqual([]);
    expect(asked).toHaveLength(1);
  });

  it("throws the error rather than returning what it had so far", async () => {
    let calls = 0;
    const page = async () => (++calls === 1
      ? { data: Array(1000).fill(0), error: null }
      : { data: null, error: { message: "boom" } });
    await expect(fetchAllRows(page)).rejects.toThrow("boom");
  });
});

describe("pagesOf", () => {
  /** A table of `total` numbered rows whose pages answer after `delay(from)` ms,
   *  recording what was asked and how many requests were open at once. */
  function slowPager(
    total: number,
    { withCount = true, delay = () => 0, failAt = -1 }: { withCount?: boolean; delay?: (from: number) => number; failAt?: number } = {},
  ) {
    const asked: Array<[number, number, boolean]> = [];
    let open = 0;
    let mostOpen = 0;
    const page = async (from: number, to: number, count: boolean) => {
      asked.push([from, to, count]);
      mostOpen = Math.max(mostOpen, ++open);
      await new Promise((resolve) => setTimeout(resolve, delay(from)));
      open--;
      // A dropped connection rejects outright; that is the case worth guarding.
      if (from === failAt) throw new Error(`page at ${from} failed`);
      const data = Array.from({ length: Math.max(0, Math.min(total, to + 1) - from) }, (_, i) => from + i);
      return { data, error: null, count: withCount && count ? total : null };
    };
    return { page, asked, mostOpen: () => mostOpen };
  }
  const collect = async <T,>(pages: AsyncIterable<T[]>) => {
    const out: T[][] = [];
    for await (const p of pages) out.push(p);
    return out;
  };

  it("asks for the count once, then for every other page without waiting on the one before", async () => {
    const { page, asked, mostOpen } = slowPager(4500, { delay: () => 5 });
    const pages = await collect(pagesOf(page, { pageSize: 1000, concurrency: 4 }));
    expect(pages.map((p) => p.length)).toEqual([1000, 1000, 1000, 1000, 500]);
    expect(asked.filter(([, , count]) => count)).toEqual([[0, 999, true]]);
    expect(mostOpen()).toBe(4);
  });

  it("hands pages back in order even when later ones answer first", async () => {
    // The further along the page, the faster it answers.
    const { page } = slowPager(3500, { delay: (from) => 40 - from / 100 });
    const rows = (await collect(pagesOf(page, { pageSize: 1000 }))).flat();
    expect(rows).toEqual(Array.from({ length: 3500 }, (_, i) => i));
  });

  it("never has more than `concurrency` requests open", async () => {
    const { page, mostOpen } = slowPager(10_000, { delay: () => 3 });
    await collect(pagesOf(page, { pageSize: 1000, concurrency: 2 }));
    expect(mostOpen()).toBe(2);
  });

  it("reads one page after another when the reply carries no count", async () => {
    const { page, asked, mostOpen } = slowPager(2000, { withCount: false });
    expect((await collect(pagesOf(page, { pageSize: 1000 }))).flat()).toHaveLength(2000);
    expect(asked.map(([from]) => from)).toEqual([0, 1000, 2000]);
    expect(mostOpen()).toBe(1);
  });

  it("stops after one request for an empty table, or a single short page", async () => {
    for (const total of [0, 10]) {
      const { page, asked } = slowPager(total);
      expect((await collect(pagesOf(page))).flat()).toHaveLength(total);
      expect(asked).toHaveLength(1);
    }
  });

  it("fails on a page that fails, and leaves no failure unhandled", async () => {
    const unhandled: unknown[] = [];
    const onUnhandled = (reason: unknown) => unhandled.push(reason);
    process.on("unhandledRejection", onUnhandled);
    try {
      // Page 3000 fails at once, while pages 1000 and 2000 are still slow.
      const { page } = slowPager(5000, { failAt: 3000, delay: (from) => (from === 3000 ? 0 : 20) });
      await expect(collect(pagesOf(page, { pageSize: 1000 }))).rejects.toThrow("page at 3000 failed");
      await new Promise((resolve) => setTimeout(resolve, 50));
      expect(unhandled).toEqual([]);
    } finally {
      process.off("unhandledRejection", onUnhandled);
    }
  });
});
