CREATE TABLE IF NOT EXISTS "chain_sync_cursors" (
  "id" text PRIMARY KEY NOT NULL,
  "chain_id" integer NOT NULL,
  "last_block_number" text NOT NULL DEFAULT '0',
  "last_synced_at" timestamp with time zone DEFAULT now(),
  "updated_at" timestamp with time zone DEFAULT now()
);
