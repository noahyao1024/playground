import http from "node:http";
import { randomUUID } from "node:crypto";
import type { AddressInfo } from "node:net";

export type Row = Record<string, unknown>;

export type Request = {
  method: string;
  path: string;
  table: string;
  params: URLSearchParams;
  headers: http.IncomingHttpHeaders;
  body: unknown;
};

type Reply = { status: number; body?: unknown; headers?: Record<string, string> };

export type Options = {
  /** Handlers for /rest/v1/rpc/<name>. */
  rpc?: Record<string, (args: Row) => Reply>;
  /** Anything outside /rest/v1 -- the app's own /api/exchange-rate, say. */
  other?: (req: Request) => Reply | undefined;
  /** Runs before the table logic; return a reply to answer instead of it. */
  intercept?: (req: Request) => Reply | undefined;
};

export type StandIn = {
  url: string;
  tables: Record<string, Row[]>;
  requests: Request[];
  close: () => Promise<void>;
};

/** Filters as PostgREST spells them in a query string: eq, neq, is and in, each
 *  optionally negated with not. Anything else throws, so a test never passes by
 *  a filter being silently ignored. */
function matches(row: Row, column: string, expression: string): boolean {
  const negated = expression.startsWith("not.");
  const expr = negated ? expression.slice(4) : expression;
  const dot = expr.indexOf(".");
  const op = expr.slice(0, dot);
  const value = expr.slice(dot + 1);
  const cell = row[column];
  let ok: boolean;
  switch (op) {
    case "eq": ok = cell !== null && cell !== undefined && String(cell) === value; break;
    case "neq": ok = cell !== null && cell !== undefined && String(cell) !== value; break;
    case "is":
      ok = value === "null" ? cell === null || cell === undefined : String(cell) === value;
      break;
    case "in": ok = value.replace(/^\(|\)$/g, "").split(",").includes(String(cell)); break;
    default: throw new Error(`stand-in PostgREST: unsupported filter ${column}=${expression}`);
  }
  return negated ? !ok : ok;
}

const RESERVED = new Set(["select", "order", "offset", "limit", "on_conflict", "columns"]);

function filtered(rows: Row[], params: URLSearchParams): Row[] {
  let out = rows;
  for (const [key, value] of params) {
    if (RESERVED.has(key)) continue;
    out = out.filter((row) => matches(row, key, value));
  }
  return out;
}

function ordered(rows: Row[], order: string | null): Row[] {
  // With no ORDER BY any order is legal. Reverse insertion order is the one
  // most likely to catch code that quietly assumed one.
  if (!order) return [...rows].reverse();
  const keys = order.split(",").map((part) => {
    const [column, direction] = part.split(".");
    return { column, desc: direction === "desc" };
  });
  return [...rows].sort((a, b) => {
    for (const { column, desc } of keys) {
      const x = a[column] as string | number, y = b[column] as string | number;
      if (x === y) continue;
      return (x < y ? -1 : 1) * (desc ? -1 : 1);
    }
    return 0;
  });
}

/** A stand-in for Supabase's PostgREST that behaves the way the app depends on:
 *  filters, multi-column ordering, offset/limit paging capped at 1000 rows like
 *  the real service, count=exact on HEAD, single-object replies, inserts,
 *  updates, deletes and rpc calls. Every request is recorded. */
export async function startPostgrest(tables: Record<string, Row[]>, options: Options = {}): Promise<StandIn> {
  const requests: Request[] = [];

  const server = http.createServer((incoming, res) => {
    let raw = "";
    incoming.on("data", (chunk) => (raw += chunk));
    incoming.on("end", () => {
      const url = new URL(incoming.url ?? "/", "http://stand-in");
      const req: Request = {
        method: incoming.method ?? "GET",
        path: url.pathname,
        table: url.pathname.replace(/^\/rest\/v1\//, ""),
        params: url.searchParams,
        headers: incoming.headers,
        body: raw ? JSON.parse(raw) : undefined,
      };
      requests.push(req);

      const send = ({ status, body, headers = {} }: Reply) => {
        res.writeHead(status, { "content-type": "application/json", ...headers });
        res.end(body === undefined ? "" : JSON.stringify(body));
      };

      try {
        const intercepted = options.intercept?.(req);
        if (intercepted) return send(intercepted);

        if (!url.pathname.startsWith("/rest/v1/")) {
          const reply = options.other?.(req);
          return send(reply ?? { status: 404, body: { message: `no stand-in for ${url.pathname}` } });
        }

        if (req.table.startsWith("rpc/")) {
          const handler = options.rpc?.[req.table.slice(4)];
          if (!handler) return send({ status: 404, body: { message: `no rpc ${req.table}` } });
          return send(handler((req.body ?? {}) as Row));
        }

        const rows = (tables[req.table] ??= []);
        const representation = String(incoming.headers.prefer ?? "").includes("return=representation");
        const single = String(incoming.headers.accept ?? "").includes("vnd.pgrst.object");
        const answer = (out: Row[]) => {
          if (single) {
            if (out.length !== 1) return send({ status: 406, body: { message: `expected 1 row, got ${out.length}` } });
            return send({ status: 200, body: out[0] });
          }
          return send({ status: 200, body: out });
        };

        switch (req.method) {
          case "HEAD": {
            const count = filtered(rows, req.params).length;
            return send({ status: 200, headers: { "content-range": count ? `0-${count - 1}/${count}` : `*/0` } });
          }
          case "GET": {
            const offset = Number(req.params.get("offset") ?? 0);
            const limit = Math.min(Number(req.params.get("limit") ?? Infinity), 1000);
            return answer(ordered(filtered(rows, req.params), req.params.get("order")).slice(offset, offset + limit));
          }
          case "POST": {
            const incomingRows = (Array.isArray(req.body) ? req.body : [req.body]) as Row[];
            // An upsert: on_conflict names the unique columns, and a row matching
            // an existing one on all of them is merged into it instead of added.
            const conflict = req.params.get("on_conflict")?.split(",");
            const merge = conflict && String(incoming.headers.prefer ?? "").includes("resolution=merge-duplicates");
            const written = incomingRows.map((row) => {
              const existing = merge ? rows.find((r) => conflict.every((col) => r[col] === row[col])) : undefined;
              if (existing) return Object.assign(existing, row);
              const inserted = { id: randomUUID(), ...row };
              rows.push(inserted);
              return inserted;
            });
            return representation || single ? answer(written) : send({ status: 201 });
          }
          case "PATCH": {
            const hit = filtered(rows, req.params);
            for (const row of hit) Object.assign(row, req.body as Row);
            return representation || single ? answer(hit) : send({ status: 204 });
          }
          case "DELETE": {
            const hit = new Set(filtered(rows, req.params));
            tables[req.table] = rows.filter((row) => !hit.has(row));
            return representation ? answer([...hit]) : send({ status: 204 });
          }
          default:
            return send({ status: 405, body: { message: req.method } });
        }
      } catch (err) {
        return send({ status: 500, body: { message: err instanceof Error ? err.message : String(err) } });
      }
    });
  });

  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const { port } = server.address() as AddressInfo;
  return {
    url: `http://127.0.0.1:${port}`,
    tables,
    requests,
    close: () => new Promise<void>((resolve) => server.close(() => resolve())),
  };
}

/** The requests made to one table, as "METHOD query" strings without select=. */
export function calls(standIn: StandIn, table: string): string[] {
  return standIn.requests
    .filter((r) => r.table === table)
    .map((r) => {
      const params = new URLSearchParams(r.params);
      params.delete("select");
      return `${r.method} ${decodeURIComponent(params.toString())}`;
    });
}
