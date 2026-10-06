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
- `.github/workflows/daily-jobs.yml` — daily, runs `scripts/daily-jobs.mjs`, which calls
  `/api/cron/bill` on the 1st–3rd in Singapore, and `/api/cron/daily`, `/api/cron/stocks`,
  `/api/cron/housing` and `/api/cron/projects` every day, and fails the run when a job did not do its work, so GitHub mails the owner. `/api/cron/daily` works out
  who owes more than `UNPAID_THRESHOLD_CNY` and hands back the mail; the workflow sends it to
  `ALERT_TO` — the owner, not the people who owe — through the SMTP secrets GitHub holds. The
  site has no mail settings and no mail library. The run's log is public: counts and states
  only, never names or amounts; the mail body goes through a file. Schedule here rather than
  on Vercel because Vercel Cron on Hobby neither retries nor tells anyone and keeps an hour of
  logs; the work stays on the site, next to its configuration.
- The cron routes answer Vercel Cron's `CRON_SECRET`, or a GitHub OIDC token that
  `src/lib/cron.ts` checks is from `daily-jobs.yml` on `main` in this repository, by numeric
  repository id. So GitHub holds no copy of any site secret. Renaming the workflow file, or
  running it from another branch, is refused until `DAILY_JOBS_CLAIMS` says otherwise.
- GitHub holds what only its workflows use: the SMTP secrets (`SMTP_USERNAME`, `SMTP_PASSWORD`,
  `ALERT_TO`, and the optional variables `SMTP_SERVER`, `SMTP_PORT`, `MAIL_FROM`) and
  `SUPABASE_DB_URL`. `test/workflows.test.ts` fails any workflow reaching for anything else:
  configuration kept in two places goes stale in one of them.
- `.github/workflows/check.yml` — typecheck, lint and tests on every pull request and push
  to `main`, with a Postgres service for `test/sql/`. The gate pre-approved deploys rest on.
- `vercel.json` — cron hitting `/api/cron/bill` at 00:00 UTC on the 1st, 2nd and 3rd, and
  `/api/cron/keepalive` daily. The billing runs after the first are retries: billing fills only
  what has no charge yet, so they, and the workflow's call, bill nothing when the 1st worked.
  These are the backstop for GitHub, which stops scheduling in a public repository after 60
  days without a commit: bills still go out and the database stays awake. Never schedule
  `/api/cron/daily` here too — two callers would mean two mails.
- `.github/dependabot.yml` — grouped weekly updates, split into production and development,
  with majors excluded. Not because majors are unwelcome, but because they want someone able
  to look at the result; a green preview build does not catch a renamed icon. Note that a
  *minor* has broken the build here too: eslint-plugin-react-hooks 7.1.1 added two rules and
  took lint from zero errors to eight.
- `.claude/hooks/session-start.sh` — runs `npm install` when a Claude Code on the web session
  starts, so the checks work there from the first command. A no-op on your machine.
- `.mcp.json` — Supabase's MCP server for this project. A Claude Code on the web session
  cannot sign in to it and reports at start that it needs authorizing: expected, and not
  worth telling the owner. The owner's claude.ai Supabase connector (`mcp__Supabase__*`) is
  set up and reaches the same project; use it there.
- The split bill's wallets: a charge is paid by a `charge` entry in the append-only
  `wallet_entries`, through the settle functions, never by setting `paid` (`/api/data`
  refuses it). `auto_settle` (`src/lib/billing.ts` calls it) pays every live unpaid charge
  a wallet covers, oldest first, passing over one it cannot; the app runs it after
  billing, a new charge, a top-up, a restored charge and a change of `pays_from`, and a
  failure there is reported, never thrown, as the write before it stands. A person's
  wallet is `coalesce(pays_from, id)`, one level deep, which a trigger holds. Reversing
  a settlement does not stop the next run paying the charge again while the wallet
  covers it; to stop paying a charge, delete it.
