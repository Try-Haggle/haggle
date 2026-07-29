CREATE TABLE "dispute_precedents" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"source_dispute_id" uuid NOT NULL,
	"source_snapshot_sha256" text NOT NULL,
	"reason_code" text NOT NULL,
	"outcome" text NOT NULL,
	"status" text DEFAULT 'CANDIDATE' NOT NULL,
	"facts_summary" text,
	"issue_summary" text,
	"decision_principle" text,
	"evidence_profile" jsonb,
	"distinguishing_factors" jsonb,
	"remedy_summary" text,
	"analysis_version" text,
	"policy_version" text,
	"analyzed_by" text,
	"analyzed_at" timestamp with time zone,
	"approved_by" text,
	"approved_at" timestamp with time zone,
	"effective_from" timestamp with time zone,
	"effective_until" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "dispute_precedents_approved_analysis_complete" CHECK ("dispute_precedents"."status" <> 'APPROVED' OR (
        "dispute_precedents"."facts_summary" IS NOT NULL
        AND "dispute_precedents"."issue_summary" IS NOT NULL
        AND "dispute_precedents"."decision_principle" IS NOT NULL
        AND "dispute_precedents"."evidence_profile" IS NOT NULL
        AND "dispute_precedents"."analysis_version" IS NOT NULL
        AND "dispute_precedents"."policy_version" IS NOT NULL
        AND "dispute_precedents"."approved_by" IS NOT NULL
        AND "dispute_precedents"."approved_at" IS NOT NULL
        AND "dispute_precedents"."effective_from" IS NOT NULL
      )),
	CONSTRAINT "dispute_precedents_effective_window_valid" CHECK ("dispute_precedents"."effective_until" IS NULL OR "dispute_precedents"."effective_from" IS NULL OR "dispute_precedents"."effective_until" > "dispute_precedents"."effective_from")
);
--> statement-breakpoint
CREATE UNIQUE INDEX "dispute_precedents_source_dispute_unique" ON "dispute_precedents" USING btree ("source_dispute_id");--> statement-breakpoint
CREATE INDEX "dispute_precedents_runtime_lookup_idx" ON "dispute_precedents" USING btree ("status","reason_code","effective_from","approved_at");