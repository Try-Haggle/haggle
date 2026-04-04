import type {
  SettlementHold,
  SettlementResolution,
  DepositRequirement,
} from "./types.js";
import { REVIEWER_SHARE, PLATFORM_SHARE } from "./types.js";

/**
 * Create a settlement hold when a dispute is opened.
 * The original transaction funds are held in escrow until resolved.
 */
export function createSettlementHold(
  dispute_id: string,
  order_id: string,
  amount_cents: number,
  now: string,
): SettlementHold {
  if (amount_cents <= 0) {
    throw new Error("amount_cents must be positive");
  }

  return {
    dispute_id,
    order_id,
    held_amount_cents: amount_cents,
    status: "HELD",
    held_at: now,
  };
}

/**
 * Resolve the settlement after a dispute outcome.
 *
 * Dispute cost is ALWAYS paid by the loser:
 * - buyer_favor  → seller lost → dispute cost from seller deposit
 * - seller_favor → buyer lost  → dispute cost deducted from escrowed amount
 * - partial_refund → seller lost → dispute cost from seller deposit
 *
 * Dispute cost goes to: reviewers (70%) + platform (30%)
 *
 * Seller deposit (separate):
 * - Seller loses → deposit forfeited to platform
 * - Seller wins  → deposit refunded
 * - Tier 1 (no deposit) → both are 0
 *
 * @param dispute_cost_cents - The dispute cost for this tier (from computeDisputeCost)
 */
export function resolveSettlement(
  hold: SettlementHold,
  outcome: "buyer_favor" | "seller_favor" | "partial_refund",
  refund_amount_cents: number | undefined,
  deposit: DepositRequirement | null,
  dispute_cost_cents: number,
  now: string,
): SettlementResolution {
  if (hold.status !== "HELD") {
    throw new Error(`Settlement is already ${hold.status}, cannot resolve`);
  }

  // Dispute cost split: reviewers 70%, platform 30%
  const reviewer_receives_cents = Math.round(dispute_cost_cents * REVIEWER_SHARE);
  const platform_from_dispute = dispute_cost_cents - reviewer_receives_cents; // avoid rounding loss

  let buyer_receives_cents: number;
  let seller_receives_cents: number;
  let holdStatus: SettlementHold["status"];

  // Seller deposit handling
  const seller_lost = outcome === "buyer_favor" || outcome === "partial_refund";
  const deposit_forfeited_cents = deposit && seller_lost ? deposit.amount_cents : 0;
  const deposit_refund_cents = deposit && !seller_lost ? deposit.amount_cents : 0;

  switch (outcome) {
    case "buyer_favor":
      // Buyer gets full refund. Dispute cost comes from seller deposit, not escrow.
      buyer_receives_cents = hold.held_amount_cents;
      seller_receives_cents = 0;
      holdStatus = "REFUNDED";
      break;

    case "seller_favor":
      // Buyer lost → dispute cost deducted from escrowed amount
      buyer_receives_cents = 0;
      seller_receives_cents = hold.held_amount_cents - dispute_cost_cents;
      holdStatus = "RELEASED";
      break;

    case "partial_refund": {
      if (refund_amount_cents === undefined || refund_amount_cents < 0) {
        throw new Error("refund_amount_cents is required for partial_refund and must be non-negative");
      }
      if (refund_amount_cents > hold.held_amount_cents) {
        throw new Error("refund_amount_cents cannot exceed held_amount_cents");
      }
      // Buyer gets refund portion. Seller gets remainder.
      // Dispute cost comes from seller deposit (seller lost in partial_refund).
      buyer_receives_cents = refund_amount_cents;
      seller_receives_cents = hold.held_amount_cents - refund_amount_cents;
      holdStatus = "PARTIAL_REFUND";
      break;
    }
  }

  // Platform total = dispute cost platform share + forfeited seller deposit
  const platform_receives_cents = platform_from_dispute + deposit_forfeited_cents;

  return {
    hold: { ...hold, status: holdStatus, released_at: now },
    buyer_receives_cents,
    seller_receives_cents,
    dispute_cost_cents,
    reviewer_receives_cents,
    platform_receives_cents,
    deposit_refund_cents,
  };
}
