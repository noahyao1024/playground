-- Settling leaves deleted charges alone, and pays for exactly what it checked.
--
-- A delete only marks a charge (20260915_soft_delete_charges), and every screen
-- reads past the mark. settle_person did not: it totalled and settled every
-- unpaid row the person had, deleted or not. So "Settle everything owed" showed
-- a total counting live charges only, then debited the wallet for that plus any
-- unpaid charge that had been deleted, and flagged those paid on the way. A
-- deleted charge is one somebody decided nobody owes.
--
-- It also totalled the charges in one statement and settled them in another,
-- re-reading in between. A charge written in that gap -- the monthly run landing
-- while someone settles on another person's behalf -- was settled without ever
-- having been checked against the balance, which could leave the wallet below
-- zero. It now locks the charges first, then totals and settles those same rows.
--
-- settle_charge now refuses a deleted charge outright. The UI never offers one,
-- but a settle that races a delete should fail rather than pay for it.
--
-- unsettle_charge is unchanged. Reversing a settlement whose charge was deleted
-- afterwards returns real money to a real wallet, which is still worth allowing.
--
-- Same signatures as the 20260915 versions, so create or replace swaps them in
-- place, and running this twice leaves the same result as running it once.

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
  v_ids uuid[];
  v_total numeric;
  v_count int;
  v_balance numeric;
  r record;
begin
  perform 1 from subscribers where id = p_wallet_owner for update;
  if not found then
    raise exception 'No such person';
  end if;

  -- Lock what is owed, then total those rows. The loop below settles the same
  -- ids, so nothing written after this point can be paid for unchecked.
  select array_agg(id), count(*), coalesce(sum(total_cny), 0)
    into v_ids, v_count, v_total
    from (
      select id, total_cny from charges
      where subscriber_id = p_subscriber and not paid and deleted_at is null
      for update
    ) owed;

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
    where id = any(v_ids)
    order by period_start
  loop
    insert into wallet_entries (subscriber_id, amount_cny, kind, charge_id, note)
      values (p_wallet_owner, -r.total_cny, 'charge', r.id, p_note);
    update charges set paid = true where id = r.id;
  end loop;

  return query select v_count, round(v_total, 2), round(v_balance - v_total, 2);
end $$;

-- Nothing below changes anything. It reports how many settlements were posted
-- against a charge that had already been deleted -- the footprint of the old
-- settle_person -- and have not been reversed since, so a rehearsal answers
-- whether any wallet is owed money back. A count and a total only: run logs
-- are public.
do $$
declare
  v_count int;
  v_total numeric;
begin
  select count(*), coalesce(sum(-w.amount_cny), 0) into v_count, v_total
    from wallet_entries w
    join charges c on c.id = w.charge_id
    where w.kind = 'charge'
      and c.deleted_at is not null
      and w.created_at > c.deleted_at
      and not exists (
        select 1 from wallet_entries a
        where a.charge_id = w.charge_id and a.kind = 'adjustment' and a.created_at > w.created_at
      );
  raise notice 'settlements posted after their charge was deleted, not reversed: % (CNY %)',
    v_count, round(v_total, 2);
end $$;
