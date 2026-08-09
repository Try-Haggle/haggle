CREATE TABLE "learned_category_check_evidence" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"category_path" text NOT NULL,
	"check_key" text NOT NULL,
	"source_key" text NOT NULL,
	"origin" text DEFAULT 'UNKNOWN' NOT NULL,
	"question_ko" text NOT NULL,
	"metadata" jsonb,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "learned_category_checks" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"category_path" text NOT NULL,
	"check_key" text NOT NULL,
	"question_ko" text NOT NULL,
	"feature_key" text,
	"occurrence_count" integer DEFAULT 1 NOT NULL,
	"distinct_source_count" integer DEFAULT 1 NOT NULL,
	"status" text DEFAULT 'OBSERVED' NOT NULL,
	"first_seen_at" timestamp with time zone DEFAULT now() NOT NULL,
	"last_seen_at" timestamp with time zone DEFAULT now() NOT NULL,
	"promoted_at" timestamp with time zone,
	"metadata" jsonb,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX "learned_category_check_evidence_source_idx" ON "learned_category_check_evidence" USING btree ("category_path","check_key","source_key");--> statement-breakpoint
CREATE INDEX "learned_category_check_evidence_check_idx" ON "learned_category_check_evidence" USING btree ("category_path","check_key");--> statement-breakpoint
CREATE INDEX "learned_category_check_evidence_created_idx" ON "learned_category_check_evidence" USING btree ("created_at" DESC);--> statement-breakpoint
CREATE UNIQUE INDEX "learned_category_checks_path_key_idx" ON "learned_category_checks" USING btree ("category_path","check_key");--> statement-breakpoint
CREATE INDEX "learned_category_checks_status_idx" ON "learned_category_checks" USING btree ("status","last_seen_at");