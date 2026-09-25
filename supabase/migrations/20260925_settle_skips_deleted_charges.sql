-- Settling leaves deleted charges alone.
--
-- A delete only marks a charge (20260915_soft_delete_charges), and every screen
-- reads past the mark. settle_person did not: it totalled and settled every
-- unpaid row the person had, deleted or not. So "Settle everything owed" showed
-- a total counting live charges only, then debited the wallet for that plus any
-- unpaid charge that had been deleted, and flagged those paid on the way. A
-- deleted charge is one somebody decided nobody owes.
--
-- settle_charge now refuses a deleted charge outright. The UI never offers one,
-- but a settle that races a delete should fail rather than pay for it.
--
-- unsettle_charge is unchanged. Reversing a settlement whose charge was deleted
-- afterwards returns real money to a real wallet, which is still worth allowing.
--
-- Both functions are the 20260915 versions with the deleted_at checks added and
-- nothing else: same signatures, so create or replace swaps them in place, and
-- running this twice leaves the same result as running it once.

create or replace function settle_charge(
  p_charge_id uuid,
  p_wallet_owner uuid,
  p_note text default null
) returns numeric
language plpgsql as $$
declare
  v_amount numeric;
  v_paid boolean;
  v_deleted_at timestamptz;
  v_balance numeric;
begin
  perform 1 from subscribers where id = p_wallet_owner for update;
  if not found then
    raise exception 'No such person';
  end if;

  select total_cny, paid, deleted_at into v_amount, v_paid, v_deleted_at
    from charges where id = p_charge_id for update;
  if not found then
    raise exception 'No such charge';
  end if;
  if v_deleted_at is not null then
    raise exception 'That charge has been deleted';
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

create or replace function settle_person(
  p_subscriber uuid,
  p_wallet_owner uuid,
  p_note text default null
) returns table (settled int, total numeric, balance_left numeric)
language plpgsql as $$
declare
  v_total numeric;
  v_count int;
  v_balance numeric;
  r record;
begin
  perform 1 from subscribers where id = p_wallet_owner for update;
  if not found then
    raise exception 'No such person';
  end if;

  select count(*), coalesce(sum(total_cny), 0) into v_count, v_total
    from charges where subscriber_id = p_subscriber and not paid and deleted_at is null;

  if v_count = 0 then
    raise exception 'Nothing outstanding for that person';
  end if;

  select coalesce(sum(amount_cny), 0) into v_balance
    from wallet_entries where subscriber_id = p_wallet_owner;

  if v_balance < v_total then
    raise exception 'Not enough in the wallet for all % charge(s): % available, % needed',
      v_count, round(v_balance, 2), round(v_total, 2);
  end if;

  for r in
    select id, total_cny from charges
    where subscriber_id = p_subscriber and not paid and deleted_at is null
    order by period_start
    for update
  loop
    insert into wallet_entries (subscriber_id, amount_cny, kind, charge_id, note)
      values (p_wallet_owner, -r.total_cny, 'charge', r.id, p_note);
    update charges set paid = true where id = r.id;
  end loop;

  return query select v_count, round(v_total, 2), round(v_balance - v_total, 2);
end $$;
