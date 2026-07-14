-- Reconcile tables that were declared in Drizzle but never added to migration history.
-- CREATE/INDEX IF NOT EXISTS keeps this safe for cloud databases where db:push may
-- already have created the objects.

CREATE TABLE IF NOT EXISTS "tag_promotion_rules" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "category" text NOT NULL,
  "candidate_min_use" integer NOT NULL,
  "emerging_min_use" integer NOT NULL,
  "candidate_min_age_days" integer DEFAULT 0 NOT NULL,
  "emerging_min_age_days" integer DEFAULT 7 NOT NULL,
  "suggestion_auto_promote_count" integer NOT NULL,
  "enabled" boolean DEFAULT true NOT NULL,
  "updated_by" uuid,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "tag_promotion_rules_category_uq"
  ON "tag_promotion_rules" USING btree ("category");
--> statement-breakpoint

CREATE TABLE IF NOT EXISTS "admin_action_log" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "actor_id" uuid NOT NULL,
  "action_type" text NOT NULL,
  "target_type" text,
  "target_id" text,
  "payload" jsonb,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "admin_action_log_actor_idx"
  ON "admin_action_log" USING btree ("actor_id", "created_at");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "admin_action_log_action_idx"
  ON "admin_action_log" USING btree ("action_type", "created_at");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "admin_action_log_target_idx"
  ON "admin_action_log" USING btree ("target_type", "target_id");
--> statement-breakpoint

CREATE TABLE IF NOT EXISTS "seller_attestation_commits" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "listing_id" uuid NOT NULL,
  "seller_id" uuid NOT NULL,
  "imei_encrypted" text NOT NULL,
  "battery_health_pct" integer NOT NULL,
  "find_my_off" boolean NOT NULL,
  "photo_urls" jsonb NOT NULL,
  "commit_hash" text NOT NULL,
  "canonical_payload" jsonb NOT NULL,
  "committed_at" timestamp with time zone DEFAULT now() NOT NULL,
  "expires_at" timestamp with time zone NOT NULL,
  CONSTRAINT "seller_attestation_commits_listing_id_listings_published_id_fk"
    FOREIGN KEY ("listing_id") REFERENCES "public"."listings_published"("id")
    ON DELETE cascade ON UPDATE no action
);
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "uq_seller_attestation_commits_listing_id"
  ON "seller_attestation_commits" USING btree ("listing_id");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_seller_attestation_commits_listing"
  ON "seller_attestation_commits" USING btree ("listing_id");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_seller_attestation_commits_seller_committed"
  ON "seller_attestation_commits" USING btree ("seller_id", "committed_at");
--> statement-breakpoint

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'seller_attestation_commits_listing_id_listings_published_id_fk'
      AND conrelid = 'seller_attestation_commits'::regclass
  ) THEN
    ALTER TABLE "seller_attestation_commits"
      ADD CONSTRAINT "seller_attestation_commits_listing_id_listings_published_id_fk"
      FOREIGN KEY ("listing_id") REFERENCES "public"."listings_published"("id")
      ON DELETE cascade ON UPDATE no action NOT VALID;
  END IF;
END $$;
