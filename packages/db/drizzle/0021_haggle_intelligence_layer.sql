CREATE TABLE IF NOT EXISTS "conversation_signal_sources" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "source_key" text NOT NULL,
  "session_id" uuid NOT NULL,
  "round_id" uuid,
  "round_no" integer,
  "listing_id" uuid,
  "user_id" uuid,
  "role_perspective" text DEFAULT 'UNKNOWN' NOT NULL,
  "source_label" text NOT NULL,
  "raw_text" text NOT NULL,
  "raw_text_hash" text NOT NULL,
  "raw_access_policy" jsonb NOT NULL,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  CONSTRAINT "chk_conversation_signal_sources_role" CHECK ("role_perspective" IN ('BUYER','SELLER','SYSTEM','UNKNOWN')),
  CONSTRAINT "chk_conversation_signal_sources_label" CHECK ("source_label" IN ('incoming','outgoing','system'))
);

CREATE UNIQUE INDEX IF NOT EXISTS "conversation_signal_sources_source_key_idx"
  ON "conversation_signal_sources" ("source_key");
CREATE INDEX IF NOT EXISTS "conversation_signal_sources_session_idx"
  ON "conversation_signal_sources" ("session_id", "round_no");
CREATE INDEX IF NOT EXISTS "conversation_signal_sources_round_idx"
  ON "conversation_signal_sources" ("round_id");
CREATE INDEX IF NOT EXISTS "conversation_signal_sources_hash_idx"
  ON "conversation_signal_sources" ("raw_text_hash");

CREATE TABLE IF NOT EXISTS "conversation_market_signals" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "signal_key" text NOT NULL,
  "session_id" uuid,
  "round_id" uuid,
  "round_no" integer,
  "listing_id" uuid,
  "user_id" uuid,
  "role_perspective" text DEFAULT 'UNKNOWN' NOT NULL,
  "signal_type" text NOT NULL,
  "entity_type" text NOT NULL,
  "entity_value" text NOT NULL,
  "normalized_value" text NOT NULL,
  "confidence" numeric(5, 4) NOT NULL,
  "extraction_method" text NOT NULL,
  "privacy_class" text NOT NULL,
  "market_usefulness" text NOT NULL,
  "evidence" jsonb NOT NULL,
  "metadata" jsonb,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  CONSTRAINT "chk_conversation_market_signals_role" CHECK ("role_perspective" IN ('BUYER','SELLER','SYSTEM','UNKNOWN')),
  CONSTRAINT "chk_conversation_market_signals_type" CHECK ("signal_type" IN ('product_identity','product_attribute','condition_claim','price_anchor','price_resistance','deal_blocker','demand_intent','term_preference','trust_risk','market_outcome','tag_candidate','term_candidate')),
  CONSTRAINT "chk_conversation_market_signals_method" CHECK ("extraction_method" IN ('deterministic','model_assisted','manual','system')),
  CONSTRAINT "chk_conversation_market_signals_privacy" CHECK ("privacy_class" IN ('public_market','user_preference','safety','private_context')),
  CONSTRAINT "chk_conversation_market_signals_usefulness" CHECK ("market_usefulness" IN ('high','medium','low','none')),
  CONSTRAINT "chk_conversation_market_signals_confidence" CHECK ("confidence" >= 0 AND "confidence" <= 1)
);

CREATE UNIQUE INDEX IF NOT EXISTS "conversation_market_signals_signal_key_idx"
  ON "conversation_market_signals" ("signal_key");
CREATE INDEX IF NOT EXISTS "conversation_market_signals_session_idx"
  ON "conversation_market_signals" ("session_id", "round_no");
CREATE INDEX IF NOT EXISTS "conversation_market_signals_listing_type_idx"
  ON "conversation_market_signals" ("listing_id", "signal_type");
CREATE INDEX IF NOT EXISTS "conversation_market_signals_user_type_idx"
  ON "conversation_market_signals" ("user_id", "signal_type");
CREATE INDEX IF NOT EXISTS "conversation_market_signals_normalized_idx"
  ON "conversation_market_signals" ("signal_type", "normalized_value");
CREATE INDEX IF NOT EXISTS "conversation_market_signals_created_idx"
  ON "conversation_market_signals" ("created_at");

