CREATE TABLE "listing_claims" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"listing_id" uuid NOT NULL,
	"opened_by_session_id" uuid NOT NULL,
	"opened_by_buyer_id" uuid NOT NULL,
	"seller_id" uuid NOT NULL,
	"status" text DEFAULT 'OPEN' NOT NULL,
	"lock_kind" text DEFAULT 'OPEN_HOLD' NOT NULL,
	"exclusive_buyer_id" uuid,
	"exclusive_until" timestamp with time zone,
	"funding_buyer_id" uuid,
	"funding_session_id" uuid,
	"funding_settlement_approval_id" uuid,
	"funding_payment_intent_id" uuid,
	"funding_lease_expires_at" timestamp with time zone,
	"funded_at" timestamp with time zone,
	"version" integer DEFAULT 1 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "listing_claims_status_check" CHECK (status in ('OPEN', 'EXCLUSIVE', 'FUNDING', 'FUNDED')),
	CONSTRAINT "listing_claims_lock_kind_check" CHECK (lock_kind in ('OPEN_HOLD', 'EXCLUSIVE')),
	CONSTRAINT "listing_claims_exclusive_fields_check" CHECK ((lock_kind = 'OPEN_HOLD' and exclusive_buyer_id is null and exclusive_until is null)
          or (lock_kind = 'EXCLUSIVE' and exclusive_buyer_id is not null and exclusive_until is not null))
);
--> statement-breakpoint
CREATE UNIQUE INDEX "listing_claims_active_listing_unique" ON "listing_claims" USING btree ("listing_id") WHERE status in ('OPEN', 'EXCLUSIVE', 'FUNDING', 'FUNDED');--> statement-breakpoint
CREATE INDEX "listing_claims_listing_status_idx" ON "listing_claims" USING btree ("listing_id","status");