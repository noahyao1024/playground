-- A followed development's tenure, as URA's sales give it: "Freehold", or
-- "99 yrs lease commencing from 2012". The comparison takes its lease from it
-- rather than asking. Null until a read has kept it; '' when URA's sales gave
-- none, so a read is not made again for it.
--
-- The code runs before this is applied: it reads every column, and writes the
-- tenure only once the column is there. Merge first, then apply.

alter table housing_projects add column if not exists tenure text
  check (tenure is null or length(tenure) <= 80);
