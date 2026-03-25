import { pgTable, uuid, text, timestamp, uniqueIndex } from "drizzle-orm/pg-core";
import { listingsPublished } from "./listings-published.js";

export const buyerListings = pgTable(
  "buyer_listings",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    userId: uuid("user_id").notNull(),
    publishedListingId: uuid("published_listing_id")
      .notNull()
      .references(() => listingsPublished.id),
    status: text("status", {
      enum: ["viewed", "negotiating", "completed", "cancelled"],
    })
      .notNull()
      .default("viewed"),
    firstViewedAt: timestamp("first_viewed_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    lastViewedAt: timestamp("last_viewed_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    negotiationStartedAt: timestamp("negotiation_started_at", {
      withTimezone: true,
    }),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => [
    uniqueIndex("buyer_listings_user_listing_idx").on(
      table.userId,
      table.publishedListingId,
    ),
  ],
);
