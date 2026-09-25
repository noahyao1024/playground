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

Not `supabase db push`. That replays whatever the remote's `schema_migrations` table does
not list, and these migrations went in one at a time through the MCP server, which did not
record them — seven of the thirteen are not idempotent and would error or double-apply.

A file in `supabase/migrations/` is therefore still not proof it is live. Check before
assuming: aim PostgREST's `on_conflict` at the index you expect and read the error code —
`42P10` means no such constraint, and the probe writes nothing.
