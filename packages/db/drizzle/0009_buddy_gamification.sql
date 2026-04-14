-- ────────────────────────────────────────────────────────────────
-- 0009: Buddy + Gamification + Presets
-- ────────────────────────────────────────────────────────────────

-- skill_presets: negotiation strategy presets (system + user custom)
CREATE TABLE IF NOT EXISTS "skill_presets" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "name" text NOT NULL,
  "display_name" text NOT NULL,
  "description" text,
  "advisor_skill_id" text NOT NULL,
  "advisor_config" jsonb,
  "validator_skills" jsonb,
  "is_system" boolean NOT NULL DEFAULT true,
  "user_id" uuid,
  "avg_saving_pct" numeric(8, 4),
  "avg_win_rate" numeric(8, 4),
  "usage_count" integer NOT NULL DEFAULT 0,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL
);

CREATE INDEX IF NOT EXISTS "skill_presets_name_idx" ON "skill_presets" ("name");
CREATE INDEX IF NOT EXISTS "skill_presets_is_system_idx" ON "skill_presets" ("is_system");
CREATE INDEX IF NOT EXISTS "skill_presets_user_id_idx" ON "skill_presets" ("user_id");

-- buddies: companion creatures born from trades
CREATE TABLE IF NOT EXISTS "buddies" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "user_id" uuid NOT NULL,
  "name" text,
  "species" text NOT NULL,
  "rarity" text NOT NULL,

  -- Birth imprint (immutable)
  "birth_trade_id" uuid NOT NULL,
  "birth_category" text NOT NULL,
  "birth_skills" jsonb NOT NULL,
  "birth_preset" text,
  "birth_saving_pct" numeric(8, 4),

  -- Growth stats
  "total_trades" integer NOT NULL DEFAULT 0,
  "deals" integer NOT NULL DEFAULT 0,
  "rejects" integer NOT NULL DEFAULT 0,
  "timeouts" integer NOT NULL DEFAULT 0,
  "walkaways" integer NOT NULL DEFAULT 0,
  "avg_saving_pct" numeric(8, 4),
  "best_saving_pct" numeric(8, 4),

  -- Passive ability (LEGENDARY+ only)
  "ability" jsonb,
  "ability_unlocked_at" timestamp with time zone,

  -- Buddy level
  "buddy_level" integer NOT NULL DEFAULT 1,
  "buddy_xp" integer NOT NULL DEFAULT 0,

  -- Awaken system
  "is_awakened" boolean NOT NULL DEFAULT false,
  "awakened_at" timestamp with time zone,
  "awaken_perks" jsonb,

  -- Meta
  "status" text NOT NULL DEFAULT 'EGG',
  "hatched_at" timestamp with time zone,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL
);

CREATE INDEX IF NOT EXISTS "buddies_user_id_idx" ON "buddies" ("user_id");
CREATE INDEX IF NOT EXISTS "buddies_species_idx" ON "buddies" ("species");
CREATE INDEX IF NOT EXISTS "buddies_rarity_idx" ON "buddies" ("rarity");
CREATE INDEX IF NOT EXISTS "buddies_status_idx" ON "buddies" ("status");

-- buddy_trades: per-buddy trade history
CREATE TABLE IF NOT EXISTS "buddy_trades" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "buddy_id" uuid NOT NULL,
  "session_id" uuid NOT NULL,
  "category" text NOT NULL,
  "skills_used" jsonb,
  "preset_used" text,
  "outcome" text NOT NULL,
  "saving_pct" numeric(8, 4),
  "rounds" integer,
  "opponent_pattern" text,
  "tactic_used" text,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL
);

CREATE INDEX IF NOT EXISTS "buddy_trades_buddy_id_idx" ON "buddy_trades" ("buddy_id");
CREATE INDEX IF NOT EXISTS "buddy_trades_category_idx" ON "buddy_trades" ("category");
CREATE INDEX IF NOT EXISTS "buddy_trades_outcome_idx" ON "buddy_trades" ("outcome");

-- agent_levels: user-wide XP + level + stats
CREATE TABLE IF NOT EXISTS "agent_levels" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "user_id" uuid NOT NULL,
  "level" integer NOT NULL DEFAULT 1,
  "xp" integer NOT NULL DEFAULT 0,
  "total_trades" integer NOT NULL DEFAULT 0,
  "total_deals" integer NOT NULL DEFAULT 0,
  "total_volume" numeric(18, 2) NOT NULL DEFAULT 0,
  "total_saved" numeric(18, 2) NOT NULL DEFAULT 0,
  "avg_saving_pct" numeric(8, 4) NOT NULL DEFAULT 0,
  "best_saving_pct" numeric(8, 4) NOT NULL DEFAULT 0,
  "consecutive_deals" integer NOT NULL DEFAULT 0,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL
);

CREATE UNIQUE INDEX IF NOT EXISTS "agent_levels_user_id_idx" ON "agent_levels" ("user_id");
CREATE INDEX IF NOT EXISTS "agent_levels_level_desc_idx" ON "agent_levels" ("level" DESC);
CREATE INDEX IF NOT EXISTS "agent_levels_total_volume_idx" ON "agent_levels" ("total_volume" DESC);

-- Add gamification columns to negotiation_sessions
ALTER TABLE "negotiation_sessions" ADD COLUMN IF NOT EXISTS "preset_id" uuid;
ALTER TABLE "negotiation_sessions" ADD COLUMN IF NOT EXISTS "buddy_id" uuid;
ALTER TABLE "negotiation_sessions" ADD COLUMN IF NOT EXISTS "skills_used" jsonb;

-- Seed system presets
INSERT INTO "skill_presets" ("name", "display_name", "description", "advisor_skill_id", "advisor_config", "is_system")
VALUES
  ('lowest_price', '⚡ 최저가 우선', '가격 절약을 최우선으로 하는 공격적 전략. 큰 폭의 역제안과 앵커링 기법을 적극 활용합니다.', 'faratin-coaching-v1', '{"buddyStyle": "aggressive"}', true),
  ('balanced', '⚖️ 균형 전략', '가격 절약과 거래 성사 확률의 균형을 맞추는 표준 전략. 대부분의 거래에 적합합니다.', 'faratin-coaching-v1', '{"buddyStyle": "balanced"}', true),
  ('safe_first', '🛡️ 안전 우선', '거래 성사를 최우선으로 하는 보수적 전략. 작은 폭의 역제안과 협조적 톤을 사용합니다.', 'faratin-coaching-v1', '{"buddyStyle": "defensive"}', true)
ON CONFLICT DO NOTHING;
