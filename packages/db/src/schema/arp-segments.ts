import { integer, numeric, pgTable, text, timestamp, uuid } from "drizzle-orm/pg-core";

export const arpSegments = pgTable("arp_segments", {
  id: uuid("id").defaultRandom().primaryKey(),
  category: text("category"),
  amountTier: text("amount_tier"),
  tag: text("tag"),
  reviewHours: numeric("review_hours", { precision: 8, scale: 2 }).notNull(),
  sampleCount: integer("sample_count").notNull().default(0),
  lastAdjustedAt: timestamp("last_adjusted_at", { withTimezone: true }),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});
