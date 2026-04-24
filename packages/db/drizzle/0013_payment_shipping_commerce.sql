-- Step 70: Payment, Shipping, Commerce, and Dispute tables
-- Tables: payment_intents, payment_authorizations, payment_settlements, refunds,
--         payment_provider_capabilities, shipments, shipment_events,
--         settlement_approvals, commerce_orders, dispute_cases,
--         dispute_evidence, dispute_resolutions
--
-- Note: settlement_releases already exists in 0002_phase3_5_tables.sql (line 206).
--   It references payment_intent_id and order_id, but those tables are created HERE.
--   This is a known migration ordering inversion — safe due to no FK constraints in 0002.
--
-- Note: dispute_deposits already exists in 0002_phase3_5_tables.sql (line 48).

-- ============================================================
-- Commerce tables (created first — referenced by payment/shipping/dispute)
-- ============================================================

CREATE TABLE IF NOT EXISTS "settlement_approvals" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"listing_id" uuid NOT NULL,
	"seller_id" uuid NOT NULL,
	"buyer_id" uuid NOT NULL,
	"approval_state" text NOT NULL DEFAULT 'NEGOTIATING',
	"seller_approval_mode" text NOT NULL,
	"selected_payment_rail" text NOT NULL,
	"currency" text NOT NULL DEFAULT 'USD',
	"final_amount_minor" numeric(18, 0) NOT NULL,
	"hold_kind" text,
	"held_snapshot_price_minor" numeric(18, 0),
	"held_snapshot_utility" numeric(8, 4),
	"held_at" timestamp with time zone,
	"hold_reason" text,
	"resume_reprice_required" boolean NOT NULL DEFAULT true,
	"reserved_until" timestamp with time zone,
	"buyer_approved_at" timestamp with time zone,
	"seller_approved_at" timestamp with time zone,
	"shipment_input_due_at" timestamp with time zone,
	"terms_snapshot" jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "chk_settlement_approvals_state" CHECK (
		"approval_state" IN ('NEGOTIATING','MUTUALLY_ACCEPTABLE','HELD_BY_BUYER','RESERVED_PENDING_APPROVAL','AWAITING_SELLER_APPROVAL','APPROVED','DECLINED','EXPIRED')
	),
	CONSTRAINT "chk_settlement_approvals_rail" CHECK (
		"selected_payment_rail" IN ('x402','stripe')
	)
);

CREATE TABLE IF NOT EXISTS "commerce_orders" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"settlement_approval_id" uuid NOT NULL UNIQUE REFERENCES "settlement_approvals"("id"),
	"listing_id" uuid NOT NULL,
	"seller_id" uuid NOT NULL,
	"buyer_id" uuid NOT NULL,
	"status" text NOT NULL DEFAULT 'APPROVED',
	"currency" text NOT NULL DEFAULT 'USD',
	"amount_minor" numeric(18, 0) NOT NULL,
	"order_snapshot" jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "chk_commerce_orders_status" CHECK (
		"status" IN ('APPROVED','PAYMENT_PENDING','PAID','FULFILLMENT_PENDING','FULFILLMENT_ACTIVE','DELIVERED','IN_DISPUTE','REFUNDED','CLOSED','CANCELED')
	)
);

-- ============================================================
-- Payment tables
-- ============================================================

CREATE TABLE IF NOT EXISTS "payment_intents" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"order_id" uuid NOT NULL REFERENCES "commerce_orders"("id"),
	"seller_id" uuid NOT NULL,
	"buyer_id" uuid NOT NULL,
	"selected_rail" text NOT NULL,
	"allowed_rails" text[] NOT NULL DEFAULT '{x402,stripe}',
	"buyer_authorization_mode" text NOT NULL DEFAULT 'human_wallet',
	"currency" text NOT NULL DEFAULT 'USD',
	"amount_minor" numeric(18, 0) NOT NULL,
	"status" text NOT NULL DEFAULT 'CREATED',
	"provider_context" jsonb,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "chk_payment_intents_status" CHECK (
		"status" IN ('CREATED','QUOTED','AUTHORIZED','SETTLEMENT_PENDING','SETTLED','FAILED','CANCELED')
	),
	CONSTRAINT "chk_payment_intents_rail" CHECK (
		"selected_rail" IN ('x402','stripe')
	)
);

CREATE TABLE IF NOT EXISTS "payment_authorizations" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"payment_intent_id" uuid NOT NULL REFERENCES "payment_intents"("id"),
	"rail" text NOT NULL,
	"provider_reference" text NOT NULL,
	"authorized_amount_minor" numeric(18, 0) NOT NULL,
	"currency" text NOT NULL DEFAULT 'USD',
	"metadata" jsonb,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);

