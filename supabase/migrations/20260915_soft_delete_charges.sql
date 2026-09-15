-- Deleting a charge used to destroy it, which sits badly next to a wallet whose
-- whole design is that entries are never rewritten. Worse, deleting a settled
-- charge left its wallet entry pointing at nothing while still counting against
-- a balance.
--
-- A delete is now a mark. The row stays, the ledger entry still resolves, and
-- the action can be taken back. Everything that reads charges filters on this.

alter table charges add column if not exists deleted_at timestamptz;

create index if not exists charges_not_deleted_idx on charges (deleted_at) where deleted_at is null;
