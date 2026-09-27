-- Restricted stock units, held by an asset account: the plan they follow and
-- the owner's numbers for it, the grants with their tranches, and what has been
-- sold. Private like the rest of finance -- RLS on with no policy, nothing
-- granted to anon or authenticated -- the numbers most of all: when the windows
-- fall and how much of a tranche each buys come from the employer's own pages.
--
-- Additive only. The code reads none of it until it is here, so merge first,
-- then apply.

alter table finance_accounts
  add column if not exists rsu_plan text check (rsu_plan in ('tiktok')),
  add column if not exists rsu_rules jsonb check (rsu_rules is null or jsonb_typeof(rsu_rules) = 'object');

-- Only an asset holds shares, and rules belong to a plan.
alter table finance_accounts drop constraint if exists finance_accounts_rsu;
alter table finance_accounts add constraint finance_accounts_rsu check (
  (rsu_plan is null or kind = 'asset') and (rsu_rules is null or rsu_plan is not null)
);

create table if not exists finance_rsu_grants (
  id uuid primary key default gen_random_uuid(),
  account_id uuid not null references finance_accounts (id) on delete cascade,
  -- As the employer numbers it.
  grant_no text not null check (btrim(grant_no) <> '' and length(grant_no) <= 40),
  -- What kind of grant: an entry grant, a refresher.
  label text check (length(label) <= 80),
  -- Which of the account's rsu_rules profiles its tranches sell by.
  profile text not null check (profile ~ '^[a-z0-9_]{1,40}$'),
  granted_on date,
  -- The day its vesting is counted from.
  vest_start date,
  -- False for a grant offered and not yet accepted.
  signed boolean not null default true,
  -- [{vests_on: YYYY-MM-DD, shares: n}], oldest first; checked by the API.
  tranches jsonb not null check (jsonb_typeof(tranches) = 'array' and jsonb_array_length(tranches) > 0),
  note text check (length(note) <= 500),
  created_at timestamptz not null default now(),
  -- Its index, starting with account_id, is also the one the foreign key needs.
  unique (account_id, grant_no)
);

create table if not exists finance_rsu_sales (
  id uuid primary key default gen_random_uuid(),
  account_id uuid not null references finance_accounts (id) on delete cascade,
  -- The cutoff of the window it was sold in.
  window_cutoff date not null,
  shares integer not null check (shares > 0),
  -- Per share, and withheld, in the rules' currency.
  price numeric check (price > 0),
  tax numeric check (tax >= 0),
  note text check (length(note) <= 500),
  created_at timestamptz not null default now(),
  -- One a window; the index serves the foreign key too.
  unique (account_id, window_cutoff)
);

alter table finance_rsu_grants enable row level security;
alter table finance_rsu_sales enable row level security;
revoke all on table finance_rsu_grants, finance_rsu_sales from anon, authenticated;
