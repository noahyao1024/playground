# Handoff: URA developments (Punggol Watertown)

Written 2026-10-05 for the next agent. **Delete this file in the pull request that finishes
the work below.** Read `AGENTS.md` first: everything there still holds (public repo, no local
server, pre-approved deploys and what they require, migrations rehearsed first).

## What the owner asked for

> 我关注的是 Punggol Watertown。你分别展示 p50 和 avg 谢谢。

The owner wants Punggol Watertown's **P50 and average**, shown separately, for sale prices
and for rents. The owner then applied for URA's Data Service and received an access key by
email. **The key is the owner's to set on Vercel. It never goes into this repository, a
commit, a pull request, an issue or a workflow log, because the repository is public.** If
the key is ever needed again, ask the owner. Don't search for it.

## Where things stand

- Branch `claude/project-understanding-5fd6j1`. Commit `c8a5ac0` "Housing: follow private
  developments, from URA's records" sits on top of `main` at `300f832`.
- Checks at `c8a5ac0`: `npm run typecheck` and `npm run lint` are clean, and `npm test` passes
  572 tests, `test/sql` included, against a local Postgres.
- `main` (PR #101) is live with the growth model and the one-row market snapshot. Its
  migration `20261005_housing_snapshot.sql` is applied.
- **Not done:** the pull request, the merge, the migration
  `20261005_housing_projects.sql`, the key on Vercel, and any real data from URA.

## What the commit adds

| Where | What |
|---|---|
| `src/lib/ura.ts` | URA's client. It takes one token per run from `insertNewToken/v1` (header `AccessKey`), then reads `invokeUraDS/v1` with the headers `AccessKey` and `Token`. Sales come from `PMI_Resi_Transaction&batch=1..4` (postal districts 01–07, 08–14, 15–21, 22–28). Rental contracts come from `PMI_Resi_Rental&refPeriod=26q3` for the last 4 quarters. Calls are spaced 1.5 s apart. `refreshProjects` reads a development that was never read, or that was read a week or more ago, or the one just followed (`only`). A development's sales are replaced whole once its batch has been read; rents are replaced per quarter read. `read_at` is set only when the read is complete. `found` is false when a complete read held nothing under that name. `readProjects` returns `[]` while the tables don't exist. |
| `src/lib/housing-projects.ts` | The summaries, safe to import on the client: `summarize` (count, p25, p50, p75, mean), `lastYear` (the 12 months up to the latest record of each kind), `byBand` (rental size bands; each sale goes in the band holding its area; gross yield = p50 rent × 12 / p50 price), `byBedrooms` and `byQuarter`. |
| `src/app/api/housing/route.ts` | GET adds `projects` and `ura` (whether the key is set). POST `followProject` (at most 10; reads URA at once) and `unfollowProject`. |
| `src/app/api/cron/projects/route.ts` | Called daily by `scripts/daily-jobs.mjs` ("Developments: …"). It answers in counts and states only, and never names a development, because the log is public. |
| `src/components/housing/developments.tsx` | The Developments card on /housing → Market → Private. Each figure shows P50 large with "Average X" beneath it, in tables by size band and by bedrooms, with a psf trend. A development can also fill the rent-or-buy comparison. |
| `supabase/migrations/20261005_housing_projects.sql` | Creates `housing_projects`, `housing_project_sales` and `housing_project_rents`. All three are private like finance's: RLS with no policy, revoked from `anon` and `authenticated`. Nothing is dropped. |
| `.env.example`, `AGENTS.md`, `README.md` | `URA_ACCESS_KEY` is documented and empty. |
| Tests | `test/lib/ura.test.ts` (against a fake URA), `test/lib/housing-projects.test.ts`, `test/api/housing.test.ts`, `test/scripts/daily-jobs.test.ts`, `test/sql/database.test.ts` |

## Next, in order

1. **Ship the code.** Open a pull request from the branch to `main` and wait for Check to go
   green and the Vercel preview to build. Then merge; this is pre-approved, see AGENTS.md
   "Deploying". Confirm that the merge commit's production deployment reaches `success`.
   Merging before the migration is safe: without the tables the page shows no developments,
   and the daily job reports "Developments: no tables for them yet" without failing.
2. **Apply the migration.** Run `.github/workflows/apply-migration.yml` with
   `20261005_housing_projects.sql`, first with `apply` off as a rehearsal and then on. It
   only creates tables.
3. **The key, which the owner sets.** It goes in Vercel → Project → Settings → Environment
   Variables, as `URA_ACCESS_KEY` for Production and Preview. A new environment variable
   reaches new deployments only, so redeploy production afterwards, unless the merge in
   step 1 happens after the key is set.
   - To check without seeing the key: once the owner is signed in, `GET /api/housing` says
     `"ura": true`, and the Developments card stops showing its "no key" note.
4. **Follow WATERTOWN.** Go to /housing → Market → Private → Developments and follow
   `WATERTOWN`. Following reads URA straight away, from Vercel: one token, all four sales
   batches (the district isn't known yet), and four rental quarters, within the route's
   60 s.
   - Alternatively, run `insert into housing_projects (name) values ('WATERTOWN');` with
     the Supabase connector, then run the Daily jobs workflow by hand.
5. **Check what came back.**
   - Look at the follow toast, or the Daily jobs line, which reads "Developments: 1
     followed, 1 read (N sale(s), M rental contract(s))".
   - Then query with the Supabase connector:
     ```sql
     select name, street, district, segment, read_at, found from housing_projects;
     select count(*), min(month), max(month) from housing_project_sales where project = 'WATERTOWN';
     select count(*), min(quarter), max(quarter) from housing_project_rents where project = 'WATERTOWN';
     ```
6. **Answer the owner in Chinese.** Give Watertown's P50 and average for:
   - sale price and psf over the last 12 months;
   - rent by size band and by bedrooms;
   - gross yield per band.

   The page shows the same figures.

## Known risks

- **No real URA response has been parsed yet.** The field names
  (`project`, `street`, `marketSegment`, `transaction[].contractDate` as MMYY, `area` in sqm,
  `price`, `noOfUnits`, `typeOfSale` 1/2/3 for new, sub and resale, `floorRange`,
  `propertyType`, `district`, and for rentals `rental[].leaseDate`, `rent`, `areaSqft` as
  `"1000-1100"`, `noOfBedRoom`) come from URA's published API documentation, and the tests
  use a fake built from them. The first real read is the real test.
  - If WATERTOWN comes back with `found = false`, check the name URA uses.
  - If the counts look wrong, check `salesIn` and `rentsIn` against a real payload.
  - In both cases fix the code with a test, as AGENTS.md asks.
- **URA's firewall** (a WAF at `ura.adexel.com`) blocked this sandbox's IP after a few token
  requests. Don't call URA from a sandbox or a GitHub runner; reading it is Vercel's job.
  - If Vercel is refused too, the failure reads `HTTP 403` in the follow's response or in
    the Daily jobs line. Tell the owner, who can write to URA; the contact is in their
    email.
  - Don't try to get around the firewall: no proxies, no faked headers, no scraping URA's
    pages.
- **Response size.** Each sales batch is URA's five years of caveats for seven districts,
  several MB. After the first read the district is known, and only its one batch is read
  from then on. If the first read times out at 60 s, the fix is to read the batches across
  runs, not to raise the limit blindly.

## Also open with the owner

The Dependabot PRs **#98** (next.js, which carries a critical advisory), **#95** and **#94**
are waiting for the owner's decision. Don't merge them without the owner's yes.

## Working here

- Run the checks with:
  `npm run typecheck && npm run lint && TEST_DATABASE_URL=postgresql://postgres@localhost:5432/postgres npm test`.
  In a cloud container, start Postgres first with `service postgresql start`.
- A fix comes with a test that fails without it. Revert the fix and watch the test go red.
- Don't start the app locally. Check against the live site, GitHub and the Supabase
  connector (`mcp__Supabase__*`) instead.
