-- Add optional note field to subscriptions
alter table subscriptions
  add column if not exists note text;
