-- Payment methods table
create table if not exists payment_methods (
  id uuid primary key default gen_random_uuid(),
  label text not null default '',
  cardholder_name text not null,
  card_type text not null default 'unknown',
  last4 text not null,
  expiry_month integer not null,
  expiry_year integer not null,
  is_default boolean not null default false,
  created_at timestamptz not null default now()
);

-- Enable RLS (matching existing tables)
alter table payment_methods enable row level security;

-- Allow anon reads (matching existing pattern)
create policy "Allow anon read" on payment_methods
  for select using (true);

-- Add payment_method_id to charges
alter table charges
  add column if not exists payment_method_id uuid references payment_methods(id) on delete set null;

-- Add payment_method_id to subscriptions
alter table subscriptions
  add column if not exists payment_method_id uuid references payment_methods(id) on delete set null;
