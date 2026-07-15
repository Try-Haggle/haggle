CREATE TABLE IF NOT EXISTS "shipment_apv_invoice_restoration_remediation_acknowledgments" (
  "id" uuid PRIMARY KEY NOT NULL,
  "client_request_id" uuid NOT NULL,
  "remediation_request_id" uuid NOT NULL
    REFERENCES "shipment_apv_invoice_restoration_remediation_requests"("id") ON DELETE CASCADE,
  "checker_id" uuid NOT NULL,
  "decision_request_id" uuid NOT NULL,
  "request_version" integer NOT NULL,
  "action" text NOT NULL,
  "incident_reference_hash" text,
  "created_at" timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT "shipment_apv_invoice_restore_remediation_ack_action_check"
    CHECK ("action" IN ('ACKNOWLEDGED', 'INCIDENT_LINKED')),
  CONSTRAINT "shipment_apv_invoice_restore_remediation_ack_incident_check" CHECK (
    ("action" = 'ACKNOWLEDGED' AND "incident_reference_hash" IS NULL)
    OR ("action" = 'INCIDENT_LINKED' AND "incident_reference_hash" ~ '^[0-9a-f]{64}$')
  ),
  CONSTRAINT "shipment_apv_invoice_restore_remediation_ack_version_check"
    CHECK ("request_version" >= 1)
);

CREATE UNIQUE INDEX IF NOT EXISTS "shipment_apv_invoice_restore_remediation_ack_client_unique"
  ON "shipment_apv_invoice_restoration_remediation_acknowledgments" ("client_request_id");
CREATE UNIQUE INDEX IF NOT EXISTS "shipment_apv_invoice_restore_remediation_ack_action_unique"
  ON "shipment_apv_invoice_restoration_remediation_acknowledgments"
    ("remediation_request_id", "checker_id", "request_version", "action");
CREATE INDEX IF NOT EXISTS "shipment_apv_invoice_restore_remediation_ack_timeline_idx"
  ON "shipment_apv_invoice_restoration_remediation_acknowledgments"
    ("remediation_request_id", "created_at", "id");
