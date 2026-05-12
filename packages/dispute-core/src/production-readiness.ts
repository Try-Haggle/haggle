export type ProductionDisputeStatus =
  | "open"
  | "under_review"
  | "waiting_for_buyer"
  | "waiting_for_seller"
  | "resolved_buyer_favor"
  | "resolved_seller_favor"
  | "partial_refund"
  | "closed";

export type DisputeFinancialOutcome =
  | "buyer_favor"
  | "seller_favor"
  | "partial_refund"
  | "no_action";

export interface DisputeFinalizationSnapshot {
  dispute_id: string;
  order_id: string;
  status: ProductionDisputeStatus;
  outcome?: DisputeFinancialOutcome;
  order_status?: string;
  payment_state?: string;
  refund_status?: string;
  refund_amount_minor?: number;
  expected_refund_amount_minor?: number;
  settlement_release_status?: string;
  return_shipment_status?: string;
  finalized_at?: string;
  finalization_attempts?: number;
}

export type DisputeFinalizationFindingType =
  | "resolved_buyer_favor_without_refund"
  | "partial_refund_missing_or_amount_mismatch"
  | "resolved_seller_favor_without_release"
  | "resolved_dispute_order_not_terminal"
  | "resolved_dispute_missing_finalization_marker"
  | "return_required_before_refund"
  | "excessive_finalization_attempts";

export interface DisputeFinalizationFinding {
  type: DisputeFinalizationFindingType;
  severity: "warning" | "critical";
  dispute_id: string;
  order_id: string;
  message: string;
  recommended_action: string;
}

function isResolved(status: ProductionDisputeStatus): boolean {
  return status === "resolved_buyer_favor"
    || status === "resolved_seller_favor"
    || status === "partial_refund"
    || status === "closed";
}

function isTerminalOrderStatus(status?: string): boolean {
  return !status || ["REFUNDED", "CLOSED", "CANCELED", "DELIVERED"].includes(status);
}

function refundCompleted(status?: string): boolean {
  return status === "COMPLETED" || status === "refunded" || status === "succeeded";
}

function releaseCompleted(status?: string): boolean {
  return status === "RELEASED" || status === "SETTLED" || status === "released" || status === "settled";
}

function returnCompletedOrNotRequired(status?: string): boolean {
  return !status || ["RETURNED", "returned", "not_required", "NOT_REQUIRED"].includes(status);
}

export function detectDisputeFinalizationFindings(
  disputes: readonly DisputeFinalizationSnapshot[],
): DisputeFinalizationFinding[] {
  const findings: DisputeFinalizationFinding[] = [];

  for (const dispute of disputes) {
    if (!isResolved(dispute.status)) continue;

    if (!dispute.finalized_at) {
      findings.push({
        type: "resolved_dispute_missing_finalization_marker",
        severity: "warning",
        dispute_id: dispute.dispute_id,
        order_id: dispute.order_id,
        message: "Resolved dispute does not have a finalization marker.",
        recommended_action: "Verify the finalizer ran once and write an audited finalization timestamp.",
      });
    }

    if (!isTerminalOrderStatus(dispute.order_status)) {
      findings.push({
        type: "resolved_dispute_order_not_terminal",
        severity: "critical",
        dispute_id: dispute.dispute_id,
        order_id: dispute.order_id,
        message: "Resolved dispute is attached to a non-terminal order.",
        recommended_action: "Block order closure side effects until refund, release, and return state are reconciled.",
      });
    }

    if ((dispute.finalization_attempts ?? 0) > 1) {
      findings.push({
        type: "excessive_finalization_attempts",
        severity: "warning",
        dispute_id: dispute.dispute_id,
        order_id: dispute.order_id,
        message: "Dispute finalization has been attempted more than once.",
        recommended_action: "Check idempotency keys and audit log before retrying financial side effects.",
      });
    }

    if (dispute.outcome === "buyer_favor") {
      if (!returnCompletedOrNotRequired(dispute.return_shipment_status)) {
        findings.push({
          type: "return_required_before_refund",
          severity: "warning",
          dispute_id: dispute.dispute_id,
          order_id: dispute.order_id,
          message: "Buyer-favor dispute has a return shipment that is not completed.",
          recommended_action: "Verify return policy before releasing refund funds.",
        });
      }

      if (!refundCompleted(dispute.refund_status)) {
        findings.push({
          type: "resolved_buyer_favor_without_refund",
          severity: "critical",
          dispute_id: dispute.dispute_id,
          order_id: dispute.order_id,
          message: "Buyer-favor dispute is resolved without a completed refund.",
          recommended_action: "Run refund reconciliation and complete or manually review the refund.",
        });
      }
    }

    if (dispute.outcome === "partial_refund") {
      const expected = dispute.expected_refund_amount_minor ?? 0;
      const actual = dispute.refund_amount_minor ?? 0;
      if (!refundCompleted(dispute.refund_status) || expected <= 0 || actual !== expected) {
        findings.push({
          type: "partial_refund_missing_or_amount_mismatch",
          severity: "critical",
          dispute_id: dispute.dispute_id,
          order_id: dispute.order_id,
          message: "Partial-refund dispute does not match the expected completed refund amount.",
          recommended_action: "Compare provider refund amount with the dispute resolution before closing the case.",
        });
      }
    }

    if ((dispute.outcome === "seller_favor" || dispute.outcome === "no_action")
      && !releaseCompleted(dispute.settlement_release_status)) {
      findings.push({
        type: "resolved_seller_favor_without_release",
        severity: "critical",
        dispute_id: dispute.dispute_id,
        order_id: dispute.order_id,
        message: "Seller-favor/no-action dispute is resolved without settlement release.",
        recommended_action: "Run settlement release reconciliation and complete or manually review the release.",
      });
    }
  }

  return findings.sort((a, b) => {
    if (a.severity === b.severity) return a.type.localeCompare(b.type);
    return a.severity === "critical" ? -1 : 1;
  });
}
