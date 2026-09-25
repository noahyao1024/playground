import { describe, expect, it } from "vitest";
import { fetchAllRows } from "@/lib/paginate";

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
