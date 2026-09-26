-- Pins search_path on every function in public, as Supabase's security advisor
-- asks (lint 0011, function_search_path_mutable). A function that resolves names
-- through its caller's search_path can be pointed at a look-alike table or
-- function planted earlier in that path. Pinned, it finds only public's, with
-- pg_temp last so a temporary table cannot stand in for one either.
--
-- None of these is SECURITY DEFINER, so the exposure was small; this closes it.
-- Behaviour is unchanged: each reaches only objects in public and built-ins in
-- pg_catalog, which is searched first whatever the setting.
--
-- CREATE OR REPLACE FUNCTION resets this, so a later redefinition must carry its
-- own `set search_path`. test/sql fails any function in public that does not.

alter function public.touch_charge() set search_path = public, pg_temp;
alter function public.touch_row() set search_path = public, pg_temp;
alter function public.wallet_entries_are_final() set search_path = public, pg_temp;
alter function public.settle_charge(uuid, uuid, text) set search_path = public, pg_temp;
alter function public.settle_person(uuid, uuid, text) set search_path = public, pg_temp;
alter function public.unsettle_charge(uuid, text) set search_path = public, pg_temp;
