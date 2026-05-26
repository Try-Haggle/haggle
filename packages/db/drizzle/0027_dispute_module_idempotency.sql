CREATE TABLE IF NOT EXISTS dispute_module_idempotency_keys (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  platform_id text NOT NULL,
  idempotency_key text NOT NULL,
  request_fingerprint text NOT NULL,
  dispute_id uuid NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS dispute_module_idem_platform_key_unique
  ON dispute_module_idempotency_keys (platform_id, idempotency_key);
