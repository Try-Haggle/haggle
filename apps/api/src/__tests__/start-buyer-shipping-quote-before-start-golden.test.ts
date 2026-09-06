/**
 * D2 goldens: physical carrier start requires successful test/mock shipping quote
 * before createSession; digital / A4 no-shipment skips; quote amount is exposed.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

const getPublishedListingByRef = vi.fn();
const loadListingStrategyContext = vi.fn();
const assertListingAcceptsNewSession = vi.fn();
const evaluateAttemptControl = vi.fn();
const createSession = vi.fn();
const compileNegotiationAgentSnapshot = vi.fn((..._args: unknown[]) => ({ compiled: true }));
const quoteNegotiationCredits = vi.fn((..._args: unknown[]) => ({ quoted: true }));
const quoteShippingBeforeStart = vi.fn();

vi.mock("../services/draft.service.js", () => ({
  getPublishedListingByRef: (...args: unknown[]) => getPublishedListingByRef(...args),
}));

vi.mock("../services/listing-strategy.service.js", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../services/listing-strategy.service.js")>();
  return {
    ...actual,
    loadListingStrategyContext: (...args: unknown[]) => loadListingStrategyContext(...args),
  };
});

vi.mock("../services/listing-claim.service.js", () => ({
  ListingClaimError: class ListingClaimError extends Error {},
  LISTING_CLAIM_HTTP: {},
  assertListingAcceptsNewSession: (...args: unknown[]) => assertListingAcceptsNewSession(...args),
}));

vi.mock("../services/attempt-control.service.js", () => ({
  defaultAttemptControlPolicy: () => ({ maxRoundsPerSession: 8 }),
  isAttemptControlRateLimited: () => false,
  evaluateAttemptControl: (...args: unknown[]) => evaluateAttemptControl(...args),
  withBuyerListingStartGate: async (
    _db: unknown,
    _input: unknown,
    run: (tx: unknown, attemptControl: unknown) => Promise<unknown>,
  ) => {
    const attemptControl = { max_rounds_per_session: 8 };
    const value = await run(_db, attemptControl);
    return { ok: true as const, value, attemptControl };
  },
}));

vi.mock("../services/negotiation-session.service.js", () => ({
  createSession: (...args: unknown[]) => createSession(...args),
}));

vi.mock("@haggle/engine-session", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@haggle/engine-session")>();
  return {
    ...actual,
    compileNegotiationAgentSnapshot: (...args: unknown[]) =>
      compileNegotiationAgentSnapshot(...args),
  };
});

vi.mock("@haggle/commerce-core", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@haggle/commerce-core")>();
  return {
    ...actual,
    quoteNegotiationCredits: (...args: unknown[]) => quoteNegotiationCredits(...args),
  };
});

vi.mock("../shipping/shipping-quote-before-start.js", async (importOriginal) => {
  const actual =
    await importOriginal<typeof import("../shipping/shipping-quote-before-start.js")>();
  return {
    ...actual,
    quoteShippingBeforeStart: (...args: unknown[]) => quoteShippingBeforeStart(...args),
  };
});

const { startBuyerNegotiation } = await import("../services/start-buyer-negotiation.service.js");
const { ShippingQuoteBeforeStartError, SHIPPING_QUOTE_INCOMPLETE } = await import(
  "../shipping/shipping-quote-before-start.js"
);

const denver = {
  name: "Alex Buyer",
  street1: "1600 Blake St",
  city: "Denver",
  state: "CO",
  zip: "80202",
  country: "US",
};

function listingFixture(snapshot: Record<string, unknown> = {}) {
  getPublishedListingByRef.mockResolvedValue({
    id: "listing-1",
    publicId: "jc6r2T3d",
    sellerId: "seller-1",
    negotiationAgentSnapshot: {
      negotiationAgentBuilderMemory: { categoryCriteria: [] },
      parcel: { weight_oz: 16, length_in: 10, width_in: 8, height_in: 4 },
      ...snapshot,
    },
  });
  loadListingStrategyContext.mockResolvedValue({
    askPriceMinor: 100_00,
    floorPriceMinor: 80_00,
    listedAtMs: Date.now() - 60_000,
    deadlineAtMs: Date.now() + 86_400_000,
    sellerNegotiationAgentPresetId: "balancer",
    listingContext: { category: "electronics", tags: ["iphone"] },
    sellerNegotiationAgentBuilderMemory: {},
    sellerStrategy: {
      compiler: { selected_playbook: "default" },
      weights: { w_p: 0.4, w_t: 0.2, w_r: 0.2, w_s: 0.2 },
      alpha: { price: 0.4, time: 0.2, reputation: 0.2, satisfaction: 0.2 },
      beta: 0.5,
      u_threshold: 0.7,
      u_aspiration: 0.85,
      anchor_ratio: 1,
      v_t_floor: 0.1,
      w_rep: 0.2,
      v_s_base: 0.2,
      n_threshold: 3,
    },
  });
  evaluateAttemptControl.mockResolvedValue({
    allowed: true,
    attemptControl: { max_rounds_per_session: 8 },
  });
  assertListingAcceptsNewSession.mockResolvedValue(undefined);
  createSession.mockResolvedValue({ id: "sess-new", status: "ACTIVE" });
}

describe("D2 startBuyerNegotiation shipping quote before start", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    listingFixture();
    quoteShippingBeforeStart.mockResolvedValue({
      source: "mock",
      key_mode: "missing",
      money_charged: false,
      label_purchased: false,
      rate_minor: 825,
      carrier: "USPS",
      service: "Priority",
      est_delivery_days: 3,
      carrier_priority: "balanced",
      rates: [],
      quoted_at: "2026-09-06T13:00:00.000Z",
    });
  });

  it("physical carrier success: quotes before create and exposes amount", async () => {
    const result = await startBuyerNegotiation({} as never, {
      body: {
        listing_public_id: "jc6r2T3d",
        negotiation_agent_preset_id: "balancer",
        fulfillment: {
          methods: ["carrier"],
          preferred: "carrier",
          buyer_address: denver,
          carrier_priority: "balanced",
        },
      },
      buyerId: "buyer-1",
      isGuest: false,
      driver: "web",
      allowGuest: false,
    });

    expect(quoteShippingBeforeStart).toHaveBeenCalledOnce();
    expect(createSession).toHaveBeenCalledOnce();
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.body.shipping_quote).toMatchObject({
      rate_minor: 825,
      carrier: "USPS",
      service: "Priority",
      source: "mock",
      money_charged: false,
      label_purchased: false,
    });

    const snapshot = createSession.mock.calls[0]?.[1]?.negotiationAgentSnapshot as Record<
      string,
      unknown
    >;
    const fulfillmentContext = snapshot?.fulfillment_context as Record<string, unknown>;
    expect(fulfillmentContext).toMatchObject({
      shipping_cost_known: true,
      shipping_cost_minor: 825,
    });
    expect(snapshot?.shipping_quote).toMatchObject({
      rate_minor: 825,
      money_charged: false,
      label_purchased: false,
    });
  });

  it("physical carrier without address rejects via D1 before quote (address gate first)", async () => {
    const result = await startBuyerNegotiation({} as never, {
      body: {
        listing_public_id: "jc6r2T3d",
        negotiation_agent_preset_id: "balancer",
        fulfillment: {
          methods: ["carrier"],
          preferred: "carrier",
          carrier_priority: "balanced",
        },
      },
      buyerId: "buyer-1",
      isGuest: false,
      driver: "web",
      allowGuest: false,
    });

    expect(result).toMatchObject({
      ok: false,
      status: 409,
      body: {
        error: "DELIVERY_ADDRESS_REQUIRED",
      },
    });
    if (!result.ok) {
      expect(result.body.error).toBe("DELIVERY_ADDRESS_REQUIRED");
      expect(result.body.error).not.toBe("SHIPPING_QUOTE_ADDRESS_REQUIRED");
    }
    expect(quoteShippingBeforeStart).not.toHaveBeenCalled();
    expect(createSession).not.toHaveBeenCalled();
  });

  it("physical carrier incomplete quote rejects start", async () => {
    quoteShippingBeforeStart.mockRejectedValue(
      new ShippingQuoteBeforeStartError(
        SHIPPING_QUOTE_INCOMPLETE,
        "Shipping quote returned no rates",
      ),
    );

    const result = await startBuyerNegotiation({} as never, {
      body: {
        listing_public_id: "jc6r2T3d",
        negotiation_agent_preset_id: "balancer",
        fulfillment: {
          methods: ["carrier"],
          preferred: "carrier",
          buyer_address: denver,
        },
      },
      buyerId: "buyer-1",
      isGuest: false,
      driver: "web",
      allowGuest: false,
    });

    expect(result).toMatchObject({
      ok: false,
      status: 409,
      body: {
        error: "SHIPPING_QUOTE_INCOMPLETE",
        money_charged: false,
        label_purchased: false,
      },
    });
    expect(createSession).not.toHaveBeenCalled();
  });

  it("digital A4 no-shipment path skips quote", async () => {
    listingFixture({ fulfillment_type: "digital_delivery" });

    const result = await startBuyerNegotiation({} as never, {
      body: {
        listing_public_id: "jc6r2T3d",
        negotiation_agent_preset_id: "balancer",
        fulfillment: {
          methods: ["carrier"],
          preferred: "carrier",
          buyer_address: denver,
        },
      },
      buyerId: "buyer-1",
      isGuest: false,
      driver: "web",
      allowGuest: false,
    });

    expect(quoteShippingBeforeStart).not.toHaveBeenCalled();
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.body).not.toHaveProperty("shipping_quote");
    expect(createSession).toHaveBeenCalledOnce();
  });
});