- Who may do what is `src/lib/access.ts`: `FINANCE_OWNER` sees `/finance` and `/housing`,
  `ALLOWED_EMAILS` edit the split bill, and the addresses in `ADMIN_EMAILS` — set on Vercel
  only — have all of the owner's rights. Never write another address into this repository: it
  is public, and the address would be published for good. The environment is read on the
  server; the browser is told what the signed-in address may do through the session
  (`withRoles`, NextAuth's session callback: `canEdit`, `isOwner`), never who else may, so
  client components go by those flags, not by comparing addresses.
- `/finance` and `/api/finance` — the owner's accounts and balances, answering only the owners
  (`isFinanceOwner`). `finance_accounts` and `finance_balances` are the one
  private corner of the database: RLS with no policy, privileges revoked from `anon` and
  `authenticated`. Do not give them a `select` policy to match the other tables — that publishes
  the owner's balances to anyone holding the public key. The arithmetic (carry-forward, archive
  cut-off, stored rates, the filters, loan schedules) lives in `src/lib/finance.ts`; the page
  only draws it. `liquidity` and `long_term` are null until set, meaning "as the category
  says" — read them through `liquidityOf` and `isLongTerm`, never directly.
  A loan is scheduled period by period, as the bank's 还款计划 is (`loanSchedule`), and
  everything else about it is read off that schedule (`loanStatus`,
  `/api/finance/loan-schedule`). Don't bring back a closed form: it drifts from the bank by
  cents a month. Each month's interest is rounded to the cent, but for 等额本息 at a stated
  `loan_payment`: its balance is carried exactly, a BigInt fraction, as 建设银行 carries it,
  and shown to the cent, the principal what the shown balance fell by and the interest the
  rest of the payment. That matches the bank's plan to the cent where rounding each month
  drifted six fen; `loan_first_interest` takes four decimal places for it. Four methods
  (`LOAN_METHODS`: 等额本息, 等额本金, 等本等息, 先息后本) and three day counts
  (`loan_day_count`: 30/360, the default, or by the day, actual/365 or actual/360);
  interest is always balance × days, so a prepayment inside a period weights it by the day.
  `loan_payment`, `loan_first_interest` and `loan_maturity` are the bank's stated figures, null
  meaning "worked out" (a last repayment on the contract's end date is charged by the day).
  Rate changes and prepayments live in the private `finance_loan_rate_changes` and
  `finance_loan_prepayments`, never written over the terms, so the months before one keep what
  they were charged. Read a loan through `loanTermsOf`, which gathers all of it. The code runs
  before those tables' migrations are applied — none are read, the new columns are never sent
  empty — so merge first, then apply.
  RSUs are an asset with `rsu_plan` (`RSU_PLANS` in `src/lib/rsu.ts`, `tiktok` for now). The
  plan is the mechanism, in code; its numbers — the window months and cutoff day, each
  profile's rates by full years vested, the price over time (`prices`) — are the owner's,
  copied from the employer's pages, and live only in `rsu_rules` in the database. Never put
  them, or the grants, in this repository: the tests use made-up rules and prices. Grants and sales are in the private
  `finance_rsu_grants` and `finance_rsu_sales`, read as the loan tables are, so the code runs
  before their migration too. A window buys the floor of Σ shares × rate over the tranches
  vested by its cutoff, summed exactly in hundredths of a percent, less what was sold in the
  windows before (`rsuWindow`); a grant not yet `signed` counts only where asked. A window is
  priced at the plan's price in effect by its cutoff (`priceOn`). With `liquidity` null an
  RSU account's liquid share is what a window within `LIQUID_WITHIN_MONTHS` (3) may still
  buy of the shares held, and none while no window is that near, worked out for each day —
  read it through `liquidityOf(a, day)`. Its balance is still recorded by hand: the held
  shares at a price.
  Stocks are positions on an asset, in the private `finance_stock_positions`: shares of a
  symbol at an average cost, in the currency it trades in, with the last price fetched and
  the rate into the account's currency then (`src/lib/stocks.ts`). Prices come from Yahoo
  Finance's chart endpoint (`src/lib/quotes.ts`), keyless and unofficial: a full browser user
  agent gets 429, so it sends a short one, and a symbol it cannot price keeps its last price.
  `revalueStocks` (`src/lib/stocks-server.ts`) prices them and records the account's balance
  for the day with `liquid_share`: the value in positions up more than `liquid_min_gain`
  percent (10 unless set). Liquidity reads, in order: set by hand, the balance's own
  `liquid_share`, RSUs, positions, the category — pass the balance to `liquidityOf(a, day,
  balance)`. `/api/cron/stocks` answers in counts only: the Daily jobs log is public. Never
  put the owner's holdings in the repository; the tests use made-up ones.
  The owner's own agents get in as the owner with a bearer token: one made on the page
  (/finance → API access, `/api/finance/tokens`), stored only as its SHA-256 in the private
  `finance_api_tokens`, or `FINANCE_API_TOKEN` (`src/lib/finance-server.ts`). Tokens are made
  and revoked only from the owner's signed-in session, never with a token — one that could mint
  tokens could outlive its own revoking. `/api/finance/openapi` describes finance and housing, to the same
  token, and a test holds it to the route. `/finance` is a 404 to anyone but the owner, even
  signed out; the owner comes in by `/auth/signin?callbackUrl=/finance`.
- `/housing` and `/api/housing` — Singapore's housing market and the owner's rent-or-buy
  comparisons, behind the same check as `/finance` (`isFinanceOwner`, `financeAccessResponse`: the
  owner's session or a finance token).
  `/api/housing/openapi` serves the housing-only contract from `src/lib/housing-openapi.ts`;
  the finance contract composes its paths and schemas. Both use the same token/session,
  private/no-store headers and requested host. Contract tests check the actual POST action
  inventory, schema references, a saved example and stored-token revocation. New housing
  actions and fields need matching documentation. `/api/housing/analysis` returns project
  statistics and, for a selected scenario or read-only POST what-if, effective estimates,
  the full projection, real-money gap, 500 seeded futures, assumption checks and chart rows.
  `/api/housing/chart` exports those and every saved market series as passive SVG, under
  the same permission check and private/no-store headers. POST never saves a what-if;
  its chart URL is null, so send the same body to POST chart. Never put a token in a URL.
  Optional `inputs.property` is parsed by `housing-property.ts`: explicit development,
  area/unit, bedrooms/bathrooms, separate PropertyGuru buy/rent URLs and adopted
  adopted-quote snapshots. Keep it in `readInputs`' field-level legacy recovery.
  Links are references, never scraped, and URL search boundaries are not exact quotes.
  Linking applies region/lease only on the page's explicit selection and invalidates
  confirmation, retaining actual prices, verified AV and manual growth. API analysis
  never silently changes those inputs from property metadata or a scenario name.
  Comparable sales exclude bulk deals and match area; rentals also match known rooms.
  URA has no sale room count or bathroom data: say which dimensions are unverified.
  `property_context` shares this logic with the page. Quote amount/context mismatches
  must be reported, and refreshes retain adopted snapshots.
  `rentOrBuy` records nominal cumulative payment funding, principal, actual costs,
  investment deposits/gains and OA contributions/interest on each annual row.
  `housing-breakdown.ts` reconciles the PK asset and additive gap tables with those
  rows, including cent rounding, and differences annual flows from cumulative ones.
  Principal/funding are not extra expenses; sale costs are hypothetical once per row,
  not accumulated across hypothetical sales. CPF refunds are asset transfers, not
  another cost; housing accrued interest is distinct from actual OA interest.
  Keep page drilldowns, `comparison.breakdown`, and `cumulative-costs` SVG/JSON equal.
  `finance-access.ts` defines `housing:read`, `finance:read` (both resources), and
  `finance:write`. New tokens default to read-only; existing tokens retain write
  access via `20261006_finance_token_scopes.sql`. Require write permission before
  parsing any finance/housing mutation; analysis and chart POSTs remain reads.
  A supplied bearer never gains permission through a browser cookie. Only a
  specifically missing scope column enables the legacy lookup during deployment;
  other failures and unknown scopes fail closed. Minting fails 503 before the
  migration rather than turning a read-only token into a legacy write token.
  Token management still requires the owner session, never a bearer alone.
  OpenAPI is filtered by scope; `?read_only=true` downloads a compact read-only
  contract for schema importers that cannot authenticate their fetch. The Housing
  header opens token management, client configuration and a copyable Chinese prompt.
  `/api/housing/mcp` uses the standard SDK's stateless Streamable HTTP transport,
  bearer auth on every request, same-origin validation, no-store, and three read-only
  tools. It calls the existing raw/analysis/SVG handlers; keep it equivalent to REST
  and the page. Each tool schema is self-contained. SVG is an embedded resource;
  clients unable to render it can plot the JSON rows. No OAuth is implemented;
  don't promise compatibility with clients that require it or ordinary chats with
  no tool connection. No refresh, token management or write tool is exposed.
  `housing-comparison.ts` and `housing-charts.ts` are shared by the page and API: use them
  when changing calculations or chart rows. `simulate` caps the last browser batch at
  PATHS so a partial batch cannot diverge from the API's draws. A 200 refresh can carry
  failures: document them.
  Its tables — `housing_market`, `housing_sources`, `housing_scenarios` — are private like
  finance's though the figures are public data: the page
  is the owner's. The market is read from data.gov.sg, keyless, by `src/lib/housing-data.ts`,
  which names the datasets and makes one spelling of their towns ("Ang Mo Kio", "QUEENSTOWN ",
  CENTRAL AREA) and flat types ("4-RM" beside "4-room"); of two records for one figure the later
  stands. `/api/cron/housing` reads a dataset again only when its catalogue `lastUpdatedAt`
  moves, and a dataset it cannot read fails the daily run. Without a key data.gov.sg answers
  four record requests every ten seconds and turns the rest away with 429 — six datasets asked
  for at once from Vercel lost two that way — so the datasets are read one after another, each
  request for records 2.6 s after the last, and a 429 waits out its window before asking again.
  `DATA_GOV_SG_API_KEY`, optional, raises the limit. If data.gov.sg retires a dataset id,
  that is the failure you will see: find its successor in the catalogue and change the id.
  The arithmetic is `src/lib/housing.ts`: stamp duties and property tax as IRAS published them
  in October 2026 — when IRAS changes a rate, change it there and its test's figures with it —
  and the mortgage is `loanSchedule`'s. A scenario's inputs are kept whole as jsonb and checked
  by `parseInputs`, so a new input needs a default, not a migration. The comparison never
  refuses a residency or a kind of home; what the rules may not allow goes in `notesOn`.
  The growth model is `src/lib/housing-model.ts`. It reads four more series from
  `housing_market`: SingStat's 3-month SORA and SGS yields (`sora`, `sgs`) and CPI (`cpi`) from
  data.gov.sg, and the S&P 500 with dividends in SGD (`equity`: `^SP500TR` × `SGD=X`) from
  Yahoo's chart endpoint. Yahoo has no catalogue, so the calendar stands in for one: it is
  asked only once a quarter has closed that is not kept, and the quarter still running is
  never kept — the estimates move when a source publishes, monthly at most, not daily. The
  page reads the market from `housing_snapshot`, one row in one query: `refreshMarket` builds
  it again only when a figure moved, or when there is none in the shape `SNAPSHOT_VERSION`
  names — change `readMarket`'s answer and bump it. Without the table, before its migration,
  the page reads every figure as before. The estimates are live, each with its reason: the home's price growth
  and the investments' at the lower quartile of their ten-year spans (conservative, and the
  same rule for both), the investments' less `INVEST_COSTS` (0.3% a year: the US tax withheld
  on the dividends the index reinvests whole, and a fund's fees), rents and CPI at the middle
  span, SORA expected from the yields less each one's average premium over SORA, and a bank
  loan's fixed rate as SORA's expected average over its lock-in plus `FIXED_MARGIN` (0.3, as
  banks priced two-year packages in September 2026 -- when their pricing moves, move it and its
  test with it). The spread is what the loan pays over SORA after the lock-in, 0.7 by default
  as banks' spreads settle; it does not price the fixed rate. A scenario's `auto` lists the inputs that take them
  (`withEstimates`). A missing `auto` means none, so a scenario kept before keeps its numbers;
  the page's new comparison leaves all five to the market. Futures replay the joint quarterly
  history in two-year blocks, wrapping at its end. Each series' change has its mean taken out
  and the input's rate put in; SORA is an AR(1) departure from its expected path, floored at
  0. Draws are seeded: the same inputs draw the same futures, so a test can name its numbers.
  A future costs about a millisecond, so the page draws 500 of them 25 between frames
  (`use-simulation.ts`), and keeps the summaries of the last 32 comparisons it drew, so going
  back to one draws nothing. HDB published no rent medians for 2019 Q4: gaps of up to two
  quarters are bridged rather than breaking a series.
  The guided comparison (`src/components/housing/guided-inputs.tsx`) keeps what it asks in a
  scenario's optional `guidance` (`src/lib/housing-guidance.ts`); a scenario without it keeps
  manual contribution assumptions. Corrected cash and interest rules apply when recalculating
  all scenarios; saved inputs are never changed by a read. With guidance, a comparison is shown and saved only once
  `comparisonReady` (the route refuses one that is not): the buyer confirmed, a lease that has
  not run out, and for CPF from a salary an eligible buyer of known age; PRs on the new rules
  also need a grant date on or before `as_of`. A lease runs from
  1 January of its first year (the lease's, never the TOP year's: the form no longer asks that,
  which counted for nothing, and `parseGuidance` passes over a `build_year` saved before),
  counted at the `as_of` date kept with the scenario; the home's
  value carries an editable annual-effective discounted right-to-occupy factor
  (`lease_discount_rate`, default 3%; 0% gives linear decay), nothing at expiry, after which the
  buyer pays rent. CPF from a salary is the Ordinary Account's share at CPF's 2026 rates and
  its announced 2027 ones, ordinary wages to S$8,000; later years keep 2027's. When CPF
  publishes new rates, add them to `estimatedOa` and its test's figures with them.
  New guidance uses `2026-2027-pr-v2`: `pr_since` chooses the G/G contribution stage,
  switching in the month after the anniversary month, and `cpf_scheme` can select an approved
  F/F full-rate arrangement. Grant-month wages use labeled calendar-day proration; actual
  payroll proration, F/G, bonuses and special allocations need manual OA. Only the OA share
  of contributions is added to each side's savings. Older `2026-2027-v1` scenarios keep the
  full-rate assumption until the user enters a PR date; switching to salary CPF or switching
  buyer identity to PR also selects the new rules.
  `cpf_rules` names the rules a scenario was saved under and `parseGuidance` refuses any
  other: renaming it without still accepting the old name drops every saved scenario's
  guidance when read. CPF pays for the home up to a limit: none at 20 years of lease or less;
  else the verified limit, where one is given; else the price, for freehold or a lease that
  sees the youngest buyer to 95, and none otherwise. Comparisons run to 99 years; futures
  are drawn to `SIMULATED_YEARS` (35), past which only the central projection is shown.
  The final nominal gap also shows `inTodaysMoney`, deflated by `cost_growth` over the
  holding period. That assumption comes from CPI unless overridden; show its rate and the
  scenario's baseline date, and keep the nominal chart and winner unchanged.
  Growth and investment returns use annual effective compound rates. CPF OA savings
  and housing accrued interest accrue monthly at annual rate / 12 and compound only
  after the December year-end credit (`housing-cpf.ts`). Deposits earn next month;
  withdrawals reduce the current month's interest base. Pending OA interest is an
  asset in net worth but cannot pay the mortgage before credit. Annual rows expose
  credited balances, pending interest and housing principal/interest. Baseline-month
  transactions are modelled as a whole month; pre-baseline pending interest, actual
  transaction dates and extra CPF interest are excluded. Never call it a CPF statement.
  Bank minimum cash uses `housing-financing.ts`, not a flat 5% or the voluntarily
  selected loan share. `financing.outstanding_loans` is independent of ABSD's `nth`;
  `borrower_age` is the bank-assessed age, falling back to guidance age as a single
  borrower. Unknown ages use the lower band conservatively. HDB/private bank term
  thresholds differ. Exceeding the estimated LTV/term is flagged, not refused or
  silently rewritten. Test every band, cash requirement and borrower-age fallback.
  Historical replay proportions are scenario shares, never calibrated probabilities.
  Private developments the owner follows are read from URA's Data Service (`src/lib/ura.ts`)
  with `URA_ACCESS_KEY`, set on Vercel only. They live in `housing_projects`, with
  `housing_project_sales` and `housing_project_rents`, private like the rest. A key gets a token
  a day, and URA's firewall bars an address that asks for tokens again and again: this sandbox
  was barred after its second token request in a minute. So a run asks for one token, spaces its
  requests, and reads a development a week after it last did (`/api/cron/projects`, from the
  daily job), or at once when it is followed. Sales come in four files by postal district
  (01–07, 08–14, 15–21, 22–28), five years whole; rental contracts come one file a quarter, the
  one running and the five before it read (`RENT_QUARTERS`), as URA publishes a month two weeks
  after it ends and the page sums up the twelve months to the latest contract. Only followed
  developments are kept. A development's sales are replaced whole
  on each read, as URA gives a sale no id. Its `tenure` is kept as its sales give it
  ("99 yrs lease commencing from 2012", "Freehold"; '' where they give none), `leaseOf` reads it,
  and comparing one of its sizes fills the comparison's lease from it. One read before the column
  was there is read again once to fill it; before its migration none is written. The arithmetic — P50 and average by URA's rental size
  bands and by quarter, the yields — is `src/lib/housing-projects.ts`. The daily job's log never
  names a development: which ones the owner follows is the owner's business.
- Chart colours are `--series-1` to `--series-3` in `globals.css`, a palette checked for
  colour-blind separation with separate dark steps. Marks wear them; text never does.

Two conventions worth knowing before adding code:

- `src/lib/paginate.ts` — PostgREST caps rows per request and a capped response is an
  ordinary 200, so anything reading a table that grows without bound pages through it. Every
  paged query needs a unique sort key; `created_at` is not one, since a billing run stamps
  its whole batch with the same second. `pagesOf` fetches the pages several at a time, in
  order; `/api/finance` streams them as they come, which also lifts Vercel's 4.5 MB cap on a
  function's response. Keep lists of ids out of URLs: past a few hundred the gateway refuses.
- `src/components/ui/number-input.tsx` — use it for numeric fields. Binding a number
  straight to a controlled input makes the field refuse to be emptied.
- Supabase's advisors, held to in `test/sql`: every function in `public` pins its
  `search_path` (a `create or replace function` must say `set search_path = public, pg_temp`
  itself, since it resets the setting), and every foreign key has an index that starts with its
  columns. A new migration that breaks either fails CI before it reaches the live project.
- The public key reads the split bill and nothing more, also held to in `test/sql`: no write
  privilege on its tables, no `select` on a card's holder name or expiry (the page names its
  columns; editors get those from `GET /api/data`), and no function in `public` it may call.
  Postgres grants a new function to everyone, so a migration that adds one says
  `revoke execute on function f(…) from public, anon, authenticated`.

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
