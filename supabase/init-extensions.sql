-- Pre-migration extension bootstrap.
-- Runs after `supabase start`, BEFORE `drizzle-kit migrate`.
--
-- The 0002 migration declares vector(...) columns but never runs CREATE EXTENSION
-- (only a comment). On a fresh local DB that migration would fail, so we guarantee
-- the extension here. Idempotent — safe to run repeatedly.
CREATE EXTENSION IF NOT EXISTS vector;
