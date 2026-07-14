CREATE TABLE IF NOT EXISTS "dispute_ai_audit_discovery_failures" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "dispute_id" uuid NOT NULL,
  "event_count" integer NOT NULL,
  "failure_code" text NOT NULL,
  "status" text DEFAULT 'OPEN' NOT NULL,
  "attempt_count" integer DEFAULT 1 NOT NULL,
  "first_failed_at" timestamp with time zone DEFAULT now() NOT NULL,
  "last_failed_at" timestamp with time zone DEFAULT now() NOT NULL,
  "resolved_at" timestamp with time zone,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL,
  CONSTRAINT "dispute_ai_audit_discovery_failure_event_count_check" CHECK ("event_count" > 0),
  CONSTRAINT "dispute_ai_audit_discovery_failure_code_check" CHECK ("failure_code" IN (
    'AI_AUDIT_ARCHIVE_TOO_LARGE', 'AI_AUDIT_CHAIN_INVALID', 'AI_AUDIT_CHAIN_UNSEALED', 'AI_AUDIT_ARCHIVE_UNEXPECTED'
  )),
  CONSTRAINT "dispute_ai_audit_discovery_failure_status_check" CHECK ("status" IN ('OPEN', 'RESOLVED')),
  CONSTRAINT "dispute_ai_audit_discovery_failure_attempt_check" CHECK ("attempt_count" > 0),
  CONSTRAINT "dispute_ai_audit_discovery_failure_resolution_check" CHECK (
    ("status" = 'OPEN' AND "resolved_at" IS NULL) OR ("status" = 'RESOLVED' AND "resolved_at" IS NOT NULL)
  )
);

CREATE UNIQUE INDEX IF NOT EXISTS "dispute_ai_audit_discovery_failure_version_unique"
  ON "dispute_ai_audit_discovery_failures" ("dispute_id", "event_count");
CREATE INDEX IF NOT EXISTS "dispute_ai_audit_discovery_failure_open_idx"
  ON "dispute_ai_audit_discovery_failures" ("status", "last_failed_at");
