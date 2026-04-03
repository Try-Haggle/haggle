import { pgTable, text, integer, numeric, timestamp } from "drizzle-orm/pg-core";

export const tagIdfCache = pgTable("tag_idf_cache", {
  tag: text("tag").primaryKey(),
  docCount: integer("doc_count").notNull(),
  idfScore: numeric("idf_score", { precision: 8, scale: 4 }).notNull(),
  totalDocs: integer("total_docs").notNull(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});
