CREATE TABLE IF NOT EXISTS "dispute_evidence_provenance_archive_outbox" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "archive_key" text NOT NULL,
  "evidence_id" uuid NOT NULL,
  "dispute_id" uuid NOT NULL,
  "payload" jsonb NOT NULL,
  "payload_sha256" text NOT NULL,
  "status" text DEFAULT 'PENDING' NOT NULL,
  "attempt_count" integer DEFAULT 0 NOT NULL,
  "next_attempt_at" timestamp with time zone DEFAULT now() NOT NULL,
  "lease_token" uuid,
  "lease_expires_at" timestamp with time zone,
  "last_error" text,
  "http_status" integer,
  "receipt_id" text,
  "receipt_sha256" text,
  "delivered_at" timestamp with time zone,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL,
  CONSTRAINT "dispute_evidence_provenance_archive_status_check" CHECK
    ("status" IN ('PENDING', 'PROCESSING', 'DELIVERED', 'FAILED', 'DEAD_LETTER')),
  CONSTRAINT "dispute_evidence_provenance_archive_payload_hash_check" CHECK
    ("payload_sha256" ~ '^[0-9a-f]{64}$'),
  CONSTRAINT "dispute_evidence_provenance_archive_receipt_hash_check" CHECK
    ("receipt_sha256" IS NULL OR "receipt_sha256" ~ '^[0-9a-f]{64}$'),
  CONSTRAINT "dispute_evidence_provenance_archive_payload_size_check" CHECK
    (octet_length("payload"::text) <= 131072),
  CONSTRAINT "dispute_evidence_provenance_archive_delivery_check" CHECK (
    ("status" = 'DELIVERED' AND "delivered_at" IS NOT NULL AND "receipt_id" IS NOT NULL
      AND "receipt_sha256" = "payload_sha256")
    OR ("status" <> 'DELIVERED' AND "delivered_at" IS NULL)
  )
);

CREATE UNIQUE INDEX IF NOT EXISTS "dispute_evidence_provenance_archive_key_unique"
  ON "dispute_evidence_provenance_archive_outbox" ("archive_key");
CREATE INDEX IF NOT EXISTS "dispute_evidence_provenance_archive_evidence_idx"
  ON "dispute_evidence_provenance_archive_outbox" ("evidence_id", "created_at");
CREATE INDEX IF NOT EXISTS "dispute_evidence_provenance_archive_due_idx"
  ON "dispute_evidence_provenance_archive_outbox" ("status", "next_attempt_at");

CREATE OR REPLACE FUNCTION protect_dispute_evidence_provenance_archive_payload()
RETURNS trigger AS $$
BEGIN
  IF NEW.archive_key IS DISTINCT FROM OLD.archive_key
    OR NEW.evidence_id IS DISTINCT FROM OLD.evidence_id
    OR NEW.dispute_id IS DISTINCT FROM OLD.dispute_id
    OR NEW.payload IS DISTINCT FROM OLD.payload
    OR NEW.payload_sha256 IS DISTINCT FROM OLD.payload_sha256
    OR NEW.created_at IS DISTINCT FROM OLD.created_at THEN
    RAISE EXCEPTION 'dispute evidence provenance archive payload is immutable';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS dispute_evidence_provenance_archive_payload_immutable
  ON "dispute_evidence_provenance_archive_outbox";
CREATE TRIGGER dispute_evidence_provenance_archive_payload_immutable
  BEFORE UPDATE ON "dispute_evidence_provenance_archive_outbox"
  FOR EACH ROW EXECUTE FUNCTION protect_dispute_evidence_provenance_archive_payload();
