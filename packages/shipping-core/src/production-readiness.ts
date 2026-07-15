const SENSITIVE_SHIPPING_KEY_PATTERNS = [
  /address/i,
  /authorization/i,
  /email/i,
  /name/i,
  /phone/i,
  /postal/i,
  /secret/i,
  /signature/i,
  /street/i,
  /token/i,
  /zip/i,
];

export function isSensitiveShippingKey(key: string): boolean {
  return SENSITIVE_SHIPPING_KEY_PATTERNS.some((pattern) => pattern.test(key));
}

export function redactShippingSensitiveData(value: unknown): unknown {
  return redactShippingSensitiveDataInner(value, new WeakSet<object>());
}

function redactShippingSensitiveDataInner(value: unknown, seen: WeakSet<object>): unknown {
  if (Array.isArray(value)) {
    if (seen.has(value)) return "[Circular]";
    seen.add(value);
    return value.map((item) => redactShippingSensitiveDataInner(item, seen));
  }

  if (!value || typeof value !== "object") {
    return value;
  }

  if (seen.has(value)) return "[Circular]";
  seen.add(value);

  if (value instanceof Error) {
    return {
      name: value.name,
      message: "[REDACTED_ERROR_MESSAGE]",
    };
  }

  const redacted: Record<string, unknown> = {};
  for (const [key, entry] of Object.entries(value as Record<string, unknown>)) {
    redacted[key] = isSensitiveShippingKey(key)
      ? "[REDACTED]"
      : redactShippingSensitiveDataInner(entry, seen);
  }
  return redacted;
}

export type CarrierErrorClassification =
  | "retryable"
  | "non_retryable"
  | "unknown_requires_reconciliation";

export function classifyCarrierError(error: unknown): CarrierErrorClassification {
  if (error && typeof error === "object") {
    const candidate = error as {
      status?: unknown;
      statusCode?: unknown;
      code?: unknown;
      type?: unknown;
    };
    const status =
      typeof candidate.status === "number"
        ? candidate.status
        : typeof candidate.statusCode === "number"
          ? candidate.statusCode
          : null;
    if (status !== null) {
      if (status === 408 || status === 409 || status === 425 || status === 429 || status >= 500)
        return "retryable";
      if (status >= 400 && status < 500) return "non_retryable";
    }
    const code =
      typeof candidate.code === "string"
        ? candidate.code.toLowerCase()
        : typeof candidate.type === "string"
          ? candidate.type.toLowerCase()
          : "";
    if (/timeout|rate_limit|api_error|connection|econnreset/.test(code)) return "retryable";
    if (/auth|invalid|not_found|permission|address_verification/.test(code)) return "non_retryable";
  }

  const message =
    error instanceof Error ? error.message.toLowerCase() : String(error ?? "").toLowerCase();
  if (/\b(timeout|timed out|econnreset|temporarily unavailable|rate limit)\b/.test(message)) {
    return "retryable";
  }
  return "unknown_requires_reconciliation";
}

export function calculateCarrierRetryDelayMs(
  attempt: number,
  options: { baseDelayMs?: number; maxDelayMs?: number } = {},
): number {
  const baseDelayMs = options.baseDelayMs ?? 150;
  const maxDelayMs = options.maxDelayMs ?? 750;
  const boundedAttempt = Math.max(0, Math.floor(attempt));
  return Math.min(maxDelayMs, baseDelayMs * 2 ** boundedAttempt);
}

export type ProductionShipmentState =
  | "label_pending"
  | "label_created"
  | "in_transit"
  | "out_for_delivery"
  | "delivered"
  | "delivery_exception"
  | "return_in_transit"
  | "returned";

export interface LocalShipmentSnapshot {
  shipment_id: string;
  order_id: string;
  state: ProductionShipmentState;
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
  state: ProductionShipmentState;
  carrier?: string;
  label_purchased?: boolean;
  label_url?: string;
  qr_code_url?: string;
  local_shipment_id?: string;
}

export type ShipmentReconciliationFindingType =
  | "local_delivered_provider_not_delivered"
  | "provider_delivered_local_not_delivered"
  | "label_created_without_fulfillable_order"
  | "label_missing_after_provider_purchase"
  | "tracking_missing_after_label"
  | "return_state_mismatch"
  | "orphan_provider_shipment";

export interface ShipmentReconciliationFinding {
  type: ShipmentReconciliationFindingType;
  severity: "warning" | "critical";
  shipment_id?: string;
  order_id?: string;
  provider_shipment_id?: string;
  provider_tracker_id?: string;
  tracking_number?: string;
  message: string;
  recommended_action: string;
}

function isDeliveredLike(state: ProductionShipmentState): boolean {
  return state === "delivered" || state === "returned";
}

function isReturnState(state: ProductionShipmentState): boolean {
  return state === "return_in_transit" || state === "returned";
}

function isFulfillableOrderStatus(status?: string): boolean {
  return (
    !status ||
    [
      "PAID",
      "FULFILLMENT_PENDING",
      "FULFILLMENT_ACTIVE",
      "DELIVERED",
      "IN_DISPUTE",
      "CLOSED",
    ].includes(status)
  );
}

