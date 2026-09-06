/**
 * D1 goldens: physical listing start requires delivery address (409
 * DELIVERY_ADDRESS_REQUIRED, no session). Digital (A4 no-shipment) exempt.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

const getPublishedListingByRef = vi.fn();
const loadListingStrategyContext = vi.fn();
const assertListingAcceptsNewSession = vi.fn();
const evaluateAttemptControl = vi.fn();
const createSession = vi.fn();
const compileNegotiationAgentSnapshot = vi.fn((..._args: unknown[]) => ({ compiled: true }));
const quoteNegotiationCredits = vi.fn((..._args: unknown[]) => ({ quoted: true }));

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
  isAttemptControlRateLimited: (error: string | undefined) =>
    error === "ATTEMPT_LIMIT_EXCEEDED" ||
    error === "ATTEMPT_WINDOW_EXCEEDED" ||
    error === "MARKETPLACE_ATTEMPT_LIMIT_EXCEEDED" ||
    error === "ATTEMPT_COOLDOWN",
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

const { DELIVERY_ADDRESS_REQUIRED, startBuyerNegotiation } = await import(
  "../services/start-buyer-negotiation.service.js"
);

const DENVER = {
  name: "Alex Buyer",
  street1: "1600 Blake St",
  city: "Denver",
  state: "CO",
  zip: "80202",
  country: "US",
};

function listingFixture(snapshotExtras: Record<string, unknown> = {}) {
  getPublishedListingByRef.mockResolvedValue({
    id: "listing-1",
    publicId: "d1PhysAdr",
    sellerId: "seller-1",
    negotiationAgentSnapshot: {
      negotiationAgentBuilderMemory: { categoryCriteria: [] },
      sellerFulfillmentOffer: {
        options: [{ method: "carrier" }],
        preferred: "carrier",
      },
      ...snapshotExtras,
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
  createSession.mockResolvedValue({ id: "sess-d1", status: "ACTIVE" });
}

describe("D1 delivery address gate (physical vs digital)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    listingFixture();
  });

  it("physical carrier missing address → 409 DELIVERY_ADDRESS_REQUIRED, no session", async () => {
    const result = await startBuyerNegotiation({} as never, {
      body: {
        listing_public_id: "d1PhysAdr",
        negotiation_agent_preset_id: "balancer",
        fulfillment: { methods: ["carrier"], preferred: "carrier" },
      },
      buyerId: "buyer-1",
      isGuest: false,
      driver: "web",
      allowGuest: false,
    });

    expect(result).toMatchObject({
      ok: false,
      status: 409,
      body: { error: DELIVERY_ADDRESS_REQUIRED },
    });
    expect(result.body).not.toHaveProperty("session_id");
    expect(createSession).not.toHaveBeenCalled();
  });

  it("physical carrier with address → not blocked by this gate", async () => {
    const result = await startBuyerNegotiation({} as never, {
      body: {
        listing_public_id: "d1PhysAdr",
        negotiation_agent_preset_id: "balancer",
        fulfillment: {
          methods: ["carrier"],
          preferred: "carrier",
          buyer_address: DENVER,
        },
      },
      buyerId: "buyer-1",
      isGuest: false,
      driver: "web",
      allowGuest: false,
    });

    expect(result.ok).toBe(true);
    expect(result.status).toBe(202);
    if (result.ok) {
      expect(result.body.session_id).toBe("sess-d1");
    }
    expect(createSession).toHaveBeenCalledTimes(1);
  });

  it("digital (A4 no-shipment) without address → allowed", async () => {
    listingFixture({ fulfillment_type: "digital_delivery" });

    const result = await startBuyerNegotiation({} as never, {
      body: {
        listing_public_id: "d1PhysAdr",
        negotiation_agent_preset_id: "balancer",
        // no fulfillment / no address — digital exempt
      },
      buyerId: "buyer-1",
      isGuest: false,
      driver: "web",
      allowGuest: false,
    });

    expect(result.ok).toBe(true);
    expect(result.status).toBe(202);
    expect(createSession).toHaveBeenCalledTimes(1);
  });

  it("digital listing stays exempt even if carrier fulfillment omits address", async () => {
    listingFixture({ fulfillment_type: "digital_delivery" });

    const result = await startBuyerNegotiation({} as never, {
      body: {
        listing_public_id: "d1PhysAdr",
        negotiation_agent_preset_id: "balancer",
        fulfillment: { methods: ["carrier"], preferred: "carrier" },
      },
      buyerId: "buyer-1",
      isGuest: false,
      driver: "web",
      allowGuest: false,
    });

    expect(result.ok).toBe(true);
    expect(result.status).toBe(202);
    expect(createSession).toHaveBeenCalledTimes(1);
  });

  it("start without fulfillment body is not blocked by D1 (MCP / no shipping preference)", async () => {
    const result = await startBuyerNegotiation({} as never, {
      body: {
        listing_public_id: "d1PhysAdr",
        negotiation_agent_preset_id: "balancer",
      },
      buyerId: "buyer-1",
      isGuest: false,
      driver: "mcp",
      allowGuest: false,
    });

    expect(result.ok).toBe(true);
    expect(createSession).toHaveBeenCalledTimes(1);
  });
});
