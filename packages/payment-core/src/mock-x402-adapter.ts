import type { PaymentProvider } from "./provider.js";
import { createId } from "./id.js";
import type { PaymentIntent, Refund } from "./types.js";

function nowIso(): string {
  return new Date().toISOString();
}

export class MockX402Adapter implements PaymentProvider {
  readonly rail = "x402" as const;
  readonly provider = "ai.haggle.x402.mock";

  async quote(intent: PaymentIntent) {
    return {
      rail: this.rail,
      provider_reference: createId("x402_quote"),
      amount: intent.amount,
      expires_at: new Date(Date.now() + 15 * 60 * 1000).toISOString(),
      metadata: {
        network: "base-sepolia",
        settlement_mode: "mock",
      },
    };
  }

  async authorize(intent: PaymentIntent) {
    return {
      authorization: {
        id: createId(),
        payment_intent_id: intent.id,
        rail: this.rail,
        provider_reference: createId("x402_auth"),
        authorized_amount: intent.amount,
        created_at: nowIso(),
      },
      metadata: {
        signer: "mock-buyer-wallet",
      },
    };
  }

  async settle(intent: PaymentIntent) {
    return {
      settlement: {
        id: createId(),
        payment_intent_id: intent.id,
        rail: this.rail,
        provider_reference: createId("x402_settle"),
        settled_amount: intent.amount,
        settled_at: nowIso(),
        status: "SETTLED" as const,
      },
      metadata: {
        tx_hash: `0x${createId().replaceAll("-", "")}`,
      },
    };
  }

  async refund(intent: PaymentIntent, refund: Refund) {
    return {
      refund: {
        ...refund,
        status: "COMPLETED" as const,
        updated_at: nowIso(),
      },
      metadata: {
        provider_reference: createId("x402_refund"),
        original_payment_intent_id: intent.id,
      },
    };
  }
}
