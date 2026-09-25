# AGENTS.md

Guidance for AI agents working in this repo.

## Don't run the app locally

Verification happens against the **remote**, not `localhost`. Do not run `npm run dev`,
`npm run build`, or start any server to check your work.

There is no `.env.local` here, and no `.env.production` — both held real production values
and were deleted; `vercel env pull` regenerates either if you ever genuinely need one.
`src/lib/supabase.ts` has no hardcoded fallback, so a dev server started in this checkout
comes up in localStorage mode with sign-in disabled. A local "it works" proves nothing, and
filling those files back in to make it work would be solving the wrong problem.

`.env.example` is tracked and lists every variable with a line on what breaks without it.
It is the one place that describes the environment; keep it true.

To check something, use the remote instead:

```bash
curl -sI https://playground.noahyao.me/          # live site
gh run list -L 5                                 # GitHub Actions
vercel ls                                        # Vercel deployments (CLI is logged in)
gh api repos/noahyao1024/playground/deployments  # same, via the GitHub Deployments Vercel writes back
```

A Claude Code on the web session may have neither `gh` nor `vercel`, and its network policy
may not reach the live site or Supabase. The repo is public, so which commit is live still
answers without either: `curl -s 'https://api.github.com/repos/noahyao1024/playground/deployments?per_page=1'`.

Checks that need no server of the app's and no secrets are fine and expected:

```bash
npm run typecheck   # tsc --noEmit
npm run lint        # eslint
npm test            # vitest
```

Check their output, not their exit code through a pipe — `npx eslint src | head` reports
success because `head` succeeded.

The tests never start the app. They call route handlers and library functions directly,
against `test/helpers/postgrest.ts`, a stand-in for Supabase's REST API that filters, orders
and caps pages at 1000 rows the way the real one does. `test/sql/` is the exception: it
builds the schema from `supabase/migrations/` on a real Postgres and tests what lives there —
the settle functions and their locking, the unique indexes, the append-only ledger. It needs
`TEST_DATABASE_URL` pointing at a server it may create databases on, skips without one
locally, and fails without one in CI. Any throwaway Postgres will do:
`TEST_DATABASE_URL=postgresql://postgres@localhost:5432/postgres npm test`.

A fix comes with a test that fails without it. Revert the fix, watch the test go red, put
it back — a test that passes either way guards nothing.

## Deploying

Push to `main`. Vercel auto-deploys it — there is no deploy command. Confirm local and
remote `main` agree before pushing.

**Deploys are pre-approved** (the owner's decision, 2026-09-25): an agent need not ask
before merging its own pull request to `main`, provided that

- the Check workflow — typecheck, lint and the tests — is green on the pull request's head,
- the Vercel preview build succeeded, and
- the change carries tests for what it fixes or adds.

After merging, confirm the production deployment of the merge commit reaches `success`, and
say what went out. A migration still follows the process below: rehearse it first, apply it
only once the code that depends on it is live, and ask before one that drops or rewrites
data.

Vercel writes each deployment back as a GitHub Deployment, so `gh api .../deployments`
tells you which commit is live and whether it succeeded.

## This repo is public

`noahyao1024/playground` is a **public** repo. `.env*` is gitignored with one deliberate
exception, `!.env.example`, which holds placeholders only. The history is clean — no
service-role key has ever been committed. Keep it that way: never paste a key, token, or
connection string into a tracked file, a commit message, or a PR description. Workflow logs
are public too, so print the *shape* of a secret when diagnosing one, never the value.

`vercel.json` is tracked and holds only a cron schedule. Don't put secrets there.

## Layout

- Next.js 16 App Router, TypeScript, Tailwind v4, shadcn/ui
- Supabase (`@supabase/supabase-js`) for data; NextAuth v5 + Google OAuth for sign-in
- `.github/workflows/supabase-keepalive.yml` — daily, pings Supabase REST so the free-tier
  project doesn't get paused. Occasional 504s from upstream are noise; it retries.
- `.github/workflows/unpaid-alert.yml` — daily, emails `ALERT_TO` — the owner, not the people
  who owe — a list of anyone owing more than `UNPAID_THRESHOLD_CNY`. Silent when nobody is
  over it, which is the common case.
- `.github/workflows/check.yml` — typecheck, lint and tests on every pull request and push
  to `main`, with a Postgres service for `test/sql/`. The gate pre-approved deploys rest on.
- `vercel.json` — cron hitting `/api/cron/bill` at 00:00 UTC on the 1st, 2nd and 3rd. The
  last two are retries: billing fills only what has no charge yet, so they bill nothing when
  the 1st worked.
- `.github/dependabot.yml` — grouped weekly updates, split into production and development,
  with majors excluded. Not because majors are unwelcome, but because they want someone able
  to look at the result; a green preview build does not catch a renamed icon. Note that a
  *minor* has broken the build here too: eslint-plugin-react-hooks 7.1.1 added two rules and
  took lint from zero errors to eight.
- `.claude/hooks/session-start.sh` — runs `npm install` when a Claude Code on the web session
  starts, so the checks work there from the first command. A no-op on your machine.
- `/finance` and `/api/finance` — the owner's accounts and balances, answering only
  `FINANCE_OWNER` in `src/lib/access.ts`. `finance_accounts` and `finance_balances` are the one
  private corner of the database: RLS with no policy, privileges revoked from `anon` and
  `authenticated`. Do not give them a `select` policy to match the other tables — that publishes
  the owner's balances to anyone holding the public key. The arithmetic (carry-forward, archive
  cut-off, stored rates) lives in `src/lib/finance.ts`; the page only draws it.
