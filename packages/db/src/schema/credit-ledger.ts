import {
  index,
  integer,
  jsonb,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from "drizzle-orm/pg-core";

/**
 * Soft-AI credit balance wallet (Eng1 C1).
 *
 * Orthogonal to trust-ledger* (reputation / settlement reliability).
 * SoT: docs/wip/credit-ledger-sot.md
 *
 * Idempotency keys are scoped per account (account_id, idempotency_key) —
 * never globally unique on the key alone (security residual).
 */

export const CREDIT_LEDGER_KINDS = ["grant", "debit"] as const;
export type CreditLedgerKind = (typeof CREDIT_LEDGER_KINDS)[number];

export const creditAccounts = pgTable(
  "credit_accounts",
  {
    accountId: uuid("account_id").primaryKey(),
    /** Denormalized Soft-credit balance; must stay consistent with ledger entries. */
    balance: integer("balance").notNull().default(0),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [index("credit_accounts_balance_idx").on(table.balance)],
);

export const creditLedgerEntries = pgTable(
  "credit_ledger_entries",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    accountId: uuid("account_id").notNull(),
    /** Signed integer: +N grant, -N debit. */
    delta: integer("delta").notNull(),
    kind: text("kind", { enum: ["grant", "debit"] }).notNull(),
    /** Grant reason or debit kind (signup, soft_ai, …). */
    reason: text("reason").notNull(),
    /**
     * Logical event key. Unique together with account_id only —
     * do not add a global unique index on idempotency_key alone.
     */
    idempotencyKey: text("idempotency_key").notNull(),
    refType: text("ref_type"),
    refId: text("ref_id"),
    balanceAfter: integer("balance_after").notNull(),
    metadata: jsonb("metadata").$type<Record<string, unknown>>(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    // biome-ignore format: kept on one line for scripts/verify-db-invariants.mjs string check
    uniqueIndex("credit_ledger_entries_account_idempotency_key_idx").on(table.accountId, table.idempotencyKey),
    index("credit_ledger_entries_account_created_idx").on(table.accountId, table.createdAt),
    index("credit_ledger_entries_ref_idx").on(table.refType, table.refId),
  ],
);
