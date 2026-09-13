-- Builder threads keep the conversation's memory beside its messages, so a
-- thread restored on another surface or device resumes with what it had
-- established, not just with its transcript. Nullable: older rows have none.
ALTER TABLE "agent_builder_threads" ADD COLUMN IF NOT EXISTS "memory" jsonb;
