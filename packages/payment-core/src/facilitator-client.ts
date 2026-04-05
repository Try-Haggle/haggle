import type {
  X402PaymentPayloadEnvelope,
  X402FacilitatorVerifyResponse,
  X402FacilitatorSettleResponse,
} from "./x402-protocol.js";

export interface FacilitatorClientConfig {
  facilitator_url: string;
  timeout_ms?: number;
}

export interface FacilitatorClient {
  verify(payload: X402PaymentPayloadEnvelope): Promise<X402FacilitatorVerifyResponse>;
  settle(payload: X402PaymentPayloadEnvelope): Promise<X402FacilitatorSettleResponse>;
}

/**
 * HTTP client for x402 facilitator endpoints.
 * Handles /verify and /settle calls with timeout and error handling.
 */
export class HttpFacilitatorClient implements FacilitatorClient {
  private readonly url: string;
  private readonly timeout: number;

  constructor(config: FacilitatorClientConfig) {
    this.url = config.facilitator_url.replace(/\/$/, "");
    this.timeout = config.timeout_ms ?? 30_000;
  }

  async verify(payload: X402PaymentPayloadEnvelope): Promise<X402FacilitatorVerifyResponse> {
    return this.post<X402FacilitatorVerifyResponse>("/verify", payload);
  }

  async settle(payload: X402PaymentPayloadEnvelope): Promise<X402FacilitatorSettleResponse> {
    return this.post<X402FacilitatorSettleResponse>("/settle", payload);
  }

  private async post<T>(path: string, body: unknown): Promise<T> {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), this.timeout);

    try {
      const response = await fetch(`${this.url}${path}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
        signal: controller.signal,
      });

      if (!response.ok) {
        const text = await response.text().catch(() => "");
        throw new FacilitatorError(
          `facilitator ${path} returned ${response.status}: ${text}`,
          response.status,
        );
      }

      return (await response.json()) as T;
    } catch (error) {
      if (error instanceof FacilitatorError) throw error;
      if (error instanceof DOMException && error.name === "AbortError") {
        throw new FacilitatorError(`facilitator ${path} timed out after ${this.timeout}ms`, 0);
      }
      throw new FacilitatorError(
        `facilitator ${path} failed: ${error instanceof Error ? error.message : String(error)}`,
        0,
      );
    } finally {
      clearTimeout(timer);
    }
  }
}

export class FacilitatorError extends Error {
  constructor(
    message: string,
    readonly statusCode: number,
  ) {
    super(message);
    this.name = "FacilitatorError";
  }
}

/**
 * Mock facilitator for testing — always succeeds.
 */
export class MockFacilitatorClient implements FacilitatorClient {
  readonly calls: { method: string; payload: X402PaymentPayloadEnvelope }[] = [];

  async verify(payload: X402PaymentPayloadEnvelope): Promise<X402FacilitatorVerifyResponse> {
    this.calls.push({ method: "verify", payload });
    return { isValid: true };
  }

  async settle(payload: X402PaymentPayloadEnvelope): Promise<X402FacilitatorSettleResponse> {
    this.calls.push({ method: "settle", payload });
    return {
      success: true,
      txHash: `0xmock_${Date.now().toString(16)}`,
      network: payload.network,
      settlementReference: `ref_mock_${Date.now()}`,
    };
  }
}
