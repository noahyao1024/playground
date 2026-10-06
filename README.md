# Playground — playground.noahyao.me

Personal tools, deployed on Vercel.

- **Split Bill / 分账** — tracks shared subscription costs among a handful of
  friends. Services are priced in SGD, USD or JPY and converted to CNY at the
  rate that held in the month being billed. Charges are settled from per-person
  wallets — automatically, oldest first, whenever the wallet holds enough: after
  each monthly run, a new charge, a top-up. A person can pay from someone else's
  wallet instead (`pays_from`), so a household shares one.
- **SRE Machine Delivery** — server deliveries from order to deployment.
- **Finance / 资产负债** — private to its owner. Accounts in China and Singapore,
  each kept in its own currency and recorded as a balance whenever the owner
  chooses; each balance is valued in CNY and SGD at the rates of its own day.
  Net worth, assets, debts, and how all three moved.
- **Housing / 租房还是买房** — private to the same owner. Singapore's home prices
  and rents from the government's open data — HDB's medians by town and flat
  type, URA's indices for private homes — as trends side by side, and renting
  against buying a particular home, year by year: stamp duties, the loan, CPF,
  what the money not spent would have earned. The years ahead are read off the
  market's own history, live, and played out over 500 futures drawn from it,
  with SORA, rents and prices moving together as they have.

## Stack

Next.js 16 (App Router) · React 19 · TypeScript · Tailwind v4 · shadcn/ui +
Base UI · Supabase (Postgres + PostgREST) · NextAuth v5 with Google OAuth.

## How access works

Worth reading before changing anything that touches data.

The anon key is **public on purpose** — it ships in the browser bundle. What
keeps it safe is RLS: every split-bill table has one policy, `select … using
(true)`, so that key can read and nothing more — and it holds no write
privilege to try with, nor may it call any function in `public`. A card's
holder name and expiry date are not granted to it either: the page shows those
to editors only, who get them from `GET /api/data`.

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
service role, server-side, reaches them. `/api/finance` answers the owner —
`FINANCE_OWNER` in [`src/lib/access.ts`](src/lib/access.ts), narrower than the
split bill's allowlist — and any address in `ADMIN_EMAILS`, set on Vercel only
so that no other address is published here, with 401 for anyone else, and marks every response
`private, no-store`. `/finance` is a 404 to everyone but the owner, signed in or
not, and names itself to nobody else — no title, no breadcrumb. Signed out, the
owner comes in by `/auth/signin?callbackUrl=/finance`. The navbar item appears
only for the owner, but it is a convenience; the page and the route are the
gate. The one other way in is an API token, below.

**Housing is behind the same door.** `/housing` and `/api/housing` answer whom
`/finance` answers — the owner's session, or a finance API token — and its
tables (`housing_market`, `housing_sources`, `housing_scenarios`) are as private
as finance's, although the market figures themselves are public data.

Housing's guided comparison starts with an asking/negotiated price and a comparable
whole-home monthly rent, then explicitly confirms residency, property count and
home kind. Fees, loan terms and growth estimates remain editable in advanced
settings. AV defaults to rent × 12 as a clearly labeled rough proxy (capped at
S$10 million); a verified IRAS annual value overrides it. Renovation has explicit
zero/simple/more templates, each editable. These are cost comparisons, not mortgage approval or affordability checks.

The holding period supports 1–99 years independently of the mortgage. Optional
lease start year and original term calculate remaining tenure at a saved assessment
date; TOP/build year calculates building age only. Expiry assumes 1 January of
start year + term. Leasehold value multiplies market growth by a normalized
3% discounted occupancy factor, not an official valuation. At expiry the home is
worth zero and the buyer pays replacement rent while still servicing any debt.
Scenarios beyond 35 years show assumptions only, without simulated win probabilities.

