export type ProductionPaymentState =
  | "pending"
  | "authorized"
  | "captured"
  | "canceled"
  | "refunded"
  | "partially_refunded"
  | "failed"
  | "disputed"
  | "expired";

export type ProductionPaymentAction =
  | "authorize"
  | "capture"
  | "cancel"
  | "refund"
  | "partial_refund"
  | "fail"
  | "dispute"
  | "expire";

export const PRODUCTION_PAYMENT_STATES: readonly ProductionPaymentState[] = [
  "pending",
  "authorized",
  "captured",
  "canceled",
  "refunded",
  "partially_refunded",
  "failed",
  "disputed",
  "expired",
];

const PRODUCTION_PAYMENT_TRANSITIONS: Record<
  ProductionPaymentState,
  Partial<Record<ProductionPaymentAction, ProductionPaymentState>>
> = {
  pending: {
    authorize: "authorized",
    cancel: "canceled",
    fail: "failed",
    expire: "expired",
  },
  authorized: {
    capture: "captured",
    cancel: "canceled",
    fail: "failed",
    expire: "expired",
  },
  captured: {
    refund: "refunded",
    partial_refund: "partially_refunded",
    dispute: "disputed",
  },
  partially_refunded: {
    refund: "refunded",
    dispute: "disputed",
  },
  disputed: {
    refund: "refunded",
    partial_refund: "partially_refunded",
    fail: "failed",
  },
  canceled: {},
  refunded: {},
  failed: {},
  expired: {},
};

export function transitionProductionPaymentState(
  state: ProductionPaymentState,
  action: ProductionPaymentAction,
): ProductionPaymentState | null {
  return PRODUCTION_PAYMENT_TRANSITIONS[state][action] ?? null;
}

export function assertProductionPaymentTransition(
  state: ProductionPaymentState,
  action: ProductionPaymentAction,
): ProductionPaymentState {
  const next = transitionProductionPaymentState(state, action);
  if (!next) {
    throw new Error(`invalid production payment transition: ${state} -> ${action}`);
  }
  return next;
}

export type LegacyPaymentIntentStatus =
  | "CREATED"
  | "QUOTED"
  | "AUTHORIZED"
  | "SETTLEMENT_PENDING"
  | "SETTLED"
  | "FAILED"
  | "CANCELED";

