import { api } from "./api-client";

const DEFAULT_MAX_ATTEMPTS = 20;
const DEFAULT_RETRY_SECONDS = 2;
const MIN_RETRY_SECONDS = 1;
const MAX_RETRY_SECONDS = 5;

const CONFIRMED_STATUSES = new Set(["FUNDING_CONFIRMED", "ALREADY_SETTLED"]);
const RETRYABLE_STATUSES = new Set(["FUNDING_PENDING", "FUNDING_CONFIRMATIONS_PENDING"]);

export interface ConditionalSettlementConfirmationResponse {
  conditional_settlement?: {
    status?: string;
    funding_tx_hash?: string;
  };
  retry?: {
    after_seconds?: number;
    reuse_transaction_hash?: boolean;
    use_new_idempotency_key?: boolean;
  };
}

interface ConfirmationPollOptions {
  maxAttempts?: number;
  request?: () => Promise<ConditionalSettlementConfirmationResponse>;
  sleep?: (milliseconds: number) => Promise<void>;
}

function retryDelayMilliseconds(response: ConditionalSettlementConfirmationResponse): number {
  const requested = response.retry?.after_seconds ?? DEFAULT_RETRY_SECONDS;
  const bounded = Math.min(MAX_RETRY_SECONDS, Math.max(MIN_RETRY_SECONDS, requested));
  return bounded * 1_000;
}

function wait(milliseconds: number) {
  return new Promise<void>((resolve) => globalThis.setTimeout(resolve, milliseconds));
}

export async function confirmConditionalSettlementFunding(
  paymentIntentId: string,
  options: ConfirmationPollOptions = {},
): Promise<ConditionalSettlementConfirmationResponse> {
  const maxAttempts = options.maxAttempts ?? DEFAULT_MAX_ATTEMPTS;
  const request =
    options.request ??
    (() =>
      api.post<ConditionalSettlementConfirmationResponse>(
        `/payments/${paymentIntentId}/x402/conditional-settlement-confirmation`,
        {},
        {
          headers: {
            "Idempotency-Key": `funding-confirm-${paymentIntentId}-${crypto.randomUUID()}`,
          },
        },
      ));
  const sleep = options.sleep ?? wait;

  for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
    const response = await request();
    const status = response.conditional_settlement?.status;

    if (status && CONFIRMED_STATUSES.has(status)) {
      return response;
    }
    if (!status || !RETRYABLE_STATUSES.has(status)) {
      throw new Error(`Funding confirmation returned an unexpected status: ${status ?? "missing"}`);
    }
    if (attempt === maxAttempts) break;

    await sleep(retryDelayMilliseconds(response));
  }

  throw new Error(
    "Funding is still waiting for network confirmation. Retry confirmation from the order page; do not submit another payment.",
  );
}
