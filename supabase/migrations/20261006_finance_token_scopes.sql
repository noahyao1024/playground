-- Preserve existing tokens, but allow new agents to receive less authority.
-- Additive and safe to rehearse before the code goes live.
alter table finance_api_tokens
  add column if not exists scope text not null default 'finance:write'
  check (scope in ('housing:read', 'finance:read', 'finance:write'));

-- Tokens and hashes remain private, including the new column.
alter table finance_api_tokens enable row level security;
revoke all on table finance_api_tokens from anon, authenticated;
notify pgrst, 'reload schema';
