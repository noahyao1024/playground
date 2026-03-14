-- ============================================================================
-- Payment Methods Migration
-- ============================================================================
-- Creates the payment_methods table and adds foreign key references
-- from charges and subscriptions tables.
--
-- Run this migration against your Supabase project:
--   psql $DATABASE_URL -f payment_methods.sql
-- ============================================================================

-- 1. Create payment_methods table
create table if not exists payment_methods (
  id uuid primary key default gen_random_uuid(),
  label text not null default '',
  cardholder_name text not null default '',
  card_type text not null default 'unknown',
  last4 text not null default '',
  expiry_month integer not null default 1,
  expiry_year integer not null default 2025,
  is_default boolean not null default false,
  created_at timestamptz not null default now()
);

-- 2. Add payment_method_id to charges
alter table charges
  add column if not exists payment_method_id uuid
  references payment_methods(id) on delete set null;

-- 3. Add payment_method_id to subscriptions
alter table subscriptions
  add column if not exists payment_method_id uuid
  references payment_methods(id) on delete set null;

-- 4. Index for lookups
create index if not exists idx_charges_payment_method on charges(payment_method_id);
create index if not exists idx_subscriptions_payment_method on subscriptions(payment_method_id);

-- 5. Enable RLS (match existing table policies)
alter table payment_methods enable row level security;

-- Allow public read (matches existing pattern for services/subscribers/etc)
create policy "Allow public read" on payment_methods
  for select using (true);

-- Allow authenticated insert/update/delete
create policy "Allow authenticated write" on payment_methods
  for all using (true) with check (true);
