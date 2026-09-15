-- wallet_entries shipped without row level security.
--
-- Every other table has it on with a read-only policy, so anon can select and
-- nothing else. This one had RLS off entirely, and Supabase grants anon INSERT
-- by default — so anyone holding the anon key, which is public by design and
-- ships in the browser bundle, could post a top-up to any wallet.
--
-- Updates and deletes happened to be blocked already, but by the append-only
-- trigger rather than by permissions. That was luck, not a boundary.
--
-- Reads stay open, matching the other tables. Writes go through /api/settle and
-- /api/data, which use the service role key behind a signed-in allowlist.

alter table wallet_entries enable row level security;

drop policy if exists anon_read on wallet_entries;
create policy anon_read on wallet_entries for select using (true);
