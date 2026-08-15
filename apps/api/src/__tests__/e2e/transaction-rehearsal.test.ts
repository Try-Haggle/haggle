import { computeOrderPhase, determineNextAction } from "@haggle/commerce-core";
import { createSettlementHold, DisputeService, resolveSettlement } from "@haggle/dispute-core";
import {
  buyerConfirmReceipt,
  completeVerifiedTestBufferRelease,
  computeReleasePhase,
  confirmDelivery,
  createSettlementRelease,
  isFullyReleased,
  MockX402Adapter,
  PaymentService,
  type Refund,
} from "@haggle/payment-core";
import { MockCarrierAdapter, ShippingService } from "@haggle/shipping-core";
import { describe, expect, it } from "vitest";

const ORDER_ID = "order-test-rehearsal-001";
const BUYER_ID = "buyer-test-rehearsal-001";
const SELLER_ID = "seller-test-rehearsal-001";
const AMOUNT = { currency: "USDC", amount_minor: 45_000 };
const PRODUCT_AMOUNT = { currency: "USDC", amount_minor: 43_000 };
const BUFFER_AMOUNT = { currency: "USDC", amount_minor: 2_000 };

const paymentService = new PaymentService({ x402: new MockX402Adapter() });
const shippingService = new ShippingService({ mock_carrier: new MockCarrierAdapter() });
const disputeService = new DisputeService();

async function settleTestPayment() {
  let intent = paymentService.createIntent({
    order_id: ORDER_ID,
    seller_id: SELLER_ID,
    buyer_id: BUYER_ID,
    selected_rail: "x402",
    amount: AMOUNT,
    now: "2026-08-12T20:00:00.000Z",
  });

  intent = (await paymentService.quoteIntent(intent, "2026-08-12T20:01:00.000Z")).intent;
  intent = (await paymentService.authorizeIntent(intent, "2026-08-12T20:02:00.000Z")).intent;
  intent = paymentService.markSettlementPending(intent, "2026-08-12T20:03:00.000Z").intent;
  const settled = await paymentService.settleIntent(intent, "2026-08-12T20:04:00.000Z");

  expect(settled.intent.status).toBe("SETTLED");
  expect(settled.value?.status).toBe("SETTLED");
  expect(settled.value?.settled_amount).toEqual(AMOUNT);
  return settled.intent;
}

async function createLabeledShipment() {
  let shipment = shippingService.createShipment({
    order_id: ORDER_ID,
    carrier: "mock_carrier",
    now: "2026-08-12T20:05:00.000Z",
  });
  shipment = (await shippingService.createLabel(shipment, "2026-08-12T20:06:00.000Z")).shipment;
  return shipment;
}

