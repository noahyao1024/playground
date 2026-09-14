-- Stop a delete from taking the books with it.
--
-- services and subscribers were referenced ON DELETE CASCADE, so removing one
-- service silently removed every subscription and charge that pointed at it —
-- deleting a service with 18 charges destroyed all 18, with nothing in the UI
-- saying so. RESTRICT makes Postgres refuse instead. Rows that nothing
-- references still delete normally.
--
-- payment_methods stays ON DELETE SET NULL: dropping a card should unlink it,
-- not block on every charge ever paid with it.

alter table charges drop constraint if exists charges_service_id_fkey;
alter table charges add constraint charges_service_id_fkey
  foreign key (service_id) references services(id) on delete restrict;

alter table subscriptions drop constraint if exists subscriptions_service_id_fkey;
alter table subscriptions add constraint subscriptions_service_id_fkey
  foreign key (service_id) references services(id) on delete restrict;

alter table charges drop constraint if exists charges_subscriber_id_fkey;
alter table charges add constraint charges_subscriber_id_fkey
  foreign key (subscriber_id) references subscribers(id) on delete restrict;

alter table subscriptions drop constraint if exists subscriptions_subscriber_id_fkey;
alter table subscriptions add constraint subscriptions_subscriber_id_fkey
  foreign key (subscriber_id) references subscribers(id) on delete restrict;
