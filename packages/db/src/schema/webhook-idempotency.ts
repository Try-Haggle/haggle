import { index, integer, pgTable, text, timestamp, unique, uuid } from "drizzle-orm/pg-core";
import { sql } from "drizzle-orm";

export const webhookIdempotency = pgTable("webhook_idempotency", {
  id: uuid("id").defaultRandom().primaryKey(),
  idempotencyKey: text("idempotency_key").notNull(),
  source: text("source").notNull(), // e.g., 'x402', 'easypost', 'legitapp'
  status: text("status", { enum: ["PROCESSING", "COMPLETED", "FAILED"] }).notNull().default("COMPLETED"),
  claimId: uuid("claim_id"),
  leaseExpiresAt: timestamp("lease_expires_at", { withTimezone: true }),
  attemptCount: integer("attempt_count").notNull().default(0),
  payloadSha256: text("payload_sha256"),
  lastError: text("last_error"),
  nextAttemptAt: timestamp("next_attempt_at", { withTimezone: true }),
  completedAt: timestamp("completed_at", { withTimezone: true }),
  processedAt: timestamp("processed_at", { withTimezone: true }).notNull().defaultNow(),
  expiresAt: timestamp("expires_at", { withTimezone: true })
    .notNull()
    .default(sql`now() + interval '30 days'`),
  responseStatus: integer("response_status"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
}, (table) => ({
  sourceEventUnique: unique("webhook_idempotency_source_event_unique").on(table.source, table.idempotencyKey),
  statusLeaseIdx: index("webhook_idempotency_status_lease_idx").on(table.status, table.leaseExpiresAt),
}));
