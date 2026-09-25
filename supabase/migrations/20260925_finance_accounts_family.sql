-- Family money: whose each account is, how much of it could be spent now, which
-- debts are long-term, and for a loan, the terms its repayments follow.
--
-- Additive only. Existing rows keep every value they have and the new columns
-- start empty, which for liquidity and long_term means "as the category says".

alter table finance_accounts
  -- Who in the family holds it. Free text; empty means nobody in particular.
  add column if not exists owner text check (owner is null or length(btrim(owner)) > 0),
  -- The share of an asset's balance that could be spent or sold now: shares
  -- partly under water, a deposit not yet due. 0 to 1. Null follows the
  -- category: CPF / 公积金 and property none of it, anything else all.
  add column if not exists liquidity numeric check (liquidity >= 0 and liquidity <= 1),
  -- Whether a debt is long-term, which the net-worth view can leave out. Null
  -- follows the category: a mortgage is long-term, nothing else is.
  add column if not exists long_term boolean,
  -- A loan's terms, in the account's currency: all five or none.
  add column if not exists loan_principal numeric check (loan_principal > 0),
  -- Annual, in percent: 3.95 is 3.95%.
  add column if not exists loan_rate numeric check (loan_rate >= 0 and loan_rate < 100),
  -- The first repayment. Each later one falls on the same day of the month.
  add column if not exists loan_start date,
  add column if not exists loan_term_months int check (loan_term_months between 1 and 600),
  -- annuity: 等额本息, the same payment every month.
  -- equal_principal: 等额本金, the same principal every month, so payments fall.
  add column if not exists loan_method text check (loan_method in ('annuity', 'equal_principal'));

alter table finance_accounts drop constraint if exists finance_accounts_loan_terms;
alter table finance_accounts add constraint finance_accounts_loan_terms check (
  (loan_principal is null and loan_rate is null and loan_start is null
    and loan_term_months is null and loan_method is null)
  or (kind = 'liability' and loan_principal is not null and loan_rate is not null
    and loan_start is not null and loan_term_months is not null and loan_method is not null)
);
