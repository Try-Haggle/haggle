CREATE TABLE IF NOT EXISTS "websocket_auth_tickets" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "token_hash" text NOT NULL,
  "user_id" uuid NOT NULL,
  "channel" text NOT NULL,
  "resource_id" uuid,
  "expires_at" timestamp with time zone NOT NULL,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  CONSTRAINT "ws_auth_tickets_hash_ck" CHECK ("token_hash" ~ '^[0-9a-f]{64}$'),
  CONSTRAINT "ws_auth_tickets_channel_ck" CHECK ("channel" IN ('negotiation', 'notification')),
  CONSTRAINT "ws_auth_tickets_scope_ck" CHECK (
    ("channel" = 'notification' AND "resource_id" IS NULL)
    OR ("channel" = 'negotiation' AND "resource_id" IS NOT NULL)
  ),
  CONSTRAINT "ws_auth_tickets_lifetime_ck" CHECK (
    "expires_at" > "created_at"
    AND "expires_at" <= "created_at" + interval '60 seconds'
  )
);
CREATE UNIQUE INDEX IF NOT EXISTS "ws_auth_tickets_token_hash_uidx"
  ON "websocket_auth_tickets" USING btree ("token_hash");
CREATE INDEX IF NOT EXISTS "ws_auth_tickets_expiry_idx"
  ON "websocket_auth_tickets" USING btree ("expires_at");