Salary-based CPF estimates cover employed citizens / PRs on full rates (PR year 3
onwards), ordinary wages up to S$8,000, age allocation and an editable retirement
age. They include published [2026 contribution rates](https://www.cpf.gov.sg/content/dam/web/employer/employer-obligations/documents/CPFcontributionratesfrom1Jan2026.pdf),
[2026 allocation rates](https://www.cpf.gov.sg/service/sfc/servlet.shepherd/document/download/069IW00000DZMxZYAX),
[2027 contribution rates](https://www.cpf.gov.sg/content/dam/web/employer/employer-obligations/documents/jan2027cpfcontributionrates.pdf)
and [2027 allocation rates](https://www.cpf.gov.sg/content/dam/web/employer/employer-obligations/documents/jan2027cpfallocationrates.pdf).
After 2027 the model holds those rules, with unchanged salary and birthdays
approximated at annual anniversaries. Bonuses, graduated PR rates and retirement
account overflow require manual OA contributions. Existing OA savings are separate.
CPF housing spending is capped at the purchase price unless the user supplies a
verified allowance; unknown/short tenure uses cash until an allowance is verified.
A lease of 20 years or less permits no CPF housing usage. Use the
[CPF housing usage calculator](https://www.cpf.gov.sg/member/tools-and-services/calculators/cpf-housing-usage)
to verify limits, including valuation and lease-to-age-95 restrictions. Saved
`guidance` JSON includes the date and rule version; older comparisons without it
retain their original arithmetic until edited through the guided inputs.

Every response also carries `frame-ancestors 'none'` and its old-browser twin,
`nosniff`, a referrer policy and a permissions policy (`next.config.ts`).

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
  term, and how it is repaid: 等额本息, 等额本金, 等本等息 (a flat rate: card
  instalments, car and personal loans in Singapore) or 先息后本 (interest only)
  — from which the page works out every repayment to the cent, the way the
  bank's repayment plan (还款计划) does: each month's interest rounded half up,
  the last repayment clearing what is left. Interest is counted by the month,
  or **by the day** (365 for a Singapore home loan on daily rest, or 360). Where the
  bank's plan differs, give its stated **monthly payment** and the **first
  repayment's interest** (the first after a rate reset usually does), and the
  **contract end date** when the last repayment falls after the monthly day —
  it is then charged by the day, counted 30/360. Given the monthly payment,
  等额本息's balance is carried unrounded, as 建设银行 carries it, and shown
  to the cent; the first repayment's interest then takes up to four decimals,
  the fraction of a cent the bank carried (3,836.2239 where its plan shows
  3,836.22). A **rate
  change** is kept beside the terms, not over them: from its first repayment
  the new rate applies, and the payment is the one given or is worked out
  again over the months left. A **prepayment** comes off what is owed on its
  day; after it the payment stays and the loan ends sooner (缩短期限), or the end
  stays and the payment falls (减少月供). **Loans → Repayment plan** lists every
  repayment, to set beside the bank's app. The schedule is the plan; the
  balance recorded for the loan is the truth.
- An asset may hold **RSUs** under a plan — `tiktok` for now: double-trigger
  units a private company buys back in windows. Each grant lists its tranches,
  when each vests and how many shares. A window counts every tranche vested by
  its cutoff at the rate its grant's profile sets for the full years since it
  vested, takes the floor of the sum, and less what was sold in the windows
  before, that is what it may buy. Pick a window, and the **RSUs** card shows
  the shares and what they come to, before and after tax, in the plan's
  currency, CNY and SGD — at the plan's price in effect by the window's cutoff
  (the latest, for a window still to come), or a price typed over it. The
  plan's numbers — which months the windows fall in, the cutoff day, the
  rates, and its price over time — are the owner's, copied from the employer's
  own pages into the account's rules: they live only in the database, never in
  this repository. A grant offered and not yet signed counts only where asked.
  With its liquidity unset, an RSU account counts as liquid what a window
  within **three months** may still buy of the shares held, and nothing while
  no window is that near — worked out for each day of the history. Its
  balance is still what is recorded: the shares held at the price.
- An asset may hold **stock positions**: so many shares of a symbol at an
  average cost, pasted from a broker's statement (**Stocks → Import**: a line
  each, `AAPL 100 150.25`; Hong Kong `0700.HK` or `00700`, A-shares `600519`,
  Singapore `D05.SI`, Futu's `HK.00700` too). They are priced from Yahoo
  Finance — keyless and unofficial, so a symbol it cannot price keeps its last
  price — and the account's balance for the day is recorded from them: on
  every change, on opening the page once the prices are ten minutes old, and
  every day by the Daily jobs workflow, whether or not the page is opened. A
  position up **more than** the account's threshold (10% unless set; it is on
  the card) counts as liquid, the rest not. Each balance keeps the share that
  was liquid when it was recorded, so every day of the history counts what was
  liquid then. What is held lives in the database only.

## Housing: where the figures come from

- **The market** is read from [data.gov.sg](https://data.gov.sg), keyless:
  HDB's median resale price and median rent by town and flat type, each
  quarter, and its resale price index; URA's price and rental indices for
  private homes, 2009 Q1 = 100. HDB's two medians pair up quarter by quarter,
  which is what gives a town's gross yield (a year's rent over the price). URA
  publishes no prices without a key, so a private home's own price and rent
  are typed into the comparison. The daily job asks data.gov.sg every day and
  reads a dataset again only when its catalogue says it changed, paced to the
  rate limit data.gov.sg sets without a key; `DATA_GOV_SG_API_KEY` raises it.
  For the years ahead it also reads SingStat's 3-month compounded SORA,
  government securities' yields (1, 2, 5 and 10 years) and consumer price index
  from data.gov.sg, and the S&P 500 with dividends reinvested, in Singapore
  dollars, from Yahoo Finance's chart endpoint (`^SP500TR` and `SGD=X`) — once a
  quarter has closed, never the quarter still running. So nothing moves more
  often than a source publishes. The page reads the market kept whole in one
  row, built again by the daily job only when a figure moved, rather than
  fifteen thousand figures each time it opens.
- **The years ahead** are estimated from that history each time it is read,
  and each estimate says why. The home's price growth and the investments' are
  taken at the lower quartile of their ten-year spans — three spans in four did
  better — conservative, and the same rule for both so neither side is
  flattered; rents and consumer prices at the middle span. The investments'
  are less 0.3% a year for holding them: the index reinvests dividends whole,
  but the US withholds tax on them from a Singapore investor's fund, and the
  fund charges fees. SORA is expected to follow what government bond yields
  say, each yield less the premium it has paid over SORA on average since 2005.
  A bank loan's fixed rate is SORA's expected average over the lock-in plus the
  0.3% banks ask over it — two-year packages were 1.65% in September 2026;
  after it, the loan pays 3-month SORA plus the spread, 0.7% unless set, as
  banks' spreads settle after a lock-in, reset every three months. An input left to the
  market follows its estimate as the figures move; typing a number makes it
  yours, and emptying the field hands it back.
- **Developments you follow** — a private condo by the name URA gives it,
  WATERTOWN say — are read from URA's Data Service with the owner's access key
  (`URA_ACCESS_KEY`, on Vercel): every sale caveated in the last five years and
  the last six quarters of rental contracts, read when followed and weekly
  after. The page shows the middle (P50) and the average of the latest year's
  prices, prices a square foot and rents, by size as URA bands its rental
  contracts, the gross yield, and the price a square foot quarter by quarter;
  a size's middle price and rent fill Rent or buy, with the lease URA records
  for the development, so its decline is counted without anything typed.
- **Across 500 futures**: each replays the quarters since 2006 two years at a
  time from random places, every series from the same quarter, so prices,
  rents, costs, shares and SORA move together as they did — rents up while
  rates rose — but around the comparison's own rates. SORA strays from its
  expected path by each quarter's surprise in its history, the departures
  fading as SORA's have, never below zero. The page shows the spread of the gap
  between buying and renting, the chance buying is ahead each year, when it
  first pulls ahead, and what happens if SORA runs two points higher, rents
  stand still for three years, or prices fall 15% in the second year.
- **Rent or buy** starts both sides with the same money. The buyer pays the
  down payment, stamp duties, fees and renovation — CPF first where CPF may —
  and the renter invests that cash instead. Each month both spend the dearer
  side's outgoings, and the cheaper side invests the difference; CPF pays the
  buyer's instalments and sits in the renter's account. Each year ends with the
  home as though sold: its grown price less the loan, the agent and legal fees,
  and seller's stamp duty within four years. The year buying pulls ahead is the
  first whose end finds it ahead.
- **A month of owning, taken apart**: what goes out (the instalment and the
  running costs) against what is a cost. Principal is not one — it stays yours,
  in the home. Interest, S&CC, property tax and repairs are; so are the stamp
  duties, fees, renovation and selling costs, spread over the years looked at,
  and what the money in the home would have earned invested; the home's rise
  in value counts against them. With nothing earning, those months add up to
  the gap in net worth exactly; with returns, the net worth compounds them and
  is the comparison to go by.
- **Tax rules** are IRAS's as published in October 2026: BSD up to 6%; ABSD by
  residency and which home it is (citizen 0/20/30%, PR 5/30/35%, foreigner
  60%); SSD 16/12/8/4% within four years for homes bought from 4 Jul 2025;
  owner-occupier property tax on the annual value, from 2025. The comparison
  never refuses a buyer: what the rules may not allow, it says.

## Finance API, for agents

An agent or a script can work on the finance data as the owner — read it and
record balances — with a bearer token. It opens `/api/finance/*` and nothing
else: the split bill does not know it.

Make one on the page: **/finance → API access → Generate token**, signed in as
the owner, on any device. The token is shown once; only its SHA-256 is kept
(`finance_api_tokens`, as private as the other finance tables). Give it to the
agent in its own environment — never in this repo, which is public — and revoke
it on the same page if it is ever lost. Tokens can only be made and revoked
from a signed-in session, never with a token.

`FINANCE_API_TOKEN`, set in Vercel, is the other way to give one: it works the
same, but is changed by redeploying rather than on the page.

```bash
curl -s https://playground.noahyao.me/api/finance/summary \
  -H "Authorization: Bearer $FINANCE_TOKEN"
```

| | |
|---|---|
| `GET /api/finance/openapi` | OpenAPI 3.1 description of all of this, with the same token. |
| `GET /api/finance/summary` | Where things stand, worked out: totals, change since the last record, each account's newest balance, loan schedule and RSU position, history. Takes the page's filters: `?exclude_long_term=1&liquid_only=1&owner=Daisy`. |
| `GET /api/finance` | Every account and balance, as stored; each account with its loan's `rate_changes` and `prepayments`, and its `rsu_grants` and `rsu_sales`. |
| `GET /api/finance/loan-schedule?id=…` | One loan's every repayment to the cent — date, payment, principal, interest, balance — and the totals. |
| `GET /api/finance/rsu?id=…&window=…&price=…&tax_rate=…` | One RSU account in a window, tranche by tranche: what it may buy, what that comes to at the price, and the windows ahead. |
| `POST /api/finance` | `{"action": …}`: `createAccount`, `updateAccount`, `deleteAccount`, `recordBalances`, `deleteBalance`, `addLoanRateChange`, `deleteLoanRateChange`, `addLoanPrepayment`, `deleteLoanPrepayment`, `addRsuGrant`, `updateRsuGrant`, `deleteRsuGrant`, `addRsuSale`, `deleteRsuSale`, `importStockPositions`, `addStockPosition`, `updateStockPosition`, `deleteStockPosition`, `revalueStocks`. |

To revoke it, replace the value and redeploy; the old one stops working with
that deployment.

## Environment

Copy `.env.example` to `.env.local`. Every key is listed there with a line on
what breaks without it.

Production values live in **Vercel** (`vercel env ls production`): everything
the site uses. GitHub holds what only its workflows use: the SMTP account the
unpaid alert is sent through (`SMTP_USERNAME`, `SMTP_PASSWORD`, `ALERT_TO`, and
optionally the variables `SMTP_SERVER`, `SMTP_PORT`, `MAIL_FROM`), and
`SUPABASE_DB_URL` for the Apply Migration workflow. Nothing is kept in both.
Nothing is stored in this repo, and `src/lib/supabase.ts` has no fallback: without
`NEXT_PUBLIC_SUPABASE_*` the client is `null` and the app runs against
localStorage rather than quietly attaching to production.

## Scheduled work

| what | called by | when |
|---|---|---|
| Generate the month's charges: `/api/cron/bill` | Vercel Cron, and the Daily jobs workflow | 1st–3rd |
| Work out who owes over the threshold, `/api/cron/daily`, and email `ALERT_TO` | the Daily jobs workflow | daily |
| Value the stock accounts at the day's prices and record their balances: `/api/cron/stocks` | the Daily jobs workflow | daily |
| Keep the free-tier Supabase project awake: `/api/cron/keepalive` | Vercel Cron | daily |

The work happens on the site; what schedules it is split by what each scheduler
does well. The **Daily jobs** workflow (`.github/workflows/daily-jobs.yml`) runs
`scripts/daily-jobs.mjs`, which calls the routes and judges the answers, then
sends the alert through GitHub's SMTP secrets. Each run is on record in the
Actions tab, and a failed one — no answer, a refusal, a charge skipped, a mail
that could not go — is mailed to the owner by GitHub. **Vercel Cron**
(`vercel.json`) runs on time, within the hour on the
Hobby plan, and never lapses, but it does not retry, tells nobody when a run
fails, and keeps an hour of logs.

So each covers the other. GitHub stops scheduling workflows in a public
repository after 60 days without a commit, warning a week before; if that
happens, Vercel still bills and keeps the database awake, and only the alert
waits. If Vercel misses a billing run, the workflow's call fills it in — billing
fills only what has no charge yet, so two callers bill a month once. The alert
has one caller, since two would mean two mails.

The routes answer two callers only. Vercel Cron sends `CRON_SECRET`. The
workflow sends the OIDC token GitHub gives each run, which the site checks is
from `daily-jobs.yml` on `main` in this repository (`src/lib/cron.ts`), so no
secret is copied into GitHub for it. In the Actions tab, **Run workflow** runs
the jobs on demand; ticking *Test mail* sends the alert even when nobody is over
the threshold, to check the mail setup.

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
