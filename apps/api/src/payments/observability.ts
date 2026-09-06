export const PAYMENT_METRIC_NAMES = [
  "payment.operation.started",
  "payment.operation.completed",
  "payment.operation.failed",
  "payment.operation.duration_ms",
  "payment.idempotency.result",
  "payment.webhook.received",
  "payment.webhook.rejected",
  "payment.webhook.duplicate",
  "payment.webhook.processing_failed",
  "payment.reconciliation.finding",
  "payment.reconciliation.drift_open",
  "payment.stuck.count",
  "payment.refund.failed",
  "payment.admin_override",
] as const;

export type PaymentMetricName = (typeof PAYMENT_METRIC_NAMES)[number];
export type PaymentMetricEnvironment = "test" | "live";
export type PaymentMetricOperation =
  | "prepare"
  | "authorize"
  | "capture"
  | "settlement_pending"
  | "cancel"
  | "refund"
  | "fail"
  | "webhook"
  | "reconciliation";
export type PaymentMetricFailureType =
  | "signature_invalid"
  | "signature_missing"
  | "timestamp_invalid"
  | "timestamp_expired"
  | "environment_mismatch"
  | "malformed"
  | "config_missing"
  | "provider_timeout"
  | "provider_retryable"
  | "provider_non_retryable"
  | "state_transition_invalid"
  | "idempotency_required"
  | "idempotency_conflict"
  | "idempotency_in_progress"
  | "processing_error"
  | "unknown";

export interface PaymentMetricDimensions {
  provider?: "stripe" | "x402";
  rail?: "stripe" | "x402";
  environment?: PaymentMetricEnvironment;
  operation?: PaymentMetricOperation;
  event_type?: string;
  failure_type?: PaymentMetricFailureType;
  idempotency_result?: "new" | "duplicate" | "conflict" | "in_progress" | "required_missing";
  reconciliation_type?: string;
  status?: "pending" | "authorized" | "unknown";
}

export interface PaymentMetricEvent {
  name: PaymentMetricName;
  value: number;
  dimensions: PaymentMetricDimensions;
  timestamp: string;
}

export type PaymentMetricSink = (event: PaymentMetricEvent) => void | Promise<void>;

type PaymentMetricDimensionKey = keyof PaymentMetricDimensions;

const metricNames = new Set<string>(PAYMENT_METRIC_NAMES);

const metricDimensionKeys: Record<PaymentMetricName, ReadonlySet<PaymentMetricDimensionKey>> = {
  "payment.operation.started": new Set(["provider", "rail", "operation", "environment"]),
  "payment.operation.completed": new Set(["provider", "rail", "operation", "environment"]),
  "payment.operation.failed": new Set([
    "provider",
    "rail",
    "operation",
    "environment",
    "failure_type",
  ]),
  "payment.operation.duration_ms": new Set(["provider", "rail", "operation", "environment"]),
  "payment.idempotency.result": new Set(["operation", "idempotency_result", "environment"]),
  "payment.webhook.received": new Set(["provider", "event_type", "environment"]),
  "payment.webhook.rejected": new Set(["provider", "failure_type", "environment"]),
  "payment.webhook.duplicate": new Set(["provider", "event_type", "environment"]),
  "payment.webhook.processing_failed": new Set([
    "provider",
    "event_type",
    "failure_type",
    "environment",
  ]),
  "payment.reconciliation.finding": new Set(["provider", "reconciliation_type", "environment"]),
  "payment.reconciliation.drift_open": new Set(["provider", "reconciliation_type", "environment"]),
  "payment.stuck.count": new Set(["rail", "status", "environment"]),
  "payment.refund.failed": new Set(["provider", "rail", "failure_type", "environment"]),
  "payment.admin_override": new Set(["operation", "environment"]),
};

