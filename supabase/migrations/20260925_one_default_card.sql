-- At most one card is the default.
--
-- Choosing a default clears the flag on every card first, and that clearing
-- request never worked: its filter compared a uuid with an empty string, which
-- Postgres refuses, and the caller swallowed the error. So every card ever made
-- default kept the flag. The request is fixed in the app; this makes the rule
-- hold whatever sends the next write.
--
-- Apply it after the fixed app is deployed, not before. The old app still
-- fails to clear the old default, so with this in place it could not change
-- the default at all.
--
-- Partial, so any number of cards can be non-default. If more than one is
-- flagged already, creating it fails and nothing changes: which card is meant
-- to be the default is not something this file can know. Settle it by hand
-- first -- in the fixed app, edit the card that should be the default and save.

create unique index if not exists payment_methods_one_default
  on public.payment_methods (is_default)
  where is_default;
