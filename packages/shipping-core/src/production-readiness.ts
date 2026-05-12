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
    redacted[key] = isSensitiveShippingKey(key) ? "[REDACTED]" : redactShippingSensitiveDataInner(entry, seen);
  }
  return redacted;
}

export type CarrierErrorClassification =
  | "retryable"
  | "non_retryable"
  | "unknown_requires_reconciliation";

export function classifyCarrierError(error: unknown): CarrierErrorClassification {
  if (error && typeof error === "object") {
    const candidate = error as { status?: unknown; statusCode?: unknown; code?: unknown; type?: unknown };
    const status = typeof candidate.status === "number"
      ? candidate.status
      : typeof candidate.statusCode === "number"
        ? candidate.statusCode
        : null;
    if (status !== null) {
      if (status === 408 || status === 409 || status === 425 || status === 429 || status >= 500) return "retryable";
      if (status >= 400 && status < 500) return "non_retryable";
    }
    const code = typeof candidate.code === "string"
      ? candidate.code.toLowerCase()
      : typeof candidate.type === "string"
        ? candidate.type.toLowerCase()
        : "";
    if (/timeout|rate_limit|api_error|connection|econnreset/.test(code)) return "retryable";
    if (/auth|invalid|not_found|permission|address_verification/.test(code)) return "non_retryable";
  }

  const message = error instanceof Error ? error.message.toLowerCase() : String(error ?? "").toLowerCase();
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
