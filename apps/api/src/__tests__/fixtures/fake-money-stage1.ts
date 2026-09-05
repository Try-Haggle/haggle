/**
 * Stage 1 fake-money / fake-address fixtures.
 *
 * Proves the happy-path linkage invariant from
 * docs/wip/fake-money-fake-address-e2e-test-plan.md check 2:
 * mock payment settled ↔ commerce order ↔ settlement release.
 *
 * No real money, real carrier addresses, or PAN values.
 */

export const FAKE_MONEY_STAGE1_BUYER_ID = "11111111-1111-4111-8111-111111111111";
export const FAKE_MONEY_STAGE1_SELLER_ID = "22222222-2222-4222-8222-222222222222";
export const FAKE_MONEY_STAGE1_ORDER_ID = "33333333-3333-4333-8333-333333333333";
export const FAKE_MONEY_STAGE1_PAYMENT_INTENT_ID = "44444444-4444-4444-8444-444444444444";
export const FAKE_MONEY_STAGE1_APPROVAL_ID = "55555555-5555-4555-8555-555555555555";
export const FAKE_MONEY_STAGE1_LISTING_ID = "66666666-6666-4666-8666-666666666666";
export const FAKE_MONEY_STAGE1_RELEASE_ID = "77777777-7777-4777-8777-777777777777";

/** USDC minor units only — never a card PAN or live settlement amount. */
export const FAKE_MONEY_STAGE1_AMOUNT = {
  currency: "USDC" as const,
  amount_minor: 45_000,
};

export const FAKE_MONEY_STAGE1_PRODUCT_AMOUNT = {
  currency: "USDC" as const,
  amount_minor: 43_000,
};

export const FAKE_MONEY_STAGE1_BUFFER_AMOUNT = {
  currency: "USDC" as const,
  amount_minor: 2_000,
};

export const FAKE_MONEY_STAGE1_NOW = "2026-09-06T00:00:00.000Z";

export interface FakeMoneyStage1PaymentLink {
  id: string;
  order_id: string;
  status: string;
  buyer_id?: string;
  seller_id?: string;
}

export interface FakeMoneyStage1OrderLink {
  id: string;
  status?: string;
  settlement_approval_id?: string | null;
}

export interface FakeMoneyStage1ReleaseLink {
  id?: string;
  payment_intent_id: string;
  order_id: string;
  product_release_status?: string;
}

export interface FakeMoneyStage1Linkage {
  payment: FakeMoneyStage1PaymentLink;
  order: FakeMoneyStage1OrderLink;
  release: FakeMoneyStage1ReleaseLink;
}

export interface FakeMoneyStage1LinkageResult {
  ok: boolean;
  failures: string[];
}

/**
 * Pure linkage check used by Stage 1 harness tests.
 * Returns structured failures so callers can assert without throwing mid-flow.
 */
export function evaluateFakeMoneyStage1Linkage(
  input: FakeMoneyStage1Linkage,
): FakeMoneyStage1LinkageResult {
  const failures: string[] = [];
  const settled = input.payment.status === "SETTLED" || input.payment.status === "captured";
  if (!settled) {
    failures.push(`payment status must be SETTLED, got ${input.payment.status}`);
  }
  if (input.order.id !== input.payment.order_id) {
    failures.push(
      `commerce order id ${input.order.id} does not match payment.order_id ${input.payment.order_id}`,
    );
  }
  if (input.release.order_id !== input.payment.order_id) {
    failures.push(
      `settlement release order_id ${input.release.order_id} does not match payment.order_id ${input.payment.order_id}`,
    );
  }
  if (input.release.payment_intent_id !== input.payment.id) {
    failures.push(
      `settlement release payment_intent_id ${input.release.payment_intent_id} does not match payment.id ${input.payment.id}`,
    );
  }
  return { ok: failures.length === 0, failures };
}

export function assertFakeMoneyStage1Linkage(input: FakeMoneyStage1Linkage): void {
  const result = evaluateFakeMoneyStage1Linkage(input);
  if (!result.ok) {
    throw new Error(`Stage1 fake-money linkage failed: ${result.failures.join("; ")}`);
  }
}

export function buildFakeMoneyStage1Fixture(overrides?: {
  payment?: Partial<FakeMoneyStage1PaymentLink>;
  order?: Partial<FakeMoneyStage1OrderLink>;
  release?: Partial<FakeMoneyStage1ReleaseLink>;
}): FakeMoneyStage1Linkage {
  const payment: FakeMoneyStage1PaymentLink = {
    id: FAKE_MONEY_STAGE1_PAYMENT_INTENT_ID,
    order_id: FAKE_MONEY_STAGE1_ORDER_ID,
    status: "SETTLED",
    buyer_id: FAKE_MONEY_STAGE1_BUYER_ID,
    seller_id: FAKE_MONEY_STAGE1_SELLER_ID,
    ...overrides?.payment,
  };
  const order: FakeMoneyStage1OrderLink = {
    id: FAKE_MONEY_STAGE1_ORDER_ID,
    status: "FULFILLMENT_PENDING",
    settlement_approval_id: FAKE_MONEY_STAGE1_APPROVAL_ID,
    ...overrides?.order,
  };
  const release: FakeMoneyStage1ReleaseLink = {
    id: FAKE_MONEY_STAGE1_RELEASE_ID,
    payment_intent_id: FAKE_MONEY_STAGE1_PAYMENT_INTENT_ID,
    order_id: FAKE_MONEY_STAGE1_ORDER_ID,
    product_release_status: "PENDING_DELIVERY",
    ...overrides?.release,
  };
  return { payment, order, release };
}
