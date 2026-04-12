-- Migration 006: Add LLM negotiation engine columns
-- All columns nullable for backward compatibility with rule-based rounds.

-- ─── negotiation_sessions ─────────────────────────────────────
ALTER TABLE negotiation_sessions
  ADD COLUMN IF NOT EXISTS phase TEXT,
  ADD COLUMN IF NOT EXISTS intervention_mode TEXT DEFAULT 'FULL_AUTO',
  ADD COLUMN IF NOT EXISTS buddy_tone JSONB,
  ADD COLUMN IF NOT EXISTS coaching_snapshot JSONB;

-- ─── negotiation_rounds ───────────────────────────────────────
ALTER TABLE negotiation_rounds
  ADD COLUMN IF NOT EXISTS coaching JSONB,
  ADD COLUMN IF NOT EXISTS validation JSONB,
  ADD COLUMN IF NOT EXISTS llm_tokens_used INTEGER,
  ADD COLUMN IF NOT EXISTS reasoning_used BOOLEAN DEFAULT FALSE,
  ADD COLUMN IF NOT EXISTS message TEXT,
  ADD COLUMN IF NOT EXISTS phase_at_round TEXT;
