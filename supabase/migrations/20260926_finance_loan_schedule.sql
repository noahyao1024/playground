-- Loans to the cent, as the bank's repayment plan (还款计划) has them, and a
-- loan's rate changes kept as history rather than written over its terms.
--
-- A bank states the monthly payment it takes, and it can differ from what the
-- formula gives by more than rounding. The first repayment after a rate reset
-- is charged for a stretch other than a plain month, so its interest differs
-- from the formula's too. And a contract may end after the last monthly
-- repayment's day: the last repayment then falls on its end date, charged by
-- the day for the stretch since the one before. Each can now be given as the
-- bank has it. All are optional and outside the all-five-or-none rule of the
-- terms: left empty, the schedule is worked out as before.
--
-- A rate change applies from the first repayment charged at the new rate. From
-- then on the payment is the one given, or else what repays the balance then
-- owed over the repayments left. The months before it keep the rate they were
-- charged at.
--
-- Additive only. The new table is private like the rest of finance: RLS on
-- with no policy, nothing granted to anon or authenticated.

alter table finance_accounts
  -- The monthly payment the bank states, under 等额本息 (annuity).
  add column if not exists loan_payment numeric check (loan_payment > 0),
  -- The first repayment's interest as the bank charged it.
  add column if not exists loan_first_interest numeric check (loan_first_interest >= 0),
  -- The contract's end date, when the last repayment falls due on it rather
  -- than on the monthly day: 建设银行's, 2043-01-16 for a loan repaid on the 1st.
  add column if not exists loan_maturity date;

-- They qualify a loan, so they need one; a stated payment is a level payment,
-- which only 等额本息 has. coalesce: a check that comes out null passes.
alter table finance_accounts drop constraint if exists finance_accounts_loan_extras;
alter table finance_accounts add constraint finance_accounts_loan_extras check (
  (loan_payment is null or coalesce(loan_method = 'annuity', false))
  and (loan_first_interest is null or loan_principal is not null)
  and (loan_maturity is null or loan_principal is not null)
);

create table if not exists finance_loan_rate_changes (
  id uuid primary key default gen_random_uuid(),
  account_id uuid not null references finance_accounts (id) on delete cascade,
  -- The first repayment charged at the new rate.
  effective_date date not null,
  -- Annual, in percent, like loan_rate.
  rate numeric not null check (rate >= 0 and rate < 100),
  -- The payment from then on as the bank states it; null works it out.
  payment numeric check (payment > 0),
  created_at timestamptz not null default now(),
  -- One change a day per loan. Its index, starting with account_id, is also the
  -- one the foreign key needs.
  unique (account_id, effective_date)
);

alter table finance_loan_rate_changes enable row level security;
revoke all on table finance_loan_rate_changes from anon, authenticated;
