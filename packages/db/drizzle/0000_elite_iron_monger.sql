CREATE TABLE "listing_drafts" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"status" text DEFAULT 'draft' NOT NULL,
	"user_id" uuid,
	"claim_token" text,
	"claim_expires_at" timestamp with time zone,
	"title" text,
	"category" text,
	"brand" text,
	"model" text,
	"condition" text,
	"description" text,
	"target_price" numeric(12, 2),
	"floor_price" numeric(12, 2),
	"strategy_config" jsonb,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
