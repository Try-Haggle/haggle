import { integer, jsonb, numeric, pgTable, text, timestamp, uuid } from "drizzle-orm/pg-core";

export const trustScores = pgTable("trust_scores", {
  id: uuid("id").defaultRandom().primaryKey(),
  actorId: uuid("actor_id").notNull(),
  actorRole: text("actor_role", { enum: ["buyer", "seller", "combined"] }).notNull(),
  score: numeric("score", { precision: 8, scale: 4 }).notNull(),
  status: text("status", { enum: ["NEW", "SCORING", "MATURE"] }).notNull(),
  completedTransactions: integer("completed_transactions").notNull().default(0),
  weightsVersion: text("weights_version").notNull(),
  rawScore: numeric("raw_score", { precision: 8, scale: 4 }).notNull(),
  slaPenaltyFactor: numeric("sla_penalty_factor", { precision: 8, scale: 4 }).notNull().default("1.0"),
  rawInputs: jsonb("raw_inputs").$type<Record<string, unknown>>(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});
