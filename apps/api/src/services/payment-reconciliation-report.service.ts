/**
 * Report-only payment ledger reconciliation.
 *
 * Detects local order ↔ intent ↔ refund ↔ release mismatches and optionally
 * compares local payment snapshots to injected provider snapshots.
 * Never settles, refunds, releases, or otherwise mutates money state.
 */

import {
  commerceOrders,
  type Database,
  desc,
  inArray,
  paymentIntents,
  refunds,
  settlementReleases,
} from "@haggle/db";
import {
  detectPaymentReconciliationFindings,
  type LocalPaymentSnapshot,
  type ProviderPaymentSnapshot,
  type ReconciliationFinding,
  type ReconciliationFindingType,
} from "@haggle/payment-core";
import {
  emitPaymentMetricSafely,
  type PaymentMetricEnvironment,
} from "../payments/observability.js";
import { requiresRealPaymentProviders } from "../payments/provider-runtime-policy.js";

type Severity = "warning" | "critical";

export type LocalPaymentLedgerFindingType =
  | "order_paid_like_intent_not_settled"
  | "intent_settled_order_not_paid_like"
  | "order_refunded_without_completed_refund"
  | "completed_refund_exceeds_intent_amount"
  | "settled_intent_missing_settlement_release"
  | "product_released_order_not_terminal"
  | "release_intent_order_mismatch";

export interface PaymentLedgerSnapshot {
  payment_intent_id: string;
  order_id: string;
  intent_status: string;
  intent_canonical_status: string;
  intent_amount_minor: number;
  intent_selected_rail: "x402" | "stripe";
  order_status: string;
  order_amount_minor: number;
  completed_refund_amount_minor: number;
  has_completed_refund: boolean;
  settlement_release_id?: string;
  settlement_release_payment_intent_id?: string;
  product_release_status?: string;
  provider_reference?: string;
}

export interface LocalPaymentLedgerFinding {
  type: LocalPaymentLedgerFindingType;
  severity: Severity;
  payment_intent_id: string;
  order_id: string;
  message: string;
  recommended_action: string;
}

export interface PaymentReconciliationReport {
  generatedAt: string;
  reportOnly: true;
  summary: {
    critical: number;
    warning: number;
    total: number;
    local_ledger: number;
    provider: number;
  };
  findings: {
    local_ledger: LocalPaymentLedgerFinding[];
    provider: ReconciliationFinding[];
  };
  nextActions: string[];
}

export interface CollectPaymentReconciliationOptions {
  limit?: number;
  generatedAt?: string;
  providerSnapshots?: readonly ProviderPaymentSnapshot[];
}

export interface PaymentReconciliationCollectResult {
  generatedAt: string;
  ledger: PaymentLedgerSnapshot[];
  localPayments: LocalPaymentSnapshot[];
  providerPayments: ProviderPaymentSnapshot[];
}

const PAID_LIKE_ORDER_STATUSES = new Set([
  "PAID",
  "FULFILLMENT_PENDING",
  "FULFILLMENT_ACTIVE",
  "DELIVERED",
  "IN_DISPUTE",
]);

const PRE_PAYMENT_ORDER_STATUSES = new Set(["APPROVED", "PAYMENT_PENDING"]);

const TERMINAL_AFTER_RELEASE_ORDER_STATUSES = new Set([
  "DELIVERED",
  "CLOSED",
  "REFUNDED",
  "IN_DISPUTE",
  "CANCELED",
]);

function parseMinor(value: string | number | null | undefined): number {
  if (value == null) return 0;
  const n = typeof value === "number" ? value : Number(value);
  return Number.isFinite(n) ? n : 0;
}

function countSeverity(findings: Array<{ severity: Severity }>, severity: Severity): number {
  return findings.filter((finding) => finding.severity === severity).length;
}

function uniqueNextActions(actions: string[]): string[] {
  return Array.from(new Set(actions.filter((action) => action.length > 0)));
}

function mapIntentToProductionState(
  status: string,
  canonicalStatus: string,
  refundedAmountMinor: number,
  amountMinor: number,
): LocalPaymentSnapshot["state"] {
  if (canonicalStatus === "partially_refunded" || canonicalStatus === "refunded") {
    return canonicalStatus;
  }
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
    default:
      if (
        canonicalStatus === "pending" ||
        canonicalStatus === "authorized" ||
        canonicalStatus === "captured" ||
        canonicalStatus === "canceled" ||
        canonicalStatus === "failed" ||
        canonicalStatus === "disputed" ||
        canonicalStatus === "expired"
      ) {
        return canonicalStatus;
      }
      return "pending";
  }
}

