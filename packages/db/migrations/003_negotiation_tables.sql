-- Migration: Add negotiation tables (sessions, rounds, groups)
-- Run via: Supabase Dashboard > SQL Editor, or psql/node script

-- ── negotiation_groups ────────────────────────────────────
CREATE TABLE IF NOT EXISTS negotiation_groups (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  topology TEXT NOT NULL,
  anchor_user_id UUID NOT NULL,
  intent_id UUID,
  max_sessions INTEGER NOT NULL DEFAULT 10,
  status TEXT NOT NULL DEFAULT 'ACTIVE',
  batna NUMERIC(18,0),
  best_session_id UUID,
  version INTEGER NOT NULL DEFAULT 1,
  metadata JSONB,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS negotiation_groups_anchor_status_idx
  ON negotiation_groups (anchor_user_id, status);

-- ── negotiation_sessions ──────────────────────────────────
CREATE TABLE IF NOT EXISTS negotiation_sessions (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  group_id UUID,
  intent_id UUID,
  listing_id UUID NOT NULL,
  strategy_id TEXT NOT NULL,
  role TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'CREATED',
  buyer_id UUID NOT NULL,
  seller_id UUID NOT NULL,
  counterparty_id UUID NOT NULL,
  current_round INTEGER NOT NULL DEFAULT 0,
  rounds_no_concession INTEGER NOT NULL DEFAULT 0,
  last_offer_price_minor NUMERIC(18,0),
  last_utility JSONB,
  strategy_snapshot JSONB NOT NULL,
  version INTEGER NOT NULL DEFAULT 1,
  expires_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS negotiation_sessions_group_status_idx
  ON negotiation_sessions (group_id, status);
CREATE INDEX IF NOT EXISTS negotiation_sessions_buyer_status_idx
  ON negotiation_sessions (buyer_id, status);
CREATE INDEX IF NOT EXISTS negotiation_sessions_seller_status_idx
  ON negotiation_sessions (seller_id, status);
CREATE INDEX IF NOT EXISTS negotiation_sessions_listing_idx
  ON negotiation_sessions (listing_id);

-- ── negotiation_rounds (append-only) ──────────────────────
CREATE TABLE IF NOT EXISTS negotiation_rounds (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  session_id UUID NOT NULL,
  round_no INTEGER NOT NULL,
  sender_role TEXT NOT NULL,
  message_type TEXT NOT NULL,
  price_minor NUMERIC(18,0) NOT NULL,
  counter_price_minor NUMERIC(18,0),
  utility JSONB,
  decision TEXT,
  metadata JSONB,
  idempotency_key TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS negotiation_rounds_session_round_idx
  ON negotiation_rounds (session_id, round_no);
CREATE UNIQUE INDEX IF NOT EXISTS negotiation_rounds_idempotency_key_idx
  ON negotiation_rounds (idempotency_key);
