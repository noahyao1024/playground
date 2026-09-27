-- Stock positions, held by an asset account: how many shares of each symbol,
-- what they cost, and the last price they were valued at. Private like the
-- rest of finance -- RLS on with no policy, nothing granted to anon or
-- authenticated.
--
-- Additive only. The code reads none of it until it is here, so merge first,
-- then apply.

create table if not exists finance_stock_positions (
  id uuid primary key default gen_random_uuid(),
  account_id uuid not null references finance_accounts (id) on delete cascade,
  -- As the quote source spells it: AAPL, 0700.HK, 600519.SS, D05.SI.
  symbol text not null check (symbol ~ '^[A-Z0-9^][A-Z0-9.=-]{0,19}$'),
  name text check (length(name) <= 120),
  quantity numeric not null check (quantity > 0),
  -- The average cost of a share, in `currency`.
  cost numeric not null check (cost >= 0),
  -- What it trades in, as its quote gives it.
  currency text not null check (currency ~ '^[A-Z]{3}$'),
  -- The last price it was valued at, in `currency`; what one unit of
  -- `currency` was worth in the account's currency then; and when.
  price numeric check (price > 0),
  fx numeric check (fx > 0),
  priced_at timestamptz,
  note text check (length(note) <= 500),
  created_at timestamptz not null default now(),
  -- Its index, starting with account_id, is also the one the foreign key needs.
  unique (account_id, symbol)
);

alter table finance_stock_positions enable row level security;
revoke all on table finance_stock_positions from anon, authenticated;

-- How far a position has to be up, in percent, for it to count as liquid.
-- Null: 10.
alter table finance_accounts
  add column if not exists liquid_min_gain numeric
    check (liquid_min_gain is null or (liquid_min_gain >= -100 and liquid_min_gain <= 10000));

-- The share of a balance that was liquid when it was recorded, for an account
-- whose liquidity is worked out from what it holds at the time, as stocks are.
-- Null follows the account.
alter table finance_balances
  add column if not exists liquid_share numeric
    check (liquid_share is null or (liquid_share >= 0 and liquid_share <= 1));
