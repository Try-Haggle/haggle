-- Step 95: DS Panel Voting — reviewer assignments & profiles

CREATE TABLE IF NOT EXISTS "reviewer_assignments" (
  "id"          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "dispute_id"  uuid NOT NULL,
  "reviewer_id" uuid NOT NULL,
  "slot_cost"   integer NOT NULL DEFAULT 1,
  "assigned_at" timestamptz NOT NULL DEFAULT now(),
  "vote_value"  integer,
  "vote_weight" numeric(4,2),
  "voted_at"    timestamptz,
  "reasoning"   text,
  CONSTRAINT "reviewer_assignments_dispute_reviewer_uniq"
    UNIQUE ("dispute_id", "reviewer_id")
);

CREATE TABLE IF NOT EXISTS "reviewer_profiles" (
  "user_id"              uuid PRIMARY KEY,
  "ds_score"             integer NOT NULL DEFAULT 0,
  "ds_tier"              text NOT NULL DEFAULT 'BRONZE',
  "vote_weight"          numeric(4,2) NOT NULL DEFAULT 0.63,
  "cases_reviewed"       integer NOT NULL DEFAULT 0,
  "zone_hit_rate"        numeric(4,3),
  "participation_rate"   numeric(4,3),
  "avg_response_hours"   numeric(6,1),
  "active_slots"         integer NOT NULL DEFAULT 0,
  "max_slots"            integer NOT NULL DEFAULT 3,
  "qualified"            boolean NOT NULL DEFAULT false,
  "qualified_at"         timestamptz,
  "qualify_score"        integer,
  "total_earnings_cents" integer NOT NULL DEFAULT 0,
  "created_at"           timestamptz NOT NULL DEFAULT now(),
  "updated_at"           timestamptz NOT NULL DEFAULT now()
);

-- Index for fast lookup of active assignments per reviewer
CREATE INDEX IF NOT EXISTS "idx_reviewer_assignments_reviewer"
  ON "reviewer_assignments" ("reviewer_id");

-- Index for fast lookup of all assignments per dispute
CREATE INDEX IF NOT EXISTS "idx_reviewer_assignments_dispute"
  ON "reviewer_assignments" ("dispute_id");

-- Index for qualified reviewer pool queries
CREATE INDEX IF NOT EXISTS "idx_reviewer_profiles_qualified"
  ON "reviewer_profiles" ("qualified", "active_slots", "max_slots");
