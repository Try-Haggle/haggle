import { pgTable, uuid, text, integer, numeric, boolean, timestamp, jsonb, index } from "drizzle-orm/pg-core";

export const recommendationLogs = pgTable("recommendation_logs", {
  id: uuid("id").defaultRandom().primaryKey(),
  userId: uuid("user_id"),
  context: text("context").notNull(),
  sourceType: text("source_type").notNull(),
  sourceListingId: uuid("source_listing_id"),
  recommendedListingId: uuid("recommended_listing_id").notNull(),
  position: integer("position").notNull(),
  compositeScore: numeric("composite_score", { precision: 6, scale: 4 }).notNull(),
  signalScores: jsonb("signal_scores").notNull().$type<Record<string, number>>(),
  clicked: boolean("clicked").notNull().default(false),
  clickedAt: timestamp("clicked_at", { withTimezone: true }),
  negotiationStarted: boolean("negotiation_started").notNull().default(false),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
}, (table) => [
  index("idx_recommendation_logs_user").on(table.userId),
  index("idx_recommendation_logs_created").on(table.createdAt),
]);
