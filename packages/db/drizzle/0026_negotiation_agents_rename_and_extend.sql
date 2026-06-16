-- Phase 1 — Negotiation Agent terminology + schema extensions
-- See .claude/worktrees/negotiation-agent-rebuild-plan-2026-05-28.md

-- Table + column renames (skill_presets is the historic name).
ALTER TABLE skill_presets RENAME TO negotiation_agents;
ALTER TABLE negotiation_agents RENAME COLUMN advisor_config TO negotiation_agent_config;

ALTER INDEX skill_presets_name_idx RENAME TO negotiation_agents_name_idx;
ALTER INDEX skill_presets_is_system_idx RENAME TO negotiation_agents_is_system_idx;
ALTER INDEX skill_presets_user_id_idx RENAME TO negotiation_agents_user_id_idx;
ALTER INDEX skill_presets_pkey RENAME TO negotiation_agents_pkey;

-- Listing draft's per-listing agent state (was strategy_config).
ALTER TABLE listing_drafts RENAME COLUMN strategy_config TO negotiation_agent_draft;

-- Per-session frozen agent snapshot (was strategy_snapshot) in the three
-- tables that snapshot the agent at point-in-time.
ALTER TABLE negotiation_sessions
  RENAME COLUMN strategy_snapshot TO negotiation_agent_snapshot;
ALTER TABLE waiting_intents
  RENAME COLUMN strategy_snapshot TO negotiation_agent_snapshot;
ALTER TABLE negotiation_escalations
  RENAME COLUMN strategy_snapshot TO negotiation_agent_snapshot;

-- New: agent role (buyer-only / seller-only / both). Used by /negotiations/agents
-- list endpoints to filter the right surface (/sell/agents vs /buy/agents).
ALTER TABLE negotiation_agents
  ADD COLUMN role text NOT NULL DEFAULT 'both'
    CHECK (role IN ('buyer', 'seller', 'both'));
CREATE INDEX negotiation_agents_role_idx ON negotiation_agents (role);

-- MCP guest publish flow reuses the existing `listing_drafts.claim_token`
-- column — Phase 7 does not introduce a parallel pending_owner_token.
