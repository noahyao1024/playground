-- Settle everything one person owes, in one go.
--
-- Charge by charge was the only way, and 帆哥 alone has eleven — eleven dialogs,
-- eleven balance checks, and a half-finished state if you stop midway.
--
-- The balance is checked once against the whole total and the run is all or
-- nothing: a wallet that cannot cover everything settles none of it, rather than
-- leaving a person half paid.
--
-- Still one ledger entry per charge, not one lump sum, so each entry keeps the
-- charge_id that ties it to what it paid for.

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
    from charges where subscriber_id = p_subscriber and not paid;

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
    where subscriber_id = p_subscriber and not paid
    order by period_start
    for update
  loop
    insert into wallet_entries (subscriber_id, amount_cny, kind, charge_id, note)
      values (p_wallet_owner, -r.total_cny, 'charge', r.id, p_note);
    update charges set paid = true where id = r.id;
  end loop;

  return query select v_count, round(v_total, 2), round(v_balance - v_total, 2);
end $$;
