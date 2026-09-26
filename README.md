# Playground — playground.noahyao.me

Personal tools, deployed on Vercel.

- **Split Bill / 分账** — tracks shared subscription costs among a handful of
  friends. Services are priced in SGD, USD or JPY and converted to CNY at the
  rate that held in the month being billed. Charges are settled from per-person
  wallets.
- **SRE Machine Delivery** — server deliveries from order to deployment.
- **Finance / 资产负债** — private to its owner. Accounts in China and Singapore,
  each kept in its own currency and recorded as a balance whenever the owner
  chooses; each balance is valued in CNY and SGD at the rates of its own day.
  Net worth, assets, debts, and how all three moved.

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

**Finance is the exception to all of the above.** `finance_accounts` and
`finance_balances` have RLS on and *no* policy, and every privilege is revoked
from `anon` and `authenticated`: the public key reads nothing there, and only the
service role, server-side, reaches them. `/api/finance` answers one address —
`FINANCE_OWNER` in [`src/lib/access.ts`](src/lib/access.ts), narrower than the
split bill's allowlist — with 401 for anyone else, and marks every response
`private, no-store`. `/finance` shows a sign-in prompt when signed out and a 404
to anyone else signed in. The navbar item and home-page card appear only for the
owner, but they are conveniences; the page and the route are the gate. The one
other way in is `FINANCE_API_TOKEN`, below.

## Finance: how the numbers work

- A **balance** is what one account held on one day, in the account's own
  currency. A liability's balance is what is owed, as a positive number.
- Each balance is stored with `cny_rate` and `sgd_rate` — what one unit of its
  currency was worth on `rate_date` (mid-market, ECB via Frankfurter, no markup;
  a weekend takes the last published day). History is never re-priced: a month
  already recorded keeps its value when rates move. Nothing is recorded when the
  rates cannot be fetched.
- An account not recorded on a day **carries forward** its last balance before
  it. Recording a day again replaces that day's balances; there is one per
  account per day.
- **Archiving** an account takes it off the books from the next day (Singapore
  time) and keeps its history. An account with balances cannot be deleted, and
  its currency cannot change — the database refuses both.
- An account may name its **owner** — the money is a family's — and is shown by
  its institution and name together, the owner beside them: *Daisy 微信余额*.
- **Liquidity** is the share of an asset that could be spent now. Unset, CPF /
  公积金 and property count as none of it and anything else as all; set it lower
  for shares partly under water.
- A **long-term** debt is a mortgage, unless marked otherwise, or anything
  marked so. The page's filters leave those out, count only liquid shares, or
  keep one owner's accounts; every total, the chart and the records follow them.
- A liability may carry **loan terms** — amount, annual rate, first repayment,
  term, 等额本息 or 等额本金 — from which the page works out the monthly payment,
  the payments left, and the principal and interest still to repay. The
  schedule is the plan; the balance recorded for the loan is the truth.

## Finance API, for agents

An agent or a script can work on the finance data as the owner — read it and
record balances — with a bearer token. It opens `/api/finance/*` and nothing
else: the split bill does not know it.

1. Generate one: `openssl rand -hex 32` (or `python3 -c "import secrets;
   print(secrets.token_hex(32))"`). Shorter than 32 characters is ignored.
2. Set it in Vercel as `FINANCE_API_TOKEN` for Production, then redeploy: an
   environment change reaches only deployments made after it.
3. Give the agent the same value in its own environment. Never in this repo —
   it is public.

```bash
curl -s https://playground.noahyao.me/api/finance/summary \
  -H "Authorization: Bearer $FINANCE_API_TOKEN"
```

| | |
|---|---|
| `GET /api/finance/openapi` | OpenAPI 3.1 description of all of this. Public. |
| `GET /api/finance/summary` | Where things stand, worked out: totals, change since the last record, each account's newest balance and loan schedule, history. Takes the page's filters: `?exclude_long_term=1&liquid_only=1&owner=Daisy`. |
| `GET /api/finance` | Every account and balance, as stored. |
| `POST /api/finance` | `{"action": …}`: `createAccount`, `updateAccount`, `deleteAccount`, `recordBalances`, `deleteBalance`. |

To revoke it, replace the value and redeploy; the old one stops working with
that deployment.

## Environment

Copy `.env.example` to `.env.local`. Every key is listed there with a line on
what breaks without it.

Production values live in **Vercel** (`vercel env ls production`): everything
the site and its scheduled jobs use. GitHub holds two secrets: `CRON_SECRET`,
the same value as Vercel's, for the Daily jobs workflow to call the site with,
and `SUPABASE_DB_URL` for the Apply Migration workflow.
Nothing is stored in this repo, and `src/lib/supabase.ts` has no fallback: without
`NEXT_PUBLIC_SUPABASE_*` the client is `null` and the app runs against
localStorage rather than quietly attaching to production.

## Scheduled work

| what | called by | when |
|---|---|---|
| Generate the month's charges: `/api/cron/bill` | Vercel Cron, and the Daily jobs workflow | 1st–3rd |
| Email `ALERT_TO` who owes over the threshold: `/api/cron/daily` | the Daily jobs workflow | daily |
| Keep the free-tier Supabase project awake: `/api/cron/keepalive` | Vercel Cron | daily |

The work happens on the site; what schedules it is split by what each scheduler
does well. The **Daily jobs** workflow (`.github/workflows/daily-jobs.yml`) runs
`scripts/daily-jobs.mjs`, which calls the routes and judges the answers, so each
run is on record in the Actions tab and a failed one — no answer, a refused
secret, a mail due that could not go, a charge skipped — is mailed to the owner
by GitHub. **Vercel Cron** (`vercel.json`) runs on time, within the hour on the
Hobby plan, and never lapses, but it does not retry, tells nobody when a run
fails, and keeps an hour of logs.

So each covers the other. GitHub stops scheduling workflows in a public
repository after 60 days without a commit, warning a week before; if that
happens, Vercel still bills and keeps the database awake, and only the alert
waits. If Vercel misses a billing run, the workflow's call fills it in — billing
fills only what has no charge yet, so two callers bill a month once. The alert
has one caller, since two would mean two mails.

All three routes answer only `Authorization: Bearer $CRON_SECRET`. In the
Actions tab, **Run workflow** runs the jobs on demand; ticking *Test mail* sends
the alert even when nobody is over the threshold, to check the mail setup.

Billing is self-healing: each run walks every month from a subscription's start
to the target month and fills whatever has no charge yet, each at its own
historical rate. A missed run costs latency, not data -- and running on the 1st,
2nd and 3rd keeps that latency to a day: the later two bill nothing when the 1st
worked. Twice this year a single missed run left a month unbilled for days.

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
