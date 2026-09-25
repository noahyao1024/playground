-- Personal finance: the owner's accounts in China and Singapore, what each held
-- on the days it was recorded, and what is owed.
--
-- Private, unlike every other table here. Those are readable with the anon key by
-- design; these hold one person's money and must not be. RLS is on with no policy
-- at all, and anon and authenticated lose their grants, so neither the public key
-- nor any signed-in Supabase session can read or write a row. Only the service
-- role can -- the server, behind /api/finance, which admits one address.
--
-- A balance is recorded in the account's own currency, together with what one
-- unit was worth in CNY and in SGD on that day. Totals multiply by those stored
-- rates, so a month already recorded keeps its value when the market moves.

create table if not exists finance_accounts (
  id uuid primary key default gen_random_uuid(),
  name text not null check (length(btrim(name)) > 0),
  institution text,
  region text not null check (region in ('CN', 'SG', 'OTHER')),
  currency text not null check (currency ~ '^[A-Z]{3}$'),
  kind text not null check (kind in ('asset', 'liability')),
  category text not null,
  note text,
  sort_order int not null default 0,
  archived_at timestamptz,
  created_at timestamptz not null default now(),
  -- The target of finance_balances' (account_id, currency) key, below.
  unique (id, currency)
);

create table if not exists finance_balances (
  id uuid primary key default gen_random_uuid(),
  account_id uuid not null,
  as_of date not null,
  currency text not null,
  -- What the account held, or for a liability what was owed, as a positive amount.
  amount numeric not null,
  -- CNY and SGD per one unit of `currency`, mid-market, on rate_date: the
  -- trading day at or before as_of that the rates were published for.
  cny_rate numeric not null check (cny_rate > 0),
  sgd_rate numeric not null check (sgd_rate > 0),
  rate_date date not null,
  note text,
  created_at timestamptz not null default now(),
  updated_at timestamptz,
  -- One balance per account per day; recording the day again replaces it.
  unique (account_id, as_of),
  -- The balance is in its account's currency, and the account's currency cannot
  -- change under balances already priced in it.
  foreign key (account_id, currency) references finance_accounts (id, currency)
    on update restrict on delete restrict
);

create index if not exists finance_balances_as_of_idx on finance_balances (as_of, id);

-- touch_row() comes from 20260915_charge_audit_fields.
drop trigger if exists finance_balances_touch on finance_balances;
create trigger finance_balances_touch before update on finance_balances
  for each row execute function touch_row();

alter table finance_accounts enable row level security;
alter table finance_balances enable row level security;
revoke all on table finance_accounts, finance_balances from anon, authenticated;
