-- Tokens the owner's own agents use on /api/finance/*, made and revoked on the
-- /finance page. Only each token's SHA-256 is kept: the token itself is shown
-- once, when it is made, and cannot be read back from here or anywhere else.
-- A token carries 256 random bits, so a plain SHA-256 needs no salt and no slow
-- hash to be safe to store.
--
-- Private like finance_accounts: RLS on with no policy, and nothing granted to
-- anon or authenticated. Only the service role -- the server -- reads it.
--
-- Additive only.

create table if not exists finance_api_tokens (
  id uuid primary key default gen_random_uuid(),
  -- What it is for, as the owner named it: "Laptop agent".
  name text not null check (length(btrim(name)) between 1 and 60),
  token_sha256 text not null unique check (token_sha256 ~ '^[0-9a-f]{64}$'),
  created_at timestamptz not null default now()
);

alter table finance_api_tokens enable row level security;
revoke all on table finance_api_tokens from anon, authenticated;
