import { pgTable, uuid, text, timestamp, jsonb } from "drizzle-orm/pg-core";
import { listingDrafts } from "./listing-drafts.js";

export const listingsPublished = pgTable("listings_published", {
  id: uuid("id").defaultRandom().primaryKey(),
  publicId: text("public_id").notNull().unique(),
  draftId: uuid("draft_id")
    .notNull()
    .references(() => listingDrafts.id),
  snapshotJson: jsonb("snapshot_json")
    .notNull()
    .$type<Record<string, unknown>>(),
  publishedAt: timestamp("published_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
});
