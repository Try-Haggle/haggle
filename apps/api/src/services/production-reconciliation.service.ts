import {
  commerceOrders,
  desc,
  disputeCases,
  disputeResolutions,
  paymentAuthorizations,
  paymentIntents,
  paymentSettlements,
  refunds,
  settlementReleases,
  shipments,
  type Database,
} from "@haggle/db";

type Severity = "warning" | "critical";

type PaymentState =
  | "pending"
  | "authorized"
  | "captured"
  | "canceled"
  | "refunded"
  | "partially_refunded"
  | "failed"
  | "disputed"
  | "expired";

type ShipmentState =
  | "label_pending"
  | "label_created"
  | "in_transit"
  | "out_for_delivery"
  | "delivered"
  | "delivery_exception"
  | "return_in_transit"
  | "returned";

type DisputeStatus =
  | "open"
  | "under_review"
  | "waiting_for_buyer"
  | "waiting_for_seller"
  | "resolved_buyer_favor"
  | "resolved_seller_favor"
  | "partial_refund"
  | "closed";

type DisputeOutcome = "buyer_favor" | "seller_favor" | "partial_refund" | "no_action";

export interface LocalPaymentSnapshot {
  payment_intent_id: string;
  order_id?: string;
  state: PaymentState;
  amount_minor: number;
  refunded_amount_minor?: number;
  provider_reference?: string;
}

export interface ProviderPaymentSnapshot {
  provider_reference: string;
  state: PaymentState;
  amount_minor: number;
  refunded_amount_minor?: number;
  local_payment_intent_id?: string;
}

export interface LocalShipmentSnapshot {
  shipment_id: string;
  order_id: string;
  state: ShipmentState;
  carrier?: string;
  tracking_number?: string;
  provider_shipment_id?: string;
  provider_tracker_id?: string;
  label_url?: string;
  qr_code_url?: string;
  order_status?: string;
}

export interface ProviderShipmentSnapshot {
  provider_shipment_id?: string;
  provider_tracker_id?: string;
  tracking_number?: string;
  state: ShipmentState;
  carrier?: string;
  label_purchased?: boolean;
  label_url?: string;
  qr_code_url?: string;
  local_shipment_id?: string;
}

