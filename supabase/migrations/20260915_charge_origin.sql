-- Say where a charge came from, in a field the user cannot overwrite.
--
-- Until now this was inferred from note: the monthly run writes "Auto-generated",
-- the manual form defaults to "Manual". But the form lets you replace the note,
-- and once you do the origin is gone with it — one charge already reads
-- "Plus 升级上来" and is indistinguishable from a generated one.
--
-- Backfilled from that same convention, which is accurate for every row written
-- so far. Only metadata is added; no amount is touched.

alter table charges add column if not exists origin text
  check (origin in ('auto', 'manual'));

update charges
set origin = case when note = 'Auto-generated' then 'auto' else 'manual' end
where origin is null;

alter table charges alter column origin set default 'manual';
