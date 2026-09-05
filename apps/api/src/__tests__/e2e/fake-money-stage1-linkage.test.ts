/**
 * Stage 1 happy path: mock payment settled ↔ commerce order ↔ settlement release.
 *
 * Package-level harness (no real DB, money, addresses, or PAN). Complements the
 * dashboard check "2. Fake payment and order linkage" in
 * docs/wip/fake-money-fake-address-e2e-test-plan.md.
 */

import { computeOrderPhase, determineNextAction } from "@haggle/commerce-core";
import {
  createSettlementRelease,
  MockStripeAdapter,
  MockX402Adapter,
  PaymentService,
} from "@haggle/payment-core";
import { describe, expect, it } from "vitest";
import {
  assertFakeMoneyStage1Linkage,
  buildFakeMoneyStage1Fixture,
  evaluateFakeMoneyStage1Linkage,
  FAKE_MONEY_STAGE1_AMOUNT,
  FAKE_MONEY_STAGE1_BUFFER_AMOUNT,
  FAKE_MONEY_STAGE1_BUYER_ID,
  FAKE_MONEY_STAGE1_NOW,
  FAKE_MONEY_STAGE1_ORDER_ID,
  FAKE_MONEY_STAGE1_PRODUCT_AMOUNT,
  FAKE_MONEY_STAGE1_SELLER_ID,
} from "../fixtures/fake-money-stage1.js";

describe("Stage1 fake-money payment↔order↔release linkage", () => {
  it("evaluates a linked fixture as pass and a broken fixture as fail", () => {
    const linked = buildFakeMoneyStage1Fixture();
    expect(evaluateFakeMoneyStage1Linkage(linked)).toEqual({ ok: true, failures: [] });
    assertFakeMoneyStage1Linkage(linked);

    const broken = buildFakeMoneyStage1Fixture({
      release: {
        payment_intent_id: "99999999-9999-4999-8999-999999999999",
        order_id: FAKE_MONEY_STAGE1_ORDER_ID,
      },
    });
    const result = evaluateFakeMoneyStage1Linkage(broken);
    expect(result.ok).toBe(false);
    expect(result.failures.some((f) => f.includes("payment_intent_id"))).toBe(true);
  });

  it.each([
    ["stripe", new MockStripeAdapter()] as const,
    ["x402", new MockX402Adapter()] as const,
  ])("settles mock %s payment and keeps commerce order + settlement release on the same ids", async (rail, adapter) => {
    const paymentService = new PaymentService(
      rail === "stripe" ? { stripe: adapter } : { x402: adapter },
    );

    let intent = paymentService.createIntent({
      order_id: FAKE_MONEY_STAGE1_ORDER_ID,
      seller_id: FAKE_MONEY_STAGE1_SELLER_ID,
      buyer_id: FAKE_MONEY_STAGE1_BUYER_ID,
      selected_rail: rail,
      amount: FAKE_MONEY_STAGE1_AMOUNT,
      now: FAKE_MONEY_STAGE1_NOW,
    });

    intent = (await paymentService.quoteIntent(intent, FAKE_MONEY_STAGE1_NOW)).intent;
    intent = (await paymentService.authorizeIntent(intent, FAKE_MONEY_STAGE1_NOW)).intent;
    intent = paymentService.markSettlementPending(intent, FAKE_MONEY_STAGE1_NOW).intent;
    const settled = await paymentService.settleIntent(intent, FAKE_MONEY_STAGE1_NOW);
    const payment = settled.intent;

    expect(payment.status).toBe("SETTLED");
    expect(payment.order_id).toBe(FAKE_MONEY_STAGE1_ORDER_ID);
    expect(settled.value?.status).toBe("SETTLED");
    expect(settled.value?.payment_intent_id).toBe(payment.id);
    expect(settled.value?.settled_amount).toEqual(FAKE_MONEY_STAGE1_AMOUNT);

    // Commerce order is the same UUID the payment intent was prepared against.
    const commerceOrder = {
      id: FAKE_MONEY_STAGE1_ORDER_ID,
      status: "FULFILLMENT_PENDING" as const,
      payment_intent_id: payment.id,
    };

    const release = createSettlementRelease({
      payment_intent_id: payment.id,
      order_id: commerceOrder.id,
      product_amount: FAKE_MONEY_STAGE1_PRODUCT_AMOUNT,
      buffer_amount: FAKE_MONEY_STAGE1_BUFFER_AMOUNT,
      now: FAKE_MONEY_STAGE1_NOW,
    });

    assertFakeMoneyStage1Linkage({
      payment: {
        id: payment.id,
        order_id: payment.order_id,
        status: payment.status,
        buyer_id: payment.buyer_id,
        seller_id: payment.seller_id,
      },
      order: { id: commerceOrder.id, status: commerceOrder.status },
      release: {
        id: release.id,
        payment_intent_id: release.payment_intent_id,
        order_id: release.order_id,
        product_release_status: release.product_release_status,
      },
    });

    expect(release.product_release_status).toBe("PENDING_DELIVERY");
    expect(computeOrderPhase({ payment_status: payment.status })).toBe("FULFILLMENT");
    expect(determineNextAction({ phase: "PAYMENT", payment_status: payment.status })).toEqual({
      type: "await_shipment_input",
    });
    expect(commerceOrder.payment_intent_id).toBe(release.payment_intent_id);
  });
});
