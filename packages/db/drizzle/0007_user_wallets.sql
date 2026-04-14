CREATE TABLE IF NOT EXISTS "user_wallets" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "user_id" uuid NOT NULL,
  "wallet_address" text NOT NULL,
  "network" text NOT NULL,
  "role" text NOT NULL,
  "is_primary" boolean DEFAULT false NOT NULL,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL,
  CONSTRAINT "user_wallets_user_network_role_unique" UNIQUE ("user_id", "network", "role")
);
