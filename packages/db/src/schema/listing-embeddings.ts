import { pgTable, uuid, text, integer, timestamp, index } from "drizzle-orm/pg-core";
import { listingsPublished } from "./listings-published.js";
import { vector } from "./pgvector.js";

export const listingEmbeddings = pgTable("listing_embeddings", {
  id: uuid("id").defaultRandom().primaryKey(),
  publishedListingId: uuid("published_listing_id")
    .notNull()
    .unique()
    .references(() => listingsPublished.id, { onDelete: "cascade" }),
  textEmbedding: vector("text_embedding", 1536),
  imageEmbedding: vector("image_embedding", 768),
  textHash: text("text_hash"),
  imageHash: text("image_hash"),
  modelVersion: text("model_version").notNull(),
  status: text("status", { enum: ["pending", "completed", "failed", "dead"] })
    .notNull()
    .default("pending"),
  retryCount: integer("retry_count").notNull().default(0),
  failedAt: timestamp("failed_at", { withTimezone: true }),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});
