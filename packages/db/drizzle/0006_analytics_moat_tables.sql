-- 0006_analytics_moat_tables.sql
-- 추가 해자 테이블: 시장 미시구조, 협상 그래프, 전술 효과, 가격 발견

-- ── 1. market_microstructure — 시장 미시구조 데이터 ────────────

CREATE TABLE IF NOT EXISTS market_microstructure (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  category TEXT NOT NULL,
  subcategory TEXT,
  sku TEXT,

  period_start TIMESTAMPTZ NOT NULL,
  period_end TIMESTAMPTZ NOT NULL,
  period_type TEXT NOT NULL,

  total_sessions INTEGER NOT NULL DEFAULT 0,
  deal_count INTEGER NOT NULL DEFAULT 0,
  reject_count INTEGER NOT NULL DEFAULT 0,
  timeout_count INTEGER NOT NULL DEFAULT 0,

  avg_ask_minor NUMERIC(18,0),
  avg_bid_minor NUMERIC(18,0),
  avg_deal_minor NUMERIC(18,0),
  median_deal_minor NUMERIC(18,0),
  bid_ask_spread NUMERIC(8,4),
  price_stddev NUMERIC(18,0),

  avg_rounds NUMERIC(5,1),
  avg_duration_minutes NUMERIC(10,1),
  avg_discount_rate NUMERIC(5,4),

  boulware_ratio NUMERIC(5,4),
  linear_ratio NUMERIC(5,4),
  conceder_ratio NUMERIC(5,4),

  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE UNIQUE INDEX IF NOT EXISTS market_microstructure_period_idx
  ON market_microstructure(category, subcategory, sku, period_start, period_type);
CREATE INDEX IF NOT EXISTS market_microstructure_category_idx
  ON market_microstructure(category, period_type);
CREATE INDEX IF NOT EXISTS market_microstructure_sku_idx
  ON market_microstructure(sku);

-- ── 2. negotiation_graph — 협상 관계 그래프 ────────────────────

CREATE TABLE IF NOT EXISTS negotiation_graph (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  buyer_id UUID NOT NULL,
  seller_id UUID NOT NULL,
  category TEXT NOT NULL,

  total_sessions INTEGER NOT NULL DEFAULT 1,
  deal_count INTEGER NOT NULL DEFAULT 0,
  avg_discount_rate NUMERIC(5,4),
  avg_rounds NUMERIC(5,1),

  buyer_pattern_mode TEXT,
  seller_pattern_mode TEXT,

  last_deal_at TIMESTAMPTZ,
  dispute_count INTEGER NOT NULL DEFAULT 0,

  first_interaction_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE UNIQUE INDEX IF NOT EXISTS negotiation_graph_pair_category_idx
  ON negotiation_graph(buyer_id, seller_id, category);
CREATE INDEX IF NOT EXISTS negotiation_graph_buyer_idx
  ON negotiation_graph(buyer_id);
CREATE INDEX IF NOT EXISTS negotiation_graph_seller_idx
  ON negotiation_graph(seller_id);

-- ── 3. tactic_effectiveness — 전술 효과 통계 ──────────────────

CREATE TABLE IF NOT EXISTS tactic_effectiveness (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tactic TEXT NOT NULL,
  category TEXT NOT NULL,
  role TEXT NOT NULL,

  price_range_low NUMERIC(18,0),
  price_range_high NUMERIC(18,0),
  opponent_pattern TEXT,

  times_used INTEGER NOT NULL DEFAULT 0,
  times_succeeded INTEGER NOT NULL DEFAULT 0,
  avg_concession_gained NUMERIC(8,6),
  avg_counter_delay NUMERIC(5,1),

  deal_rate NUMERIC(5,4),
  avg_discount_when_used NUMERIC(5,4),

  period_start TIMESTAMPTZ NOT NULL,
  period_end TIMESTAMPTZ NOT NULL,

  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE UNIQUE INDEX IF NOT EXISTS tactic_effectiveness_composite_idx
  ON tactic_effectiveness(tactic, category, role, opponent_pattern, period_start);
CREATE INDEX IF NOT EXISTS tactic_effectiveness_tactic_idx
  ON tactic_effectiveness(tactic);
CREATE INDEX IF NOT EXISTS tactic_effectiveness_category_idx
  ON tactic_effectiveness(category);

-- ── 4. price_discovery — 가격 발견 시그널 ─────────────────────

CREATE TABLE IF NOT EXISTS price_discovery (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  session_id UUID NOT NULL,
  listing_id UUID NOT NULL,
  category TEXT NOT NULL,
  sku TEXT,

  initial_ask_minor NUMERIC(18,0) NOT NULL,
  initial_bid_minor NUMERIC(18,0),

  final_price_minor NUMERIC(18,0),
  outcome TEXT,

  total_rounds INTEGER NOT NULL,
  price_trajectory JSONB,
  convergence_round INTEGER,

  external_ref_minor NUMERIC(18,0),
  external_ref_source TEXT,
  savings_vs_ref NUMERIC(18,0),

  day_of_week INTEGER,
  hour_of_day INTEGER,
  duration_minutes NUMERIC(10,1),

  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS price_discovery_session_idx
  ON price_discovery(session_id);
CREATE INDEX IF NOT EXISTS price_discovery_listing_idx
  ON price_discovery(listing_id);
CREATE INDEX IF NOT EXISTS price_discovery_category_sku_idx
  ON price_discovery(category, sku);
CREATE INDEX IF NOT EXISTS price_discovery_created_idx
  ON price_discovery(created_at);
