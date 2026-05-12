CREATE UNIQUE INDEX IF NOT EXISTS dispute_cases_active_order_uidx
  ON dispute_cases (order_id)
  WHERE status NOT IN (
    'RESOLVED_BUYER_FAVOR',
    'RESOLVED_SELLER_FAVOR',
    'PARTIAL_REFUND',
    'CLOSED'
  );
