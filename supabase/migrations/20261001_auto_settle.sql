-- A charge is paid out of the wallet by default, as soon as the wallet holds
-- enough for it.
--
-- Settling was a click every time: each month someone opened a dialog per
-- person and picked a wallet that was nearly always the person's own -- or, for
-- 周岩, 袁老板's, which pays for them both. auto_settle does what that click
-- did, through the same ledger: one 'charge' entry per charge, noted
-- 'Auto-settled', the charge marked paid, the balance checked under the same
-- lock settle_charge and settle_person take.
--
-- pays_from is the wallet a person's charges come out of when it is not their
-- own. One level deep: someone who pays from another wallet holds no wallet
-- others pay from, so a person's wallet is always coalesce(pays_from, id).
-- The manual dialogs start on that wallet too; any wallet may still pay.
--
-- What it settles: every live, unpaid charge above zero of the people who pay
-- from a wallet, oldest first, each one the balance still covers. One it cannot
-- cover is passed over, not waited on, so a wallet a little short of an old
-- charge still pays the newer, smaller ones. A charge of zero or less is left
-- for a person to look at. Nothing is reversed or rewritten: what it pays is
-- undone, as any settlement is, with unsettle_charge.
--
-- Run by the app after whatever may leave something payable: billing, a new
-- charge, a top-up, a restored charge, a change of wallet. Running it again
-- settles nothing more, so callers need not coordinate.

alter table subscribers add column if not exists pays_from uuid
  references subscribers(id) on delete restrict;

do $$
begin
  alter table subscribers add constraint subscribers_pays_from_not_self check (pays_from <> id);
exception when duplicate_object then null;
end $$;

-- The advisors want every foreign key indexed, and the delete guard and the
-- one-level rule below both look people up by it.
create index if not exists subscribers_pays_from_idx on subscribers (pays_from);

create or replace function subscribers_pay_from_one_wallet() returns trigger
language plpgsql
set search_path = public, pg_temp
as $$
begin
  if new.pays_from is null then
    return new;
  end if;
  if new.pays_from = new.id then
    raise exception using errcode = 'check_violation',
      message = 'A person pays from their own wallet unless told otherwise; leave it empty for that';
  end if;
  if exists (select 1 from subscribers where id = new.pays_from and pays_from is not null) then
    raise exception using errcode = 'check_violation',
      message = format('%s pays from another wallet, so nobody can pay from theirs',
                       (select name from subscribers where id = new.pays_from));
  end if;
  if exists (select 1 from subscribers where pays_from = new.id) then
    raise exception using errcode = 'check_violation',
      message = format('Others pay from %s''s wallet, so it cannot pay from another', new.name);
  end if;
  return new;
end $$;

drop trigger if exists subscribers_pay_from_one_wallet on subscribers;
create trigger subscribers_pay_from_one_wallet before insert or update of pays_from on subscribers
  for each row execute function subscribers_pay_from_one_wallet();

-- p_people: settle what these people owe, out of the wallets they pay from --
-- and with it what everyone else paying from those wallets owes. Null for
-- every wallet. One row per wallet that paid anything.
create or replace function auto_settle(p_people uuid[] default null)
returns table (wallet uuid, settled int, total numeric, balance_left numeric)
language plpgsql
set search_path = public, pg_temp
as $$
declare
  v_wallets uuid[];
  v_wallet uuid;
  v_ids uuid[];
  v_balance numeric;
  v_settled int;
  v_total numeric;
  r record;
begin
  select array_agg(distinct coalesce(s.pays_from, s.id) order by coalesce(s.pays_from, s.id))
    into v_wallets
    from subscribers s
    where p_people is null or s.id = any(p_people);
  if v_wallets is null then
    return;
  end if;

  -- Every wallet locked before any charge, in one order. settle_charge and
  -- settle_person lock their wallet before their charges too, so none of them
  -- can hold a charge this is waiting on while waiting on a wallet this holds.
  perform 1 from subscribers where id = any(v_wallets) order by id for update;

  foreach v_wallet in array v_wallets loop
    -- Lock what is owed, then pay from those same rows: a charge written in
    -- between is left for the next run rather than paid unchecked.
    select array_agg(id) into v_ids from (
      select c.id from charges c
        join subscribers s on s.id = c.subscriber_id
       where coalesce(s.pays_from, s.id) = v_wallet
         and not c.paid and c.deleted_at is null and c.total_cny > 0
       order by c.id
       for update of c
    ) owed;
    continue when v_ids is null;

    select coalesce(sum(amount_cny), 0) into v_balance
      from wallet_entries where subscriber_id = v_wallet;
    v_settled := 0;
    v_total := 0;

    for r in
      select id, total_cny from charges
       where id = any(v_ids)
       order by period_start, billing_date nulls last, created_at, id
    loop
      continue when r.total_cny > v_balance;
      insert into wallet_entries (subscriber_id, amount_cny, kind, charge_id, note)
        values (v_wallet, -r.total_cny, 'charge', r.id, 'Auto-settled');
      update charges set paid = true where id = r.id;
      v_balance := v_balance - r.total_cny;
      v_settled := v_settled + 1;
      v_total := v_total + r.total_cny;
    end loop;

    if v_settled > 0 then
      wallet := v_wallet;
      settled := v_settled;
      total := round(v_total, 2);
      balance_left := round(v_balance, 2);
      return next;
    end if;
  end loop;
end $$;

-- Postgres grants a new function to everyone. These are the server's.
revoke execute on function auto_settle(uuid[]), subscribers_pay_from_one_wallet()
  from public, anon, authenticated;
grant execute on function auto_settle(uuid[]) to service_role;