describe("test-asset transaction rehearsal", () => {
  it("connects payment, delivery, buyer review, and full test-buffer release", async () => {
    const payment = await settleTestPayment();
    expect(computeOrderPhase({ payment_status: payment.status })).toBe("FULFILLMENT");
    expect(determineNextAction({ phase: "PAYMENT", payment_status: payment.status })).toEqual({
      type: "await_shipment_input",
    });

    let shipment = await createLabeledShipment();
    expect(
      computeOrderPhase({
        payment_status: payment.status,
        shipment_status: shipment.status,
      }),
    ).toBe("FULFILLMENT");

    shipment = shippingService.recordEvent(
      shipment,
      "ship",
      { carrier_raw_status: "in_transit" },
      "2026-08-12T21:00:00.000Z",
    ).shipment;
    shipment = shippingService.recordEvent(
      shipment,
      "out_for_delivery",
      { carrier_raw_status: "out_for_delivery" },
      "2026-08-13T16:00:00.000Z",
    ).shipment;
    shipment = shippingService.recordEvent(
      shipment,
      "deliver",
      { carrier_raw_status: "delivered" },
      "2026-08-13T18:00:00.000Z",
    ).shipment;

    expect(shipment.status).toBe("DELIVERED");
    expect(shipment.events.map((event) => event.status)).toEqual([
      "LABEL_CREATED",
      "IN_TRANSIT",
      "OUT_FOR_DELIVERY",
      "DELIVERED",
    ]);

    let release = createSettlementRelease({
      payment_intent_id: payment.id,
      order_id: ORDER_ID,
      product_amount: PRODUCT_AMOUNT,
      buffer_amount: BUFFER_AMOUNT,
      now: "2026-08-12T20:04:00.000Z",
    });
    release = confirmDelivery(release, shipment.delivered_at!);

    expect(
      computeOrderPhase({
        payment_status: payment.status,
        shipment_status: shipment.status,
        product_release_status: release.product_release_status,
      }),
    ).toBe("DELIVERY");
    expect(computeReleasePhase(release)).toBe("BUYER_REVIEW");

    release = buyerConfirmReceipt(release, "2026-08-13T18:15:00.000Z");
    release = completeVerifiedTestBufferRelease(release, "2026-08-13T18:16:00.000Z");

    expect(
      computeOrderPhase({
        payment_status: payment.status,
        shipment_status: shipment.status,
        product_release_status: release.product_release_status,
        buffer_release_status: release.buffer_release_status,
      }),
    ).toBe("COMPLETED");
    expect(computeReleasePhase(release)).toBe("FULLY_RELEASED");
    expect(isFullyReleased(release)).toBe(true);
  });

  it("keeps funds held during a dispute and maps buyer-favor resolution to refund", async () => {
    const payment = await settleTestPayment();
    let shipment = await createLabeledShipment();
    shipment = shippingService.recordEvent(
      shipment,
      "exception",
      { carrier_raw_status: "failure", message: "Package damaged in transit" },
      "2026-08-13T17:00:00.000Z",
    ).shipment;

    let dispute = disputeService.openCase({
      order_id: ORDER_ID,
      reason_code: "DELIVERY_EXCEPTION",
      opened_by: "buyer",
      initial_evidence: [
        {
          submitted_by: "buyer",
          type: "tracking_snapshot",
          text: "Carrier reports damage in transit",
        },
      ],
      now: "2026-08-13T17:05:00.000Z",
    }).dispute;
    const hold = createSettlementHold(dispute.id, ORDER_ID, AMOUNT.amount_minor, dispute.opened_at);

    expect(
      computeOrderPhase({
        payment_status: payment.status,
        shipment_status: shipment.status,
        dispute_status: dispute.status,
      }),
    ).toBe("IN_DISPUTE");
    expect(hold.status).toBe("HELD");

    dispute = disputeService.startReview(dispute).dispute;
    dispute = disputeService.resolve(
      dispute,
      {
        outcome: "buyer_favor",
        summary: "Carrier evidence confirms the buyer did not receive a usable item.",
        refund_amount_minor: AMOUNT.amount_minor,
      },
      "2026-08-13T18:00:00.000Z",
    ).dispute;
    const settlement = resolveSettlement(
      hold,
      "buyer_favor",
      AMOUNT.amount_minor,
      null,
      0,
      "2026-08-13T18:01:00.000Z",
    );
    const refund: Refund = {
      id: "refund-test-rehearsal-001",
      payment_intent_id: payment.id,
      amount: AMOUNT,
      reason_code: "dispute_buyer_favor",
      status: "REQUESTED",
      created_at: "2026-08-13T18:01:00.000Z",
      updated_at: "2026-08-13T18:01:00.000Z",
    };
    const refundResult = await paymentService.refundIntent(payment, refund);

    expect(dispute.status).toBe("RESOLVED_BUYER_FAVOR");
    expect(computeOrderPhase({ dispute_status: dispute.status })).toBe("REFUNDED");
    expect(
      determineNextAction({
        phase: "IN_DISPUTE",
        dispute_status: dispute.status,
      }),
    ).toEqual({ type: "process_refund" });
    expect(settlement.hold.status).toBe("REFUNDED");
    expect(settlement.buyer_receives_cents).toBe(AMOUNT.amount_minor);
    expect(settlement.seller_receives_cents).toBe(0);
    expect(refundResult.refund.status).toBe("COMPLETED");
  });

  it("maps seller-favor resolution to completion without a buyer refund", async () => {
    const payment = await settleTestPayment();
    let dispute = disputeService.openCase({
      order_id: ORDER_ID,
      reason_code: "ITEM_NOT_AS_DESCRIBED",
      opened_by: "buyer",
      now: "2026-08-13T17:05:00.000Z",
    }).dispute;
    const hold = createSettlementHold(dispute.id, ORDER_ID, AMOUNT.amount_minor, dispute.opened_at);

    dispute = disputeService.startReview(dispute).dispute;
    dispute = disputeService.resolve(
      dispute,
      {
        outcome: "seller_favor",
        summary: "Listing and shipment evidence show the seller fulfilled the agreed terms.",
      },
      "2026-08-13T18:00:00.000Z",
    ).dispute;
    const settlement = resolveSettlement(
      hold,
      "seller_favor",
      undefined,
      null,
      1_000,
      "2026-08-13T18:01:00.000Z",
    );

    expect(payment.status).toBe("SETTLED");
    expect(dispute.status).toBe("RESOLVED_SELLER_FAVOR");
    expect(computeOrderPhase({ dispute_status: dispute.status })).toBe("COMPLETED");
    expect(
      determineNextAction({
        phase: "IN_DISPUTE",
        dispute_status: dispute.status,
      }),
    ).toEqual({ type: "complete_order" });
    expect(settlement.hold.status).toBe("RELEASED");
    expect(settlement.buyer_receives_cents).toBe(0);
    expect(settlement.seller_receives_cents).toBe(44_000);
  });
});
