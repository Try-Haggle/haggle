import type {
  X402FacilitatorSettleResponse,
  X402FacilitatorVerifyResponse,
  X402PaymentPayloadEnvelope,
  X402PaymentRequirement,
} from "@haggle/payment-core";

export class X402FacilitatorClient {
  constructor(
    private readonly facilitatorUrl: string,
    private readonly apiKeyId?: string,
    private readonly apiKeySecret?: string,
  ) {}

  private buildHeaders() {
    const headers: Record<string, string> = {
      "content-type": "application/json",
    };
    if (this.apiKeyId) {
      headers["x-cdp-api-key-id"] = this.apiKeyId;
    }
    if (this.apiKeySecret) {
      headers["x-cdp-api-key-secret"] = this.apiKeySecret;
    }
    return headers;
  }

  async verify(paymentPayload: X402PaymentPayloadEnvelope, paymentRequirements: X402PaymentRequirement) {
    const response = await fetch(`${this.facilitatorUrl.replace(/\/$/, "")}/verify`, {
      method: "POST",
      headers: this.buildHeaders(),
      body: JSON.stringify({
        paymentPayload,
        paymentRequirements,
      }),
    });

    if (!response.ok) {
      throw new Error(`x402 verify failed with status ${response.status}`);
    }

    return (await response.json()) as X402FacilitatorVerifyResponse;
  }

  async settle(paymentPayload: X402PaymentPayloadEnvelope, paymentRequirements: X402PaymentRequirement) {
    const response = await fetch(`${this.facilitatorUrl.replace(/\/$/, "")}/settle`, {
      method: "POST",
      headers: this.buildHeaders(),
      body: JSON.stringify({
        paymentPayload,
        paymentRequirements,
      }),
    });

    if (!response.ok) {
      throw new Error(`x402 settle failed with status ${response.status}`);
    }

    return (await response.json()) as X402FacilitatorSettleResponse;
  }
}
