-- Let a charge stand on its own, without a service behind it.
--
-- A one-off expense had to be registered as a permanent service first, which is
-- how the services table grew to 21 rows of which 15 no longer bill anything.
-- service_id becomes optional, and a charge that has none carries its own label.
-- One of the two must always be present, so a charge can always name itself.

alter table charges alter column service_id drop not null;
alter table charges add column if not exists label text;

alter table charges drop constraint if exists charges_identified;
alter table charges add constraint charges_identified
  check (service_id is not null or label is not null);
