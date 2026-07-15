CREATE TABLE IF NOT EXISTS "shipment_apv_payout_cancellation_requests" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "client_request_id" uuid NOT NULL,
  "payout_offset_id" uuid NOT NULL REFERENCES "shipment_apv_payout_offsets"("id"),
  "settlement_release_id" uuid NOT NULL,
  "requester_id" uuid NOT NULL,
  "reason" text NOT NULL,
  "status" text DEFAULT 'PENDING' NOT NULL,
  "version" integer DEFAULT 0 NOT NULL,
  "expires_at" timestamp with time zone NOT NULL,
  "approver_id" uuid,
  "decision_request_id" uuid,
  "decision_reason" text,
  "onchain_state" text,
  "decided_at" timestamp with time zone,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL,
  CONSTRAINT "shipment_apv_payout_cancel_request_status_check"
    CHECK ("status" IN ('PENDING', 'APPROVED', 'REJECTED', 'EXPIRED')),
  CONSTRAINT "shipment_apv_payout_cancel_request_reason_check"
    CHECK (char_length("reason") BETWEEN 12 AND 500),
  CONSTRAINT "shipment_apv_payout_cancel_request_decision_check" CHECK (
    ("status" = 'PENDING' AND "approver_id" IS NULL AND "decided_at" IS NULL)
    OR
    ("status" = 'EXPIRED' AND "approver_id" IS NULL AND "decision_reason" IS NOT NULL AND "decided_at" IS NOT NULL)
    OR
    ("status" IN ('APPROVED', 'REJECTED') AND "approver_id" IS NOT NULL AND "decision_reason" IS NOT NULL AND "decided_at" IS NOT NULL)
  )
);

CREATE UNIQUE INDEX IF NOT EXISTS "shipment_apv_payout_cancel_request_client_unique"
  ON "shipment_apv_payout_cancellation_requests" ("client_request_id");
CREATE UNIQUE INDEX IF NOT EXISTS "shipment_apv_payout_cancel_request_decision_unique"
  ON "shipment_apv_payout_cancellation_requests" ("decision_request_id");
CREATE UNIQUE INDEX IF NOT EXISTS "shipment_apv_payout_cancel_request_active_offset_unique"
  ON "shipment_apv_payout_cancellation_requests" ("payout_offset_id") WHERE "status" = 'PENDING';
CREATE INDEX IF NOT EXISTS "shipment_apv_payout_cancel_request_pending_idx"
  ON "shipment_apv_payout_cancellation_requests" ("status", "expires_at", "created_at");
