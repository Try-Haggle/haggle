-- Promote the first four dispute evidence operational tables into the Drizzle
-- model and add missing transaction-ledger relationships. The tables already
-- exist from historical migrations, so this migration only strengthens links.
--
-- NOT VALID protects deployment from unknown historical orphans while still
-- enforcing every new write. Run `pnpm db:audit:relations`, repair any orphans,
-- then validate the constraints in a follow-up migration.

DO $$
DECLARE
  relation record;
BEGIN
  FOR relation IN
    SELECT * FROM (VALUES
      ('settlement_releases_payment_intent_id_fkey', 'settlement_releases', 'payment_intent_id', 'payment_intents', 'id'),
      ('settlement_releases_order_id_fkey', 'settlement_releases', 'order_id', 'commerce_orders', 'id'),
      ('agent_payment_grants_order_id_fkey', 'agent_payment_grants', 'order_id', 'commerce_orders', 'id'),
      ('agent_payment_grants_settlement_approval_id_fkey', 'agent_payment_grants', 'settlement_approval_id', 'settlement_approvals', 'id'),
      ('payment_intents_agent_payment_grant_id_fkey', 'payment_intents', 'agent_payment_grant_id', 'agent_payment_grants', 'id'),
      ('payment_disclosures_agent_payment_grant_id_fkey', 'payment_disclosures', 'agent_payment_grant_id', 'agent_payment_grants', 'id'),
      ('payment_disclosures_payment_intent_id_fkey', 'payment_disclosures', 'payment_intent_id', 'payment_intents', 'id'),
      ('shipment_apv_adjustments_shipment_id_fkey', 'shipment_apv_adjustments', 'shipment_id', 'shipments', 'id'),
      ('shipment_apv_adjustments_order_id_fkey', 'shipment_apv_adjustments', 'order_id', 'commerce_orders', 'id'),
      ('shipment_apv_adjustments_settlement_release_id_fkey', 'shipment_apv_adjustments', 'settlement_release_id', 'settlement_releases', 'id'),
      ('shipment_apv_payout_offsets_settlement_release_id_fkey', 'shipment_apv_payout_offsets', 'settlement_release_id', 'settlement_releases', 'id'),
      ('shipment_apv_payout_offsets_order_id_fkey', 'shipment_apv_payout_offsets', 'order_id', 'commerce_orders', 'id'),
      ('shipment_apv_seller_liabilities_source_release_id_fkey', 'shipment_apv_seller_liabilities', 'source_settlement_release_id', 'settlement_releases', 'id'),
      ('shipment_apv_seller_liabilities_source_order_id_fkey', 'shipment_apv_seller_liabilities', 'source_order_id', 'commerce_orders', 'id'),
      ('shipment_apv_cancel_requests_settlement_release_id_fkey', 'shipment_apv_payout_cancellation_requests', 'settlement_release_id', 'settlement_releases', 'id'),
      ('shipment_apv_cancel_audit_outbox_request_id_fkey', 'shipment_apv_payout_cancellation_audit_outbox', 'cancellation_request_id', 'shipment_apv_payout_cancellation_requests', 'id')
    ) AS expected(constraint_name, child_table, child_column, parent_table, parent_column)
  LOOP
    IF EXISTS (
      SELECT 1
      FROM pg_constraint constraint_row
      WHERE constraint_row.conname = relation.constraint_name
        AND constraint_row.conrelid = to_regclass(format('public.%I', relation.child_table))
        AND constraint_row.contype = 'f'
        AND array_length(constraint_row.conkey, 1) = 1
        AND array_length(constraint_row.confkey, 1) = 1
        AND constraint_row.confrelid = to_regclass(format('public.%I', relation.parent_table))
        AND constraint_row.confdeltype = 'a'
        AND constraint_row.confupdtype = 'a'
        AND (
          SELECT attribute.attname
          FROM pg_attribute attribute
          WHERE attribute.attrelid = constraint_row.conrelid
            AND attribute.attnum = constraint_row.conkey[1]
        ) = relation.child_column
        AND (
          SELECT attribute.attname
          FROM pg_attribute attribute
          WHERE attribute.attrelid = constraint_row.confrelid
            AND attribute.attnum = constraint_row.confkey[1]
        ) = relation.parent_column
    ) THEN
      CONTINUE;
    END IF;

    IF EXISTS (
      SELECT 1
      FROM pg_constraint
      WHERE conname = relation.constraint_name
        AND conrelid = to_regclass(format('public.%I', relation.child_table))
    ) THEN
      RAISE EXCEPTION 'constraint % exists with an unexpected definition', relation.constraint_name;
    ELSE
      EXECUTE format(
        'ALTER TABLE public.%I ADD CONSTRAINT %I FOREIGN KEY (%I) REFERENCES public.%I (%I) ON DELETE NO ACTION ON UPDATE NO ACTION NOT VALID',
        relation.child_table,
        relation.constraint_name,
        relation.child_column,
        relation.parent_table,
        relation.parent_column
      );
    END IF;
  END LOOP;
END $$;

CREATE INDEX IF NOT EXISTS "settlement_releases_payment_intent_idx"
  ON "settlement_releases" ("payment_intent_id");
CREATE INDEX IF NOT EXISTS "agent_payment_grants_order_id_idx"
  ON "agent_payment_grants" ("order_id");
CREATE INDEX IF NOT EXISTS "agent_payment_grants_settlement_approval_id_idx"
  ON "agent_payment_grants" ("settlement_approval_id");
CREATE INDEX IF NOT EXISTS "shipment_apv_adjustments_order_id_idx"
  ON "shipment_apv_adjustments" ("order_id");
CREATE INDEX IF NOT EXISTS "shipment_apv_adjustments_settlement_release_id_idx"
  ON "shipment_apv_adjustments" ("settlement_release_id");
CREATE INDEX IF NOT EXISTS "shipment_apv_seller_liabilities_source_order_id_idx"
  ON "shipment_apv_seller_liabilities" ("source_order_id");
CREATE INDEX IF NOT EXISTS "shipment_apv_cancel_requests_settlement_release_id_idx"
  ON "shipment_apv_payout_cancellation_requests" ("settlement_release_id");
