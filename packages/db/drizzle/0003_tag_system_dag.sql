-- 0003_tag_system_dag.sql
-- Step 49: Tag System DAG Schema + IDF Extension

-- Extend tags table
ALTER TABLE tags
  ADD COLUMN IF NOT EXISTS idf NUMERIC(8,4) NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS created_by TEXT NOT NULL DEFAULT 'USER',
  ADD COLUMN IF NOT EXISTS aliases TEXT[] NOT NULL DEFAULT '{}';

-- DAG edges
CREATE TABLE IF NOT EXISTS tag_edges (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  parent_tag_id UUID NOT NULL,
  child_tag_id UUID NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT tag_edges_unique UNIQUE (parent_tag_id, child_tag_id)
);
CREATE INDEX IF NOT EXISTS tag_edges_parent_idx ON tag_edges(parent_tag_id);
CREATE INDEX IF NOT EXISTS tag_edges_child_idx ON tag_edges(child_tag_id);

-- Tag suggestions queue
CREATE TABLE IF NOT EXISTS tag_suggestions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  label TEXT NOT NULL,
  normalized_label TEXT NOT NULL,
  suggested_by TEXT NOT NULL,
  first_seen_listing_id UUID,
  occurrence_count INTEGER NOT NULL DEFAULT 1,
  status TEXT NOT NULL DEFAULT 'PENDING',
  merged_into_tag_id UUID,
  reviewed_by UUID,
  reviewed_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT tag_suggestions_normalized_unique UNIQUE (normalized_label)
);
CREATE INDEX IF NOT EXISTS tag_suggestions_status_idx ON tag_suggestions(status);

-- LLM placement cache
CREATE TABLE IF NOT EXISTS tag_placement_cache (
  cache_key TEXT PRIMARY KEY,
  selected_tag_ids TEXT[] NOT NULL,
  reasoning TEXT,
  missing_tags TEXT[] NOT NULL DEFAULT '{}',
  model_version TEXT NOT NULL,
  hit_count INTEGER NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  last_used_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
