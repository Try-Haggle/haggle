-- ────────────────────────────────────────────────────────────────
-- 0010: Pity ceiling columns for agent_levels
-- Dual pity system: volume-based OR quality-trade-count, whichever first
-- Resets when the corresponding rarity is obtained
-- ────────────────────────────────────────────────────────────────

ALTER TABLE "agent_levels" ADD COLUMN IF NOT EXISTS "pity_volume_epic" numeric(18, 2) NOT NULL DEFAULT 0;
ALTER TABLE "agent_levels" ADD COLUMN IF NOT EXISTS "pity_trades_epic" integer NOT NULL DEFAULT 0;
ALTER TABLE "agent_levels" ADD COLUMN IF NOT EXISTS "pity_volume_legendary" numeric(18, 2) NOT NULL DEFAULT 0;
ALTER TABLE "agent_levels" ADD COLUMN IF NOT EXISTS "pity_trades_legendary" integer NOT NULL DEFAULT 0;
