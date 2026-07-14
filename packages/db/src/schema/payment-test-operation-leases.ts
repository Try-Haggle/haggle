import { index, pgTable, text, timestamp, uuid } from "drizzle-orm/pg-core";

export const paymentTestOperationLeases = pgTable(
  "payment_test_operation_leases",
  {
    key: text("key").primaryKey(),
    leaseId: uuid("lease_id").notNull(),
    ownerId: text("owner_id").notNull(),
    expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => ({ expiresIdx: index("payment_test_operation_leases_expires_idx").on(table.expiresAt) }),
);
