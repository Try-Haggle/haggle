CREATE TABLE "listings_published" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"public_id" text NOT NULL UNIQUE,
	"draft_id" uuid NOT NULL REFERENCES "listing_drafts"("id"),
	"snapshot_json" jsonb NOT NULL,
	"published_at" timestamp with time zone DEFAULT now() NOT NULL
);
