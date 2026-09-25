# AGENTS.md

Guidance for AI agents working in this repo.

## Don't run the app locally

Verification happens against the **remote**, not `localhost`. Do not run `npm run dev`,
`npm run build`, or start any server to check your work.

`.env.local` intentionally holds only `VERCEL_OIDC_TOKEN` — no Supabase URL/keys, no
`AUTH_*`. `src/lib/supabase.ts` has no hardcoded fallback, so a local dev server comes up
in localStorage mode with sign-in disabled: a local "it works" proves nothing. Don't try to
repair this by copying values out of `.env.production`.

To check something, use the remote instead:

```bash
curl -sI https://playground.noahyao.me/          # live site
gh run list -L 5                                 # GitHub Actions
vercel ls                                        # Vercel deployments (CLI is logged in)
gh api repos/noahyao1024/playground/deployments  # same, via the GitHub Deployments Vercel writes back
```

Type-level checks that need no server or secrets (`npx tsc --noEmit`, `npm run lint`) are
fine.

## Deploying

Push to `main`. Vercel auto-deploys it — there is no deploy command. Confirm local and
remote `main` agree before pushing.

Vercel writes each deployment back as a GitHub Deployment, so `gh api .../deployments`
tells you which commit is live and whether it succeeded.

## This repo is public

`noahyao1024/playground` is a **public** repo. `.env*` is gitignored and the history is
clean — keep it that way. Never paste a key, token, or connection string into a tracked
file, a commit message, or a PR description.

`vercel.json` is tracked and holds only a cron schedule. Don't put secrets there.

## Layout

- Next.js 16 App Router, TypeScript, Tailwind v4, shadcn/ui
- Supabase (`@supabase/supabase-js`) for data; NextAuth v5 + Google OAuth for sign-in
- `.github/workflows/supabase-keepalive.yml` — daily, pings Supabase REST so the free-tier
  project doesn't get paused. Occasional 504s from upstream are noise; it retries.
- `.github/workflows/unpaid-alert.yml` — daily, emails whoever owes more than
  `UNPAID_THRESHOLD_CNY`. Silent when nobody is over it, which is the common case.
- `vercel.json` — monthly cron hitting `/api/cron/bill` on the 1st

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
not list, and these migrations went in one at a time through the MCP server, which did not
record them — seven of the thirteen are not idempotent and would error or double-apply.

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
