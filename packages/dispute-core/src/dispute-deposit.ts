import type {
  DisputeDeposit,
  DepositRequirement,
  DefaultJudgmentResult,
} from "./types.js";

// ---------------------------------------------------------------------------
// Public Functions
// ---------------------------------------------------------------------------

/**
 * Create a deposit requirement when a dispute is escalated to Tier 2 or 3.
 * Only the SELLER deposits. The buyer's stake is the transaction amount
 * already held in escrow (SettlementHold).
 */
export function createDepositRequirement(
  dispute_id: string,
  tier: 2 | 3,
  amount_cents: number,
): DepositRequirement {
  if (amount_cents <= 0) {
    throw new Error("amount_cents must be positive");
  }

  const deadline_hours = tier === 2 ? 48 : 72;

  return {
    dispute_id,
    tier,
    amount_cents,
    deadline_hours,
    seller_deposit: {
      dispute_id,
      amount_cents,
      status: "PENDING",
    },
  };
}

/**
 * Record that the seller has submitted their deposit.
 */
export function recordDeposit(
  req: DepositRequirement,
  now: string,
): DepositRequirement {
  if (req.seller_deposit.status !== "PENDING") {
    throw new Error(`seller deposit is already ${req.seller_deposit.status}`);
  }

  return {
    ...req,
    seller_deposit: {
      ...req.seller_deposit,
      status: "DEPOSITED",
      deposited_at: now,
    },
  };
}

/**
 * Check whether a default judgment should be issued because the seller
 * failed to deposit before the deadline. Buyer auto-wins.
 *
 * Returns null if:
 * - Seller has deposited
 * - The deadline has not yet passed
 */
export function checkDefaultJudgment(
  req: DepositRequirement,
  deadline_iso: string,
  now: string,
): DefaultJudgmentResult | null {
  const deadline = new Date(deadline_iso).getTime();
  const current = new Date(now).getTime();

  if (current < deadline) return null;
  if (req.seller_deposit.status === "DEPOSITED") return null;

  return {
    winning_party: "buyer",
    reason: "seller_deposit_timeout",
  };
}

/**
 * Resolve the seller's deposit after dispute outcome.
 * - Seller loses → FORFEITED (goes to platform revenue)
 * - Seller wins → REFUNDED
 */
export function resolveDeposit(
  req: DepositRequirement,
  seller_won: boolean,
  now: string,
): DepositRequirement {
  return {
    ...req,
    seller_deposit: {
      ...req.seller_deposit,
      status: seller_won ? "REFUNDED" : "FORFEITED",
      resolved_at: now,
    },
  };
}
