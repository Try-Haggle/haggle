import type { Database } from "@haggle/db";
import { confirmFulfillment, type SettlementRelease } from "@haggle/payment-core";
import { getActiveDisputeByOrderId } from "./dispute-record.service.js";
import {
  type FulfillmentRecord,
  getFulfillmentByOrderId,
  updateFulfillmentRecord,
} from "./fulfillment-record.service.js";
import { getCommerceOrderByOrderId } from "./payment-record.service.js";
import {
  getSettlementReleaseByOrderId,
  updateSettlementReleaseRecord,
} from "./settlement-release.service.js";

export type BuyerAccessConfirmation = "access_received";

export class FulfillmentConfirmError extends Error {
  constructor(
    readonly code:
      | "FULFILLMENT_NOT_FOUND"
      | "INVALID_FULFILLMENT_STATUS"
      | "INVALID_CONFIRMATION"
      | "ORDER_IN_DISPUTE"
      | "PROOF_NOT_FOUND"
      | "PROOF_FULFILLMENT_MISMATCH"
      | "INVALID_RELEASE_STATUS",
    message: string,
  ) {
    super(message);
    this.name = "FulfillmentConfirmError";
  }
}

const CONFIRMABLE_STATUSES = new Set(["PROOF_SUBMITTED", "AWAITING_BUYER_CONFIRMATION"]);

/**
 * Pure transition: buyer access confirm moves fulfillment to FULFILLED with fulfilled_at.
 * Does not touch settlement release / money (caller starts review via confirmFulfillment).
 */
export function transitionFulfillmentForBuyerAccessConfirm(
  fulfillment: FulfillmentRecord,
  now: string,
): FulfillmentRecord {
  if (fulfillment.status === "DISPUTED" || fulfillment.status === "CANCELED") {
    throw new FulfillmentConfirmError(
      "INVALID_FULFILLMENT_STATUS",
      `Cannot confirm access while fulfillment status is "${fulfillment.status}"`,
    );
  }
  if (fulfillment.status === "FULFILLED" && fulfillment.fulfilled_at) {
    // Idempotent: already confirmed.
    return fulfillment;
  }
  if (!CONFIRMABLE_STATUSES.has(fulfillment.status)) {
    throw new FulfillmentConfirmError(
      "INVALID_FULFILLMENT_STATUS",
      `Cannot confirm access while fulfillment status is "${fulfillment.status}"; expected PROOF_SUBMITTED (or AWAITING_BUYER_CONFIRMATION)`,
    );
  }

  return {
    ...fulfillment,
    status: "FULFILLED",
    fulfilled_at: now,
    updated_at: now,
  };
}

async function assertNoActiveDispute(db: Database, orderId: string): Promise<void> {
  const [order, activeDispute] = await Promise.all([
    getCommerceOrderByOrderId(db, orderId),
    getActiveDisputeByOrderId(db, orderId),
  ]);
  if (order?.status === "IN_DISPUTE" || activeDispute) {
    throw new FulfillmentConfirmError(
      "ORDER_IN_DISPUTE",
      "Buyer access confirmation is blocked while the order has an active dispute",
    );
  }
}

async function validateOptionalProofId(
  db: Database,
  fulfillmentId: string,
  proofId: string | undefined,
): Promise<void> {
  if (!proofId) return;

  const row = await db.query.fulfillmentProofs.findFirst({
    where: (fields, ops) => ops.eq(fields.id, proofId),
  });
  if (!row) {
    throw new FulfillmentConfirmError(
      "PROOF_NOT_FOUND",
      `No fulfillment proof found for id ${proofId}`,
    );
  }
  if (row.fulfillmentId !== fulfillmentId) {
    throw new FulfillmentConfirmError(
      "PROOF_FULFILLMENT_MISMATCH",
      "proof_id does not belong to this order fulfillment",
    );
  }
}

/**
 * Buyer access confirmation (A6): review window only, no money move.
 *
 * - Sets fulfilled_at / FULFILLED on the fulfillment record
 * - Starts buyer review via confirmFulfillment (PENDING_DELIVERY → BUYER_REVIEW)
 * - HARD GUARD: never calls buyerConfirmReceipt / completeBuyerReview / sets RELEASED
 */
export async function confirmBuyerAccess(
  db: Database,
  input: {
    order_id: string;
    confirmation: string;
    proof_id?: string;
    now?: string;
  },
): Promise<{
  fulfillment: FulfillmentRecord;
  settlement_release: SettlementRelease | null;
  buyer_review_started: boolean;
  already_confirmed: boolean;
  auto_released: false;
}> {
  if (input.confirmation !== "access_received") {
    throw new FulfillmentConfirmError(
      "INVALID_CONFIRMATION",
      'confirmation must be "access_received"',
    );
  }

  const fulfillment = await getFulfillmentByOrderId(db, input.order_id);
  if (!fulfillment) {
    throw new FulfillmentConfirmError(
      "FULFILLMENT_NOT_FOUND",
      `No fulfillment record for order ${input.order_id}`,
    );
  }

  await assertNoActiveDispute(db, input.order_id);
  await validateOptionalProofId(db, fulfillment.id, input.proof_id);

  const now = input.now ?? new Date().toISOString();
  const alreadyConfirmed = fulfillment.status === "FULFILLED" && Boolean(fulfillment.fulfilled_at);
  const updatedFulfillment = transitionFulfillmentForBuyerAccessConfirm(fulfillment, now);

  if (!alreadyConfirmed) {
    await updateFulfillmentRecord(db, updatedFulfillment);
  }

  const releaseBefore = await getSettlementReleaseByOrderId(db, input.order_id);
  let releaseAfter: SettlementRelease | null = releaseBefore;
  let buyerReviewStarted = false;

  if (releaseBefore) {
    if (releaseBefore.product_release_status === "RELEASED") {
      throw new FulfillmentConfirmError(
        "INVALID_RELEASE_STATUS",
        "Cannot start buyer review: product payment is already RELEASED",
      );
    }

    if (releaseBefore.product_release_status === "PENDING_DELIVERY") {
      // Start review clocks only — never auto-release / never set RELEASED.
      const updatedRelease = confirmFulfillment(releaseBefore, now);
      if (updatedRelease.product_release_status === "RELEASED") {
        throw new Error("HARD GUARD violated: confirmFulfillment must not set RELEASED");
      }
      await updateSettlementReleaseRecord(db, updatedRelease);
      releaseAfter = updatedRelease;
      buyerReviewStarted = true;
    } else if (releaseBefore.product_release_status === "BUYER_REVIEW") {
      releaseAfter = releaseBefore;
      buyerReviewStarted = true;
    }
  }

  return {
    fulfillment: updatedFulfillment,
    settlement_release: releaseAfter,
    buyer_review_started: buyerReviewStarted || Boolean(releaseAfter?.buyer_review_deadline),
    already_confirmed: alreadyConfirmed,
    auto_released: false,
  };
}
