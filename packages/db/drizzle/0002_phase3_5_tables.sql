-- Phase 3-5 tables: trust, disputes, ARP, tags, waiting intents, skills, auth, settlement
-- Manual migration (drizzle-kit generate blocked by ESM/CJS issue)

CREATE TABLE IF NOT EXISTS "trust_scores" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"actor_id" uuid NOT NULL,
	"actor_role" text NOT NULL,
	"score" numeric(8, 4) NOT NULL,
	"status" text NOT NULL,
	"completed_transactions" integer DEFAULT 0 NOT NULL,
	"weights_version" text NOT NULL,
	"raw_score" numeric(8, 4) NOT NULL,
	"sla_penalty_factor" numeric(8, 4) DEFAULT '1.0' NOT NULL,
	"raw_inputs" jsonb,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);

CREATE TABLE IF NOT EXISTS "ds_ratings" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"reviewer_id" uuid NOT NULL,
	"score" integer NOT NULL,
	"tier" text NOT NULL,
	"vote_weight" numeric(8, 4) NOT NULL,
	"cumulative_cases" integer DEFAULT 0 NOT NULL,
	"recent_cases" integer DEFAULT 0 NOT NULL,
	"zone_hit_rate" numeric(8, 4),
	"participation_rate" numeric(8, 4),
	"unique_categories" integer DEFAULT 0,
	"metadata" jsonb,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);

CREATE TABLE IF NOT EXISTS "ds_tag_specializations" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"reviewer_id" uuid NOT NULL,
	"tag" text NOT NULL,
	"score" integer NOT NULL,
	"tier" text NOT NULL,
	"case_count" integer DEFAULT 0 NOT NULL,
	"zone_hit_rate" numeric(8, 4) NOT NULL,
	"qualified" boolean DEFAULT false NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);

CREATE TABLE IF NOT EXISTS "dispute_deposits" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"dispute_id" uuid NOT NULL,
	"tier" integer NOT NULL,
	"amount_cents" integer NOT NULL,
	"status" text DEFAULT 'PENDING' NOT NULL,
	"deadline_hours" integer NOT NULL,
	"deadline_at" timestamp with time zone,
	"deposited_at" timestamp with time zone,
	"resolved_at" timestamp with time zone,
	"metadata" jsonb,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);

CREATE TABLE IF NOT EXISTS "arp_segments" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"category" text,
	"amount_tier" text,
	"tag" text,
	"review_hours" numeric(8, 2) NOT NULL,
	"sample_count" integer DEFAULT 0 NOT NULL,
	"last_adjusted_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);

CREATE TABLE IF NOT EXISTS "tags" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"name" text NOT NULL,
	"normalized_name" text NOT NULL,
	"status" text DEFAULT 'CANDIDATE' NOT NULL,
	"category" text NOT NULL,
	"use_count" integer DEFAULT 0 NOT NULL,
	"parent_id" uuid,
	"last_used_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);

CREATE TABLE IF NOT EXISTS "expert_tags" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"tag_id" uuid NOT NULL,
	"category" text NOT NULL,
	"case_count" integer DEFAULT 0 NOT NULL,
	"accuracy" numeric(8, 4) NOT NULL,
	"qualified_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);

CREATE TABLE IF NOT EXISTS "tag_merge_log" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"source_tag_id" uuid NOT NULL,
	"target_tag_id" uuid NOT NULL,
	"reason" text NOT NULL,
	"merged_by" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);

CREATE TABLE IF NOT EXISTS "waiting_intents" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"role" text NOT NULL,
	"category" text NOT NULL,
	"keywords" jsonb NOT NULL,
	"strategy_snapshot" jsonb NOT NULL,
	"min_u_total" numeric(8, 4) DEFAULT '0.3' NOT NULL,
	"max_active_sessions" integer DEFAULT 5 NOT NULL,
	"status" text DEFAULT 'ACTIVE' NOT NULL,
	"matched_at" timestamp with time zone,
	"fulfilled_at" timestamp with time zone,
	"expires_at" timestamp with time zone NOT NULL,
	"metadata" jsonb,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);

