-- Record when a row was last touched, and when payment was actually marked.
--
-- paid_date is a date written by the browser, so it carries no time and trusts
-- the client's clock. paid_at is a timestamp the database stamps itself when
-- paid flips to true — and it also fills paid_date from Singapore's calendar, so
-- that value no longer depends on whoever clicked.
--
-- updated_at answers "has this been edited since it was created": null means
-- untouched. Existing rows stay null rather than being backfilled with a time
-- nobody recorded.

alter table charges add column if not exists updated_at timestamptz;
alter table charges add column if not exists paid_at timestamptz;
alter table subscriptions add column if not exists updated_at timestamptz;

create or replace function touch_charge() returns trigger
language plpgsql as $$
begin
  new.updated_at := now();
  if new.paid and not coalesce(old.paid, false) then
    new.paid_at := now();
    new.paid_date := (now() at time zone 'Asia/Singapore')::date;
  elsif not new.paid then
    new.paid_at := null;
    new.paid_date := null;
  end if;
  return new;
end $$;

create or replace function touch_row() returns trigger
language plpgsql as $$
begin
  new.updated_at := now();
  return new;
end $$;

drop trigger if exists charges_touch on charges;
create trigger charges_touch before update on charges
  for each row execute function touch_charge();

drop trigger if exists subscriptions_touch on subscriptions;
create trigger subscriptions_touch before update on subscriptions
  for each row execute function touch_row();
