CREATE TABLE IF NOT EXISTS "shipment_apv_payout_cancellation_events" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "cancellation_request_id" uuid NOT NULL
    REFERENCES "shipment_apv_payout_cancellation_requests"("id") ON DELETE CASCADE,
  "event_type" text NOT NULL,
  "actor_id" uuid,
  "request_version" integer NOT NULL,
  "metadata" jsonb DEFAULT '{}'::jsonb NOT NULL,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  CONSTRAINT "shipment_apv_payout_cancel_event_type_check"
    CHECK ("event_type" IN ('REQUESTED', 'APPROVED', 'REJECTED', 'EXPIRED')),
  CONSTRAINT "shipment_apv_payout_cancel_event_actor_check" CHECK (
    ("event_type" = 'EXPIRED' AND "actor_id" IS NULL)
    OR ("event_type" IN ('REQUESTED', 'APPROVED', 'REJECTED') AND "actor_id" IS NOT NULL)
  )
);

CREATE UNIQUE INDEX IF NOT EXISTS "shipment_apv_payout_cancel_event_transition_unique"
  ON "shipment_apv_payout_cancellation_events"
    ("cancellation_request_id", "event_type", "request_version");
CREATE INDEX IF NOT EXISTS "shipment_apv_payout_cancel_event_timeline_idx"
  ON "shipment_apv_payout_cancellation_events" ("cancellation_request_id", "created_at", "id");
