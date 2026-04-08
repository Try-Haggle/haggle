-- Step 55: Admin ops tables
-- tag_promotion_rules: per-category auto-promotion thresholds
-- admin_action_log: append-only audit log for all admin mutations

CREATE TABLE IF NOT EXISTS tag_promotion_rules (
  id                            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  category                      text NOT NULL,
  candidate_min_use             integer NOT NULL,
  emerging_min_use              integer NOT NULL,
  candidate_min_age_days        integer NOT NULL DEFAULT 0,
  emerging_min_age_days         integer NOT NULL DEFAULT 7,
  suggestion_auto_promote_count integer NOT NULL,
  enabled                       boolean NOT NULL DEFAULT true,
  updated_by                    uuid,
  created_at                    timestamptz NOT NULL DEFAULT now(),
  updated_at                    timestamptz NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS tag_promotion_rules_category_uq
  ON tag_promotion_rules (category);

CREATE TABLE IF NOT EXISTS admin_action_log (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  actor_id    uuid NOT NULL,
  action_type text NOT NULL,
  target_type text,
  target_id   text,
  payload     jsonb,
  created_at  timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS admin_action_log_actor_idx
  ON admin_action_log (actor_id, created_at);
CREATE INDEX IF NOT EXISTS admin_action_log_action_idx
  ON admin_action_log (action_type, created_at);
CREATE INDEX IF NOT EXISTS admin_action_log_target_idx
  ON admin_action_log (target_type, target_id);

-- Seed default promotion rules (idempotent via ON CONFLICT)
INSERT INTO tag_promotion_rules
  (category, candidate_min_use, emerging_min_use,
   candidate_min_age_days, emerging_min_age_days,
   suggestion_auto_promote_count, enabled)
VALUES
  ('condition', 3, 15, 0, 7, 20, true),
  ('style',     5, 25, 0, 7, 25, true),
  ('size',      2, 10, 0, 7, 15, true),
  ('material',  3, 15, 0, 7, 20, true),
  ('default',   5, 20, 0, 7, 20, true)
ON CONFLICT (category) DO NOTHING;