export function mapLegacyStatusToProductionState(status: LegacyPaymentIntentStatus): ProductionPaymentState {
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

export function isProductionPaymentState(value: unknown): value is ProductionPaymentState {
  return typeof value === "string" && PRODUCTION_PAYMENT_STATES.includes(value as ProductionPaymentState);
}

export function isProductionStateCompatibleWithLegacyStatus(
  legacyStatus: LegacyPaymentIntentStatus,
  productionState: ProductionPaymentState,
): boolean {
  switch (legacyStatus) {
    case "CREATED":
    case "QUOTED":
      return productionState === "pending" || productionState === "expired";
    case "AUTHORIZED":
    case "SETTLEMENT_PENDING":
      return productionState === "authorized" || productionState === "expired";
    case "SETTLED":
      return productionState === "captured"
        || productionState === "partially_refunded"
        || productionState === "refunded"
        || productionState === "disputed";
    case "FAILED":
      return productionState === "failed";
    case "CANCELED":
      return productionState === "canceled" || productionState === "expired";
  }
}

export function assertProductionStateCompatibleWithLegacyStatus(
  legacyStatus: LegacyPaymentIntentStatus,
  productionState: ProductionPaymentState,
): void {
  if (!isProductionStateCompatibleWithLegacyStatus(legacyStatus, productionState)) {
    throw new Error(`incompatible payment statuses: legacy=${legacyStatus} production=${productionState}`);
  }
}

export function normalizeProductionPaymentState(
  legacyStatus: LegacyPaymentIntentStatus,
  candidate?: unknown,
): ProductionPaymentState {
  const productionState = isProductionPaymentState(candidate)
    ? candidate
    : mapLegacyStatusToProductionState(legacyStatus);
  assertProductionStateCompatibleWithLegacyStatus(legacyStatus, productionState);
  return productionState;
}

export function productionStateAfterRefund(input: {
  legacyStatus: LegacyPaymentIntentStatus;
  paymentAmountMinor: number;
  refundAmountMinor: number;
}): ProductionPaymentState {
  if (input.legacyStatus !== "SETTLED") {
    throw new Error(`refund production state requires SETTLED intent, got ${input.legacyStatus}`);
  }
  if (input.refundAmountMinor <= 0) {
    throw new Error("refund amount must be positive");
  }
  if (input.refundAmountMinor > input.paymentAmountMinor) {
    throw new Error(`refund amount ${input.refundAmountMinor} exceeds payment amount ${input.paymentAmountMinor}`);
  }
  return input.refundAmountMinor === input.paymentAmountMinor ? "refunded" : "partially_refunded";
}

const SENSITIVE_PAYMENT_KEY_PATTERNS = [
  /\baccount[_-]?number\b/i,
  /authorization/i,
  /bank.*account/i,
  /card.*number/i,
  /card[_-]?exp/i,
  /client.*secret/i,
  /cvv/i,
  /cvc/i,
  /expiry/i,
  /exp[_-]?(month|year)/i,
  /\biban\b/i,
  /(^|[_-])pan($|[_-])/i,
  /payment.*method.*id/i,
  /payment[_-]?token/i,
  /primary.*account.*number/i,
  /provider.*payment.*method/i,
  /\brouting[_-]?number\b/i,
  /secret/i,
  /signature/i,
  /token/i,
  /wallet.*token/i,
];

export function isSensitivePaymentKey(key: string): boolean {
  return SENSITIVE_PAYMENT_KEY_PATTERNS.some((pattern) => pattern.test(key));
}

export function redactPaymentSensitiveData(value: unknown): unknown {
  return redactPaymentSensitiveDataInner(value, new WeakSet<object>());
}

function isLuhnValid(candidate: string): boolean {
  let sum = 0;
  let shouldDouble = false;

  for (let index = candidate.length - 1; index >= 0; index -= 1) {
    let digit = Number(candidate[index]);
    if (!Number.isInteger(digit)) return false;
    if (shouldDouble) {
      digit *= 2;
      if (digit > 9) digit -= 9;
    }
    sum += digit;
    shouldDouble = !shouldDouble;
  }

  return sum > 0 && sum % 10 === 0;
}

function redactSensitivePaymentString(value: string): string {
  return value.replace(/\b(?:\d[ -]?){13,19}\b/g, (candidate) => {
    const digits = candidate.replace(/\D/g, "");
    if (digits.length < 13 || digits.length > 19 || !isLuhnValid(digits)) {
      return candidate;
    }
    const trailingSeparator = candidate.match(/[ -]+$/)?.[0] ?? "";
    return `[REDACTED_PAN]${trailingSeparator}`;
  });
}

function redactPaymentSensitiveDataInner(value: unknown, seen: WeakSet<object>): unknown {
  if (Array.isArray(value)) {
    if (seen.has(value)) return "[Circular]";
    seen.add(value);
    return value.map((item) => redactPaymentSensitiveDataInner(item, seen));
  }

  if (typeof value === "string") {
    return redactSensitivePaymentString(value);
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
    redacted[key] = isSensitivePaymentKey(key) ? "[REDACTED]" : redactPaymentSensitiveDataInner(entry, seen);
  }
  return redacted;
}

export type ProviderErrorClassification =
  | "retryable"
  | "non_retryable"
  | "unknown_requires_reconciliation";

export interface ProviderErrorLike {
  code?: string;
  status?: number;
  statusCode?: number;
  type?: string;
  message?: string;
}

const NON_RETRYABLE_PROVIDER_CODES = new Set([
  "authentication_error",
  "card_declined",
  "expired_card",
  "insufficient_funds",
  "invalid_request_error",
  "parameter_invalid_empty",
  "parameter_invalid_integer",
  "permission_error",
  "resource_missing",
]);

const RETRYABLE_PROVIDER_CODES = new Set([
  "api_connection_error",
  "api_error",
  "connection_reset",
  "econnreset",
  "etimedout",
  "lock_timeout",
  "rate_limit_error",
  "timeout",
]);

function errorCode(value: unknown): string | null {
  if (!value || typeof value !== "object") return null;
  const candidate = value as ProviderErrorLike;
  return (candidate.code ?? candidate.type ?? null)?.toLowerCase() ?? null;
}

function errorStatus(value: unknown): number | null {
  if (!value || typeof value !== "object") return null;
  const candidate = value as ProviderErrorLike;
  const status = candidate.status ?? candidate.statusCode;
  return typeof status === "number" && Number.isFinite(status) ? status : null;
}

export function classifyProviderError(error: unknown): ProviderErrorClassification {
  const code = errorCode(error);
  if (code && NON_RETRYABLE_PROVIDER_CODES.has(code)) return "non_retryable";
  if (code && RETRYABLE_PROVIDER_CODES.has(code)) return "retryable";

  const status = errorStatus(error);
  if (status !== null) {
    if (status === 408 || status === 409 || status === 425 || status === 429 || status >= 500) return "retryable";
    if (status >= 400 && status < 500) return "non_retryable";
  }

  const message = error instanceof Error ? error.message.toLowerCase() : String(error ?? "").toLowerCase();
  if (/\b(timeout|timed out|econnreset|connection reset|temporarily unavailable)\b/.test(message)) {
    return "retryable";
  }
  return "unknown_requires_reconciliation";
}

export function calculateRetryDelayMs(
  attempt: number,
  options: {
    baseDelayMs?: number;
    maxDelayMs?: number;
    jitterMs?: number;
  } = {},
): number {
  const baseDelayMs = options.baseDelayMs ?? 250;
  const maxDelayMs = options.maxDelayMs ?? 5_000;
  const jitterMs = options.jitterMs ?? 0;
  const boundedAttempt = Math.max(0, Math.floor(attempt));
  const exponential = Math.min(maxDelayMs, baseDelayMs * 2 ** boundedAttempt);
  return Math.min(maxDelayMs, exponential + Math.max(0, jitterMs));
}

export interface LocalPaymentSnapshot {
  payment_intent_id: string;
  order_id?: string;
  state: ProductionPaymentState;
  amount_minor: number;
  refunded_amount_minor?: number;
  provider_reference?: string;
}

export interface ProviderPaymentSnapshot {
  provider_reference: string;
  state: ProductionPaymentState;
  amount_minor: number;
  refunded_amount_minor?: number;
  local_payment_intent_id?: string;
}

export type ReconciliationFindingType =
  | "local_captured_provider_not_captured"
  | "provider_captured_local_not_captured"
  | "refund_mismatch"
  | "orphan_provider_payment"
  | "amount_mismatch";

export interface ReconciliationFinding {
  type: ReconciliationFindingType;
  severity: "warning" | "critical";
  payment_intent_id?: string;
  order_id?: string;
  provider_reference?: string;
  message: string;
}

function isCapturedLike(state: ProductionPaymentState): boolean {
  return state === "captured" || state === "partially_refunded" || state === "refunded" || state === "disputed";
}

export function detectPaymentReconciliationFindings(
  localPayments: readonly LocalPaymentSnapshot[],
  providerPayments: readonly ProviderPaymentSnapshot[],
): ReconciliationFinding[] {
  const findings: ReconciliationFinding[] = [];
  const localByProviderRef = new Map<string, LocalPaymentSnapshot>();
  const localByIntentId = new Map<string, LocalPaymentSnapshot>();

  for (const local of localPayments) {
    if (local.provider_reference) {
      localByProviderRef.set(local.provider_reference, local);
    }
    localByIntentId.set(local.payment_intent_id, local);
  }

  for (const local of localPayments) {
    const provider = local.provider_reference
      ? providerPayments.find((candidate) => candidate.provider_reference === local.provider_reference)
      : undefined;

    if (isCapturedLike(local.state) && (!provider || !isCapturedLike(provider.state))) {
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
    const local =
      localByProviderRef.get(provider.provider_reference)
      ?? (provider.local_payment_intent_id ? localByIntentId.get(provider.local_payment_intent_id) : undefined);

    if (!local) {
      findings.push({
        type: "orphan_provider_payment",
        severity: "critical",
        provider_reference: provider.provider_reference,
        message: "Provider payment has no matching local payment intent.",
      });
      continue;
    }

    if (isCapturedLike(provider.state) && !isCapturedLike(local.state)) {
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

export type PaymentAuditEventType =
  | "authorization"
  | "capture"
  | "cancel"
  | "refund"
  | "webhook_received"
  | "webhook_rejected"
  | "reconciliation_correction"
  | "admin_override";

export interface PaymentAuditEventInput {
  type: PaymentAuditEventType;
  actor: { id: string; role: string };
  payment_intent_id?: string;
  order_id?: string;
  provider_event_id?: string;
  previous_state?: ProductionPaymentState;
  next_state?: ProductionPaymentState;
  reason: string;
  request_id: string;
  metadata?: Record<string, unknown>;
  timestamp?: string;
}

export function createPaymentAuditEvent(input: PaymentAuditEventInput): PaymentAuditEventInput & { timestamp: string } {
  return {
    ...input,
    timestamp: input.timestamp ?? new Date().toISOString(),
    metadata: input.metadata ? redactPaymentSensitiveData(input.metadata) as Record<string, unknown> : undefined,
  };
}
