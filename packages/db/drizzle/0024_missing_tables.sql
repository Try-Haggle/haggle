-- notifications, notification_preferences, email_deliveries
-- CREATE TABLE이 마이그레이션 히스토리에 누락됐던 것 보완 (db:push로만 생성됐었음)

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

-- Missing columns on listing_drafts (added via db:push, never in migration history)
ALTER TABLE "listing_drafts" ADD COLUMN IF NOT EXISTS "tags" text[];
ALTER TABLE "listing_drafts" ADD COLUMN IF NOT EXISTS "photo_url" text;
ALTER TABLE "listing_drafts" ADD COLUMN IF NOT EXISTS "selling_deadline" timestamp with time zone;

-- Missing table definitions: buyer_listings, trust_penalty_records,
-- settlement_reliability_snapshots, onchain_trust_profiles, expertise_badges.
-- These tables existed in the schema but had no CREATE TABLE in migration history
-- (created via db:push on cloud dev, never committed as a migration).
-- Discovered when running db:migrate on a fresh local DB (Slice 0 verification).


CREATE TABLE IF NOT EXISTS "trust_penalty_records" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "order_id" uuid NOT NULL,
  "actor_id" uuid NOT NULL,
  "actor_role" text NOT NULL,
  "reason" text NOT NULL,
  "penalty_score" numeric(8,4) NOT NULL,
  "onchain_reference" text,
  "metadata" jsonb,
  "created_at" timestamp with time zone NOT NULL DEFAULT now(),
  CONSTRAINT "trust_penalty_records_actor_role_check" CHECK (actor_role IN ('buyer','seller')),
  CONSTRAINT "trust_penalty_records_reason_check" CHECK (reason IN ('BUYER_APPROVED_BUT_NOT_PAID','SELLER_APPROVED_BUT_NOT_FULFILLED','SHIPMENT_INFO_SLA_MISSED','DISPUTE_LOSS'))
);

CREATE TABLE IF NOT EXISTS "settlement_reliability_snapshots" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "actor_id" uuid NOT NULL,
  "actor_role" text NOT NULL,
  "successful_settlements" integer NOT NULL DEFAULT 0,
  "approval_defaults" integer NOT NULL DEFAULT 0,
  "shipment_sla_misses" integer NOT NULL DEFAULT 0,
  "dispute_wins" integer NOT NULL DEFAULT 0,
  "dispute_losses" integer NOT NULL DEFAULT 0,
  "settlement_reliability" numeric(8,4) NOT NULL,
  "created_at" timestamp with time zone NOT NULL DEFAULT now(),
  "updated_at" timestamp with time zone NOT NULL DEFAULT now(),
  CONSTRAINT "settlement_reliability_snapshots_actor_role_check" CHECK (actor_role IN ('buyer','seller'))
);

CREATE TABLE IF NOT EXISTS "onchain_trust_profiles" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "actor_id" uuid NOT NULL,
  "wallet_address" text,
  "anchored_at" timestamp with time zone,
  "reputation_score" numeric(8,4) NOT NULL,
  "settlement_reliability" numeric(8,4) NOT NULL,
  "successful_settlements" integer NOT NULL DEFAULT 0,
  "approval_defaults" integer NOT NULL DEFAULT 0,
  "shipment_sla_misses" integer NOT NULL DEFAULT 0,
  "dispute_wins" integer NOT NULL DEFAULT 0,
  "dispute_losses" integer NOT NULL DEFAULT 0,
  "onchain_reference" text,
  "metadata" jsonb,
  "created_at" timestamp with time zone NOT NULL DEFAULT now(),
  "updated_at" timestamp with time zone NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS "expertise_badges" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "trust_profile_id" uuid NOT NULL,
  "actor_id" uuid NOT NULL,
  "domain" text NOT NULL,
  "score" numeric(8,4) NOT NULL,
  "successful_orders" integer NOT NULL DEFAULT 0,
  "dispute_wins" integer NOT NULL DEFAULT 0,
  "dispute_losses" integer NOT NULL DEFAULT 0,
  "created_at" timestamp with time zone NOT NULL DEFAULT now(),
  "updated_at" timestamp with time zone NOT NULL DEFAULT now(),
  CONSTRAINT "expertise_badges_domain_check" CHECK (domain IN ('electronics','luxury','fashion','collectibles','automotive','general'))
);
