# Handoff — 2026-10-06

Delete this file in the pull request that finishes the open items. Read `AGENTS.md` first;
everything there holds.

## State

`main` is d341d9f, live in production. Every pull request is merged except Dependabot #106.

Shipped today:

- **#105** — development dependencies (Dependabot).
- **#107** — the futures card says futures stop at 35 years, rather than loading for ever.
- **#108** — URA rental contracts are read for six quarters (`RENT_QUARTERS`), so the page's
  twelve months are really twelve.
- **#109** — `ADMIN_EMAILS`, set on Vercel only, gives more addresses all of the owner's
  rights. The browser gets `canEdit` and `isOwner` from the session. Never write an address
  into this public repository.
- **#110** — rates checked against the September 2026 market:
  - the spread after a lock-in now defaults to 0.7;
  - the fixed rate is the expected SORA plus `FIXED_MARGIN` (0.3);
  - investments are less `INVEST_COSTS` (0.3).
- **#111** — the TOP year is gone, and a development's lease comes from URA's tenure:
  - the tenure is stored in `housing_projects.tenure` (migration
    `20261006_housing_project_tenure.sql`, applied);
  - WATERTOWN reads "99 yrs lease commencing from 2011".

## Open, waiting on the owner's yes

1. **Dependabot #106** — source-map-js 1.2.1 → 1.2.2, lockfile only, Check green. Merge it
   if the owner agrees.
2. **Today's money** — show the buy-or-rent gap deflated by CPI next to the future figure.
   For example, S$378k at 15 years is about S$281k today.
3. **CPF and the PR start date** — new PRs pay graduated rates. At age 55 or under that is
   9% in year 1, 24% in year 2, then the full 37%. `estimatedOa` in
   `src/lib/housing-guidance.ts` assumes full rates. Adding the PR date needs CPF's published
   graduated contribution and allocation tables, with a test that pins their figures.

## Notes

- The owner's questions on compounding, CPF use and the invested monthly gap were answered:
  the engine already models them (`rentOrBuy` in `src/lib/housing.ts`).
- A new comparison defaults to "no CPF". The owner should pick salary or manual CPF for a
  realistic result.
- The claude.ai Supabase connector returned an authorization error for a while today, then
  recovered.
