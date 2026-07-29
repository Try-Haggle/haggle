import { api } from "./api-client";

const DEFAULT_MAX_ATTEMPTS = 20;
const DEFAULT_RETRY_SECONDS = 2;
const MIN_RETRY_SECONDS = 1;
const MAX_RETRY_SECONDS = 5;

const CONFIRMED_STATUSES = new Set(["RELEASE_CONFIRMED"]);
const RETRYABLE_STATUSES = new Set(["RELEASE_PENDING", "RELEASE_CONFIRMATIONS_PENDING"]);

export interface ConditionalReleaseConfirmationResponse {
  conditional_settlement?: {
    status?: string;
    release_tx_hash?: string;
  };
  retry?: { after_seconds?: number };
}

interface ReleaseConfirmationOptions {
  maxAttempts?: number;
  request?: () => Promise<ConditionalReleaseConfirmationResponse>;
  sleep?: (milliseconds: number) => Promise<void>;
}

function wait(milliseconds: number) {
  return new Promise<void>((resolve) => globalThis.setTimeout(resolve, milliseconds));
}

function retryDelayMilliseconds(response: ConditionalReleaseConfirmationResponse): number {
  const requested = response.retry?.after_seconds ?? DEFAULT_RETRY_SECONDS;
  return Math.min(MAX_RETRY_SECONDS, Math.max(MIN_RETRY_SECONDS, requested)) * 1_000;
}

export async function confirmConditionalSettlementRelease(
  settlementReleaseId: string,
  txHash: `0x${string}`,
  options: ReleaseConfirmationOptions = {},
): Promise<ConditionalReleaseConfirmationResponse> {
  const request =
    options.request ??
    (() =>
      api.post<ConditionalReleaseConfirmationResponse>(
        `/settlement-releases/${settlementReleaseId}/conditional-release-confirmation`,
        { tx_hash: txHash },
      ));
  const sleep = options.sleep ?? wait;
  const maxAttempts = options.maxAttempts ?? DEFAULT_MAX_ATTEMPTS;

  for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
    const response = await request();
    const status = response.conditional_settlement?.status;
    if (status && CONFIRMED_STATUSES.has(status)) return response;
    if (!status || !RETRYABLE_STATUSES.has(status)) {
      throw new Error(`Release confirmation returned an unexpected status: ${status ?? "missing"}`);
    }
    if (attempt === maxAttempts) break;
    await sleep(retryDelayMilliseconds(response));
  }

  throw new Error(
    "The release transaction is still awaiting network finality. Continue confirmation from this order; do not submit another release.",
  );
}
