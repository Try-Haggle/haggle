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
