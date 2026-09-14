-- A per-person ledger, so a mistake is corrected by posting an entry rather than
-- editing what was already recorded.
--
-- Deliberately small: no idempotency keys, no credit limits, no double entry.
-- Seven people and a handful of rows a month do not need them.
--
-- Append-only is the exception, and it is the whole point — a ledger you can
-- rewrite proves nothing. Fixing an entry means posting another one.
--
-- Balance is sum(amount_cny), always computed. A stored balance eventually
-- disagrees with the rows behind it.
--
-- Nothing here touches the existing charges. The wallet starts empty and
-- charges.paid keeps its current meaning for every row already written.

create table if not exists wallet_entries (
  id uuid primary key default gen_random_uuid(),
  subscriber_id uuid not null references subscribers(id) on delete restrict,
  -- positive credits the person (a top-up), negative debits them (a charge)
  amount_cny numeric not null check (amount_cny <> 0),
  kind text not null check (kind in ('topup', 'charge', 'adjustment')),
  -- present when this entry settles a specific charge
  charge_id uuid references charges(id) on delete set null,
  note text,
  created_at timestamptz not null default now()
);

create index if not exists wallet_entries_subscriber_idx
  on wallet_entries (subscriber_id, created_at desc);

create or replace function wallet_entries_are_final() returns trigger
language plpgsql as $$
begin
  raise exception 'wallet_entries is append-only: post a correcting entry instead of changing this one';
end $$;

drop trigger if exists wallet_entries_no_change on wallet_entries;
create trigger wallet_entries_no_change before update or delete on wallet_entries
  for each row execute function wallet_entries_are_final();
