CREATE TABLE IF NOT EXISTS "agent_builder_threads" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"thread_key" text NOT NULL,
	"preset_id" text,
	"agent_id" uuid,
	"messages" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "agent_builder_threads_user_key_idx" ON "agent_builder_threads" ("user_id","thread_key");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "agent_builder_threads_user_updated_idx" ON "agent_builder_threads" ("user_id","updated_at");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "agent_builder_threads_agent_idx" ON "agent_builder_threads" ("agent_id");
