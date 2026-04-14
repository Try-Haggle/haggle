-- 0004_data_moat_columns.sql
-- Doc 30: Data Moat — 과정 데이터 영속화를 위한 컬럼 추가

-- ── negotiation_sessions: 세션 요약 컬럼 ──────────────────────

ALTER TABLE negotiation_sessions
  ADD COLUMN IF NOT EXISTS outcome TEXT,
  ADD COLUMN IF NOT EXISTS discount_rate NUMERIC(5,4),
  ADD COLUMN IF NOT EXISTS total_duration_minutes NUMERIC(10,1),
  ADD COLUMN IF NOT EXISTS buyer_pattern TEXT,
  ADD COLUMN IF NOT EXISTS seller_pattern TEXT,
  ADD COLUMN IF NOT EXISTS price_trajectory JSONB,
  ADD COLUMN IF NOT EXISTS concession_rates JSONB,
  ADD COLUMN IF NOT EXISTS tactics_used JSONB,
  ADD COLUMN IF NOT EXISTS tactics_success JSONB,
  ADD COLUMN IF NOT EXISTS conditions_exchanged JSONB,
  ADD COLUMN IF NOT EXISTS referee_hard_violations INTEGER DEFAULT 0,
  ADD COLUMN IF NOT EXISTS referee_soft_violations INTEGER DEFAULT 0,
  ADD COLUMN IF NOT EXISTS coach_vs_actual_avg_deviation INTEGER,
  ADD COLUMN IF NOT EXISTS item_value_range TEXT;

CREATE INDEX IF NOT EXISTS negotiation_sessions_outcome_idx
  ON negotiation_sessions(outcome);

-- ── negotiation_rounds: 라운드별 과정 데이터 컬럼 ─────────────

ALTER TABLE negotiation_rounds
  ADD COLUMN IF NOT EXISTS tactic_used TEXT,
  ADD COLUMN IF NOT EXISTS opponent_tactic_detected TEXT,
  ADD COLUMN IF NOT EXISTS concession_rate NUMERIC(8,6),
  ADD COLUMN IF NOT EXISTS coach_recommended_minor NUMERIC(18,0),
  ADD COLUMN IF NOT EXISTS deviation_from_coach INTEGER,
  ADD COLUMN IF NOT EXISTS referee_violations JSONB,
  ADD COLUMN IF NOT EXISTS llm_latency_ms INTEGER;

CREATE INDEX IF NOT EXISTS negotiation_rounds_tactic_idx
  ON negotiation_rounds(tactic_used);
