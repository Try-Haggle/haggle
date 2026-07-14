import {
  index,
  jsonb,
  pgTable,
  timestamp,
  unique,
  uuid,
  varchar,
} from "drizzle-orm/pg-core";

export const disputeEvidenceScanRetryAlertSnapshots = pgTable(
  "dispute_evidence_scan_retry_alert_snapshots",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    source: varchar("source", { length: 120 }).notNull(),
    deliveryId: varchar("delivery_id", { length: 80 }).notNull(),
    snapshotKind: varchar("snapshot_kind", {
      length: 16,
      enum: ["FIRING", "RECOVERY"],
    }).notNull(),
    payload: jsonb("payload").$type<Record<string, unknown>>().notNull(),
    payloadSha256: varchar("payload_sha256", { length: 64 }).notNull(),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull().defaultNow(),
    expiresAt: timestamp("expires_at", { withTimezone: true })
      .notNull(),
  },
  (table) => ({
    sourceDeliveryUnique: unique(
      "dispute_scan_retry_alert_snapshot_source_delivery_unique",
    ).on(table.source, table.deliveryId),
    expiryIdx: index("dispute_scan_retry_alert_snapshot_expiry_idx")
      .on(table.expiresAt),
  }),
);
