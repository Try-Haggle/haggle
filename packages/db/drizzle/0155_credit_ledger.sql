-- Eng1 C1: Soft-AI credit account + append-only ledger (not trust-ledger*).
-- SoT: docs/wip/credit-ledger-sot.md
-- Idempotency unique per (account_id, idempotency_key) — never global on key alone.

CREATE TABLE IF NOT EXISTS "credit_accounts" (
  "account_id" uuid PRIMARY KEY NOT NULL,
  "balance" integer DEFAULT 0 NOT NULL,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "credit_accounts_balance_idx" ON "credit_accounts" ("balance");
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "credit_ledger_entries" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "account_id" uuid NOT NULL,
  "delta" integer NOT NULL,
  "kind" text NOT NULL,
  "reason" text NOT NULL,
  "idempotency_key" text NOT NULL,
  "ref_type" text,
  "ref_id" text,
  "balance_after" integer NOT NULL,
  "metadata" jsonb,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "credit_ledger_entries_account_idempotency_key_idx"
  ON "credit_ledger_entries" ("account_id", "idempotency_key");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "credit_ledger_entries_account_created_idx"
  ON "credit_ledger_entries" ("account_id", "created_at");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "credit_ledger_entries_ref_idx"
  ON "credit_ledger_entries" ("ref_type", "ref_id");
--> statement-breakpoint
ALTER TABLE "credit_ledger_entries"
  DROP CONSTRAINT IF EXISTS "credit_ledger_entries_kind_ck";
--> statement-breakpoint
ALTER TABLE "credit_ledger_entries"
  ADD CONSTRAINT "credit_ledger_entries_kind_ck"
  CHECK ("kind" IN ('grant', 'debit'));
--> statement-breakpoint
ALTER TABLE "credit_ledger_entries"
  DROP CONSTRAINT IF EXISTS "credit_ledger_entries_delta_kind_ck";
--> statement-breakpoint
ALTER TABLE "credit_ledger_entries"
  ADD CONSTRAINT "credit_ledger_entries_delta_kind_ck"
  CHECK (
    ("kind" = 'grant' AND "delta" > 0)
    OR ("kind" = 'debit' AND "delta" < 0)
  );
