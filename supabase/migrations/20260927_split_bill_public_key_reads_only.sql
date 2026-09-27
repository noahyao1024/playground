-- What the public key may do with the split bill: read it, and no more.
--
-- The page reads the split bill with the anon key, which it must for anyone to
-- see what they owe without signing in. Every write goes through /api/data,
-- /api/settle and the billing routes, with the service role. RLS already
-- refused the public key every write -- no table has a write policy -- and the
-- settle functions run as their caller, so they were no way round it. This
-- takes the privileges away too, so that a write policy added by mistake one day
-- opens nothing.
--
-- And the cards. Their labels, brands and last four digits say which card pays
-- for what, and stay readable. The holder's name and the expiry date are for
-- the people who edit the split bill, who get them from GET /api/data.
--
-- Code first: the page read the cards with select *, which the column grant
-- below refuses outright. Deploy the page that names its columns, then apply.

revoke insert, update, delete, truncate, references, trigger
  on services, subscribers, subscriptions, charges, payment_methods, wallet_entries
  from anon, authenticated;

revoke select on payment_methods from anon, authenticated;
grant select (id, label, card_type, last4, is_default, created_at) on payment_methods to anon, authenticated;

-- Every function in public is the server's: the settle functions, which only
-- the service role calls, and the triggers, which Postgres runs itself.
revoke execute on function
  settle_charge(uuid, uuid, text), settle_person(uuid, uuid, text), unsettle_charge(uuid, text),
  touch_charge(), touch_row(), wallet_entries_are_final()
  from public, anon, authenticated;
grant execute on function settle_charge(uuid, uuid, text), settle_person(uuid, uuid, text), unsettle_charge(uuid, text)
  to service_role;

-- A function added later is executable by everyone until its migration says
-- otherwise, as Postgres grants it to public by default; test/sql fails CI
-- until it does.
