-- More kinds of loan, interest counted by the day, and prepayments. Follows
-- 20260926_finance_loan_schedule, whose check it widens.
--
-- Two more ways a loan is repaid. 等本等息, a flat rate -- card instalments,
-- car and personal loans in Singapore -- charges the same interest every month,
-- on the amount borrowed. 先息后本 pays interest alone, and the principal with
-- the last repayment. A flat loan's payment is level, so a bank can state it,
-- as it can an annuity's.
--
-- Interest is counted by the month (30/360, as before, as Chinese banks count
-- it), or by the day: a year of 365 (daily rest, as Singapore banks count a
-- home loan), or of 360 (a rate quoted by the day). Null is by the month.
--
-- A prepayment is principal repaid early, kept like a rate change: beside the
-- terms, one a day per loan. Interest runs on what was owed before it up to its
-- day. After it the payment stays and the loan ends sooner (shorten), or the
-- end stays and the payment falls (reduce).
--
-- Additive, bar two checks widened to take the new values. The new table is
-- private like the rest of finance: RLS on with no policy, nothing granted to
-- anon or authenticated.

alter table finance_accounts drop constraint if exists finance_accounts_loan_method_check;
alter table finance_accounts add constraint finance_accounts_loan_method_check
  check (loan_method in ('annuity', 'equal_principal', 'flat', 'interest_only'));

-- An older list of methods under another name would still refuse the new ones.
do $$
begin
  if exists (
    select 1 from pg_constraint
    where conrelid = 'finance_accounts'::regclass and contype = 'c'
      and pg_get_constraintdef(oid) like '%equal_principal%'
      and pg_get_constraintdef(oid) not like '%interest_only%'
  ) then
    raise exception 'finance_accounts still has a check that lists only the old loan methods';
  end if;
end $$;

alter table finance_accounts
  add column if not exists loan_day_count text check (loan_day_count in ('30/360', 'actual/365', 'actual/360'));

-- As before, with 等本等息's level payment stated too, and the day count also
-- needing a loan to qualify. coalesce: a check that comes out null passes.
alter table finance_accounts drop constraint if exists finance_accounts_loan_extras;
alter table finance_accounts add constraint finance_accounts_loan_extras check (
  (loan_payment is null or coalesce(loan_method in ('annuity', 'flat'), false))
  and (loan_first_interest is null or loan_principal is not null)
  and (loan_maturity is null or loan_principal is not null)
  and (loan_day_count is null or loan_principal is not null)
);

create table if not exists finance_loan_prepayments (
  id uuid primary key default gen_random_uuid(),
  account_id uuid not null references finance_accounts (id) on delete cascade,
  -- The day it was paid.
  paid_on date not null,
  -- Principal repaid, in the loan's currency.
  amount numeric not null check (amount > 0),
  -- shorten: the payment stays, the loan ends sooner. reduce: the end stays,
  -- the payment falls.
  mode text not null check (mode in ('shorten', 'reduce')),
  -- The payment from then on as the bank states it, when it reduces a level one.
  payment numeric check (payment > 0),
  created_at timestamptz not null default now(),
  -- One a day per loan. Its index, starting with account_id, is also the one
  -- the foreign key needs.
  unique (account_id, paid_on)
);

alter table finance_loan_prepayments enable row level security;
revoke all on table finance_loan_prepayments from anon, authenticated;
