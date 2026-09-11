ALTER TABLE "negotiation_sessions" ADD COLUMN "driver" text DEFAULT 'web' NOT NULL;--> statement-breakpoint
ALTER TABLE "negotiation_sessions" ADD CONSTRAINT "negotiation_sessions_driver_ck" CHECK ("driver" IN ('web', 'mcp'));--> statement-breakpoint
CREATE TABLE "mcp_oauth_clients" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "client_id" text NOT NULL,
  "client_secret_hash" text,
  "client_name" text NOT NULL,
  "redirect_uris" text[] NOT NULL,
  "token_endpoint_auth_method" text DEFAULT 'none' NOT NULL,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  CONSTRAINT "mcp_oauth_clients_secret_hash_ck" CHECK ("client_secret_hash" IS NULL OR "client_secret_hash" ~ '^[0-9a-f]{64}$')
);--> statement-breakpoint
CREATE UNIQUE INDEX "mcp_oauth_clients_client_id_uidx" ON "mcp_oauth_clients" ("client_id");--> statement-breakpoint
CREATE TABLE "mcp_oauth_authorization_codes" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "code_hash" text NOT NULL,
  "client_id" text NOT NULL,
  "user_id" uuid NOT NULL,
  "redirect_uri" text NOT NULL,
  "code_challenge" text NOT NULL,
  "code_challenge_method" text DEFAULT 'S256' NOT NULL,
  "scopes" text[] NOT NULL,
  "expires_at" timestamp with time zone NOT NULL,
  "consumed_at" timestamp with time zone,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  CONSTRAINT "mcp_oauth_codes_hash_ck" CHECK ("code_hash" ~ '^[0-9a-f]{64}$'),
  CONSTRAINT "mcp_oauth_codes_challenge_method_ck" CHECK ("code_challenge_method" = 'S256')
);--> statement-breakpoint
CREATE UNIQUE INDEX "mcp_oauth_codes_hash_uidx" ON "mcp_oauth_authorization_codes" ("code_hash");--> statement-breakpoint
CREATE INDEX "mcp_oauth_codes_expiry_idx" ON "mcp_oauth_authorization_codes" ("expires_at");--> statement-breakpoint
CREATE TABLE "mcp_oauth_access_tokens" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "token_hash" text NOT NULL,
  "refresh_token_hash" text,
  "client_id" text NOT NULL,
  "user_id" uuid NOT NULL,
  "scopes" text[] NOT NULL,
  "expires_at" timestamp with time zone NOT NULL,
  "refresh_expires_at" timestamp with time zone,
  "revoked_at" timestamp with time zone,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  CONSTRAINT "mcp_oauth_tokens_hash_ck" CHECK ("token_hash" ~ '^[0-9a-f]{64}$'),
  CONSTRAINT "mcp_oauth_tokens_refresh_hash_ck" CHECK ("refresh_token_hash" IS NULL OR "refresh_token_hash" ~ '^[0-9a-f]{64}$')
);--> statement-breakpoint
CREATE UNIQUE INDEX "mcp_oauth_tokens_hash_uidx" ON "mcp_oauth_access_tokens" ("token_hash");--> statement-breakpoint
CREATE UNIQUE INDEX "mcp_oauth_tokens_refresh_hash_uidx" ON "mcp_oauth_access_tokens" ("refresh_token_hash");--> statement-breakpoint
CREATE INDEX "mcp_oauth_tokens_user_idx" ON "mcp_oauth_access_tokens" ("user_id");
