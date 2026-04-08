-- Migration: Phase 0 Week 1-2 — dispute-triggered attestation + HFMI v0
-- Run via: Supabase Dashboard > SQL Editor, or psql/node script
--
-- Tables:
--   seller_attestation_commits — append-only pre-ship commit log
--   hfmi_price_observations    — HFMI ingestion log (eBay Browse, Terapeak, etc.)
--   hfmi_model_coefficients    — nightly OLS fit results per SKU
--
-- All three are additive. No changes to existing tables.

-- ── seller_attestation_commits ────────────────────────────
CREATE TABLE IF NOT EXISTS seller_attestation_commits (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  listing_id UUID NOT NULL REFERENCES listings_published(id) ON DELETE CASCADE,
  seller_id UUID NOT NULL,
  imei_encrypted TEXT NOT NULL,
  battery_health_pct INTEGER NOT NULL,
  find_my_off BOOLEAN NOT NULL,
  photo_urls JSONB NOT NULL,
  commit_hash TEXT NOT NULL,
  canonical_payload JSONB NOT NULL,
  committed_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  expires_at TIMESTAMPTZ NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_seller_attestation_commits_listing
  ON seller_attestation_commits (listing_id);

CREATE INDEX IF NOT EXISTS idx_seller_attestation_commits_seller_committed
  ON seller_attestation_commits (seller_id, committed_at);

-- ── hfmi_price_observations ───────────────────────────────
CREATE TABLE IF NOT EXISTS hfmi_price_observations (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  source TEXT NOT NULL,
  model TEXT NOT NULL,
  storage_gb INTEGER,
  battery_health_pct INTEGER,
  cosmetic_grade TEXT,
  carrier_locked BOOLEAN NOT NULL DEFAULT false,
  observed_price_usd NUMERIC(10,2) NOT NULL,
  observed_at TIMESTAMPTZ NOT NULL,
  external_id TEXT,
  raw_payload JSONB,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_hfmi_obs_source_model_at
  ON hfmi_price_observations (source, model, observed_at);

CREATE UNIQUE INDEX IF NOT EXISTS uq_hfmi_obs_source_external_id
  ON hfmi_price_observations (source, external_id);

-- ── hfmi_model_coefficients ───────────────────────────────
CREATE TABLE IF NOT EXISTS hfmi_model_coefficients (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  model TEXT NOT NULL,
  fitted_at TIMESTAMPTZ NOT NULL,
  coefficients JSONB NOT NULL,
  r_squared NUMERIC(5,4) NOT NULL,
  sample_size INTEGER NOT NULL,
  residual_std NUMERIC(10,6) NOT NULL,
  fit_version TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_hfmi_coef_model_fitted
  ON hfmi_model_coefficients (model, fitted_at);