CREATE TABLE IF NOT EXISTS "payment_settlements" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"payment_intent_id" uuid NOT NULL REFERENCES "payment_intents"("id"),
	"rail" text NOT NULL,
	"provider_reference" text NOT NULL,
	"settled_amount_minor" numeric(18, 0) NOT NULL,
	"currency" text NOT NULL DEFAULT 'USD',
	"status" text NOT NULL DEFAULT 'PENDING',
	"settled_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "chk_payment_settlements_status" CHECK (
		"status" IN ('PENDING','SETTLED','FAILED')
	)
);

CREATE TABLE IF NOT EXISTS "refunds" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"payment_intent_id" uuid NOT NULL REFERENCES "payment_intents"("id"),
	"amount_minor" numeric(18, 0) NOT NULL,
	"currency" text NOT NULL DEFAULT 'USD',
	"reason_code" text NOT NULL,
	"status" text NOT NULL DEFAULT 'REQUESTED',
	"provider_reference" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "chk_refunds_status" CHECK (
		"status" IN ('REQUESTED','PENDING','COMPLETED','FAILED')
	)
);

CREATE TABLE IF NOT EXISTS "payment_provider_capabilities" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"rail" text NOT NULL,
	"provider" text NOT NULL,
	"supports_authorize" boolean NOT NULL DEFAULT true,
	"supports_capture" boolean NOT NULL DEFAULT true,
	"supports_refund" boolean NOT NULL DEFAULT true,
	"preferred" boolean NOT NULL DEFAULT false,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "uq_provider_capabilities_rail_provider" UNIQUE ("rail", "provider")
);

-- ============================================================
-- Shipping tables
-- ============================================================

CREATE TABLE IF NOT EXISTS "shipments" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"order_id" uuid NOT NULL REFERENCES "commerce_orders"("id"),
	"seller_id" uuid NOT NULL,
	"buyer_id" uuid NOT NULL,
	"status" text NOT NULL DEFAULT 'LABEL_PENDING',
	"carrier" text,
	"tracking_number" text,
	"label_created_at" timestamp with time zone,
	"shipped_at" timestamp with time zone,
	"delivered_at" timestamp with time zone,
	"shipment_input_due_at" timestamp with time zone,
	"shipping_fee_minor" numeric(18, 0),
	"currency" text NOT NULL DEFAULT 'USD',
	"declared_weight_oz" numeric(10, 2),
	"label_url" text,
	"rate_minor" numeric(18, 0),
	"metadata" jsonb,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "chk_shipments_status" CHECK (
		"status" IN ('LABEL_PENDING','LABEL_CREATED','IN_TRANSIT','OUT_FOR_DELIVERY','DELIVERED','DELIVERY_EXCEPTION','RETURN_IN_TRANSIT','RETURNED')
	),
	CONSTRAINT "chk_shipments_tracking" CHECK (
		"status" = 'LABEL_PENDING' OR ("carrier" IS NOT NULL AND "tracking_number" IS NOT NULL)
	)
);

CREATE TABLE IF NOT EXISTS "shipment_events" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"shipment_id" uuid NOT NULL REFERENCES "shipments"("id"),
	"event_type" text NOT NULL,
	"raw_status" text,
	"canonical_status" text NOT NULL,
	"payload" jsonb,
	"occurred_at" timestamp with time zone NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);

-- ============================================================
-- Dispute tables
-- ============================================================

CREATE TABLE IF NOT EXISTS "dispute_cases" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"order_id" uuid NOT NULL REFERENCES "commerce_orders"("id"),
	"reason_code" text NOT NULL,
	"status" text NOT NULL DEFAULT 'OPEN',
	"opened_by" text NOT NULL,
	"opened_at" timestamp with time zone DEFAULT now() NOT NULL,
	"resolution_summary" text,
	"metadata" jsonb,
	"resolved_at" timestamp with time zone,
	"closed_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "chk_dispute_cases_status" CHECK (
		"status" IN ('OPEN','UNDER_REVIEW','WAITING_FOR_BUYER','WAITING_FOR_SELLER','RESOLVED_BUYER_FAVOR','RESOLVED_SELLER_FAVOR','PARTIAL_REFUND','CLOSED')
	),
	CONSTRAINT "chk_dispute_cases_opened_by" CHECK (
		"opened_by" IN ('buyer','seller','system')
	)
);

