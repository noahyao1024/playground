-- /housing reads the market whole -- some fifteen thousand figures, fifteen
-- pages of PostgREST -- every time the page opens, while the figures move only
-- when a source publishes, monthly or quarterly. So the market is kept here as
-- the page reads it, rebuilt by the daily job when a figure moves, and the page
-- reads it in one query. Private like the other housing tables: RLS on with no
-- policy, nothing granted to anon or authenticated.
--
-- Additive only. Until it is here the page reads the figures as before, so
-- merge first, then apply.

create table if not exists housing_snapshot (
  -- One row: the market.
  id text primary key check (id = 'market'),
  -- The shape it was built in (SNAPSHOT_VERSION in src/lib/housing-data.ts):
  -- code reading another shape reads the figures instead, and builds it anew.
  version integer not null check (version > 0),
  -- The market as readMarket returns it: a series a place and kind, its
  -- quarters running on from the first.
  market jsonb not null check (jsonb_typeof(market) = 'object'),
  built_at timestamptz not null default now()
);

alter table housing_snapshot enable row level security;
revoke all on table housing_snapshot from anon, authenticated;
