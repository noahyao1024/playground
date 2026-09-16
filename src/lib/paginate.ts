/** Read every row a query matches, not just the first page.
 *
 * PostgREST caps how many rows one request returns, and the cap is a server
 * setting the client cannot see. Code that assumes one request returns
 * everything is trusting a number it has no way to check — and when the cap is
 * hit the response is an ordinary 200 with fewer rows, so a truncated read is
 * indistinguishable from a complete one. Nothing throws. The caller just
 * quietly works from partial data.
 *
 * Pass a builder that applies `.range(from, to)` to the query. That query must
 * order by something unique: Postgres may return tied rows in any order it
 * likes, so a sort with ties can shuffle rows across a page boundary between
 * two requests, dropping some and repeating others. `created_at` is not enough
 * here — a billing run writes its whole batch in the same second.
 */
export async function fetchAllRows<T>(
  page: (from: number, to: number) => PromiseLike<{
    data: T[] | null;
    error: { message: string } | null;
  }>,
  pageSize = 1000,
): Promise<T[]> {
  const rows: T[] = [];
  for (let from = 0; ; from += pageSize) {
    const { data, error } = await page(from, from + pageSize - 1);
    if (error) throw new Error(error.message);
    if (!data || data.length === 0) break;
    rows.push(...data);
    // A short page means the end; a full one might not be.
    if (data.length < pageSize) break;
  }
  return rows;
}
