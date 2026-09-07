-- F2: per-evidence content_hash + anchor_status (UI badge foundation).
-- Append-only dispute_evidence: status is stamped at insert as HASHED.
-- PENDING_CHAIN / ANCHORED reserved for follow-up chain submit (no TX this ticket).
-- Resolve-time DisputeRegistry anchoring remains unchanged.

ALTER TABLE "dispute_evidence"
  ADD COLUMN IF NOT EXISTS "content_hash" text;
--> statement-breakpoint
ALTER TABLE "dispute_evidence"
  ADD COLUMN IF NOT EXISTS "anchor_status" text;
--> statement-breakpoint
ALTER TABLE "dispute_evidence"
  DROP CONSTRAINT IF EXISTS "dispute_evidence_content_hash_check";
--> statement-breakpoint
ALTER TABLE "dispute_evidence"
  ADD CONSTRAINT "dispute_evidence_content_hash_check" CHECK (
    "content_hash" IS NULL OR "content_hash" ~ '^[0-9a-f]{64}$'
  );
--> statement-breakpoint
ALTER TABLE "dispute_evidence"
  DROP CONSTRAINT IF EXISTS "dispute_evidence_anchor_status_check";
--> statement-breakpoint
ALTER TABLE "dispute_evidence"
  ADD CONSTRAINT "dispute_evidence_anchor_status_check" CHECK (
    "anchor_status" IS NULL
    OR "anchor_status" IN ('HASHED', 'PENDING_CHAIN', 'ANCHORED')
  );
--> statement-breakpoint
ALTER TABLE "dispute_evidence"
  DROP CONSTRAINT IF EXISTS "dispute_evidence_hash_anchor_pair_check";
--> statement-breakpoint
ALTER TABLE "dispute_evidence"
  ADD CONSTRAINT "dispute_evidence_hash_anchor_pair_check" CHECK (
    ("anchor_status" IS NULL AND "content_hash" IS NULL)
    OR ("anchor_status" IS NOT NULL AND "content_hash" IS NOT NULL)
  );
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "dispute_evidence_anchor_status_idx"
  ON "dispute_evidence" ("anchor_status");