CREATE TABLE IF NOT EXISTS "user_memory_cards" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "user_id" uuid NOT NULL,
  "card_type" text NOT NULL,
  "memory_key" text NOT NULL,
  "status" text DEFAULT 'ACTIVE' NOT NULL,
  "summary" text NOT NULL,
  "memory" jsonb NOT NULL,
  "evidence_refs" jsonb DEFAULT '[]'::jsonb NOT NULL,
  "strength" numeric(5, 4) DEFAULT '0.5000' NOT NULL,
  "version" integer DEFAULT 1 NOT NULL,
  "last_reinforced_at" timestamp with time zone,
  "expires_at" timestamp with time zone,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL,
  CONSTRAINT "chk_user_memory_cards_type" CHECK ("card_type" IN ('preference','constraint','pricing','style','trust','interest')),
  CONSTRAINT "chk_user_memory_cards_status" CHECK ("status" IN ('ACTIVE','STALE','SUPPRESSED','EXPIRED')),
  CONSTRAINT "chk_user_memory_cards_strength" CHECK ("strength" >= 0 AND "strength" <= 1)
);

CREATE UNIQUE INDEX IF NOT EXISTS "user_memory_cards_user_type_key_idx"
  ON "user_memory_cards" ("user_id", "card_type", "memory_key");
CREATE INDEX IF NOT EXISTS "user_memory_cards_user_status_idx"
  ON "user_memory_cards" ("user_id", "status");
CREATE INDEX IF NOT EXISTS "user_memory_cards_user_type_idx"
  ON "user_memory_cards" ("user_id", "card_type");
CREATE INDEX IF NOT EXISTS "user_memory_cards_expires_idx"
  ON "user_memory_cards" ("expires_at");

CREATE TABLE IF NOT EXISTS "user_memory_events" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "user_id" uuid NOT NULL,
  "card_id" uuid,
  "signal_id" uuid,
  "event_type" text NOT NULL,
  "delta" jsonb NOT NULL,
  "confidence" numeric(5, 4),
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  CONSTRAINT "chk_user_memory_events_type" CHECK ("event_type" IN ('CREATED','REINFORCED','DECAYED','SUPPRESSED','EXPIRED','USER_RESET','SYSTEM_REVIEW')),
  CONSTRAINT "chk_user_memory_events_confidence" CHECK ("confidence" IS NULL OR ("confidence" >= 0 AND "confidence" <= 1))
);

CREATE INDEX IF NOT EXISTS "user_memory_events_user_created_idx"
  ON "user_memory_events" ("user_id", "created_at");
CREATE INDEX IF NOT EXISTS "user_memory_events_card_idx"
  ON "user_memory_events" ("card_id");
CREATE INDEX IF NOT EXISTS "user_memory_events_signal_idx"
  ON "user_memory_events" ("signal_id");

CREATE TABLE IF NOT EXISTS "evermemos" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "user_id" uuid NOT NULL,
  "memory_class" text NOT NULL,
  "status" text DEFAULT 'ACTIVE' NOT NULL,
  "title" text NOT NULL,
  "content" jsonb NOT NULL,
  "linked_entity_type" text,
  "linked_entity_id" text,
  "importance" numeric(5, 4) DEFAULT '0.5000' NOT NULL,
  "retrieval_key" text,
  "embedding_ref" text,
  "last_retrieved_at" timestamp with time zone,
  "expires_at" timestamp with time zone,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL,
  CONSTRAINT "chk_evermemos_class" CHECK ("memory_class" IN ('core','episodic','semantic','procedural','resource','knowledge_vault')),
  CONSTRAINT "chk_evermemos_status" CHECK ("status" IN ('ACTIVE','ARCHIVED','SUPPRESSED','EXPIRED')),
  CONSTRAINT "chk_evermemos_importance" CHECK ("importance" >= 0 AND "importance" <= 1)
);

CREATE INDEX IF NOT EXISTS "evermemos_user_status_idx"
  ON "evermemos" ("user_id", "status");
CREATE INDEX IF NOT EXISTS "evermemos_user_class_idx"
  ON "evermemos" ("user_id", "memory_class");
CREATE INDEX IF NOT EXISTS "evermemos_linked_entity_idx"
  ON "evermemos" ("linked_entity_type", "linked_entity_id");
CREATE INDEX IF NOT EXISTS "evermemos_retrieval_key_idx"
  ON "evermemos" ("retrieval_key");

CREATE TABLE IF NOT EXISTS "evermemo_events" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "evermemo_id" uuid,
  "user_id" uuid NOT NULL,
  "event_type" text NOT NULL,
  "payload" jsonb NOT NULL,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  CONSTRAINT "chk_evermemo_events_type" CHECK ("event_type" IN ('CREATED','UPDATED','LINKED','RETRIEVED','REINFORCED','ARCHIVED','SUPPRESSED'))
);

CREATE INDEX IF NOT EXISTS "evermemo_events_user_created_idx"
  ON "evermemo_events" ("user_id", "created_at");
CREATE INDEX IF NOT EXISTS "evermemo_events_evermemo_idx"
  ON "evermemo_events" ("evermemo_id");

