-- 0027 — Slice 4a: clarify the per-listing agent column + add provenance.
-- See agent-builder-unified-design.html (v3) and the agent-builder slices.

-- Rename the per-listing agent state column: "draft" was confusing because the
-- same value lives on a published listing too. It is the frozen snapshot the
-- negotiation runs off. (strategy_config → negotiation_agent_draft (0026) → snapshot)
ALTER TABLE listing_drafts RENAME COLUMN negotiation_agent_draft TO negotiation_agent_snapshot;

-- Provenance / analytics: which agent this listing's snapshot came from.
-- Holds either a negotiation_agents row id (custom agent) or a preset id
-- (e.g. "balancer"). Not a DB FK because it stores both shapes.
ALTER TABLE listing_drafts ADD COLUMN IF NOT EXISTS agent_id text;
