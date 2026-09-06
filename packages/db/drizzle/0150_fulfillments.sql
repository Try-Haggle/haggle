CREATE TABLE "fulfillments" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"order_id" uuid NOT NULL,
	"payment_intent_id" uuid,
	"fulfillment_type" text NOT NULL,
	"status" text DEFAULT 'AWAITING_SELLER_ACTION' NOT NULL,
	"proof_required" boolean DEFAULT true NOT NULL,
	"proof_status" text DEFAULT 'PENDING' NOT NULL,
	"fulfilled_at" timestamp with time zone,
	"review_window_hours" integer DEFAULT 24 NOT NULL,
	"metadata" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "fulfillments_type_check" CHECK (fulfillment_type in ('physical_shipping', 'shipped', 'local_pickup', 'digital_delivery', 'external_platform_transfer', 'onchain_transfer')),
	CONSTRAINT "fulfillments_status_check" CHECK (status in ('AWAITING_SELLER_ACTION', 'PROOF_SUBMITTED', 'AWAITING_BUYER_CONFIRMATION', 'FULFILLED', 'DISPUTED', 'CANCELED')),
	CONSTRAINT "fulfillments_proof_status_check" CHECK (proof_status in ('PENDING', 'SUBMITTED', 'VERIFIED', 'REJECTED', 'NOT_REQUIRED'))
);
--> statement-breakpoint
ALTER TABLE "fulfillments" ADD CONSTRAINT "fulfillments_order_id_fkey" FOREIGN KEY ("order_id") REFERENCES "public"."commerce_orders"("id");--> statement-breakpoint
CREATE UNIQUE INDEX "uq_fulfillments_order_id" ON "fulfillments" USING btree ("order_id");--> statement-breakpoint
CREATE INDEX "fulfillments_payment_intent_idx" ON "fulfillments" USING btree ("payment_intent_id");--> statement-breakpoint
CREATE INDEX "fulfillments_type_idx" ON "fulfillments" USING btree ("fulfillment_type");
