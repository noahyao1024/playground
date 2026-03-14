-- ============================================================================
-- Subscription Notes Migration
-- ============================================================================
-- Adds an optional note field to the subscriptions table.
--
-- Run this migration against your Supabase project:
--   psql $DATABASE_URL -f subscription_notes.sql
-- ============================================================================

alter table subscriptions
  add column if not exists note text;