- Chart colours are `--series-1` to `--series-3` in `globals.css`, a palette checked for
  colour-blind separation with separate dark steps. Marks wear them; text never does.

Two conventions worth knowing before adding code:

- `src/lib/paginate.ts` — PostgREST caps rows per request and a capped response is an
  ordinary 200, so anything reading a table that grows without bound pages through it. Every
  paged query needs a unique sort key; `created_at` is not one, since a billing run stamps
  its whole batch with the same second.
- `src/components/ui/number-input.tsx` — use it for numeric fields. Binding a number
  straight to a controlled input makes the field refuse to be emptied.

GitHub runs scheduled jobs late, routinely by hours. A job that has not fired yet is not
evidence it is broken; check `gh run list --workflow=<name>` for `event=schedule`.

## Applying a migration

`.github/workflows/apply-migration.yml`, run by hand, one named file at a time. Leave
`apply` off first: it executes the file inside a transaction and rolls back, so syntax,
permissions and conflicts surface without keeping anything.

It needs the `SUPABASE_DB_URL` secret, and only one of the two connection strings Supabase
shows will do. Take the **Connection pooling** one, session mode, port 5432 —
`postgresql://postgres.<ref>:<password>@aws-<region>.pooler.supabase.com:5432/postgres`.
The Direct connection (`db.<ref>.supabase.co`, user `postgres`) is IPv6-only and no GitHub
runner can reach it. Both mistakes are now caught before any SQL runs, with the reason
named; the database password is not viewable after creation, so changing this means
resetting it, which breaks nothing here — nothing in this project connects to Postgres
directly.

Not `supabase db push`. That replays whatever the remote's `schema_migrations` table does
not list, and none of these is listed there: they went in one at a time, through the MCP
server at first and this workflow since, and neither records them. Seven of them are not
idempotent and would error or double-apply.

A file in `supabase/migrations/` is therefore still not proof it is live. Check before
assuming. The workflow's last step lists `charges`' indexes from `pg_indexes` on every run,
pass or fail, and prints them to the log as well as the summary — that is the direct answer.

Failing that, rehearse the migration: these are written `if not exists`, so an object that
is already there comes back as `NOTICE: relation "…" already exists, skipping` rather than
`CREATE INDEX`, and the rehearsal rolls back either way.

Do **not** use PostgREST's `on_conflict` as an existence probe. It cannot infer a *partial*
index — `on_conflict=` emits no `WHERE`, and Postgres will not match `ON CONFLICT (cols)`
to an index with a predicate — so it answers `42P10` whether or not the index exists.
`charges_one_per_service_month` is partial. This probe was used here for a week and read as
"not applied" the whole time, including after it had been applied.
