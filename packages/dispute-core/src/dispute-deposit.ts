import type { DefaultJudgmentResult, DepositRequirement } from "./types.js";

// ---------------------------------------------------------------------------
// Public Functions
// ---------------------------------------------------------------------------

/**
 * Create a deposit requirement when a dispute is escalated to Tier 2 or 3.
 * Both parties deposit separately from the transaction principal.
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
    buyer_deposit: {
      dispute_id,
      amount_cents,
      status: "PENDING",
    },
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
  party: "buyer" | "seller" = "seller",
): DepositRequirement {
  const key = party === "buyer" ? "buyer_deposit" : "seller_deposit";
  if (req[key].status !== "PENDING") {
    throw new Error(`${party} deposit is already ${req[key].status}`);
  }

  return {
    ...req,
    [key]: {
      ...req[key],
      status: "DEPOSITED",
      deposited_at: now,
    },
  };
}

/**
 * Check whether a default judgment should be issued because the seller
 * failed to deposit before the deadline after the buyer has deposited.
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
  if (req.buyer_deposit.status !== "DEPOSITED") return null;

  return {
    winning_party: "buyer",
    reason: "seller_deposit_timeout",
  };
}

/**
 * A winning party receives its own deposit back. The losing party's deposit
 * funds only the actual review fee; any unused amount is also returned.
 */
export function resolveDeposit(
  req: DepositRequirement,
  seller_won: boolean,
  now: string,
): DepositRequirement {
  return {
    ...req,
    buyer_deposit: {
      ...req.buyer_deposit,
      status: seller_won ? "FORFEITED" : "REFUNDED",
      resolved_at: now,
    },
    seller_deposit: {
      ...req.seller_deposit,
      status: seller_won ? "REFUNDED" : "FORFEITED",
      resolved_at: now,
    },
  };
}