const ALLOWED_PROVIDERS = new Set<string>(["stripe", "x402"]);
const ALLOWED_RAILS = new Set<string>(["stripe", "x402"]);
const ALLOWED_ENVIRONMENTS = new Set<string>(["test", "live"]);
const ALLOWED_OPERATIONS = new Set<string>([
  "prepare",
  "authorize",
  "capture",
  "settlement_pending",
  "cancel",
  "refund",
  "fail",
  "webhook",
  "reconciliation",
]);
const ALLOWED_FAILURE_TYPES = new Set<string>([
  "signature_invalid",
  "signature_missing",
  "timestamp_invalid",
  "timestamp_expired",
  "environment_mismatch",
  "malformed",
  "config_missing",
  "provider_timeout",
  "provider_retryable",
  "provider_non_retryable",
  "state_transition_invalid",
  "idempotency_required",
  "idempotency_conflict",
  "idempotency_in_progress",
  "processing_error",
  "unknown",
]);
const ALLOWED_IDEMPOTENCY_RESULTS = new Set<string>([
  "new",
  "duplicate",
  "conflict",
  "in_progress",
  "required_missing",
]);
const ALLOWED_STATUSES = new Set<string>(["pending", "authorized", "unknown"]);
const ALLOWED_RECONCILIATION_TYPES = new Set<string>([
  "order_paid_like_intent_not_settled",
  "intent_settled_order_not_paid_like",
  "order_refunded_without_completed_refund",
  "completed_refund_exceeds_intent_amount",
  "settled_intent_missing_settlement_release",
  "product_released_order_not_terminal",
  "release_intent_order_mismatch",
  "local_captured_provider_not_captured",
  "provider_captured_local_not_captured",
  "refund_mismatch",
  "orphan_provider_payment",
  "amount_mismatch",
]);

/** Reject PAN/PII/secret-looking and high-cardinality metric label values. */
const sensitiveMetricValuePatterns = [
  /\b(?:\d[ -]?){13,19}\b/,
  /\b(?:cvv|cvc|card|pan|expiry|expiration|bank|account|routing|secret|token|signature|authorization|client_secret)\b/i,
  /\b(?:pi|pm|seti|cs|evt|ch|re|txn|ord|pay|wallet|grant|dep|disp|ship)_[A-Za-z0-9_-]{6,}\b/,
  /\b(?:sk|rk|pk)_(?:live|test)_[A-Za-z0-9]+/i,
  /\bwhsec_[A-Za-z0-9]+/i,
  /\buser_[A-Za-z0-9_-]{6,}\b/i,
  /^Bearer\s+/i,
  /\beyJ[A-Za-z0-9_-]{10,}\./,
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i,
  /^[A-Z]{2}\d{2}[A-Z0-9]{10,30}$/,
  /^0x[a-fA-F0-9]{40,}$/,
  /@/,
];

let paymentMetricSink: PaymentMetricSink = () => undefined;

export function setPaymentMetricSink(sink: PaymentMetricSink): () => void {
  const previous = paymentMetricSink;
  paymentMetricSink = sink;
  return () => {
    paymentMetricSink = previous;
  };
}

export function createPaymentMetricEvent(
  name: PaymentMetricName,
  dimensions: PaymentMetricDimensions,
  value = 1,
): PaymentMetricEvent {
  assertPaymentMetricName(name);
  assertPaymentMetricValue(value);
  const allowedKeys = metricDimensionKeys[name];
  const entries = Object.entries(dimensions)
    .filter((entry): entry is [PaymentMetricDimensionKey, string] => entry[1] !== undefined)
    .sort(([left], [right]) => left.localeCompare(right));
  const safeDimensions: PaymentMetricDimensions = {};

  for (const [key, value] of entries) {
    if (!allowedKeys.has(key)) {
      throw new Error(`Unsafe payment metric dimension "${key}" for ${name}`);
    }
    assertSafePaymentMetricDimension(key, value);
    safeDimensions[key] = value as never;
  }

  return {
    name,
    value,
    dimensions: safeDimensions,
    timestamp: new Date().toISOString(),
  };
}

export async function emitPaymentMetric(
  name: PaymentMetricName,
  dimensions: PaymentMetricDimensions,
  value = 1,
): Promise<void> {
  await paymentMetricSink(createPaymentMetricEvent(name, dimensions, value));
}