CREATE TABLE IF NOT EXISTS "intent_matches" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"intent_id" uuid NOT NULL,
	"counterparty_intent_id" uuid,
	"listing_id" uuid,
	"session_id" uuid,
	"buyer_u_total" numeric(8, 4) NOT NULL,
	"seller_u_total" numeric(8, 4),
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);

CREATE TABLE IF NOT EXISTS "skills" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"skill_id" text NOT NULL UNIQUE,
	"name" text NOT NULL,
	"description" text NOT NULL,
	"version" text NOT NULL,
	"category" text NOT NULL,
	"provider" text NOT NULL,
	"status" text DEFAULT 'DRAFT' NOT NULL,
	"supported_categories" jsonb NOT NULL,
	"hook_points" jsonb NOT NULL,
	"pricing" jsonb NOT NULL,
	"config_schema" jsonb,
	"usage_count" integer DEFAULT 0 NOT NULL,
	"average_latency_ms" numeric(8, 2) DEFAULT '0' NOT NULL,
	"error_rate" numeric(8, 4) DEFAULT '0' NOT NULL,
	"metadata" jsonb,
	"registered_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);

CREATE TABLE IF NOT EXISTS "skill_executions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"skill_id" text NOT NULL,
	"hook_point" text NOT NULL,
	"success" boolean NOT NULL,
	"latency_ms" integer NOT NULL,
	"input_summary" jsonb,
	"output_summary" jsonb,
	"error" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);

CREATE TABLE IF NOT EXISTS "authentications" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"listing_id" uuid NOT NULL,
	"order_id" uuid,
	"dispute_id" uuid,
	"provider" text NOT NULL,
	"category" text NOT NULL,
	"turnaround" text DEFAULT 'standard' NOT NULL,
	"status" text DEFAULT 'REQUESTED' NOT NULL,
	"verdict" text,
	"certificate_url" text,
	"requested_by" text NOT NULL,
	"cost_minor" text NOT NULL,
	"case_id" text,
	"intent_id" text,
	"submission_url" text,
	"publish_policy" text DEFAULT 'publish_immediately' NOT NULL,
	"auto_apply_result" boolean DEFAULT true NOT NULL,
	"result_applied" boolean DEFAULT false NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);

CREATE TABLE IF NOT EXISTS "authentication_events" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"authentication_id" uuid NOT NULL,
	"event_type" text NOT NULL,
	"status" text NOT NULL,
	"verdict" text,
	"certificate_url" text,
	"occurred_at" timestamp with time zone NOT NULL,
	"raw" jsonb,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);

CREATE TABLE IF NOT EXISTS "settlement_releases" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"payment_intent_id" uuid NOT NULL,
	"order_id" uuid NOT NULL,
	"product_amount_minor" numeric(18, 0) NOT NULL,
	"product_currency" text DEFAULT 'USDC' NOT NULL,
	"product_release_status" text DEFAULT 'PENDING_DELIVERY' NOT NULL,
	"delivery_confirmed_at" timestamp with time zone,
	"buyer_review_deadline" timestamp with time zone,
	"product_released_at" timestamp with time zone,
	"buffer_amount_minor" numeric(18, 0) DEFAULT '0' NOT NULL,
	"buffer_currency" text DEFAULT 'USDC' NOT NULL,
	"buffer_release_status" text DEFAULT 'HELD' NOT NULL,
	"buffer_release_deadline" timestamp with time zone,
	"apv_adjustment_minor" numeric(18, 0) DEFAULT '0',
	"buffer_final_amount_minor" numeric(18, 0),
	"buffer_released_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);

-- negotiation_groups, negotiation_sessions, negotiation_rounds
-- CREATE TABLE이 마이그레이션 히스토리에 누락됐던 것 보완 (db:push로만 생성됐었음)
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
