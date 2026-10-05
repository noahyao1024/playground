-- /housing: the private developments the owner follows, and what URA has
-- recorded of them -- each sale caveated in the last five years, each rental
-- contract in the last year -- read from URA's Data Service with the owner's
-- access key (URA_ACCESS_KEY, on Vercel only). Only followed developments are
-- kept: URA's files are Singapore whole, the page wants a few. Private like the
-- other housing tables: RLS on with no policy, nothing granted to anon or
-- authenticated.
--
-- Additive only. Until it is here the page shows no developments and the job
-- reads none, so merge first, then apply.

-- A development followed, by the name URA gives it.
create table if not exists housing_projects (
  -- URA's own spelling, in capitals: WATERTOWN.
  name text primary key check (length(name) between 1 and 80 and name = upper(btrim(name))),
  -- Where it is, as URA says once its records are read.
  street text,
  district text check (district ~ '^[0-9]{2}$'),
  segment text check (segment in ('CCR', 'RCR', 'OCR')),
  added_at timestamptz not null default now(),
  -- When URA was last read for it, and whether it had anything under the name.
  read_at timestamptz,
  found boolean
);

alter table housing_projects enable row level security;
revoke all on table housing_projects from anon, authenticated;

-- A sale URA recorded: a caveat lodged, whole as URA writes it. URA gives sales
-- no id, and two can be alike in every field, so a development's are replaced
-- whole each time they are read.
create table if not exists housing_project_sales (
  id bigint generated always as identity primary key,
  project text not null references housing_projects (name) on delete cascade,
  -- The month of the contract.
  month date not null check (extract(day from month) = 1),
  price numeric not null check (price > 0),
  area_sqm numeric not null check (area_sqm > 0),
  -- 06-10, or null for a landed home.
  floor_range text,
  sale_type text check (sale_type in ('new', 'sub', 'resale')),
  property_type text,
  units integer not null default 1 check (units > 0)
);

create index if not exists housing_project_sales_project_month on housing_project_sales (project, month);
alter table housing_project_sales enable row level security;
revoke all on table housing_project_sales from anon, authenticated;

-- A rental contract URA recorded, by the quarter it was read for: a quarter's
-- are replaced whole when it is read again.
create table if not exists housing_project_rents (
  id bigint generated always as identity primary key,
  project text not null references housing_projects (name) on delete cascade,
  -- The quarter, as its first day, and the month the lease began.
  quarter date not null check (extract(day from quarter) = 1 and extract(month from quarter) in (1, 4, 7, 10)),
  month date not null check (extract(day from month) = 1),
  -- A month's rent.
  rent numeric not null check (rent > 0),
  -- The floor area as URA bands it, in square feet: 1000 to 1100; an open
  -- end is null.
  sqft_low integer check (sqft_low >= 0),
  sqft_high integer check (sqft_high > 0),
  bedrooms smallint check (bedrooms between 1 and 20)
);

create index if not exists housing_project_rents_project_quarter on housing_project_rents (project, quarter);
alter table housing_project_rents enable row level security;
revoke all on table housing_project_rents from anon, authenticated;
