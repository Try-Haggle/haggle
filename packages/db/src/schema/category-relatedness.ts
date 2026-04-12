import { pgTable, text, numeric, primaryKey } from "drizzle-orm/pg-core";

export const categoryRelatedness = pgTable("category_relatedness", {
  categoryFrom: text("category_from").notNull(),
  categoryTo: text("category_to").notNull(),
  score: numeric("score", { precision: 4, scale: 2 }).notNull(),
}, (table) => [
  primaryKey({ columns: [table.categoryFrom, table.categoryTo] }),
]);