export function detectLocalPaymentLedgerFindings(
  snapshots: readonly PaymentLedgerSnapshot[],
): LocalPaymentLedgerFinding[] {
  const findings: LocalPaymentLedgerFinding[] = [];

  for (const row of snapshots) {
    const intentSettled = row.intent_status === "SETTLED";
    const orderPaidLike = PAID_LIKE_ORDER_STATUSES.has(row.order_status);
    const orderPrePayment = PRE_PAYMENT_ORDER_STATUSES.has(row.order_status);

    if (orderPaidLike && !intentSettled) {
      findings.push({
        type: "order_paid_like_intent_not_settled",
        severity: "critical",
        payment_intent_id: row.payment_intent_id,
        order_id: row.order_id,
        message: "Order looks paid/fulfillable but payment intent is not SETTLED.",
        recommended_action:
          "Compare order status with intent/authorization/settlement rows before fulfillment or support action.",
      });
    }

    // CLOSED without SETTLED is allowed only when canceled/refunded paths apply;
    // treat CLOSED + non-SETTLED + no refund as warning separately via refunded check below.

    if (intentSettled && orderPrePayment) {
      findings.push({
        type: "intent_settled_order_not_paid_like",
        severity: "critical",
        payment_intent_id: row.payment_intent_id,
        order_id: row.order_id,
        message: "Payment intent is SETTLED but order is still pre-payment.",
        recommended_action:
          "Refresh order status from payment truth through audited admin tooling; do not auto-mutate.",
      });
    }

    if (row.order_status === "REFUNDED" && !row.has_completed_refund) {
      findings.push({
        type: "order_refunded_without_completed_refund",
        severity: "critical",
        payment_intent_id: row.payment_intent_id,
        order_id: row.order_id,
        message: "Order is REFUNDED but no COMPLETED refund row exists for the intent.",
        recommended_action:
          "Compare refund rows and provider refund state before closing support actions.",
      });
    }

    if (row.completed_refund_amount_minor > row.intent_amount_minor) {
      findings.push({
        type: "completed_refund_exceeds_intent_amount",
        severity: "critical",
        payment_intent_id: row.payment_intent_id,
        order_id: row.order_id,
        message: "Completed refund total exceeds the payment intent amount.",
        recommended_action:
          "Halt further refunds and reconcile completed refund rows against the intent amount.",
      });
    }

    if (
      intentSettled &&
      row.order_status !== "CANCELED" &&
      row.order_status !== "REFUNDED" &&
      !row.settlement_release_id
    ) {
      findings.push({
        type: "settled_intent_missing_settlement_release",
        severity: "warning",
        payment_intent_id: row.payment_intent_id,
        order_id: row.order_id,
        message: "SETTLED intent has no settlement_releases row for the order.",
        recommended_action:
          "Verify settlement release creation path; create or repair via audited tooling if missing.",
      });
    }

    if (
      row.product_release_status === "RELEASED" &&
      !TERMINAL_AFTER_RELEASE_ORDER_STATUSES.has(row.order_status)
    ) {
      findings.push({
        type: "product_released_order_not_terminal",
        severity: "warning",
        payment_intent_id: row.payment_intent_id,
        order_id: row.order_id,
        message: "Product funds are RELEASED but order is not in a post-release terminal status.",
        recommended_action:
          "Reconcile order status with settlement release before further payout or dispute action.",
      });
    }

    if (
      row.settlement_release_id &&
      row.settlement_release_payment_intent_id &&
      row.settlement_release_payment_intent_id !== row.payment_intent_id
    ) {
      findings.push({
        type: "release_intent_order_mismatch",
        severity: "critical",
        payment_intent_id: row.payment_intent_id,
        order_id: row.order_id,
        message: "Settlement release payment_intent_id does not match the order's payment intent.",
        recommended_action:
          "Inspect settlement_releases linkage and repair through audited admin tooling only.",
      });
    }
  }

  return findings.sort((a, b) =>
    a.severity === b.severity ? a.type.localeCompare(b.type) : a.severity === "critical" ? -1 : 1,
  );
}

export function buildPaymentReconciliationReport(input: {
  generatedAt?: string;
  ledger: readonly PaymentLedgerSnapshot[];
  localPayments?: readonly LocalPaymentSnapshot[];
  providerPayments?: readonly ProviderPaymentSnapshot[];
  runProviderCompare?: boolean;
}): PaymentReconciliationReport {
  const localFindings = detectLocalPaymentLedgerFindings(input.ledger);
  const providerFindings =
    input.runProviderCompare && input.localPayments
      ? detectPaymentReconciliationFindings(input.localPayments, input.providerPayments ?? [])
      : [];

  const all = [...localFindings, ...providerFindings];

  return {
    generatedAt: input.generatedAt ?? new Date().toISOString(),
    reportOnly: true,
    summary: {
      critical: countSeverity(all, "critical"),
      warning: countSeverity(all, "warning"),
      total: all.length,
      local_ledger: localFindings.length,
      provider: providerFindings.length,
    },
    findings: {
      local_ledger: localFindings,
      provider: providerFindings,
    },
    nextActions: uniqueNextActions([
      ...localFindings.map((finding) => finding.recommended_action),
      ...providerFindings.map((finding) => providerRecommendedAction(finding.type)),
    ]),
  };
}

