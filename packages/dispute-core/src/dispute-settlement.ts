import type { DepositRequirement, SettlementHold, SettlementResolution } from "./types.js";
import { REVIEWER_SHARE } from "./types.js";

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
 * The transaction principal is never a source for review fees. Both parties
 * deposit separately before a panel begins. The winner receives its deposit
 * in full; the loser pays only the actual review fee from its own deposit.
 * Without verified deposits (T1), the platform absorbs the review cost.
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

  if (!Number.isSafeInteger(dispute_cost_cents) || dispute_cost_cents < 0) {
    throw new Error("dispute_cost_cents must be a non-negative integer");
  }
  if (deposit) {
    if (
      deposit.buyer_deposit.status !== "DEPOSITED" ||
      deposit.seller_deposit.status !== "DEPOSITED"
    ) {
      throw new Error("Both review deposits must be funded before settlement");
    }
    if (deposit.amount_cents < dispute_cost_cents) {
      throw new Error("Losing party deposit cannot cover dispute cost");
    }
  }
  const fundedCost = deposit ? dispute_cost_cents : 0;
  const reviewer_receives_cents = Math.round(fundedCost * REVIEWER_SHARE);
  const platform_from_dispute = fundedCost - reviewer_receives_cents;

  let buyer_receives_cents: number;
  let seller_receives_cents: number;
  let holdStatus: SettlementHold["status"];

  const seller_lost = outcome === "buyer_favor" || outcome === "partial_refund";
  const buyer_deposit_refund_cents = deposit
    ? deposit.amount_cents - (seller_lost ? 0 : fundedCost)
    : 0;
  const seller_deposit_refund_cents = deposit
    ? deposit.amount_cents - (seller_lost ? fundedCost : 0)
    : 0;

  switch (outcome) {
    case "buyer_favor":
      // Buyer gets full refund. Dispute cost comes from seller deposit, not escrow.
      buyer_receives_cents = hold.held_amount_cents;
      seller_receives_cents = 0;
      holdStatus = "REFUNDED";
      break;

    case "seller_favor":
      // The seller receives the full transaction principal.
      buyer_receives_cents = 0;
      seller_receives_cents = hold.held_amount_cents;
      holdStatus = "RELEASED";
      break;

    case "partial_refund": {
      if (refund_amount_cents === undefined || refund_amount_cents < 0) {
        throw new Error(
          "refund_amount_cents is required for partial_refund and must be non-negative",
        );
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

  const platform_receives_cents = platform_from_dispute;

  return {
    hold: { ...hold, status: holdStatus, released_at: now },
    buyer_receives_cents,
    seller_receives_cents,
    dispute_cost_cents: fundedCost,
    reviewer_receives_cents,
    platform_receives_cents,
    buyer_deposit_refund_cents,
    seller_deposit_refund_cents,
    deposit_refund_cents: seller_deposit_refund_cents,
  };
}
