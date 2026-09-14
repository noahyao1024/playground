-- Paying a charge means moving money out of a wallet, not flipping a flag.
--
-- The old toggle wrote charges.paid directly, and un-paying erased paid_date with
-- nothing recording what it had been — one misclick on a charge settled in July
-- reset it to today, irrecoverably. Settlement now goes through the ledger, where
-- both the payment and any reversal are permanent rows.
--
-- The paying wallet need not belong to the charge's subscriber: one person can
-- settle another's charge, which the charge_id on the entry still ties together.
--
-- Balance is checked and debited in the same transaction, with the wallet owner's
-- row locked, so two settlements against one wallet cannot both pass a check that
-- only one of them can afford.

create or replace function settle_charge(
  p_charge_id uuid,
  p_wallet_owner uuid,
  p_note text default null
) returns numeric
language plpgsql as $$
declare
  v_amount numeric;
  v_paid boolean;
  v_balance numeric;
begin
  perform 1 from subscribers where id = p_wallet_owner for update;
  if not found then
    raise exception 'No such person';
  end if;

  select total_cny, paid into v_amount, v_paid from charges where id = p_charge_id for update;
  if not found then
    raise exception 'No such charge';
  end if;
  if v_paid then
    raise exception 'That charge is already settled';
  end if;

  select coalesce(sum(amount_cny), 0) into v_balance
    from wallet_entries where subscriber_id = p_wallet_owner;

  if v_balance < v_amount then
    raise exception 'Not enough in the wallet: % available, % needed', 
      round(v_balance, 2), round(v_amount, 2);
  end if;

  insert into wallet_entries (subscriber_id, amount_cny, kind, charge_id, note)
    values (p_wallet_owner, -v_amount, 'charge', p_charge_id, p_note);

  update charges set paid = true where id = p_charge_id;

  return round(v_balance - v_amount, 2);
end $$;

-- Undoing a settlement posts the opposite entry rather than removing the original,
-- so the ledger still shows that it happened and that it was undone.
create or replace function unsettle_charge(
  p_charge_id uuid,
  p_note text default null
) returns numeric
language plpgsql as $$
declare
  v_entry record;
  v_balance numeric;
begin
  select * into v_entry from wallet_entries
    where charge_id = p_charge_id and kind = 'charge'
    order by created_at desc limit 1;
  if not found then
    raise exception 'That charge was not settled from a wallet';
  end if;

  perform 1 from subscribers where id = v_entry.subscriber_id for update;

  if exists (
    select 1 from wallet_entries
    where charge_id = p_charge_id and kind = 'adjustment' and created_at > v_entry.created_at
  ) then
    raise exception 'That settlement has already been reversed';
  end if;

  insert into wallet_entries (subscriber_id, amount_cny, kind, charge_id, note)
    values (v_entry.subscriber_id, -v_entry.amount_cny, 'adjustment', p_charge_id,
            coalesce(p_note, 'Reversed settlement'));

  update charges set paid = false where id = p_charge_id;

  select coalesce(sum(amount_cny), 0) into v_balance
    from wallet_entries where subscriber_id = v_entry.subscriber_id;
  return round(v_balance, 2);
end $$;
