import { pgTable, uuid, integer, timestamp } from "drizzle-orm/pg-core";
import { vector } from "./pgvector.js";

export const buyerInterestVectors = pgTable("buyer_interest_vectors", {
  id: uuid("id").defaultRandom().primaryKey(),
  userId: uuid("user_id").notNull().unique(),
  interestVector: vector("interest_vector", 1536).notNull(),
  basedOnCount: integer("based_on_count").notNull(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});
