# Playground — playground.noahyao.me

Personal tools, deployed on Vercel.

- **Split Bill / 分账** — tracks shared subscription costs among a handful of
  friends. Services are priced in SGD, USD or JPY and converted to CNY at the
  rate that held in the month being billed. Charges are settled from per-person
  wallets.
- **SRE Machine Delivery** — server deliveries from order to deployment.

## Stack

Next.js 16 (App Router) · React 19 · TypeScript · Tailwind v4 · shadcn/ui +
Base UI · Supabase (Postgres + PostgREST) · NextAuth v5 with Google OAuth.

## How access works

Worth reading before changing anything that touches data.

The anon key is **public on purpose** — it ships in the browser bundle. What
keeps it safe is RLS: every table has one policy, `select … using (true)`, so
that key can read and nothing more. A write attempted with it fails at the
database.

Writes go through `/api/*` routes, which run server-side with the service-role
key and gate on `isAllowedEmail(session.user.email)` against the allowlist in
[`src/lib/auth.ts`](src/lib/auth.ts). The check reads `session.user` and then
the address — not merely whether a session exists — so a NextAuth config error
that yields a session object without a user still returns 401.

`/api/charges/today` is read-only and open. Set `READONLY_TOKEN` to require a
bearer token; no code change needed.

## Environment

Copy `.env.example` to `.env.local`. Every key is listed there with a line on
what breaks without it.

Production values live in **Vercel** (`vercel env ls production`) and the two
GitHub Actions read theirs from **repository secrets**. Nothing is stored in
this repo, and `src/lib/supabase.ts` has no fallback: without
`NEXT_PUBLIC_SUPABASE_*` the client is `null` and the app runs against
localStorage rather than quietly attaching to production.

## Scheduled work

| what | where | when |
|---|---|---|
| Generate the month's charges | `vercel.json` → `/api/cron/bill` | 1st, 00:00 UTC |
| Email anyone owing over the threshold | `.github/workflows/unpaid-alert.yml` | daily, 01:23 UTC |
| Keep the free-tier Supabase project awake | `.github/workflows/supabase-keepalive.yml` | daily, 03:17 UTC |

GitHub runs scheduled jobs late — several hours, routinely. Treat the times as
hints.

Billing is self-healing: each run walks every month from a subscription's start
to the target month and fills whatever has no charge yet, each at its own
historical rate. A missed run costs latency, not data.

## Database

Migrations are in [`supabase/migrations/`](supabase/migrations). Apply one with
the **Apply Migration** workflow, which takes a filename and, unless you tick
`apply`, runs it inside a transaction and rolls back — a rehearsal against the
real schema rather than a printout.

It applies one named file rather than `supabase db push`, because these went in
one at a time, through the MCP server at first and this workflow since, and the
remote's `schema_migrations` table lists none of them; a push would replay every
one, and seven are not idempotent.

That also means a file sitting in the directory is not proof it is live. The
workflow lists `charges`' indexes from `pg_indexes` on every run as its last
step — that is the direct answer. Do not try to infer an index's existence
through PostgREST's `on_conflict`: it cannot match a *partial* index, so it
reports one missing whether or not it is there.

The workflow reads `SUPABASE_DB_URL`. Use the **Connection pooling** string
(session mode, port 5432); the Direct connection host is IPv6-only and no
GitHub runner can reach it.

## Deploying

Push to `main`; Vercel deploys it. There is no deploy command.

## Local development

`npm install && npm run dev` starts the app, but without a `.env.local` holding
real values it runs in localStorage mode with sign-in disabled. Verification for
this project happens against the deployed site — see [AGENTS.md](AGENTS.md).

`npm test` runs the tests, against stand-ins rather than Supabase. The database
suite in `test/sql/` also needs `TEST_DATABASE_URL`, pointing at any Postgres it
may create databases on; CI provides one.
