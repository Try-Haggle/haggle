ALTER TABLE "listing_drafts" ADD COLUMN "withdrawn_at" timestamp with time zone;--> statement-breakpoint
CREATE INDEX "listing_drafts_withdrawn_at_idx" ON "listing_drafts" ("withdrawn_at") WHERE "withdrawn_at" IS NOT NULL;
