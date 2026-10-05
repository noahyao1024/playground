-- /housing: Singapore's housing market from the government's open data, and
-- the owner's rent-or-buy scenarios. Private like finance -- RLS on with no
-- policy, nothing granted to anon or authenticated. The market figures are
-- public data, but the page is the owner's, and so is what it keeps.
--
-- Additive only. The code reads none of it until it is here, so merge first,
-- then apply.

-- One figure a quarter for a series: a median price or rent, or an index.
create table if not exists housing_market (
  -- Which figure, as src/lib/housing-data.ts names it: hdb_resale, hdb_rent,
  -- hdb_rpi, ura_ppi, ura_rri.
  series text not null check (series ~ '^[a-z][a-z0-9_]{0,29}$'),
  -- Where: an HDB town, a URA region (CCR, RCR, OCR) or ALL.
  area text not null check (area ~ '^[A-Z][A-Z /&''.-]{0,39}$'),
  -- What: an HDB flat type or a kind of private home, in housing-data.ts's
  -- spelling: 4-room, executive, non-landed, all.
  segment text not null check (segment ~ '^[a-z0-9][a-z0-9-]{0,19}$'),
  -- The quarter, as its first day.
  quarter date not null check (extract(day from quarter) = 1 and extract(month from quarter) in (1, 4, 7, 10)),
  value numeric not null check (value > 0),
  primary key (series, area, segment, quarter)
);

alter table housing_market enable row level security;
revoke all on table housing_market from anon, authenticated;

-- What has been read of each data.gov.sg dataset: a dataset is fetched again
-- only once its catalogue entry says it has changed since.
create table if not exists housing_sources (
  dataset text primary key check (dataset ~ '^d_[0-9a-f]{32}$'),
  -- When data.gov.sg last changed it, as its catalogue said when it was read.
  source_updated_at timestamptz,
  refreshed_at timestamptz not null default now(),
  -- How many figures it gave.
  points integer not null check (points >= 0)
);

alter table housing_sources enable row level security;
revoke all on table housing_sources from anon, authenticated;

-- A rent-or-buy comparison the owner kept.
create table if not exists housing_scenarios (
  id uuid primary key default gen_random_uuid(),
  name text not null check (length(btrim(name)) between 1 and 80),
  -- The inputs, as src/lib/housing.ts reads them: checked there, kept whole
  -- here, so a new input needs no migration.
  inputs jsonb not null check (jsonb_typeof(inputs) = 'object'),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table housing_scenarios enable row level security;
revoke all on table housing_scenarios from anon, authenticated;
