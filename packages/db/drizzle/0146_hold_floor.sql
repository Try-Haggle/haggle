ALTER TABLE "listing_claims" ADD COLUMN "hold_price_minor" integer;--> statement-breakpoint
ALTER TABLE "listing_claims" ADD COLUMN "hold_buyer_id" uuid;--> statement-breakpoint
ALTER TABLE "listing_claims" ADD COLUMN "hold_expires_at" timestamp with time zone;