export interface DisputeFinalizationSnapshot {
  dispute_id: string;
  order_id: string;
  status: DisputeStatus;
  outcome?: DisputeOutcome;
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

export interface ReconciliationFinding {
  type:
    | "local_captured_provider_not_captured"
    | "provider_captured_local_not_captured"
    | "refund_mismatch"
    | "orphan_provider_payment"
    | "amount_mismatch";
  severity: Severity;
  payment_intent_id?: string;
  order_id?: string;
  provider_reference?: string;
  message: string;
}

export interface ShipmentReconciliationFinding {
  type:
    | "label_created_without_fulfillable_order"
    | "label_missing_after_provider_purchase"
    | "local_delivered_provider_not_delivered"
    | "orphan_provider_shipment"
    | "provider_delivered_local_not_delivered"
    | "return_state_mismatch"
    | "tracking_missing_after_label";
  severity: Severity;
  shipment_id?: string;
  order_id?: string;
  provider_shipment_id?: string;
  provider_tracker_id?: string;
  tracking_number?: string;
  message: string;
  recommended_action: string;
}

export interface DisputeFinalizationFinding {
  type:
    | "resolved_buyer_favor_without_refund"
    | "partial_refund_missing_or_amount_mismatch"
    | "resolved_seller_favor_without_release"
    | "resolved_dispute_order_not_terminal"
    | "resolved_dispute_missing_finalization_marker"
    | "return_required_before_refund"
    | "excessive_finalization_attempts";
  severity: Severity;
  dispute_id: string;
  order_id: string;
  message: string;
  recommended_action: string;
}

export interface ProductionReconciliationInput {
  payments?: {
    local: readonly LocalPaymentSnapshot[];
    provider: readonly ProviderPaymentSnapshot[];
  };
  shipments?: {
    local: readonly LocalShipmentSnapshot[];
    provider: readonly ProviderShipmentSnapshot[];
  };
  disputes?: {
    local: readonly DisputeFinalizationSnapshot[];
  };
  generatedAt?: string;
}

export interface ProductionReconciliationProviderSource {
  listPaymentProviderSnapshots?: (
    localPayments: readonly LocalPaymentSnapshot[],
  ) => Promise<readonly ProviderPaymentSnapshot[]>;
  listShipmentProviderSnapshots?: (
    localShipments: readonly LocalShipmentSnapshot[],
  ) => Promise<readonly ProviderShipmentSnapshot[]>;
}

export interface CollectProductionReconciliationOptions {
  limit?: number;
  generatedAt?: string;
  providerSource?: ProductionReconciliationProviderSource;
  includePaymentsWithoutProviderSource?: boolean;
}

export interface ProductionReconciliationReport {
  generatedAt: string;
  reportOnly: true;
  summary: {
    critical: number;
    warning: number;
    total: number;
    payments: number;
    shipments: number;
    disputes: number;
  };
  findings: {
    payments: ReconciliationFinding[];
    shipments: ShipmentReconciliationFinding[];
    disputes: DisputeFinalizationFinding[];
  };
  nextActions: string[];
}

function countSeverity(
  findings: Array<{ severity: "warning" | "critical" }>,
  severity: "warning" | "critical",
): number {
  return findings.filter((finding) => finding.severity === severity).length;
}

function parseMinor(value: string | number | null | undefined): number {
  if (value == null) return 0;
  return typeof value === "number" ? value : Number(value);
}

function recordValue(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : null;
}

function metadataString(metadata: unknown, key: string): string | undefined {
  const value = recordValue(metadata)?.[key];
  return typeof value === "string" && value.length > 0 ? value : undefined;
}

function mapLegacyPaymentState(
  status: typeof paymentIntents.$inferSelect.status,
  refundedAmountMinor: number,
  amountMinor: number,
): PaymentState {
  if (status === "SETTLED" && refundedAmountMinor > 0) {
    return refundedAmountMinor >= amountMinor ? "refunded" : "partially_refunded";
  }
  switch (status) {
    case "CREATED":
    case "QUOTED":
      return "pending";
    case "AUTHORIZED":
    case "SETTLEMENT_PENDING":
      return "authorized";
    case "SETTLED":
      return "captured";
    case "FAILED":
      return "failed";
    case "CANCELED":
      return "canceled";
  }
}

function mapShipmentState(status: typeof shipments.$inferSelect.status): ShipmentState {
  switch (status) {
    case "LABEL_PENDING":
      return "label_pending";
    case "LABEL_CREATED":
      return "label_created";
    case "IN_TRANSIT":
      return "in_transit";
    case "OUT_FOR_DELIVERY":
      return "out_for_delivery";
    case "DELIVERED":
      return "delivered";
    case "DELIVERY_EXCEPTION":
      return "delivery_exception";
    case "RETURN_IN_TRANSIT":
      return "return_in_transit";
    case "RETURNED":
      return "returned";
  }
}

function mapDisputeStatus(status: typeof disputeCases.$inferSelect.status): DisputeStatus {
  switch (status) {
    case "OPEN":
      return "open";
    case "UNDER_REVIEW":
      return "under_review";
    case "WAITING_FOR_BUYER":
      return "waiting_for_buyer";
    case "WAITING_FOR_SELLER":
      return "waiting_for_seller";
    case "RESOLVED_BUYER_FAVOR":
      return "resolved_buyer_favor";
    case "RESOLVED_SELLER_FAVOR":
      return "resolved_seller_favor";
    case "PARTIAL_REFUND":
      return "partial_refund";
    case "CLOSED":
      return "closed";
  }
}

function mapDisputeOutcome(outcome: typeof disputeResolutions.$inferSelect.outcome | null | undefined): DisputeOutcome | undefined {
  switch (outcome) {
    case "buyer_favor":
    case "seller_favor":
    case "partial_refund":
    case "no_action":
      return outcome;
    default:
      return undefined;
  }
}

function uniqueNextActions(findings: Array<{ recommended_action?: string }>): string[] {
  return Array.from(new Set(
    findings
      .map((finding) => finding.recommended_action)
      .filter((value): value is string => typeof value === "string" && value.length > 0),
  ));
}

function paymentRecommendedAction(finding: ReconciliationFinding): string {
  switch (finding.type) {
    case "local_captured_provider_not_captured":
      return "Hold fulfillment and reconcile provider capture before treating the order as paid.";
    case "provider_captured_local_not_captured":
      return "Refresh local payment/order state from provider truth and audit the correction.";
    case "refund_mismatch":
      return "Compare provider refund records with local refund rows before closing the dispute or order.";
    case "orphan_provider_payment":
      return "Find or create the owning local payment intent before fulfillment, refund, or support action.";
    case "amount_mismatch":
      return "Block settlement and compare local amount, provider amount, currency, and fee assumptions.";
  }
}

function paymentCapturedLike(state: PaymentState): boolean {
  return state === "captured" || state === "partially_refunded" || state === "refunded" || state === "disputed";
}

function detectPaymentReconciliationFindings(
  localPayments: readonly LocalPaymentSnapshot[],
  providerPayments: readonly ProviderPaymentSnapshot[],
): ReconciliationFinding[] {
  const findings: ReconciliationFinding[] = [];
  const localByProviderRef = new Map<string, LocalPaymentSnapshot>();
  const localByIntentId = new Map<string, LocalPaymentSnapshot>();

  for (const local of localPayments) {
    if (local.provider_reference) localByProviderRef.set(local.provider_reference, local);
    localByIntentId.set(local.payment_intent_id, local);
  }

  for (const local of localPayments) {
    const provider = local.provider_reference
      ? providerPayments.find((candidate) => candidate.provider_reference === local.provider_reference)
      : undefined;

    if (paymentCapturedLike(local.state) && (!provider || !paymentCapturedLike(provider.state))) {
      findings.push({
        type: "local_captured_provider_not_captured",
        severity: "critical",
        payment_intent_id: local.payment_intent_id,
        order_id: local.order_id,
        provider_reference: local.provider_reference,
        message: "Local payment is captured but provider is not captured.",
      });
    }

    if (provider && provider.amount_minor !== local.amount_minor) {
      findings.push({
        type: "amount_mismatch",
        severity: "critical",
        payment_intent_id: local.payment_intent_id,
        order_id: local.order_id,
        provider_reference: provider.provider_reference,
        message: "Local payment amount does not match provider amount.",
      });
    }

    if (provider && (provider.refunded_amount_minor ?? 0) !== (local.refunded_amount_minor ?? 0)) {
      findings.push({
        type: "refund_mismatch",
        severity: "warning",
        payment_intent_id: local.payment_intent_id,
        order_id: local.order_id,
        provider_reference: provider.provider_reference,
        message: "Local refunded amount does not match provider refunded amount.",
      });
    }
  }

  for (const provider of providerPayments) {
    const local = localByProviderRef.get(provider.provider_reference)
      ?? (provider.local_payment_intent_id ? localByIntentId.get(provider.local_payment_intent_id) : undefined);

    if (!local) {
      findings.push({
        type: "orphan_provider_payment",
        severity: "critical",
        provider_reference: provider.provider_reference,
        message: "Provider payment has no matching local payment intent.",
      });
    } else if (paymentCapturedLike(provider.state) && !paymentCapturedLike(local.state)) {
      findings.push({
        type: "provider_captured_local_not_captured",
        severity: "critical",
        payment_intent_id: local.payment_intent_id,
        order_id: local.order_id,
        provider_reference: provider.provider_reference,
        message: "Provider payment is captured but local payment is not captured.",
      });
    }
  }

  return findings;
}

function shipmentDeliveredLike(state: ShipmentState): boolean {
  return state === "delivered" || state === "returned";
}

function shipmentReturnState(state: ShipmentState): boolean {
  return state === "return_in_transit" || state === "returned";
}

function fulfillableOrder(status?: string): boolean {
  return !status || ["PAID", "FULFILLMENT_PENDING", "FULFILLMENT_ACTIVE", "DELIVERED", "IN_DISPUTE", "CLOSED"]
    .includes(status);
}

function detectShipmentReconciliationFindings(
  localShipments: readonly LocalShipmentSnapshot[],
  providerShipments: readonly ProviderShipmentSnapshot[],
): ShipmentReconciliationFinding[] {
  const findings: ShipmentReconciliationFinding[] = [];
  for (const local of localShipments) {
    const provider = providerShipments.find((candidate) =>
      (local.provider_shipment_id && candidate.provider_shipment_id === local.provider_shipment_id)
      || (local.provider_tracker_id && candidate.provider_tracker_id === local.provider_tracker_id)
      || (local.tracking_number && candidate.tracking_number === local.tracking_number)
      || (candidate.local_shipment_id && candidate.local_shipment_id === local.shipment_id)
    );

    if (local.state !== "label_pending" && !fulfillableOrder(local.order_status)) {
      findings.push({
        type: "label_created_without_fulfillable_order",
        severity: "critical",
        shipment_id: local.shipment_id,
        order_id: local.order_id,
        message: "Shipment has moved past label pending for a non-fulfillable order.",
        recommended_action: "Pause fulfillment, verify payment/order status, and void or hold the label if possible.",
      });
    }

    if (local.state !== "label_pending" && !local.tracking_number) {
      findings.push({
        type: "tracking_missing_after_label",
        severity: "warning",
        shipment_id: local.shipment_id,
        order_id: local.order_id,
        message: "Shipment label exists locally without a tracking number.",
        recommended_action: "Fetch provider shipment/tracker state and update the local tracking fields.",
      });
    }

    if (provider?.label_purchased && !local.label_url && !local.qr_code_url) {
      findings.push({
        type: "label_missing_after_provider_purchase",
        severity: "critical",
        shipment_id: local.shipment_id,
        order_id: local.order_id,
        provider_shipment_id: provider.provider_shipment_id,
        provider_tracker_id: provider.provider_tracker_id,
        tracking_number: provider.tracking_number,
        message: "Provider reports a purchased label but no local label or QR URL is available.",
        recommended_action: "Re-fetch the purchased label assets and block seller print/QR flow until recovered.",
      });
    }

    if (provider && shipmentDeliveredLike(local.state) && !shipmentDeliveredLike(provider.state)) {
      findings.push({
        type: "local_delivered_provider_not_delivered",
        severity: "critical",
        shipment_id: local.shipment_id,
        order_id: local.order_id,
        provider_shipment_id: provider.provider_shipment_id,
        provider_tracker_id: provider.provider_tracker_id,
        tracking_number: provider.tracking_number ?? local.tracking_number,
        message: "Local shipment is terminal but provider shipment is not terminal.",
        recommended_action: "Reconcile against carrier tracking before releasing funds or closing the order.",
      });
    }

    if (provider && shipmentReturnState(local.state) !== shipmentReturnState(provider.state)) {
      findings.push({
        type: "return_state_mismatch",
        severity: "warning",
        shipment_id: local.shipment_id,
        order_id: local.order_id,
        provider_shipment_id: provider.provider_shipment_id,
        provider_tracker_id: provider.provider_tracker_id,
        tracking_number: provider.tracking_number ?? local.tracking_number,
        message: "Local and provider return shipment states do not match.",
        recommended_action: "Refresh return tracker state before refund or dispute finalization.",
      });
    }
  }

  for (const provider of providerShipments) {
    const local = localShipments.find((candidate) =>
      (provider.provider_shipment_id && candidate.provider_shipment_id === provider.provider_shipment_id)
      || (provider.provider_tracker_id && candidate.provider_tracker_id === provider.provider_tracker_id)
      || (provider.tracking_number && candidate.tracking_number === provider.tracking_number)
      || (provider.local_shipment_id && candidate.shipment_id === provider.local_shipment_id)
    );

    if (!local) {
      findings.push({
        type: "orphan_provider_shipment",
        severity: "critical",
        provider_shipment_id: provider.provider_shipment_id,
        provider_tracker_id: provider.provider_tracker_id,
        tracking_number: provider.tracking_number,
        message: "Provider shipment has no matching local shipment record.",
        recommended_action: "Find the owning order before exposing tracking, billing shipment fees, or closing fulfillment.",
      });
    } else if (shipmentDeliveredLike(provider.state) && !shipmentDeliveredLike(local.state)) {
      findings.push({
        type: "provider_delivered_local_not_delivered",
        severity: "critical",
        shipment_id: local.shipment_id,
        order_id: local.order_id,
        provider_shipment_id: provider.provider_shipment_id,
        provider_tracker_id: provider.provider_tracker_id,
        tracking_number: provider.tracking_number ?? local.tracking_number,
        message: "Provider shipment is terminal but local shipment is not terminal.",
        recommended_action: "Refresh local shipment/order state and check whether funds can be released.",
      });
    }
  }

  return findings.sort((a, b) => a.severity === b.severity
    ? a.type.localeCompare(b.type)
    : a.severity === "critical" ? -1 : 1);
}

function resolvedDispute(status: DisputeStatus): boolean {
  return status === "resolved_buyer_favor" || status === "resolved_seller_favor" || status === "partial_refund" || status === "closed";
}

function terminalOrder(status?: string): boolean {
  return !status || ["REFUNDED", "CLOSED", "CANCELED", "DELIVERED"].includes(status);
}

function refundComplete(status?: string): boolean {
  return status === "COMPLETED" || status === "refunded" || status === "succeeded";
}

function releaseComplete(status?: string): boolean {
  return status === "RELEASED" || status === "SETTLED" || status === "released" || status === "settled";
}

function returnCompleteOrNotRequired(status?: string): boolean {
  return !status || ["RETURNED", "returned", "not_required", "NOT_REQUIRED"].includes(status);
}

function detectDisputeFinalizationFindings(
  disputes: readonly DisputeFinalizationSnapshot[],
): DisputeFinalizationFinding[] {
  const findings: DisputeFinalizationFinding[] = [];

  for (const dispute of disputes) {
    if (!resolvedDispute(dispute.status)) continue;

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
    if (!terminalOrder(dispute.order_status)) {
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
      if (!returnCompleteOrNotRequired(dispute.return_shipment_status)) {
        findings.push({
          type: "return_required_before_refund",
          severity: "warning",
          dispute_id: dispute.dispute_id,
          order_id: dispute.order_id,
          message: "Buyer-favor dispute has a return shipment that is not completed.",
          recommended_action: "Verify return policy before releasing refund funds.",
        });
      }
      if (!refundComplete(dispute.refund_status)) {
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
      if (!refundComplete(dispute.refund_status) || expected <= 0 || actual !== expected) {
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
      && !releaseComplete(dispute.settlement_release_status)) {
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

  return findings.sort((a, b) => a.severity === b.severity
    ? a.type.localeCompare(b.type)
    : a.severity === "critical" ? -1 : 1);
}

async function collectLocalPaymentSnapshots(
  db: Database,
  limit: number,
): Promise<LocalPaymentSnapshot[]> {
  const [intentRows, authorizationRows, settlementRows, refundRows] = await Promise.all([
    db
      .select()
      .from(paymentIntents)
      .orderBy(desc(paymentIntents.updatedAt))
      .limit(limit),
    db
      .select()
      .from(paymentAuthorizations)
      .orderBy(desc(paymentAuthorizations.createdAt))
      .limit(limit * 5),
    db
      .select()
      .from(paymentSettlements)
      .orderBy(desc(paymentSettlements.createdAt))
      .limit(limit * 5),
    db
      .select()
      .from(refunds)
      .orderBy(desc(refunds.updatedAt))
      .limit(limit * 5),
  ]);

  const providerReferenceByIntent = new Map<string, string>();
  for (const row of authorizationRows) {
    if (!providerReferenceByIntent.has(row.paymentIntentId)) {
      providerReferenceByIntent.set(row.paymentIntentId, row.providerReference);
    }
  }
  for (const row of settlementRows) {
    if (!providerReferenceByIntent.has(row.paymentIntentId)) {
      providerReferenceByIntent.set(row.paymentIntentId, row.providerReference);
    }
  }

  const refundedByIntent = new Map<string, number>();
  for (const row of refundRows) {
    if (row.status !== "COMPLETED") continue;
    refundedByIntent.set(
      row.paymentIntentId,
      (refundedByIntent.get(row.paymentIntentId) ?? 0) + parseMinor(row.amountMinor),
    );
  }

  return intentRows.map((row) => {
    const amountMinor = parseMinor(row.amountMinor);
    const refundedAmountMinor = refundedByIntent.get(row.id) ?? 0;
    return {
      payment_intent_id: row.id,
      order_id: row.orderId,
      state: mapLegacyPaymentState(row.status, refundedAmountMinor, amountMinor),
      amount_minor: amountMinor,
      refunded_amount_minor: refundedAmountMinor,
      provider_reference: providerReferenceByIntent.get(row.id),
    };
  });
}

async function collectLocalShipmentSnapshots(
  db: Database,
  limit: number,
): Promise<LocalShipmentSnapshot[]> {
  const [shipmentRows, orderRows] = await Promise.all([
    db
      .select()
      .from(shipments)
      .orderBy(desc(shipments.updatedAt))
      .limit(limit),
    db
      .select({
        id: commerceOrders.id,
        status: commerceOrders.status,
      })
      .from(commerceOrders)
      .orderBy(desc(commerceOrders.updatedAt))
      .limit(limit * 2),
  ]);
  const orderStatusById = new Map(orderRows.map((row) => [row.id, row.status]));

  return shipmentRows.map((row) => ({
    shipment_id: row.id,
    order_id: row.orderId,
    state: mapShipmentState(row.status),
    carrier: row.carrier ?? undefined,
    tracking_number: row.trackingNumber ?? undefined,
    provider_shipment_id: metadataString(row.metadata, "easypost_shipment_id"),
    provider_tracker_id: metadataString(row.metadata, "easypost_tracker_id"),
    label_url: row.labelUrl ?? undefined,
    qr_code_url: metadataString(row.metadata, "label_qr_code_url"),
    order_status: orderStatusById.get(row.orderId),
  }));
}

async function collectLocalDisputeSnapshots(
  db: Database,
  limit: number,
): Promise<DisputeFinalizationSnapshot[]> {
  const [disputeRows, resolutionRows, orderRows, paymentRows, refundRows, releaseRows, shipmentRows] = await Promise.all([
    db
      .select()
      .from(disputeCases)
      .orderBy(desc(disputeCases.updatedAt))
      .limit(limit),
    db
      .select()
      .from(disputeResolutions)
      .orderBy(desc(disputeResolutions.createdAt))
      .limit(limit * 3),
    db
      .select({
        id: commerceOrders.id,
        status: commerceOrders.status,
      })
      .from(commerceOrders)
      .orderBy(desc(commerceOrders.updatedAt))
      .limit(limit * 2),
    db
      .select({
        id: paymentIntents.id,
        orderId: paymentIntents.orderId,
      })
      .from(paymentIntents)
      .orderBy(desc(paymentIntents.updatedAt))
      .limit(limit * 2),
    db
      .select()
      .from(refunds)
      .orderBy(desc(refunds.updatedAt))
      .limit(limit * 5),
    db
      .select()
      .from(settlementReleases)
      .orderBy(desc(settlementReleases.updatedAt))
      .limit(limit * 2),
    db
      .select({
        orderId: shipments.orderId,
        shipmentType: shipments.shipmentType,
        status: shipments.status,
      })
      .from(shipments)
      .orderBy(desc(shipments.updatedAt))
      .limit(limit * 3),
  ]);

  const resolutionByDisputeId = new Map<string, typeof disputeResolutions.$inferSelect>();
  for (const row of resolutionRows) {
    if (!resolutionByDisputeId.has(row.disputeId)) {
      resolutionByDisputeId.set(row.disputeId, row);
    }
  }
  const orderStatusById = new Map(orderRows.map((row) => [row.id, row.status]));
  const orderIdByPaymentIntentId = new Map(paymentRows.map((row) => [row.id, row.orderId]));
  const refundByOrderId = new Map<string, typeof refunds.$inferSelect>();
  for (const row of refundRows) {
    const orderId = orderIdByPaymentIntentId.get(row.paymentIntentId);
    if (orderId && !refundByOrderId.has(orderId)) {
      refundByOrderId.set(orderId, row);
    }
  }
  const releaseByOrderId = new Map(releaseRows.map((row) => [row.orderId, row]));
  const returnShipmentByOrderId = new Map<string, typeof shipments.$inferSelect.status>();
  for (const row of shipmentRows) {
    if (row.shipmentType === "return" && !returnShipmentByOrderId.has(row.orderId)) {
      returnShipmentByOrderId.set(row.orderId, row.status);
    }
  }

  return disputeRows.map((row) => {
    const resolution = resolutionByDisputeId.get(row.id);
    const release = releaseByOrderId.get(row.orderId);
    const refund = refundByOrderId.get(row.orderId);
    const returnStatus = returnShipmentByOrderId.get(row.orderId);
    const finalizationAttempts = recordValue(row.metadata)?.finalization_attempts;
    return {
      dispute_id: row.id,
      order_id: row.orderId,
      status: mapDisputeStatus(row.status),
      outcome: mapDisputeOutcome(resolution?.outcome),
      order_status: orderStatusById.get(row.orderId),
      refund_status: refund?.status,
      refund_amount_minor: refund?.amountMinor == null ? undefined : parseMinor(refund.amountMinor),
      expected_refund_amount_minor: resolution?.refundAmountMinor == null
        ? undefined
        : parseMinor(resolution.refundAmountMinor),
      settlement_release_status: release?.productReleaseStatus,
      return_shipment_status: returnStatus ? mapShipmentState(returnStatus) : undefined,
      finalized_at: row.resolvedAt?.toISOString() ?? row.closedAt?.toISOString(),
      finalization_attempts: typeof finalizationAttempts === "number"
        ? finalizationAttempts
        : undefined,
    };
  });
}

export async function collectProductionReconciliationInput(
  db: Database,
  options: CollectProductionReconciliationOptions = {},
): Promise<ProductionReconciliationInput> {
  const limit = Math.min(Math.max(Math.floor(options.limit ?? 200), 1), 1_000);
  const [localPayments, localShipments, localDisputes] = await Promise.all([
    collectLocalPaymentSnapshots(db, limit),
    collectLocalShipmentSnapshots(db, limit),
    collectLocalDisputeSnapshots(db, limit),
  ]);

  const providerPaymentSnapshots = options.providerSource?.listPaymentProviderSnapshots
    ? await options.providerSource.listPaymentProviderSnapshots(localPayments)
    : [];
  const providerShipmentSnapshots = options.providerSource?.listShipmentProviderSnapshots
    ? await options.providerSource.listShipmentProviderSnapshots(localShipments)
    : [];

  return {
    generatedAt: options.generatedAt,
    payments: options.providerSource?.listPaymentProviderSnapshots || options.includePaymentsWithoutProviderSource
      ? {
          local: localPayments,
          provider: providerPaymentSnapshots,
        }
      : undefined,
    shipments: {
      local: localShipments,
      provider: providerShipmentSnapshots,
    },
    disputes: {
      local: localDisputes,
    },
  };
}

export function buildProductionReconciliationReport(
  input: ProductionReconciliationInput,
): ProductionReconciliationReport {
  const paymentFindings = input.payments
    ? detectPaymentReconciliationFindings(input.payments.local, input.payments.provider)
    : [];
  const shipmentFindings = input.shipments
    ? detectShipmentReconciliationFindings(input.shipments.local, input.shipments.provider)
    : [];
  const disputeFindings = input.disputes
    ? detectDisputeFinalizationFindings(input.disputes.local)
    : [];

  const allFindings = [
    ...paymentFindings,
    ...shipmentFindings,
    ...disputeFindings,
  ];

  return {
    generatedAt: input.generatedAt ?? new Date().toISOString(),
    reportOnly: true,
    summary: {
      critical: countSeverity(allFindings, "critical"),
      warning: countSeverity(allFindings, "warning"),
      total: allFindings.length,
      payments: paymentFindings.length,
      shipments: shipmentFindings.length,
      disputes: disputeFindings.length,
    },
    findings: {
      payments: paymentFindings,
      shipments: shipmentFindings,
      disputes: disputeFindings,
    },
    nextActions: uniqueNextActions([
      ...paymentFindings.map((finding) => ({
        recommended_action: paymentRecommendedAction(finding),
      })),
      ...shipmentFindings,
      ...disputeFindings,
    ]),
  };
}
