import { boolean, integer, jsonb, numeric, pgTable, text, timestamp, uuid } from "drizzle-orm/pg-core";

export const skills = pgTable("skills", {
  id: uuid("id").defaultRandom().primaryKey(),
  skillId: text("skill_id").notNull().unique(),
  name: text("name").notNull(),
  description: text("description").notNull(),
  version: text("version").notNull(),
  category: text("category", {
    enum: ["STRATEGY", "DATA", "INTERPRETATION", "AUTHENTICATION", "DISPUTE_RESOLUTION"],
  }).notNull(),
  provider: text("provider", {
    enum: ["FIRST_PARTY", "THIRD_PARTY", "COMMUNITY"],
  }).notNull(),
  status: text("status", {
    enum: ["DRAFT", "ACTIVE", "SUSPENDED", "DEPRECATED"],
  }).notNull().default("DRAFT"),
  supportedCategories: jsonb("supported_categories").$type<string[]>().notNull(),
  hookPoints: jsonb("hook_points").$type<string[]>().notNull(),
  pricing: jsonb("pricing").$type<Record<string, unknown>>().notNull(),
  configSchema: jsonb("config_schema").$type<Record<string, unknown>>(),
  usageCount: integer("usage_count").notNull().default(0),
  averageLatencyMs: numeric("average_latency_ms", { precision: 8, scale: 2 }).notNull().default("0"),
  errorRate: numeric("error_rate", { precision: 8, scale: 4 }).notNull().default("0"),
  metadata: jsonb("metadata").$type<Record<string, unknown>>(),
  registeredAt: timestamp("registered_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});

export const skillExecutions = pgTable("skill_executions", {
  id: uuid("id").defaultRandom().primaryKey(),
  skillId: text("skill_id").notNull(),
  hookPoint: text("hook_point").notNull(),
  success: boolean("success").notNull(),
  latencyMs: integer("latency_ms").notNull(),
  inputSummary: jsonb("input_summary").$type<Record<string, unknown>>(),
  outputSummary: jsonb("output_summary").$type<Record<string, unknown>>(),
  error: text("error"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});
