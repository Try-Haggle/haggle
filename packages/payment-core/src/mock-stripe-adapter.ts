import { createId } from "./id.js";
import type { PaymentProvider } from "./provider.js";
import type { PaymentIntent, Refund } from "./types.js";

function nowIso(): string {
  return new Date().toISOString();
}

export class MockStripeAdapter implements PaymentProvider {
  readonly rail = "stripe" as const;
  readonly provider = "ai.haggle.stripe.mock";

  async quote(intent: PaymentIntent) {
    return {
      rail: this.rail,
      provider_reference: createId("stripe_quote"),
      amount: intent.amount,
      expires_at: new Date(Date.now() + 15 * 60 * 1000).toISOString(),
      metadata: {
        payment_method_types: ["card"],
        mode: "payment",
      },
    };
  }

  async authorize(intent: PaymentIntent) {
    return {
      authorization: {
        id: createId(),
        payment_intent_id: intent.id,
        rail: this.rail,
        provider_reference: createId("stripe_auth"),
        authorized_amount: intent.amount,
        created_at: nowIso(),
      },
      metadata: {
        payment_intent_secret: createId("pi_secret"),
      },
    };
  }

  async settle(intent: PaymentIntent) {
    return {
      settlement: {
        id: createId(),
        payment_intent_id: intent.id,
        rail: this.rail,
        provider_reference: createId("stripe_settle"),
        settled_amount: intent.amount,
        settled_at: nowIso(),
        status: "SETTLED" as const,
      },
      metadata: {
        charge_id: createId("ch"),
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
        refund_id: createId("re"),
        original_payment_intent_id: intent.id,
      },
    };
  }
}
