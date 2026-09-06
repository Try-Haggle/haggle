CREATE TABLE "fulfillment_proofs" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"fulfillment_id" uuid NOT NULL,
	"proof_kind" text NOT NULL,
	"uri" text,
	"sha256" text,
	"external_reference" text,
	"submitted_by" text NOT NULL,
	"verification_status" text DEFAULT 'PENDING' NOT NULL,
	"metadata" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "fulfillment_proofs_verification_status_check" CHECK (verification_status in ('PENDING', 'VERIFIED', 'REJECTED'))
);
--> statement-breakpoint
ALTER TABLE "fulfillment_proofs" ADD CONSTRAINT "fulfillment_proofs_fulfillment_id_fkey" FOREIGN KEY ("fulfillment_id") REFERENCES "public"."fulfillments"("id");--> statement-breakpoint
CREATE INDEX "fulfillment_proofs_fulfillment_id_idx" ON "fulfillment_proofs" USING btree ("fulfillment_id");--> statement-breakpoint
CREATE INDEX "fulfillment_proofs_submitted_by_idx" ON "fulfillment_proofs" USING btree ("submitted_by");
