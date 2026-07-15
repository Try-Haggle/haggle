CREATE UNIQUE INDEX IF NOT EXISTS "payment_operation_idem_in_progress_intent_unique"
  ON "payment_operation_idempotency" ("payment_intent_id")
  WHERE "payment_intent_id" IS NOT NULL
    AND "response_status" = 409
    AND "response_body"->>'error' = 'PAYMENT_OPERATION_IN_PROGRESS';