CREATE TABLE IF NOT EXISTS "term_intelligence_terms" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "normalized_term" text NOT NULL,
  "display_label" text NOT NULL,
  "lifecycle_status" text DEFAULT 'OBSERVED' NOT NULL,
  "term_category" text,
  "value_type" text DEFAULT 'unknown' NOT NULL,
  "occurrence_count" integer DEFAULT 1 NOT NULL,
  "supporting_source_count" integer DEFAULT 1 NOT NULL,
  "avg_confidence" numeric(5, 4) DEFAULT '0.5000' NOT NULL,
  "first_seen_at" timestamp with time zone DEFAULT now() NOT NULL,
  "last_seen_at" timestamp with time zone DEFAULT now() NOT NULL,
  "verified_at" timestamp with time zone,
  "deprecated_at" timestamp with time zone,
  "metadata" jsonb,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL,
  CONSTRAINT "chk_term_intelligence_terms_status" CHECK ("lifecycle_status" IN ('OBSERVED','CANDIDATE','VERIFIED','OFFICIAL','DEPRECATED')),
  CONSTRAINT "chk_term_intelligence_terms_value_type" CHECK ("value_type" IN ('number','enum','boolean','text','unknown')),
  CONSTRAINT "chk_term_intelligence_terms_confidence" CHECK ("avg_confidence" >= 0 AND "avg_confidence" <= 1)
);

CREATE UNIQUE INDEX IF NOT EXISTS "term_intelligence_terms_normalized_idx"
  ON "term_intelligence_terms" ("normalized_term");
CREATE INDEX IF NOT EXISTS "term_intelligence_terms_status_idx"
  ON "term_intelligence_terms" ("lifecycle_status", "last_seen_at");
CREATE INDEX IF NOT EXISTS "term_intelligence_terms_category_idx"
  ON "term_intelligence_terms" ("term_category");

CREATE TABLE IF NOT EXISTS "term_intelligence_evidence" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "normalized_term" text NOT NULL,
  "source_key" text NOT NULL,
  "session_id" uuid NOT NULL,
  "round_no" integer,
  "listing_id" uuid,
  "role_perspective" text DEFAULT 'UNKNOWN' NOT NULL,
  "confidence" numeric(5, 4) NOT NULL,
  "evidence" jsonb NOT NULL,
  "metadata" jsonb,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  CONSTRAINT "chk_term_intelligence_evidence_role" CHECK ("role_perspective" IN ('BUYER','SELLER','SYSTEM','UNKNOWN')),
  CONSTRAINT "chk_term_intelligence_evidence_confidence" CHECK ("confidence" >= 0 AND "confidence" <= 1)
);

CREATE UNIQUE INDEX IF NOT EXISTS "term_intelligence_evidence_term_source_idx"
  ON "term_intelligence_evidence" ("normalized_term", "source_key");
CREATE INDEX IF NOT EXISTS "term_intelligence_evidence_session_idx"
  ON "term_intelligence_evidence" ("session_id", "round_no");
CREATE INDEX IF NOT EXISTS "term_intelligence_evidence_term_idx"
  ON "term_intelligence_evidence" ("normalized_term");

CREATE TABLE IF NOT EXISTS "memory_eligibility_snapshots" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "user_id" uuid NOT NULL,
  "eligible" boolean DEFAULT false NOT NULL,
  "reason" text NOT NULL,
  "buddy_id" uuid,
  "buddy_rarity" text,
  "monthly_trade_count" integer DEFAULT 0 NOT NULL,
  "reviewer_participation_count" integer DEFAULT 0 NOT NULL,
  "subscription_active" boolean DEFAULT false NOT NULL,
  "source_payload" jsonb,
  "evaluated_at" timestamp with time zone DEFAULT now() NOT NULL,
  "expires_at" timestamp with time zone,
  CONSTRAINT "chk_memory_eligibility_snapshots_reason" CHECK ("reason" IN ('legendary_buddy_trade_threshold','mythic_buddy_trade_threshold','reviewer_trade_threshold','subscription','manual','not_eligible'))
);

CREATE INDEX IF NOT EXISTS "memory_eligibility_snapshots_user_eval_idx"
  ON "memory_eligibility_snapshots" ("user_id", "evaluated_at");
CREATE INDEX IF NOT EXISTS "memory_eligibility_snapshots_eligible_idx"
  ON "memory_eligibility_snapshots" ("eligible", "evaluated_at");
CREATE INDEX IF NOT EXISTS "memory_eligibility_snapshots_user_current_idx"
  ON "memory_eligibility_snapshots" ("user_id", "expires_at");