export async function emitPaymentMetricSafely(
  name: PaymentMetricName,
  dimensions: PaymentMetricDimensions,
  value = 1,
): Promise<void> {
  try {
    await emitPaymentMetric(name, dimensions, value);
  } catch {
    console.warn("[payment-observability] dropped unsafe metric", { name });
  }
}

export function toPaymentMetricOperation(operation: string): PaymentMetricOperation | null {
  switch (operation) {
    case "payment.prepare":
    case "payment.stripe_onramp_session":
      return "prepare";
    case "payment.authorize":
      return "authorize";
    case "payment.x402_settle":
    case "payment.capture":
      return "capture";
    case "payment.settlement_pending":
      return "settlement_pending";
    case "payment.cancel":
      return "cancel";
    case "payment.refund":
      return "refund";
    case "payment.fail":
      return "fail";
    default:
      return null;
  }
}

export function normalizePaymentMetricEventType(value: unknown): string {
  if (typeof value !== "string" || value.trim().length === 0) return "unknown";
  const normalized = value
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9_.:-]/g, "_")
    .slice(0, 80);
  return isSafeMetricValue(normalized) ? normalized : "unknown";
}

export function normalizePaymentMetricFailureType(value: unknown): PaymentMetricFailureType {
  switch (value) {
    case "signature_verification_failed":
    case "invalid_signature":
      return "signature_invalid";
    case "missing_signature_header":
      return "signature_missing";
    case "webhook_timestamp_invalid":
      return "timestamp_invalid";
    case "webhook_timestamp_expired":
      return "timestamp_expired";
    case "environment_mismatch":
      return "environment_mismatch";
    case "missing_required_fields":
    case "malformed":
      return "malformed";
    case "webhook_secret_not_configured":
    case "provider_not_configured":
      return "config_missing";
    case "provider_timeout":
      return "provider_timeout";
    case "provider_retryable":
      return "provider_retryable";
    case "provider_non_retryable":
      return "provider_non_retryable";
    case "state_transition_invalid":
      return "state_transition_invalid";
    case "idempotency_required":
      return "idempotency_required";
    case "idempotency_conflict":
      return "idempotency_conflict";
    case "idempotency_in_progress":
      return "idempotency_in_progress";
    case "processing_error":
      return "processing_error";
    default:
      return "unknown";
  }
}

function assertPaymentMetricName(name: string): asserts name is PaymentMetricName {
  if (!metricNames.has(name)) {
    throw new Error(`Unknown payment metric "${name}"`);
  }
}

function assertPaymentMetricValue(value: number): void {
  if (!Number.isFinite(value) || value < 0) {
    throw new Error("Payment metric value must be a finite non-negative number");
  }
}

function assertSafePaymentMetricDimension(key: PaymentMetricDimensionKey, value: string): void {
  if (!isSafeMetricValue(value) || !isAllowedDimensionValue(key, value)) {
    throw new Error(`Unsafe payment metric value for "${key}"`);
  }
}

function isAllowedDimensionValue(key: PaymentMetricDimensionKey, value: string): boolean {
  switch (key) {
    case "provider":
      return ALLOWED_PROVIDERS.has(value);
    case "rail":
      return ALLOWED_RAILS.has(value);
    case "environment":
      return ALLOWED_ENVIRONMENTS.has(value);
    case "operation":
      return ALLOWED_OPERATIONS.has(value);
    case "failure_type":
      return ALLOWED_FAILURE_TYPES.has(value);
    case "idempotency_result":
      return ALLOWED_IDEMPOTENCY_RESULTS.has(value);
    case "status":
      return ALLOWED_STATUSES.has(value);
    case "reconciliation_type":
      return ALLOWED_RECONCILIATION_TYPES.has(value);
    case "event_type":
      // Coarse provider event types only; still must pass isSafeMetricValue.
      return /^[a-z0-9][a-z0-9_.:-]{0,79}$/.test(value);
    default:
      return false;
  }
}

function isSafeMetricValue(value: string): boolean {
  if (value.length === 0 || value.length > 80) return false;
  return !sensitiveMetricValuePatterns.some((pattern) => pattern.test(value));
}
