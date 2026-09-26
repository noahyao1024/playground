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

type Page<T> = { data: T[] | null; error: { message: string } | null; count?: number | null };

/** The rows fetchAllRows reads, a page at a time and in order, with several
 *  pages in flight at once.
 *
 *  The first request asks for the exact count, so every later page can be
 *  requested without waiting for the one before: years of records arrive in a
 *  couple of round trips instead of one per thousand rows. Pages come back in
 *  order however the requests finish, so a caller can stream them as they
 *  come. The same rule as fetchAllRows holds: order by something unique.
 *
 *  `page` gets `count` true only for the first request. Without a count in the
 *  reply it reads on one page after another, as fetchAllRows does. */
export async function* pagesOf<T>(
  page: (from: number, to: number, count: boolean) => PromiseLike<Page<T>>,
  { pageSize = 1000, concurrency = 4 }: { pageSize?: number; concurrency?: number } = {},
): AsyncGenerator<T[]> {
  const first = await page(0, pageSize - 1, true);
  if (first.error) throw new Error(first.error.message);
  const rows = first.data ?? [];
  if (rows.length) yield rows;
  if (rows.length < pageSize) return;

  if (first.count == null) {
    for (let from = pageSize; ; from += pageSize) {
      const { data, error } = await page(from, from + pageSize - 1, false);
      if (error) throw new Error(error.message);
      if (!data || data.length === 0) return;
      yield data;
      if (data.length < pageSize) return;
    }
  }

  const starts: number[] = [];
  for (let from = pageSize; from < first.count; from += pageSize) starts.push(from);
  const inflight = new Map<number, Promise<Page<T>>>();
  let next = 0;
  const launch = () => {
    while (inflight.size < concurrency && next < starts.length) {
      const from = starts[next++];
      const request = Promise.resolve(page(from, from + pageSize - 1, false));
      // Awaited in turn below; this only keeps a failure that lands before its
      // turn from being reported as unhandled in the meantime.
      request.catch(() => {});
      inflight.set(from, request);
    }
  };
  launch();
  for (const from of starts) {
    const { data, error } = await inflight.get(from)!;
    inflight.delete(from);
    if (error) throw new Error(error.message);
    launch();
    if (data && data.length) yield data;
  }
}
