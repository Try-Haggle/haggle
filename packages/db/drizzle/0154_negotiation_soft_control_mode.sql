-- Eng1 M1: Soft Auto/Manual control_mode + Soft AI credit charge tracking.
-- Orthogonal to intervention_mode (human approval of AI decisions) and Hard Authority.
-- SoT: docs/wip/auto-manual-control-mode-sot.md

ALTER TABLE "negotiation_sessions"
  ADD COLUMN IF NOT EXISTS "buyer_control_mode" text DEFAULT 'auto' NOT NULL;
--> statement-breakpoint
ALTER TABLE "negotiation_sessions"
  ADD COLUMN IF NOT EXISTS "seller_control_mode" text DEFAULT 'auto' NOT NULL;
--> statement-breakpoint
ALTER TABLE "negotiation_sessions"
  ADD COLUMN IF NOT EXISTS "buyer_pending_control_mode" text;
--> statement-breakpoint
ALTER TABLE "negotiation_sessions"
  ADD COLUMN IF NOT EXISTS "seller_pending_control_mode" text;
--> statement-breakpoint
ALTER TABLE "negotiation_sessions"
  ADD COLUMN IF NOT EXISTS "soft_ai_inflight_party" text;
--> statement-breakpoint
ALTER TABLE "negotiation_sessions"
  ADD COLUMN IF NOT EXISTS "buyer_soft_ai_credits_charged" integer DEFAULT 0 NOT NULL;
--> statement-breakpoint
ALTER TABLE "negotiation_sessions"
  ADD COLUMN IF NOT EXISTS "seller_manual_since" timestamp with time zone;
--> statement-breakpoint
ALTER TABLE "negotiation_sessions"
  ADD COLUMN IF NOT EXISTS "seller_manual_timeout_phase" text;
--> statement-breakpoint
ALTER TABLE "negotiation_sessions"
  DROP CONSTRAINT IF EXISTS "negotiation_sessions_buyer_control_mode_ck";
--> statement-breakpoint
ALTER TABLE "negotiation_sessions"
  ADD CONSTRAINT "negotiation_sessions_buyer_control_mode_ck"
  CHECK ("buyer_control_mode" IN ('auto', 'manual'));
--> statement-breakpoint
ALTER TABLE "negotiation_sessions"
  DROP CONSTRAINT IF EXISTS "negotiation_sessions_seller_control_mode_ck";
--> statement-breakpoint
ALTER TABLE "negotiation_sessions"
  ADD CONSTRAINT "negotiation_sessions_seller_control_mode_ck"
  CHECK ("seller_control_mode" IN ('auto', 'manual'));
--> statement-breakpoint
ALTER TABLE "negotiation_sessions"
  DROP CONSTRAINT IF EXISTS "negotiation_sessions_buyer_pending_control_mode_ck";
--> statement-breakpoint
ALTER TABLE "negotiation_sessions"
  ADD CONSTRAINT "negotiation_sessions_buyer_pending_control_mode_ck"
  CHECK ("buyer_pending_control_mode" IS NULL OR "buyer_pending_control_mode" IN ('auto', 'manual'));
--> statement-breakpoint
ALTER TABLE "negotiation_sessions"
  DROP CONSTRAINT IF EXISTS "negotiation_sessions_seller_pending_control_mode_ck";
--> statement-breakpoint
ALTER TABLE "negotiation_sessions"
  ADD CONSTRAINT "negotiation_sessions_seller_pending_control_mode_ck"
  CHECK ("seller_pending_control_mode" IS NULL OR "seller_pending_control_mode" IN ('auto', 'manual'));
--> statement-breakpoint
ALTER TABLE "negotiation_sessions"
  DROP CONSTRAINT IF EXISTS "negotiation_sessions_soft_ai_inflight_party_ck";
--> statement-breakpoint
ALTER TABLE "negotiation_sessions"
  ADD CONSTRAINT "negotiation_sessions_soft_ai_inflight_party_ck"
  CHECK ("soft_ai_inflight_party" IS NULL OR "soft_ai_inflight_party" IN ('buyer', 'seller'));
--> statement-breakpoint
ALTER TABLE "negotiation_sessions"
  DROP CONSTRAINT IF EXISTS "negotiation_sessions_seller_manual_timeout_phase_ck";
--> statement-breakpoint
ALTER TABLE "negotiation_sessions"
  ADD CONSTRAINT "negotiation_sessions_seller_manual_timeout_phase_ck"
  CHECK (
    "seller_manual_timeout_phase" IS NULL
    OR "seller_manual_timeout_phase" IN ('first', 'later')
  );
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "negotiation_sessions_seller_manual_timeout_idx"
  ON "negotiation_sessions" ("seller_control_mode", "seller_manual_since")
  WHERE "seller_control_mode" = 'manual' AND "seller_manual_since" IS NOT NULL;
