import { integer, jsonb, pgTable, text, timestamp, uuid } from "drizzle-orm/pg-core";

export const disputeDeposits = pgTable("dispute_deposits", {
  id: uuid("id").defaultRandom().primaryKey(),
  disputeId: uuid("dispute_id").notNull(),
  tier: integer("tier").notNull(),
  amountCents: integer("amount_cents").notNull(),
  status: text("status", { enum: ["PENDING", "DEPOSITED", "FORFEITED", "REFUNDED"] }).notNull().default("PENDING"),
  deadlineHours: integer("deadline_hours").notNull(),
  deadlineAt: timestamp("deadline_at", { withTimezone: true }),
  depositedAt: timestamp("deposited_at", { withTimezone: true }),
  resolvedAt: timestamp("resolved_at", { withTimezone: true }),
  metadata: jsonb("metadata").$type<Record<string, unknown>>(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});
