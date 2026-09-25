-- The four tables as they stood before the first file in supabase/migrations/.
--
-- That starting schema was created in the Supabase dashboard and never written
-- down, so this is a reconstruction: only the columns and keys the migrations
-- and the settle functions depend on, under the names they expect -- the
-- default foreign-key names, for instance, which 20260914_restrict_deletes_in_use
-- drops by name. The migrations then run on top of it in filename order, which
-- is what the tests exercise. If a migration ever needs something missing here,
-- it fails loudly while building the test database, not quietly in a test.

create table subscribers (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  created_at timestamptz not null default now()
);

create table services (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  monthly_cost numeric not null,
  currency text not null,
  created_at timestamptz not null default now()
);

create table subscriptions (
  id uuid primary key default gen_random_uuid(),
  subscriber_id uuid not null references subscribers(id) on delete cascade,
  service_id uuid not null references services(id) on delete cascade,
  start_date date,
  exchange_rate numeric,
  active boolean not null default true,
  created_at timestamptz not null default now()
);

create table charges (
  id uuid primary key default gen_random_uuid(),
  subscriber_id uuid not null references subscribers(id) on delete cascade,
  service_id uuid not null references services(id) on delete cascade,
  period_start text not null,
  period_end text not null,
  months int not null default 1,
  monthly_cost numeric not null,
  currency text not null,
  exchange_rate numeric not null,
  total_cny numeric not null,
  paid boolean not null default false,
  paid_date date,
  note text,
  created_at timestamptz not null default now()
);
