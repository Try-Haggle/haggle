-- Tables that were added to existing migration files after staging DB already ran them.
-- Extracted here as 0025 so staging/prod get them via normal migration flow.

-- From 0002_add_similar_listings_tables (buyer_listings CREATE TABLE was missing)
CREATE TABLE IF NOT EXISTS "buyer_listings" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "user_id" uuid NOT NULL,
  "published_listing_id" uuid NOT NULL REFERENCES "listings_published"("id"),
  "status" text NOT NULL DEFAULT 'viewed',
  "first_viewed_at" timestamp with time zone NOT NULL DEFAULT now(),
  "last_viewed_at" timestamp with time zone NOT NULL DEFAULT now(),
  "view_count" integer NOT NULL DEFAULT 1,
  "negotiation_started_at" timestamp with time zone,
  "created_at" timestamp with time zone NOT NULL DEFAULT now(),
  "updated_at" timestamp with time zone NOT NULL DEFAULT now(),
  CONSTRAINT "buyer_listings_status_check" CHECK (status IN ('viewed','negotiating','completed','cancelled'))
);
CREATE UNIQUE INDEX IF NOT EXISTS "buyer_listings_user_listing_idx" ON "buyer_listings"("user_id","published_listing_id");

-- From 0002_phase3_5_tables (negotiation tables were missing)
CREATE TABLE IF NOT EXISTS "negotiation_groups" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "topology" text NOT NULL,
  "anchor_user_id" uuid NOT NULL,
  "intent_id" uuid,
  "max_sessions" integer NOT NULL DEFAULT 10,
  "status" text NOT NULL DEFAULT 'ACTIVE',
  "batna" numeric(18, 0),
  "best_session_id" uuid,
  "version" integer NOT NULL DEFAULT 1,
  "metadata" jsonb,
  "created_at" timestamp with time zone NOT NULL DEFAULT now(),
  "updated_at" timestamp with time zone NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS "negotiation_groups_anchor_status_idx" ON "negotiation_groups"("anchor_user_id","status");

CREATE TABLE IF NOT EXISTS "negotiation_sessions" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "group_id" uuid,
  "intent_id" uuid,
  "listing_id" uuid NOT NULL,
  "strategy_id" text NOT NULL,
  "role" text NOT NULL,
  "status" text NOT NULL DEFAULT 'CREATED',
  "buyer_id" uuid NOT NULL,
  "seller_id" uuid NOT NULL,
  "counterparty_id" uuid NOT NULL,
  "current_round" integer NOT NULL DEFAULT 0,
  "rounds_no_concession" integer NOT NULL DEFAULT 0,
  "last_offer_price_minor" numeric(18, 0),
  "last_utility" jsonb,
  "strategy_snapshot" jsonb NOT NULL,
  "version" integer NOT NULL DEFAULT 1,
  "expires_at" timestamp with time zone,
  "phase" text,
  "intervention_mode" text DEFAULT 'FULL_AUTO',
  "buddy_tone" jsonb,
  "coaching_snapshot" jsonb,
  "created_at" timestamp with time zone NOT NULL DEFAULT now(),
  "updated_at" timestamp with time zone NOT NULL DEFAULT now(),
  "outcome" text,
  "discount_rate" numeric(5, 4),
  "total_duration_minutes" numeric(10, 1),
  "buyer_pattern" text,
  "seller_pattern" text,
  "price_trajectory" jsonb,
  "concession_rates" jsonb,
  "tactics_used" jsonb,
  "tactics_success" jsonb,
  "conditions_exchanged" jsonb,
  "referee_hard_violations" integer DEFAULT 0,
  "referee_soft_violations" integer DEFAULT 0,
  "coach_vs_actual_avg_deviation" integer,
  "item_value_range" text,
  "opponent_model" jsonb,
  "core_memory_snapshot" jsonb,
  "memo_hash" text,
  "session_fact_chain_hash" text,
  "preset_id" uuid,
  "buddy_id" uuid,
  "skills_used" jsonb
);
CREATE INDEX IF NOT EXISTS "negotiation_sessions_group_status_idx" ON "negotiation_sessions"("group_id","status");
CREATE INDEX IF NOT EXISTS "negotiation_sessions_buyer_status_idx" ON "negotiation_sessions"("buyer_id","status");
CREATE INDEX IF NOT EXISTS "negotiation_sessions_seller_status_idx" ON "negotiation_sessions"("seller_id","status");
CREATE INDEX IF NOT EXISTS "negotiation_sessions_listing_idx" ON "negotiation_sessions"("listing_id");
CREATE INDEX IF NOT EXISTS "negotiation_sessions_outcome_idx" ON "negotiation_sessions"("outcome");

