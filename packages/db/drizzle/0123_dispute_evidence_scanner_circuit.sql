CREATE TABLE IF NOT EXISTS "dispute_evidence_scanner_circuits" (
  "circuit_key" varchar(80) PRIMARY KEY,
  "state" varchar(16) NOT NULL DEFAULT 'CLOSED',
  "consecutive_failures" integer NOT NULL DEFAULT 0,
  "next_probe_at" timestamptz,
  "probe_token" uuid,
  "probe_expires_at" timestamptz,
  "last_success_at" timestamptz,
  "last_failure_at" timestamptz,
  "created_at" timestamptz NOT NULL DEFAULT now(),
  "updated_at" timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS "dispute_evidence_scanner_permits" (
  "permit_id" uuid PRIMARY KEY,
  "circuit_key" varchar(80) NOT NULL REFERENCES
    "dispute_evidence_scanner_circuits" ("circuit_key") ON DELETE CASCADE,
  "permit_kind" varchar(16) NOT NULL,
  "acquired_at" timestamptz NOT NULL,
  "expires_at" timestamptz NOT NULL
);

CREATE INDEX IF NOT EXISTS "dispute_evidence_scanner_permits_live_idx"
  ON "dispute_evidence_scanner_permits" ("circuit_key", "expires_at");
