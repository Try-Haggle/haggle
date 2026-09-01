import { integer, jsonb, numeric, pgTable, text, timestamp, uuid } from "drizzle-orm/pg-core";

export const listingDrafts = pgTable("listing_drafts", {
  id: uuid("id").defaultRandom().primaryKey(),
  status: text("status", { enum: ["draft", "published", "expired"] })
    .notNull()
    .default("draft"),
  userId: uuid("user_id"), // nullable — linked after claim
  claimToken: text("claim_token"),
  claimExpiresAt: timestamp("claim_expires_at", { withTimezone: true }),
  currentStep: integer("current_step").notNull().default(1),
  draftName: text("draft_name"),
  title: text("title"),
  description: text("description"),
  tags: text("tags").array(),
  category: text("category"),
  condition: text("condition"),
  photoUrl: text("photo_url"),
  targetPrice: numeric("target_price", { precision: 12, scale: 2 }),
  floorPrice: numeric("floor_price", { precision: 12, scale: 2 }),
  sellingDeadline: timestamp("selling_deadline", { withTimezone: true }),
  /** Per-listing agent snapshot (preset, weights, engineParams, builder chat
   *  data). The negotiation runs off this frozen snapshot; editing the source
   *  agent later does not change in-flight negotiations until re-saved.
   *  Was strategy_config (0024) → negotiation_agent_draft → snapshot (0027). */
  negotiationAgentSnapshot: jsonb("negotiation_agent_snapshot").$type<Record<string, unknown>>(),
  /** Provenance/analytics: the negotiation_agents row id (custom) or preset id
   *  (e.g. "balancer") this listing's agent came from. Not a DB FK — holds both. */
  agentId: text("agent_id"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  /**
   * Seller withdrew the listing from public view. The row stays for
   * `LISTING_WITHDRAW_RETENTION_DAYS` (90) so ops can still read it.
   */
  withdrawnAt: timestamp("withdrawn_at", { withTimezone: true }),
});
