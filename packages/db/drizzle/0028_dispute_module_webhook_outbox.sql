CREATE TABLE IF NOT EXISTS dispute_module_webhook_outbox (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  event_id text NOT NULL,
  platform_id text NOT NULL,
  external_order_id text NOT NULL,
  dispute_id uuid NOT NULL,
  event_type text NOT NULL,
  payload jsonb NOT NULL,
  status text NOT NULL DEFAULT 'PENDING',
  attempt_count integer NOT NULL DEFAULT 0,
  next_attempt_at timestamptz NOT NULL DEFAULT now(),
  last_error text,
  delivered_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS dispute_module_webhook_outbox_event_id_unique
  ON dispute_module_webhook_outbox (event_id);

CREATE INDEX IF NOT EXISTS dispute_module_webhook_outbox_pending_idx
  ON dispute_module_webhook_outbox (status, next_attempt_at);
