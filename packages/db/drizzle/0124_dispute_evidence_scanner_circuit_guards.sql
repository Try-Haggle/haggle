ALTER TABLE "dispute_evidence_scanner_circuits"
  DROP CONSTRAINT IF EXISTS "dispute_evidence_scanner_circuit_key_chk",
  DROP CONSTRAINT IF EXISTS "dispute_evidence_scanner_circuit_state_chk",
  DROP CONSTRAINT IF EXISTS "dispute_evidence_scanner_circuit_failure_chk",
  DROP CONSTRAINT IF EXISTS "dispute_evidence_scanner_circuit_shape_chk";

ALTER TABLE "dispute_evidence_scanner_circuits"
  ADD CONSTRAINT "dispute_evidence_scanner_circuit_key_chk"
    CHECK ("circuit_key" ~ '^[a-z0-9][a-z0-9._:-]{0,79}$'),
  ADD CONSTRAINT "dispute_evidence_scanner_circuit_state_chk"
    CHECK ("state" IN ('CLOSED', 'OPEN', 'HALF_OPEN')),
  ADD CONSTRAINT "dispute_evidence_scanner_circuit_failure_chk"
    CHECK ("consecutive_failures" BETWEEN 0 AND 1000),
  ADD CONSTRAINT "dispute_evidence_scanner_circuit_shape_chk"
    CHECK (
      ("state" = 'CLOSED' AND "next_probe_at" IS NULL
        AND "probe_token" IS NULL AND "probe_expires_at" IS NULL)
      OR
      ("state" = 'OPEN' AND "next_probe_at" IS NOT NULL
        AND "probe_token" IS NULL AND "probe_expires_at" IS NULL)
      OR
      ("state" = 'HALF_OPEN' AND "next_probe_at" IS NULL
        AND "probe_token" IS NOT NULL AND "probe_expires_at" IS NOT NULL)
    );

ALTER TABLE "dispute_evidence_scanner_permits"
  DROP CONSTRAINT IF EXISTS "dispute_evidence_scanner_permit_kind_chk",
  DROP CONSTRAINT IF EXISTS "dispute_evidence_scanner_permit_expiry_chk";

ALTER TABLE "dispute_evidence_scanner_permits"
  ADD CONSTRAINT "dispute_evidence_scanner_permit_kind_chk"
    CHECK ("permit_kind" IN ('REGULAR', 'PROBE')),
  ADD CONSTRAINT "dispute_evidence_scanner_permit_expiry_chk"
    CHECK (
      "expires_at" > "acquired_at"
      AND "expires_at" <= "acquired_at" + interval '5 minutes'
    );

CREATE OR REPLACE FUNCTION haggle_guard_dispute_evidence_scanner_permit()
RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE
  circuit_record "dispute_evidence_scanner_circuits"%ROWTYPE;
BEGIN
  IF TG_OP = 'UPDATE' THEN
    RAISE EXCEPTION 'scanner permits are immutable';
  END IF;

  SELECT * INTO circuit_record
    FROM "dispute_evidence_scanner_circuits"
   WHERE "circuit_key" = NEW."circuit_key"
   FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'scanner circuit does not exist';
  END IF;
  IF NEW."permit_kind" = 'PROBE' AND NOT (
    circuit_record."state" = 'HALF_OPEN'
    AND circuit_record."probe_token" = NEW."permit_id"
    AND circuit_record."probe_expires_at" = NEW."expires_at"
  ) THEN
    RAISE EXCEPTION 'scanner probe permit does not own half-open lease';
  END IF;
  IF NEW."permit_kind" = 'REGULAR'
    AND circuit_record."state" <> 'CLOSED' THEN
    RAISE EXCEPTION 'regular scanner permit requires a closed circuit';
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS dispute_evidence_scanner_permit_guard
  ON "dispute_evidence_scanner_permits";
CREATE TRIGGER dispute_evidence_scanner_permit_guard
  BEFORE INSERT OR UPDATE ON "dispute_evidence_scanner_permits"
  FOR EACH ROW EXECUTE FUNCTION haggle_guard_dispute_evidence_scanner_permit();
