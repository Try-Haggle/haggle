import { pgTable, uuid, text, timestamp, numeric, jsonb } from "drizzle-orm/pg-core";

export const listingDrafts = pgTable("listing_drafts", {
  id: uuid("id").defaultRandom().primaryKey(),
  status: text("status", { enum: ["draft", "published", "expired"] })
    .notNull()
    .default("draft"),
  userId: uuid("user_id"), // nullable — linked after claim
  claimToken: text("claim_token"),
  claimExpiresAt: timestamp("claim_expires_at", { withTimezone: true }),
  title: text("title"),
  category: text("category"),
  brand: text("brand"),
  model: text("model"),
  condition: text("condition"),
  description: text("description"),
  targetPrice: numeric("target_price", { precision: 12, scale: 2 }),
  floorPrice: numeric("floor_price", { precision: 12, scale: 2 }),
  strategyConfig: jsonb("strategy_config").$type<Record<string, unknown>>(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});