CREATE TABLE IF NOT EXISTS "dispute_evidence" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"dispute_id" uuid NOT NULL REFERENCES "dispute_cases"("id"),
	"submitted_by" text NOT NULL,
	"type" text NOT NULL,
	"uri" text,
	"text" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "chk_dispute_evidence_submitted_by" CHECK (
		"submitted_by" IN ('buyer','seller','system')
	),
	CONSTRAINT "chk_dispute_evidence_type" CHECK (
		"type" IN ('text','image','tracking_snapshot','payment_proof','other')
	)
);

CREATE TABLE IF NOT EXISTS "dispute_resolutions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"dispute_id" uuid NOT NULL UNIQUE REFERENCES "dispute_cases"("id"),
	"outcome" text NOT NULL,
	"summary" text NOT NULL,
	"refund_amount_minor" numeric(18, 0),
	"resolved_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "chk_dispute_resolutions_outcome" CHECK (
		"outcome" IN ('buyer_favor','seller_favor','partial_refund','no_action')
	)
);

-- ============================================================
-- Indexes: single-column for FK lookups
-- ============================================================

-- payment_intents
CREATE INDEX IF NOT EXISTS "idx_payment_intents_order_id" ON "payment_intents" ("order_id");
CREATE INDEX IF NOT EXISTS "idx_payment_intents_seller_id" ON "payment_intents" ("seller_id");
CREATE INDEX IF NOT EXISTS "idx_payment_intents_buyer_id" ON "payment_intents" ("buyer_id");

-- payment_authorizations
CREATE INDEX IF NOT EXISTS "idx_payment_authorizations_payment_intent_id" ON "payment_authorizations" ("payment_intent_id");

-- payment_settlements
CREATE INDEX IF NOT EXISTS "idx_payment_settlements_payment_intent_id" ON "payment_settlements" ("payment_intent_id");

-- refunds
CREATE INDEX IF NOT EXISTS "idx_refunds_payment_intent_id" ON "refunds" ("payment_intent_id");

-- shipments
CREATE INDEX IF NOT EXISTS "idx_shipments_order_id" ON "shipments" ("order_id");
CREATE INDEX IF NOT EXISTS "idx_shipments_seller_id" ON "shipments" ("seller_id");
CREATE INDEX IF NOT EXISTS "idx_shipments_buyer_id" ON "shipments" ("buyer_id");

-- shipment_events
CREATE INDEX IF NOT EXISTS "idx_shipment_events_shipment_id" ON "shipment_events" ("shipment_id");

-- settlement_approvals
CREATE INDEX IF NOT EXISTS "idx_settlement_approvals_listing_id" ON "settlement_approvals" ("listing_id");
CREATE INDEX IF NOT EXISTS "idx_settlement_approvals_seller_id" ON "settlement_approvals" ("seller_id");
CREATE INDEX IF NOT EXISTS "idx_settlement_approvals_buyer_id" ON "settlement_approvals" ("buyer_id");

-- commerce_orders
CREATE INDEX IF NOT EXISTS "idx_commerce_orders_listing_id" ON "commerce_orders" ("listing_id");
CREATE INDEX IF NOT EXISTS "idx_commerce_orders_seller_id" ON "commerce_orders" ("seller_id");
CREATE INDEX IF NOT EXISTS "idx_commerce_orders_buyer_id" ON "commerce_orders" ("buyer_id");

-- dispute_cases
CREATE INDEX IF NOT EXISTS "idx_dispute_cases_order_id" ON "dispute_cases" ("order_id");

-- dispute_evidence
CREATE INDEX IF NOT EXISTS "idx_dispute_evidence_dispute_id" ON "dispute_evidence" ("dispute_id");

-- dispute_resolutions
CREATE INDEX IF NOT EXISTS "idx_dispute_resolutions_dispute_id" ON "dispute_resolutions" ("dispute_id");

-- ============================================================
-- Composite indexes for common query patterns
-- ============================================================

CREATE INDEX IF NOT EXISTS "idx_payment_intents_order_status" ON "payment_intents" ("order_id", "status");
CREATE INDEX IF NOT EXISTS "idx_shipments_order_status" ON "shipments" ("order_id", "status");
CREATE INDEX IF NOT EXISTS "idx_dispute_cases_order_status" ON "dispute_cases" ("order_id", "status");
CREATE INDEX IF NOT EXISTS "idx_settlement_approvals_listing_state" ON "settlement_approvals" ("listing_id", "approval_state");
CREATE INDEX IF NOT EXISTS "idx_commerce_orders_status" ON "commerce_orders" ("status");
CREATE INDEX IF NOT EXISTS "idx_shipment_events_shipment_occurred" ON "shipment_events" ("shipment_id", "occurred_at");
