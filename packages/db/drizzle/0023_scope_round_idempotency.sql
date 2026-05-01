DROP INDEX IF EXISTS negotiation_rounds_idempotency_key_idx;

CREATE UNIQUE INDEX IF NOT EXISTS negotiation_rounds_session_idempotency_key_idx
  ON negotiation_rounds (session_id, idempotency_key);
