-- Step 80: Address Collection tables
-- Tables: order_addresses, user_saved_addresses
--
-- order_addresses stores per-order buyer/seller addresses (snapshotted).
-- user_saved_addresses stores reusable address book entries per user.

-- ============================================================
-- Order Addresses (per-order snapshot)
-- ============================================================

CREATE TABLE IF NOT EXISTS "order_addresses" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"order_id" uuid NOT NULL REFERENCES "commerce_orders"("id"),
	"role" text NOT NULL,
	"name" text NOT NULL,
	"company" text,
	"street1" text NOT NULL,
	"street2" text,
	"city" text NOT NULL,
	"state" text NOT NULL,
	"zip" text NOT NULL,
	"country" text NOT NULL DEFAULT 'US',
	"phone" text,
	"email" text,
	"verified" boolean DEFAULT false,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "chk_order_addresses_role" CHECK ("role" IN ('buyer','seller')),
	CONSTRAINT "chk_order_addresses_zip" CHECK ("zip" ~ '^\d{5}$'),
	CONSTRAINT "chk_order_addresses_state" CHECK ("state" ~ '^[A-Z]{2}$'),
	CONSTRAINT "order_addresses_order_role_unique" UNIQUE ("order_id", "role")
);

-- ============================================================
-- User Saved Addresses (reusable address book)
-- ============================================================

CREATE TABLE IF NOT EXISTS "user_saved_addresses" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"label" text DEFAULT 'home',
	"name" text NOT NULL,
	"street1" text NOT NULL,
	"street2" text,
	"city" text NOT NULL,
	"state" text NOT NULL,
	"zip" text NOT NULL,
	"country" text NOT NULL DEFAULT 'US',
	"phone" text,
	"is_default" boolean DEFAULT false,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "chk_user_saved_addresses_zip" CHECK ("zip" ~ '^\d{5}$'),
	CONSTRAINT "chk_user_saved_addresses_state" CHECK ("state" ~ '^[A-Z]{2}$')
);

-- ============================================================
-- Indexes
-- ============================================================

CREATE INDEX IF NOT EXISTS "idx_order_addresses_order_id" ON "order_addresses" ("order_id");
CREATE INDEX IF NOT EXISTS "idx_user_saved_addresses_user_id" ON "user_saved_addresses" ("user_id");
