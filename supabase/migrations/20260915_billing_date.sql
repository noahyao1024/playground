-- Store the day a charge is for, instead of deriving it every time.
--
-- The manual form has a date picker, and handleAddCharge threw the day away —
-- period_start only ever kept YYYY-MM. The exact date the user chose was known
-- and discarded, which is why a one-off shows a bare month.
--
-- Deriving it from the subscription's start day also fails whenever there is no
-- subscription to read: 20 charges have none, either because they were one-offs
-- or because the subscription was deleted while its charges stayed. A stored
-- column does not depend on a row that may no longer exist.
--
-- Left null for existing rows. The display still derives a date when it can, so
-- nothing gets worse; inventing a day for past charges would look authoritative
-- while being made up.

alter table charges add column if not exists billing_date date;
