import type {
  X402FacilitatorSettleResponse,
  X402FacilitatorVerifyResponse,
  X402PaymentPayloadEnvelope,
  X402PaymentRequirement,
} from "@haggle/payment-core";
import { calculateRetryDelayMs, classifyProviderError } from "@haggle/payment-core";

export class X402FacilitatorClient {
  constructor(
    private readonly facilitatorUrl: string,
    private readonly apiKeyId?: string,
    private readonly apiKeySecret?: string,
  ) {}

  private buildHeaders(idempotencyKey?: string) {
    const headers: Record<string, string> = {
      "content-type": "application/json",
    };
    if (idempotencyKey) {
      headers["idempotency-key"] = idempotencyKey;
    }
    if (this.apiKeyId) {
      headers["x-cdp-api-key-id"] = this.apiKeyId;
    }
    if (this.apiKeySecret) {
      headers["x-cdp-api-key-secret"] = this.apiKeySecret;
    }
    return headers;
  }

  private async withRetries<T>(operation: () => Promise<T>): Promise<T> {
    const maxAttempts = 3;
    let lastError: unknown;
    for (let attempt = 0; attempt < maxAttempts; attempt += 1) {
      try {
        return await operation();
      } catch (error) {
        lastError = error;
        if (classifyProviderError(error) !== "retryable" || attempt === maxAttempts - 1) {
          throw error;
        }
        await new Promise((resolve) =>
          setTimeout(
            resolve,
            calculateRetryDelayMs(attempt, {
              baseDelayMs: 150,
              maxDelayMs: 750,
            }),
          ),
        );
      }
    }
    throw lastError;
  }

  async verify(
    paymentPayload: X402PaymentPayloadEnvelope,
    paymentRequirements: X402PaymentRequirement,
  ) {
    const response = await this.withRetries(async () => {
      const candidate = await fetch(`${this.facilitatorUrl.replace(/\/$/, "")}/verify`, {
        method: "POST",
        headers: this.buildHeaders(),
        body: JSON.stringify({
          paymentPayload,
          paymentRequirements,
        }),
      });
      if (!candidate.ok && classifyProviderError({ status: candidate.status }) === "retryable") {
        throw Object.assign(new Error(`x402 verify retryable status ${candidate.status}`), {
          status: candidate.status,
        });
      }
      return candidate;
    });

    if (!response.ok) {
      throw Object.assign(new Error(`x402 verify failed with status ${response.status}`), {
        status: response.status,
      });
    }

    return (await response.json()) as X402FacilitatorVerifyResponse;
  }

  async settle(
    paymentPayload: X402PaymentPayloadEnvelope,
    paymentRequirements: X402PaymentRequirement,
    idempotencyKey?: string,
  ) {
    const response = await this.withRetries(async () => {
      const candidate = await fetch(`${this.facilitatorUrl.replace(/\/$/, "")}/settle`, {
        method: "POST",
        headers: this.buildHeaders(idempotencyKey),
        body: JSON.stringify({
          paymentPayload,
          paymentRequirements,
        }),
      });
      if (!candidate.ok && classifyProviderError({ status: candidate.status }) === "retryable") {
        throw Object.assign(new Error(`x402 settle retryable status ${candidate.status}`), {
          status: candidate.status,
        });
      }
      return candidate;
    });

    if (!response.ok) {
      throw Object.assign(new Error(`x402 settle failed with status ${response.status}`), {
        status: response.status,
      });
    }

    return (await response.json()) as X402FacilitatorSettleResponse;
  }
}
