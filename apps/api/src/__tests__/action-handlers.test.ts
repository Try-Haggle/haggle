import { beforeEach, describe, expect, it, vi } from "vitest";
import { registerActionHandlers } from "../lib/action-handlers.js";
import type { EventDispatcher } from "../lib/event-dispatcher.js";
import { createEventDispatcher } from "../lib/event-dispatcher.js";
import { openListingHold } from "../services/listing-claim.service.js";
import { getSessionById } from "../services/negotiation-session.service.js";
import { recordAgreedPrice } from "../services/price-observation-sink.js";

vi.mock("../services/listing-claim.service.js", () => ({
  openListingHold: vi.fn().mockResolvedValue({ status: "OPEN", lockKind: "OPEN_HOLD" }),
}));

vi.mock("../services/negotiation-session.service.js", () => ({
  getSessionById: vi.fn(),
}));

vi.mock("../services/price-observation-sink.js", () => ({
  recordAgreedPrice: vi.fn().mockResolvedValue(null),
}));

vi.mock("../services/intent.service.js", () => ({
  updateIntentStatus: vi.fn().mockResolvedValue(null),
}));

const mockGetSessionById = vi.mocked(getSessionById);
const mockOpenListingHold = vi.mocked(openListingHold);
const mockRecordAgreedPrice = vi.mocked(recordAgreedPrice);

function buildDispatcher() {
  const handlers = new Map<string, Parameters<EventDispatcher["registerHandler"]>[1]>();
  const dispatcher = {
    registerHandler: vi.fn((actionType, handler) => {
      handlers.set(actionType, handler);
    }),
    dispatch: vi.fn(),
  } as unknown as EventDispatcher;

  return { dispatcher, handlers };
}

function buildDb() {
  const onConflictDoNothing = vi.fn().mockResolvedValue(undefined);
  const values = vi.fn(() => ({ onConflictDoNothing }));
  const insert = vi.fn(() => ({ values }));

  return {
    db: { insert },
    insert,
    values,
    onConflictDoNothing,
  };
}

describe("registerActionHandlers", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("creates a payment-ready settlement approval keyed by accepted session id", async () => {
    const { dispatcher, handlers } = buildDispatcher();
    const db = buildDb();
    const sessionId = "00000000-0000-4000-a000-000000000099";
    const listingId = "00000000-0000-4000-a000-000000000011";
    const buyerId = "00000000-0000-4000-a000-000000000022";
    const sellerId = "00000000-0000-4000-a000-000000000033";

    mockGetSessionById.mockResolvedValue({
      id: sessionId,
      listingId,
      buyerId,
      sellerId,
      status: "ACCEPTED",
      negotiationAgentSnapshot: {},
    } as never);

    registerActionHandlers(dispatcher, db.db as never);

    await handlers.get("create_settlement")?.({
      action: "create_settlement",
      sessionId,
      agreedPriceMinor: 50_000,
      buyerId,
      sellerId,
    });

    expect(db.values).toHaveBeenCalledWith(
      expect.objectContaining({
        id: sessionId,
        listingId,
        buyerId,
        sellerId,
        approvalState: "APPROVED",
        sellerApprovalMode: "AUTO_WITHIN_POLICY",
        selectedPaymentRail: "x402",
        currency: "USD",
        finalAmountMinor: "50000",
        buyerApprovedAt: expect.any(Date),
        sellerApprovedAt: expect.any(Date),
        termsSnapshot: expect.objectContaining({
          session_id: sessionId,
          listing_id: listingId,
          final_amount_minor: 50_000,
          buyer_id: buyerId,
          seller_id: sellerId,
          selected_payment_rail: "x402",
          currency: "USD",
          seller_policy_shipment_input_due_days: 3,
          fulfillment_type: "physical_shipping",
        }),
      }),
    );
    expect(db.onConflictDoNothing).toHaveBeenCalled();
    expect(mockOpenListingHold).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        listingId,
        sessionId,
        buyerId,
        sellerId,
        agreedPriceMinor: 50_000,
      }),
    );
    expect(mockRecordAgreedPrice).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        sessionId,
        finalPriceMinor: 50_000,
        buyerId,
        sellerId,
        listingId,
      }),
    );
  });

  it("routes negotiation.agreed through the dispatcher and stores the session id as settlement approval id", async () => {
    const dispatcher = createEventDispatcher();
    const db = buildDb();
    const sessionId = "00000000-0000-4000-a000-000000000099";
    const listingId = "00000000-0000-4000-a000-000000000011";
    const buyerId = "00000000-0000-4000-a000-000000000022";
    const sellerId = "00000000-0000-4000-a000-000000000033";

    mockGetSessionById.mockResolvedValue({
      id: sessionId,
      listingId,
      buyerId,
      sellerId,
      status: "ACCEPTED",
      negotiationAgentSnapshot: {},
    } as never);

    registerActionHandlers(dispatcher, db.db as never);

    const action = await dispatcher.dispatch({
      domain: "negotiation",
      type: "negotiation.agreed",
      payload: {
        session_id: sessionId,
        agreed_price_minor: 50_000,
        buyer_id: buyerId,
        seller_id: sellerId,
      },
      idempotency_key: `neg_agreed_${sessionId}`,
      timestamp: Date.now(),
    });

    expect(action).toEqual({
      action: "create_settlement",
      sessionId,
      agreedPriceMinor: 50_000,
      buyerId,
      sellerId,
    });
    expect(db.values).toHaveBeenCalledWith(
      expect.objectContaining({
        id: sessionId,
        approvalState: "APPROVED",
        buyerId,
        sellerId,
        termsSnapshot: expect.objectContaining({
          session_id: sessionId,
          buyer_id: buyerId,
          seller_id: sellerId,
        }),
      }),
    );
  });

  it("copies local pickup from the session snapshot into settlement terms", async () => {
    const { dispatcher, handlers } = buildDispatcher();
    const db = buildDb();
    const sessionId = "00000000-0000-4000-a000-000000000099";
    const listingId = "00000000-0000-4000-a000-000000000011";
    const buyerId = "00000000-0000-4000-a000-000000000022";
    const sellerId = "00000000-0000-4000-a000-000000000033";

    mockGetSessionById.mockResolvedValue({
      id: sessionId,
      listingId,
      buyerId,
      sellerId,
      status: "ACCEPTED",
      negotiationAgentSnapshot: {
        fulfillment_context: {
          method: "local_pickup",
          fulfillment_type: "local_pickup",
          negotiable: true,
          shipping_included_in_total: true,
          shipping_cost_known: true,
          shipping_cost_minor: 0,
          rate_note: "No carrier shipping.",
        },
      },
    } as never);

    registerActionHandlers(dispatcher, db.db as never);

    await handlers.get("create_settlement")?.({
      action: "create_settlement",
      sessionId,
      agreedPriceMinor: 50_000,
      buyerId,
      sellerId,
    });

    expect(db.values).toHaveBeenCalledWith(
      expect.objectContaining({
        termsSnapshot: expect.objectContaining({
          fulfillment_type: "local_pickup",
          fulfillment_method: "local_pickup",
          shipping_cost_minor: 0,
        }),
      }),
    );
  });
});
