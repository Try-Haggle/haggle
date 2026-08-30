import { sql } from "drizzle-orm";
import {
  check,
  index,
  integer,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from "drizzle-orm/pg-core";

/**
 * One live sold-slot per listing.
 *
 * ACCEPT opens OPEN_HOLD. The first buyer to begin funding CAS-wins.
 * EXCLUSIVE columns exist so a later credit product can lock the same row
 * without a second mutex. Nothing writes EXCLUSIVE in this slice.
 */
export const listingClaims = pgTable(
  "listing_claims",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    listingId: uuid("listing_id").notNull(),
    openedBySessionId: uuid("opened_by_session_id").notNull(),
    openedByBuyerId: uuid("opened_by_buyer_id").notNull(),
    sellerId: uuid("seller_id").notNull(),
    status: text("status", {
      enum: ["OPEN", "EXCLUSIVE", "FUNDING", "FUNDED"],
    })
      .notNull()
      .default("OPEN"),
    lockKind: text("lock_kind", {
      enum: ["OPEN_HOLD", "EXCLUSIVE"],
    })
      .notNull()
      .default("OPEN_HOLD"),
    exclusiveBuyerId: uuid("exclusive_buyer_id"),
    exclusiveUntil: timestamp("exclusive_until", { withTimezone: true }),
    fundingBuyerId: uuid("funding_buyer_id"),
    fundingSessionId: uuid("funding_session_id"),
    fundingSettlementApprovalId: uuid("funding_settlement_approval_id"),
    fundingPaymentIntentId: uuid("funding_payment_intent_id"),
    fundingLeaseExpiresAt: timestamp("funding_lease_expires_at", { withTimezone: true }),
    fundedAt: timestamp("funded_at", { withTimezone: true }),
    /** Standing accept. Checkout floor only. Negotiation still starts from the ask. */
    holdPriceMinor: integer("hold_price_minor"),
    holdBuyerId: uuid("hold_buyer_id"),
    holdExpiresAt: timestamp("hold_expires_at", { withTimezone: true }),
    version: integer("version").notNull().default(1),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => ({
    activeListingUnique: uniqueIndex("listing_claims_active_listing_unique")
      .on(table.listingId)
      .where(sql`status in ('OPEN', 'EXCLUSIVE', 'FUNDING', 'FUNDED')`),
    listingStatusIdx: index("listing_claims_listing_status_idx").on(table.listingId, table.status),
    statusCheck: check(
      "listing_claims_status_check",
      sql`status in ('OPEN', 'EXCLUSIVE', 'FUNDING', 'FUNDED')`,
    ),
    lockKindCheck: check(
      "listing_claims_lock_kind_check",
      sql`lock_kind in ('OPEN_HOLD', 'EXCLUSIVE')`,
    ),
    exclusiveFieldsCheck: check(
      "listing_claims_exclusive_fields_check",
      sql`(lock_kind = 'OPEN_HOLD' and exclusive_buyer_id is null and exclusive_until is null)
          or (lock_kind = 'EXCLUSIVE' and exclusive_buyer_id is not null and exclusive_until is not null)`,
    ),
  }),
);
