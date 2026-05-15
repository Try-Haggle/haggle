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

export type PaymentMetricName = typeof PAYMENT_METRIC_NAMES[number];
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
  "payment.operation.failed": new Set(["provider", "rail", "operation", "environment", "failure_type"]),
  "payment.operation.duration_ms": new Set(["provider", "rail", "operation", "environment"]),
  "payment.idempotency.result": new Set(["operation", "idempotency_result", "environment"]),
  "payment.webhook.received": new Set(["provider", "event_type", "environment"]),
  "payment.webhook.rejected": new Set(["provider", "failure_type", "environment"]),
  "payment.webhook.duplicate": new Set(["provider", "event_type", "environment"]),
  "payment.webhook.processing_failed": new Set(["provider", "event_type", "failure_type", "environment"]),
  "payment.reconciliation.finding": new Set(["provider", "reconciliation_type", "environment"]),
  "payment.reconciliation.drift_open": new Set(["provider", "reconciliation_type", "environment"]),
  "payment.stuck.count": new Set(["rail", "status", "environment"]),
  "payment.refund.failed": new Set(["provider", "rail", "failure_type", "environment"]),
  "payment.admin_override": new Set(["operation", "environment"]),
};

const sensitiveMetricValuePatterns = [
  /\b(?:\d[ -]?){13,19}\b/,
  /\b(?:cvv|cvc|card|pan|expiry|expiration|bank|account|routing|secret|token|signature|authorization|client_secret)\b/i,
  /\b(?:pi|pm|seti|cs|evt|ch|re|txn|ord|pay|wallet|grant|dep|disp|ship)_[A-Za-z0-9_-]{6,}\b/,
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
  const normalized = value.trim().toLowerCase().replace(/[^a-z0-9_.:-]/g, "_").slice(0, 80);
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
  if (!isSafeMetricValue(value)) {
    throw new Error(`Unsafe payment metric value for "${key}"`);
  }
}

function isSafeMetricValue(value: string): boolean {
  if (value.length === 0 || value.length > 80) return false;
  return !sensitiveMetricValuePatterns.some((pattern) => pattern.test(value));
}
