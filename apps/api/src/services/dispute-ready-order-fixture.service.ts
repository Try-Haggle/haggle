/**
 * Staging/local payment-test fixture: paid + delivered commerce order
 * so dogfood can call haggle_start_dispute without real Stripe Onramp money or card PANs.
 */
import { randomUUID } from "node:crypto";
import { commerceOrders, type Database, paymentIntents, settlementApprovals } from "@haggle/db";

export type DisputeReadyOrderStatus = "PAID" | "DELIVERED";

export interface CreateDisputeReadyOrderFixtureInput {
  buyerId: string;
  amountMinor?: number;
  currency?: "USDC";
  selectedPaymentRail?: "x402" | "stripe";
  /** Default DELIVERED so ITEM_NOT_AS_DESCRIBED / ITEM_NOT_RECEIVED eligibility passes without a shipment. */
  orderStatus?: DisputeReadyOrderStatus;
  itemTitle?: string;
  listingId?: string;
  sellerId?: string;
}

export interface DisputeReadyOrderFixtureResult {
  approval_id: string;
  order_id: string;
  order_status: DisputeReadyOrderStatus;
  payment_intent_id: string;
  payment_intent_status: "SETTLED";
  selected_payment_rail: "x402" | "stripe";
  amount_minor: number;
  currency: "USDC";
  buyer_id: string;
  seller_id: string;
  listing_id: string;
  item_title: string;
  money_moved: false;
  card_pan_used: false;
  next: {
    mcp_tool: "haggle_start_dispute";
    suggested_reason_code: "ITEM_NOT_AS_DESCRIBED";
    http_open: string;
    evidence_note: string;
  };
  env: {
    non_production: string;
    production_staging: string;
  };
}

export async function createDisputeReadyOrderFixture(
  db: Database,
  input: CreateDisputeReadyOrderFixtureInput,
): Promise<DisputeReadyOrderFixtureResult> {
  const now = new Date();
  const amountMinor = input.amountMinor ?? 45_000;
  const currency = input.currency ?? "USDC";
  const selectedPaymentRail = input.selectedPaymentRail ?? "stripe";
  const orderStatus = input.orderStatus ?? "DELIVERED";
  const listingId = input.listingId ?? randomUUID();
  const sellerId = input.sellerId ?? randomUUID();
  const itemTitle = input.itemTitle ?? "Haggle dispute-after-pay dogfood fixture";
  const buyerId = input.buyerId;
  const paymentIntentId = randomUUID();

  const [approval] = await db
    .insert(settlementApprovals)
    .values({
      approvalState: "APPROVED",
      listingId,
      sellerId,
      buyerId,
      finalAmountMinor: String(amountMinor),
      currency,
      selectedPaymentRail,
      sellerApprovalMode: "AUTO_WITHIN_POLICY",
      buyerApprovedAt: now,
      sellerApprovedAt: now,
      shipmentInputDueAt: new Date(now.getTime() + 3 * 24 * 60 * 60 * 1000),
      termsSnapshot: {
        scenario: "unit_mock",
        item_title: itemTitle,
        listing_id: listingId,
        seller_id: sellerId,
        buyer_id: buyerId,
        final_amount_minor: amountMinor,
        currency,
        selected_payment_rail: selectedPaymentRail,
        fulfillment_type: "physical_shipping",
        allowed_payment_rails: ["x402", "stripe"],
        settlement_asset: "USDC",
        created_by: "payment-test-dispute-ready-order",
        negotiated_at: now.toISOString(),
        dogfood: "dispute-after-pay",
      },
      createdAt: now,
      updatedAt: now,
    })
    .returning();

  if (!approval) {
    throw new Error("DISPUTE_READY_APPROVAL_NOT_CREATED");
  }

  const [order] = await db
    .insert(commerceOrders)
    .values({
      settlementApprovalId: approval.id,
      listingId,
      sellerId,
      buyerId,
      status: orderStatus,
      currency,
      amountMinor: String(amountMinor),
      orderSnapshot: {
        settlement_approval_id: approval.id,
        item_title: itemTitle,
        terms: {
          listing_id: listingId,
          seller_id: sellerId,
          buyer_id: buyerId,
          final_amount_minor: amountMinor,
          currency,
          selected_payment_rail: selectedPaymentRail,
        },
        fixture: {
          kind: "dispute-ready-order",
          money_moved: false,
          card_pan_used: false,
          mock_payment: true,
        },
      },
      createdAt: now,
      updatedAt: now,
    })
    .returning();

  if (!order) {
    throw new Error("DISPUTE_READY_ORDER_NOT_CREATED");
  }

  const [intent] = await db
    .insert(paymentIntents)
    .values({
      id: paymentIntentId,
      orderId: order.id,
      sellerId,
      buyerId,
      selectedRail: selectedPaymentRail,
      allowedRails: ["x402", "stripe"],
      buyerAuthorizationMode: "human_wallet",
      currency,
      amountMinor: String(amountMinor),
      status: "SETTLED",
      canonicalStatus: "captured",
      providerContext: {
        fixture: "dispute-ready-order",
        adapter: selectedPaymentRail === "stripe" ? "MockStripeAdapter" : "MockX402Adapter",
        money_moved: false,
        card_pan_used: false,
        note: "Synthetic SETTLED intent for dogfood. No Stripe Onramp session, no card PAN.",
      },
      createdAt: now,
      updatedAt: now,
    })
    .returning();

  if (!intent) {
    throw new Error("DISPUTE_READY_PAYMENT_INTENT_NOT_CREATED");
  }

  return {
    approval_id: approval.id,
    order_id: order.id,
    order_status: orderStatus,
    payment_intent_id: intent.id,
    payment_intent_status: "SETTLED",
    selected_payment_rail: selectedPaymentRail,
    amount_minor: amountMinor,
    currency,
    buyer_id: buyerId,
    seller_id: sellerId,
    listing_id: listingId,
    item_title: itemTitle,
    money_moved: false,
    card_pan_used: false,
    next: {
      mcp_tool: "haggle_start_dispute",
      suggested_reason_code: "ITEM_NOT_AS_DESCRIBED",
      http_open: `/orders/${order.id}/disputes`,
      evidence_note: "Open the dispute, then upload file evidence on the web evidence URL.",
    },
    env: {
      non_production: "Available whenever NODE_ENV is not production.",
      production_staging:
        "Requires role=admin and HAGGLE_ENABLE_PAYMENT_TEST_TOOLS=true (same gate as other payment-test tools).",
    },
  };
}
