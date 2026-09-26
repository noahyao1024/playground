-- Covers every foreign key with an index, as Supabase's performance advisor asks
-- (lint 0001, unindexed_foreign_keys). Without one, deleting or re-keying a
-- referenced row scans the whole referencing table to check it, and a join
-- along the key cannot use an index. Existing indexes did not count: the one on
-- charges is partial and starts with subscriber_id, the one on subscriptions
-- starts with subscriber_id, the one on finance_balances with (account_id, as_of).
--
-- The tables are small, so each index builds in a moment. Additive only, and
-- `if not exists` makes the file safe to run again. test/sql fails any foreign
-- key in public left without one.

create index if not exists charges_service_id_idx on charges (service_id);
create index if not exists charges_payment_method_id_idx on charges (payment_method_id);
create index if not exists subscriptions_service_id_idx on subscriptions (service_id);
create index if not exists subscriptions_payment_method_id_idx on subscriptions (payment_method_id);
create index if not exists wallet_entries_charge_id_idx on wallet_entries (charge_id);
create index if not exists finance_balances_account_id_currency_idx on finance_balances (account_id, currency);