function _providerKey(snapshot: ProviderShipmentSnapshot): string | null {
  return (
    snapshot.provider_shipment_id ??
    snapshot.provider_tracker_id ??
    snapshot.tracking_number ??
    null
  );
}

export function detectShipmentReconciliationFindings(
  localShipments: readonly LocalShipmentSnapshot[],
  providerShipments: readonly ProviderShipmentSnapshot[],
): ShipmentReconciliationFinding[] {
  const findings: ShipmentReconciliationFinding[] = [];
  const localByProviderShipmentId = new Map<string, LocalShipmentSnapshot>();
  const localByProviderTrackerId = new Map<string, LocalShipmentSnapshot>();
  const localByTrackingNumber = new Map<string, LocalShipmentSnapshot>();
  const localByShipmentId = new Map<string, LocalShipmentSnapshot>();

  for (const local of localShipments) {
    localByShipmentId.set(local.shipment_id, local);
    if (local.provider_shipment_id)
      localByProviderShipmentId.set(local.provider_shipment_id, local);
    if (local.provider_tracker_id) localByProviderTrackerId.set(local.provider_tracker_id, local);
    if (local.tracking_number) localByTrackingNumber.set(local.tracking_number, local);
  }

  for (const local of localShipments) {
    const provider = providerShipments.find(
      (candidate) =>
        (local.provider_shipment_id &&
          candidate.provider_shipment_id === local.provider_shipment_id) ||
        (local.provider_tracker_id &&
          candidate.provider_tracker_id === local.provider_tracker_id) ||
        (local.tracking_number && candidate.tracking_number === local.tracking_number) ||
        (candidate.local_shipment_id && candidate.local_shipment_id === local.shipment_id),
    );

    if (local.state !== "label_pending" && !isFulfillableOrderStatus(local.order_status)) {
      findings.push({
        type: "label_created_without_fulfillable_order",
        severity: "critical",
        shipment_id: local.shipment_id,
        order_id: local.order_id,
        provider_shipment_id: local.provider_shipment_id,
        provider_tracker_id: local.provider_tracker_id,
        tracking_number: local.tracking_number,
        message: "Shipment has moved past label pending for a non-fulfillable order.",
        recommended_action:
          "Pause fulfillment, verify payment/order status, and void or hold the label if possible.",
      });
    }

    if (local.state !== "label_pending" && !local.tracking_number) {
      findings.push({
        type: "tracking_missing_after_label",
        severity: "warning",
        shipment_id: local.shipment_id,
        order_id: local.order_id,
        provider_shipment_id: local.provider_shipment_id,
        provider_tracker_id: local.provider_tracker_id,
        message: "Shipment label exists locally without a tracking number.",
        recommended_action:
          "Fetch provider shipment/tracker state and update the local tracking fields.",
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
        recommended_action:
          "Re-fetch the purchased label assets and block seller print/QR flow until recovered.",
      });
    }

    if (isDeliveredLike(local.state) && provider && !isDeliveredLike(provider.state)) {
      findings.push({
        type: "local_delivered_provider_not_delivered",
        severity: "critical",
        shipment_id: local.shipment_id,
        order_id: local.order_id,
        provider_shipment_id: provider.provider_shipment_id,
        provider_tracker_id: provider.provider_tracker_id,
        tracking_number: provider.tracking_number ?? local.tracking_number,
        message: "Local shipment is terminal but provider shipment is not terminal.",
        recommended_action:
          "Reconcile against carrier tracking before releasing funds or closing the order.",
      });
    }

    if (provider && isReturnState(local.state) !== isReturnState(provider.state)) {
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
    const local =
      (provider.provider_shipment_id &&
        localByProviderShipmentId.get(provider.provider_shipment_id)) ||
      (provider.provider_tracker_id &&
        localByProviderTrackerId.get(provider.provider_tracker_id)) ||
      (provider.tracking_number && localByTrackingNumber.get(provider.tracking_number)) ||
      (provider.local_shipment_id && localByShipmentId.get(provider.local_shipment_id));

    if (!local) {
      findings.push({
        type: "orphan_provider_shipment",
        severity: "critical",
        provider_shipment_id: provider.provider_shipment_id,
        provider_tracker_id: provider.provider_tracker_id,
        tracking_number: provider.tracking_number,
        message: "Provider shipment has no matching local shipment record.",
        recommended_action:
          "Find the owning order before exposing tracking, billing shipment fees, or closing fulfillment.",
      });
      continue;
    }

    if (isDeliveredLike(provider.state) && !isDeliveredLike(local.state)) {
      findings.push({
        type: "provider_delivered_local_not_delivered",
        severity: "critical",
        shipment_id: local.shipment_id,
        order_id: local.order_id,
        provider_shipment_id: provider.provider_shipment_id,
        provider_tracker_id: provider.provider_tracker_id,
        tracking_number: provider.tracking_number ?? local.tracking_number,
        message: "Provider shipment is terminal but local shipment is not terminal.",
        recommended_action:
          "Refresh local shipment/order state and check whether funds can be released.",
      });
    }
  }

  return findings.sort((a, b) => {
    if (a.severity === b.severity) return a.type.localeCompare(b.type);
    return a.severity === "critical" ? -1 : 1;
  });
}
