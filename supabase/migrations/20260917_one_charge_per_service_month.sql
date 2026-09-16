-- A charge is one subscriber, one service, one month. Nothing in the database
-- said so until now. The only thing preventing a month from being billed twice
-- lived in application code, in a Set built from a single unbounded read of
-- every charge ever written -- and PostgREST caps how many rows one request
-- returns. Past that cap the read comes back short with a perfectly ordinary
-- 200, so the guard would simply stop seeing the months it was meant to guard,
-- and the next run would bill them again. The read is paged now; this index is
-- what makes the rule true regardless of how the rows were fetched.
--
-- Partial on deleted_at, deliberately. A soft-deleted charge should not block
-- re-entering that month by hand: deleting one is a decision to remove that
-- charge, not a decision that the month may never hold one again. The
-- application's own dedup set is stricter -- it counts deleted rows too, so it
-- will not regenerate them -- and that asymmetry is the intended one. This
-- index only has to stop two *live* charges for the same service-month.
--
-- service_id is null on one-off charges. Postgres treats nulls as distinct in a
-- unique index, so one-off charges are never constrained here, which is right:
-- two one-off expenses in the same month are two different expenses.
--
-- Verified before writing this: zero (subscriber_id, service_id, period_start)
-- collisions across all 71 live charges, so this builds without conflict.

create unique index if not exists charges_one_per_service_month
  on public.charges (subscriber_id, service_id, period_start)
  where deleted_at is null;
