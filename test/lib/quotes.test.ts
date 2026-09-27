import { describe, expect, it } from "vitest";
import { QuoteError, parseChart, quoteOf, quotesFor } from "@/lib/quotes";

/** A chart answer as the quote source gives one, trimmed to what is read. */
const chart = (meta: Record<string, unknown>) => ({ chart: { result: [{ meta }], error: null } });
const apple = chart({
  symbol: "AAPL", currency: "USD", regularMarketPrice: 341.07, chartPreviousClose: 336.13, regularMarketTime: 1790366401,
  exchangeName: "NMS", longName: "Apple Inc.", shortName: "Apple",
});
const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });

/** A fetch answering by URL, and the URLs it was asked. */
function fake(answer: (url: string) => Response | Promise<Response>) {
  const asked: string[] = [];
  const fetcher = (async (url: string | URL | Request) => {
    const href = String(url);
    asked.push(href);
    return answer(href);
  }) as typeof fetch;
  return { fetcher, asked };
}

describe("a chart answer", () => {
  it("reads as a quote: the price, its currency and the close before", () => {
    expect(parseChart("AAPL", apple)).toEqual({
      symbol: "AAPL", price: 341.07, currency: "USD", name: "Apple Inc.", time: "2026-09-25T20:00:01.000Z", previous_close: 336.13, exchange: "NMS",
    });
  });

  it("reads London's pence as pounds", () => {
    const q = parseChart("VOD.L", chart({ currency: "GBp", regularMarketPrice: 7250, chartPreviousClose: 7100, regularMarketTime: 1790366401 }));
    expect(q).toMatchObject({ price: 72.5, previous_close: 71, currency: "GBP" });
  });

  it("is refused without a price", () => {
    expect(() => parseChart("X", chart({ currency: "USD" }))).toThrow(QuoteError);
    expect(() => parseChart("X", { chart: { result: null } })).toThrow("no price in the answer");
  });
});

describe("fetching a quote", () => {
  it("asks the first host, a day's chart, as a short user agent", async () => {
    const { fetcher, asked } = fake(() => json(apple));
    expect(await quoteOf("0700.HK", fetcher)).toMatchObject({ symbol: "0700.HK", price: 341.07 });
    expect(asked).toEqual(["https://query1.finance.yahoo.com/v8/finance/chart/0700.HK?interval=1d&range=1d"]);
  });

  it("tries the second host when the first will not answer", async () => {
    const { fetcher, asked } = fake((url) => (url.startsWith("https://query1") ? new Response("Too Many Requests", { status: 429 }) : json(apple)));
    expect((await quoteOf("AAPL", fetcher)).price).toBe(341.07);
    expect(asked.map((u) => new URL(u).host)).toEqual(["query1.finance.yahoo.com", "query2.finance.yahoo.com"]);
  });

  it("gives up at once on a symbol the source does not know, and says it is final", async () => {
    const { fetcher, asked } = fake(() => json({ chart: { result: null, error: { code: "Not Found", description: "No data found" } } }, 404));
    const err = await quoteOf("NOPE", fetcher).catch((e: QuoteError) => e);
    expect(err).toMatchObject({ message: "no such symbol", final: true, symbol: "NOPE" });
    expect(asked).toHaveLength(1);
  });

  it("says why when neither host answers", async () => {
    const { fetcher } = fake(() => new Response("down", { status: 503 }));
    await expect(quoteOf("AAPL", fetcher)).rejects.toMatchObject({ message: "HTTP 503", final: false });
  });
});

describe("fetching many", () => {
  it("answers every symbol once, each failure apart", async () => {
    const { fetcher, asked } = fake((url) => (url.includes("/NOPE?") ? json({ chart: { error: { code: "Not Found" } } }, 404) : json(apple)));
    const quotes = await quotesFor(["AAPL", "NOPE", "AAPL", "MSFT", "A", "B", "C"], fetcher);
    expect([...quotes.keys()]).toEqual(["AAPL", "NOPE", "MSFT", "A", "B", "C"]);
    expect(quotes.get("NOPE")).toEqual({ error: "no such symbol", final: true });
    expect(quotes.get("MSFT")).toMatchObject({ symbol: "MSFT", price: 341.07 });
    expect(asked).toHaveLength(6);
  });
});
