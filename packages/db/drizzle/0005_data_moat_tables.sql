-- 0005_data_moat_tables.sql
-- Doc 31: 전체 데이터 영속화 정책 — 5개 신규 테이블 + 세션 확장 컬럼

-- ── 1. negotiation_round_facts — 라운드별 전체 과정 기록 (해시 체인) ──

CREATE TABLE IF NOT EXISTS negotiation_round_facts (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  session_id UUID NOT NULL,
  round_no INTEGER NOT NULL,

  buyer_offer NUMERIC(18,0),
  seller_offer NUMERIC(18,0),
  gap NUMERIC(18,0),

  buyer_tactic TEXT,
  seller_tactic TEXT,

  conditions_changed JSONB,

  coaching_recommended_price NUMERIC(18,0),
  coaching_recommended_tactic TEXT,
  coaching_followed BOOLEAN,

  human_intervened BOOLEAN DEFAULT false,
  phase TEXT,

  fact_hash TEXT NOT NULL,
  prev_fact_hash TEXT,

  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE UNIQUE INDEX IF NOT EXISTS negotiation_round_facts_session_round_idx
  ON negotiation_round_facts(session_id, round_no);
CREATE INDEX IF NOT EXISTS negotiation_round_facts_session_idx
  ON negotiation_round_facts(session_id);

-- ── 2. negotiation_verifications — 인증/검증 기록 ─────────────────

CREATE TABLE IF NOT EXISTS negotiation_verifications (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  session_id UUID NOT NULL,
  round_no INTEGER NOT NULL,

  term TEXT NOT NULL,
  result TEXT NOT NULL,
  detail JSONB,
  provider TEXT,
  cost_minor INTEGER DEFAULT 0,

  attestation_signature TEXT NOT NULL,
  attestation_payload_hash TEXT NOT NULL,

  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS negotiation_verifications_session_idx
  ON negotiation_verifications(session_id);
CREATE INDEX IF NOT EXISTS negotiation_verifications_term_result_idx
  ON negotiation_verifications(term, result);

-- ── 3. negotiation_escalations — 에스컬레이션 이력 ────────────────

CREATE TABLE IF NOT EXISTS negotiation_escalations (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  session_id UUID NOT NULL,
  round_no INTEGER NOT NULL,

  type TEXT NOT NULL,
  context TEXT,
  strategy_snapshot JSONB,
  recent_rounds JSONB,

  resolution TEXT,
  resolution_detail JSONB,
  resolved_at TIMESTAMPTZ,

  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS negotiation_escalations_session_idx
  ON negotiation_escalations(session_id);

-- ── 4. negotiation_checkpoints — Phase 복원점 ─────────────────────

CREATE TABLE IF NOT EXISTS negotiation_checkpoints (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  session_id UUID NOT NULL,

  phase TEXT NOT NULL,
  version INTEGER NOT NULL,
  round_at_checkpoint INTEGER NOT NULL,

  core_memory_snapshot JSONB NOT NULL,
  conditions_state JSONB,
  memo_hash TEXT,

  reverted BOOLEAN DEFAULT false,
  reverted_at TIMESTAMPTZ,
  revert_reason TEXT,

  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS negotiation_checkpoints_session_phase_idx
  ON negotiation_checkpoints(session_id, phase);

-- ── 5. llm_telemetry — LLM 호출 기록 ─────────────────────────────

CREATE TABLE IF NOT EXISTS llm_telemetry (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  session_id UUID,
  round_no INTEGER,

  stage TEXT NOT NULL,
  model TEXT NOT NULL,

  input_tokens INTEGER NOT NULL,
  output_tokens INTEGER NOT NULL,
  latency_ms INTEGER NOT NULL,
  cost_minor INTEGER,

  reasoning_used BOOLEAN DEFAULT false,
  error TEXT,

  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS llm_telemetry_session_idx
  ON llm_telemetry(session_id);
CREATE INDEX IF NOT EXISTS llm_telemetry_model_created_idx
  ON llm_telemetry(model, created_at);
CREATE INDEX IF NOT EXISTS llm_telemetry_created_idx
  ON llm_telemetry(created_at);

-- ── 6. negotiation_sessions 확장 컬럼 ─────────────────────────────

ALTER TABLE negotiation_sessions
  ADD COLUMN IF NOT EXISTS opponent_model JSONB,
  ADD COLUMN IF NOT EXISTS core_memory_snapshot JSONB,
  ADD COLUMN IF NOT EXISTS memo_hash TEXT,
  ADD COLUMN IF NOT EXISTS session_fact_chain_hash TEXT;
