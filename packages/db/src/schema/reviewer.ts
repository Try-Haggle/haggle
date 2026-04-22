import { boolean, integer, numeric, pgTable, text, timestamp, unique, uuid } from "drizzle-orm/pg-core";

export const reviewerAssignments = pgTable(
  "reviewer_assignments",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    disputeId: uuid("dispute_id").notNull(),
    reviewerId: uuid("reviewer_id").notNull(),
    slotCost: integer("slot_cost").notNull().default(1),
    assignedAt: timestamp("assigned_at", { withTimezone: true }).notNull().defaultNow(),
    voteValue: integer("vote_value"),
    voteWeight: numeric("vote_weight", { precision: 4, scale: 2 }),
    votedAt: timestamp("voted_at", { withTimezone: true }),
    reasoning: text("reasoning"),
  },
  (table) => ({
    uniqueDisputeReviewer: unique("reviewer_assignments_dispute_reviewer_uniq").on(
      table.disputeId,
      table.reviewerId,
    ),
  }),
);

export const reviewerProfiles = pgTable("reviewer_profiles", {
  userId: uuid("user_id").primaryKey(),
  dsScore: integer("ds_score").notNull().default(0),
  dsTier: text("ds_tier", {
    enum: ["BRONZE", "SILVER", "GOLD", "PLATINUM", "DIAMOND"],
  })
    .notNull()
    .default("BRONZE"),
  voteWeight: numeric("vote_weight", { precision: 4, scale: 2 }).notNull().default("0.63"),
  casesReviewed: integer("cases_reviewed").notNull().default(0),
  zoneHitRate: numeric("zone_hit_rate", { precision: 4, scale: 3 }),
  participationRate: numeric("participation_rate", { precision: 4, scale: 3 }),
  avgResponseHours: numeric("avg_response_hours", { precision: 6, scale: 1 }),
  activeSlots: integer("active_slots").notNull().default(0),
  maxSlots: integer("max_slots").notNull().default(3),
  qualified: boolean("qualified").notNull().default(false),
  qualifiedAt: timestamp("qualified_at", { withTimezone: true }),
  qualifyScore: integer("qualify_score"),
  totalEarningsCents: integer("total_earnings_cents").notNull().default(0),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});
