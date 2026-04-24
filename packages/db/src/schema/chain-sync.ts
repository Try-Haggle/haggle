import { integer, pgTable, text, timestamp } from "drizzle-orm/pg-core";

/**
 * Tracks the last processed block per contract for the on-chain event listener.
 * Used as a cursor so we never re-process or skip blocks across restarts.
 */
export const chainSyncCursors = pgTable("chain_sync_cursors", {
  /** Logical key: 'settlement_router' | 'dispute_registry' */
  id: text("id").primaryKey(),
  chainId: integer("chain_id").notNull(),
  /** Last fully processed block number (bigint stored as text for Drizzle compat) */
  lastBlockNumber: text("last_block_number").notNull().default("0"),
  lastSyncedAt: timestamp("last_synced_at", { withTimezone: true }).defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow(),
});