function providerRecommendedAction(type: ReconciliationFindingType): string {
  switch (type) {
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

export async function collectPaymentReconciliationInput(
  db: Database,
  options: CollectPaymentReconciliationOptions = {},
): Promise<PaymentReconciliationCollectResult> {
  const limit = Math.min(Math.max(Math.floor(options.limit ?? 200), 1), 1_000);

  const intentRows = await db
    .select()
    .from(paymentIntents)
    .orderBy(desc(paymentIntents.updatedAt))
    .limit(limit);

  if (intentRows.length === 0) {
    return {
      generatedAt: options.generatedAt ?? new Date().toISOString(),
      ledger: [],
      localPayments: [],
      providerPayments: [...(options.providerSnapshots ?? [])],
    };
  }

  const orderIds = Array.from(new Set(intentRows.map((row) => row.orderId)));
  const intentIds = intentRows.map((row) => row.id);

  const [orderRows, refundRows, releaseRows] = await Promise.all([
    db.select().from(commerceOrders).where(inArray(commerceOrders.id, orderIds)),
    db.select().from(refunds).where(inArray(refunds.paymentIntentId, intentIds)),
    db.select().from(settlementReleases).where(inArray(settlementReleases.orderId, orderIds)),
  ]);

  const orderById = new Map(orderRows.map((row) => [row.id, row]));
  const releaseByOrderId = new Map(releaseRows.map((row) => [row.orderId, row]));

  const completedRefundByIntent = new Map<string, number>();
  for (const row of refundRows) {
    if (row.status !== "COMPLETED") continue;
    completedRefundByIntent.set(
      row.paymentIntentId,
      (completedRefundByIntent.get(row.paymentIntentId) ?? 0) + parseMinor(row.amountMinor),
    );
  }

  const ledger: PaymentLedgerSnapshot[] = [];
  const localPayments: LocalPaymentSnapshot[] = [];

  for (const intent of intentRows) {
    const order = orderById.get(intent.orderId);
    if (!order) continue;

    const completedRefundAmount = completedRefundByIntent.get(intent.id) ?? 0;
    const release = releaseByOrderId.get(intent.orderId);
    const amountMinor = parseMinor(intent.amountMinor);

    ledger.push({
      payment_intent_id: intent.id,
      order_id: intent.orderId,
      intent_status: intent.status,
      intent_canonical_status: intent.canonicalStatus,
      intent_amount_minor: amountMinor,
      intent_selected_rail: intent.selectedRail,
      order_status: order.status,
      order_amount_minor: parseMinor(order.amountMinor),
      completed_refund_amount_minor: completedRefundAmount,
      has_completed_refund: completedRefundAmount > 0,
      settlement_release_id: release?.id,
      settlement_release_payment_intent_id: release?.paymentIntentId,
      product_release_status: release?.productReleaseStatus,
    });

    localPayments.push({
      payment_intent_id: intent.id,
      order_id: intent.orderId,
      state: mapIntentToProductionState(
        intent.status,
        intent.canonicalStatus,
        completedRefundAmount,
        amountMinor,
      ),
      amount_minor: amountMinor,
      refunded_amount_minor: completedRefundAmount,
    });
  }

  return {
    generatedAt: options.generatedAt ?? new Date().toISOString(),
    ledger,
    localPayments,
    providerPayments: [...(options.providerSnapshots ?? [])],
  };
}

export function resolvePaymentReconciliationMetricEnvironment(): PaymentMetricEnvironment {
  return requiresRealPaymentProviders() ? "live" : "test";
}

export async function emitPaymentReconciliationMetrics(
  report: PaymentReconciliationReport,
  options: {
    environment?: PaymentMetricEnvironment;
    providerByFinding?: (finding: ReconciliationFinding) => "stripe" | "x402" | undefined;
  } = {},
): Promise<void> {
  const environment = options.environment ?? resolvePaymentReconciliationMetricEnvironment();
  const openByType = new Map<string, number>();

  for (const finding of report.findings.local_ledger) {
    openByType.set(finding.type, (openByType.get(finding.type) ?? 0) + 1);
    await emitPaymentMetricSafely(
      "payment.reconciliation.finding",
      {
        reconciliation_type: finding.type,
        environment,
      },
      1,
    );
  }

  for (const finding of report.findings.provider) {
    openByType.set(finding.type, (openByType.get(finding.type) ?? 0) + 1);
    const provider = options.providerByFinding?.(finding);
    await emitPaymentMetricSafely(
      "payment.reconciliation.finding",
      {
        ...(provider ? { provider } : {}),
        reconciliation_type: finding.type,
        environment,
      },
      1,
    );
  }

  for (const [reconciliationType, count] of openByType) {
    await emitPaymentMetricSafely(
      "payment.reconciliation.drift_open",
      {
        reconciliation_type: reconciliationType,
        environment,
      },
      count,
    );
  }
}