CREATE TABLE IF NOT EXISTS "negotiation_rounds" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "session_id" uuid NOT NULL,
  "round_no" integer NOT NULL,
  "sender_role" text NOT NULL,
  "message_type" text NOT NULL,
  "price_minor" numeric(18, 0) NOT NULL,
  "counter_price_minor" numeric(18, 0),
  "utility" jsonb,
  "decision" text,
  "metadata" jsonb,
  "idempotency_key" text NOT NULL,
  "coaching" jsonb,
  "validation" jsonb,
  "llm_tokens_used" integer,
  "reasoning_used" boolean DEFAULT false,
  "message" text,
  "phase_at_round" text,
  "created_at" timestamp with time zone NOT NULL DEFAULT now(),
  "tactic_used" text,
  "opponent_tactic_detected" text,
  "concession_rate" numeric(8, 6),
  "coach_recommended_minor" numeric(18, 0),
  "deviation_from_coach" integer,
  "referee_violations" jsonb,
  "llm_latency_ms" integer
);
CREATE INDEX IF NOT EXISTS "negotiation_rounds_session_round_idx" ON "negotiation_rounds"("session_id","round_no");
CREATE UNIQUE INDEX IF NOT EXISTS "negotiation_rounds_session_idempotency_key_idx" ON "negotiation_rounds"("session_id","idempotency_key");
CREATE INDEX IF NOT EXISTS "negotiation_rounds_tactic_idx" ON "negotiation_rounds"("tactic_used");

-- From 0024_missing_tables (notifications tables were missing)
CREATE TABLE IF NOT EXISTS "notifications" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "user_id" uuid NOT NULL,
  "event_type" text NOT NULL,
  "category" text NOT NULL,
  "payload" jsonb NOT NULL,
  "read_at" timestamp with time zone,
  "idempotency_key" text NOT NULL,
  "created_at" timestamp with time zone NOT NULL DEFAULT now(),
  CONSTRAINT "notifications_category_check" CHECK (category IN ('negotiation','account','listing'))
);
CREATE INDEX IF NOT EXISTS "notifications_user_created_idx" ON "notifications"("user_id", "created_at" DESC);
CREATE INDEX IF NOT EXISTS "notifications_unread_idx" ON "notifications"("user_id") WHERE read_at IS NULL;
CREATE UNIQUE INDEX IF NOT EXISTS "notifications_user_idempotency_uniq" ON "notifications"("user_id","idempotency_key");

CREATE TABLE IF NOT EXISTS "notification_preferences" (
  "user_id" uuid NOT NULL,
  "category" text NOT NULL,
  "channel" text NOT NULL,
  "enabled" boolean NOT NULL,
  "created_at" timestamp with time zone NOT NULL DEFAULT now(),
  "updated_at" timestamp with time zone NOT NULL DEFAULT now(),
  CONSTRAINT "notification_preferences_pkey" PRIMARY KEY ("user_id","category","channel"),
  CONSTRAINT "notification_preferences_category_check" CHECK (category IN ('negotiation','account','listing')),
  CONSTRAINT "notification_preferences_channel_check" CHECK (channel IN ('in_app','email'))
);

CREATE TABLE IF NOT EXISTS "email_deliveries" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "user_id" uuid NOT NULL,
  "to_email" text NOT NULL,
  "event_type" text NOT NULL,
  "provider" text NOT NULL DEFAULT 'resend',
  "provider_message_id" text,
  "status" text NOT NULL DEFAULT 'queued',
  "error_message" text,
  "attempts" integer NOT NULL DEFAULT 0,
  "idempotency_key" text NOT NULL,
  "attempted_at" timestamp with time zone NOT NULL DEFAULT now(),
  "delivered_at" timestamp with time zone,
  "created_at" timestamp with time zone NOT NULL DEFAULT now(),
  "updated_at" timestamp with time zone NOT NULL DEFAULT now(),
  CONSTRAINT "email_deliveries_provider_check" CHECK (provider IN ('resend')),
  CONSTRAINT "email_deliveries_status_check" CHECK (status IN ('queued','sent','delivered','bounced','complained','failed'))
);
CREATE INDEX IF NOT EXISTS "email_deliveries_user_created_idx" ON "email_deliveries"("user_id", "created_at" DESC);
