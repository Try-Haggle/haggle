CREATE TABLE IF NOT EXISTS "dispute_cases" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "order_id" uuid NOT NULL,
  "reason_code" text NOT NULL,
  "status" text NOT NULL DEFAULT 'OPEN',
  "opened_by" text NOT NULL,
  "opened_at" timestamp with time zone DEFAULT now() NOT NULL,
  "resolution_summary" text,
  "metadata" jsonb,
  "resolved_at" timestamp with time zone,
  "closed_at" timestamp with time zone,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL
);

CREATE TABLE IF NOT EXISTS "dispute_evidence" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "dispute_id" uuid NOT NULL,
  "submitted_by" text NOT NULL,
  "type" text NOT NULL,
  "uri" text,
  "text" text,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL
);

CREATE TABLE IF NOT EXISTS "dispute_resolutions" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "dispute_id" uuid NOT NULL,
  "outcome" text NOT NULL,
  "summary" text NOT NULL,
  "refund_amount_minor" numeric(18, 0),
  "resolved_at" timestamp with time zone,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL
);

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'chk_dispute_cases_status'
  ) THEN
    ALTER TABLE "dispute_cases"
      ADD CONSTRAINT "chk_dispute_cases_status"
      CHECK ("status" IN (
        'OPEN',
        'UNDER_REVIEW',
        'WAITING_FOR_BUYER',
        'WAITING_FOR_SELLER',
        'RESOLVED_BUYER_FAVOR',
        'RESOLVED_SELLER_FAVOR',
        'PARTIAL_REFUND',
        'CLOSED'
      ));
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'chk_dispute_cases_opened_by'
  ) THEN
    ALTER TABLE "dispute_cases"
      ADD CONSTRAINT "chk_dispute_cases_opened_by"
      CHECK ("opened_by" IN ('buyer', 'seller', 'system'));
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'chk_dispute_evidence_submitted_by'
  ) THEN
    ALTER TABLE "dispute_evidence"
      ADD CONSTRAINT "chk_dispute_evidence_submitted_by"
      CHECK ("submitted_by" IN ('buyer', 'seller', 'system'));
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'chk_dispute_evidence_type'
  ) THEN
    ALTER TABLE "dispute_evidence"
      ADD CONSTRAINT "chk_dispute_evidence_type"
      CHECK ("type" IN ('text', 'image', 'video', 'tracking_snapshot', 'payment_proof', 'other'));
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'chk_dispute_resolutions_outcome'
  ) THEN
    ALTER TABLE "dispute_resolutions"
      ADD CONSTRAINT "chk_dispute_resolutions_outcome"
      CHECK ("outcome" IN ('buyer_favor', 'seller_favor', 'partial_refund', 'no_action'));
  END IF;
END $$;

CREATE UNIQUE INDEX IF NOT EXISTS "dispute_resolutions_dispute_id_unique"
  ON "dispute_resolutions" ("dispute_id");

CREATE INDEX IF NOT EXISTS "idx_dispute_cases_order_id"
  ON "dispute_cases" ("order_id");

CREATE INDEX IF NOT EXISTS "idx_dispute_cases_order_status"
  ON "dispute_cases" ("order_id", "status");

CREATE INDEX IF NOT EXISTS "idx_dispute_evidence_dispute_id"
  ON "dispute_evidence" ("dispute_id");

CREATE INDEX IF NOT EXISTS "idx_dispute_resolutions_dispute_id"
  ON "dispute_resolutions" ("dispute_id");

CREATE UNIQUE INDEX IF NOT EXISTS dispute_cases_active_order_uidx
  ON dispute_cases (order_id)
  WHERE status NOT IN (
    'RESOLVED_BUYER_FAVOR',
    'RESOLVED_SELLER_FAVOR',
    'PARTIAL_REFUND',
    'CLOSED'
  );
