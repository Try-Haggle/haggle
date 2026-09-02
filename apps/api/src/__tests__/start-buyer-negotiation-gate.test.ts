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
  evaluateAttemptControl: (...args: unknown[]) => evaluateAttemptControl(...args),
}));

vi.mock("../services/negotiation-session.service.js", () => ({
  createSession: (...args: unknown[]) => createSession(...args),
}));

vi.mock("@haggle/engine-session", () => ({
  compileNegotiationAgentSnapshot: (...args: unknown[]) => compileNegotiationAgentSnapshot(...args),
}));

vi.mock("@haggle/commerce-core", () => ({
  quoteNegotiationCredits: (...args: unknown[]) => quoteNegotiationCredits(...args),
}));

const { startBuyerNegotiation } = await import("../services/start-buyer-negotiation.service.js");

const IMEI_REQUIRED = {
  checkId: "imei_verification",
  questionKo: "IMEI가 깨끗한지 확인 가능한가요?",
  buyerAskKo: "Should the agent require a clean IMEI?",
  enforcement: "hard" as const,
  requirement: "required" as const,
  stance: "clean IMEI, seller confirmed",
};

function listingFixture() {
  getPublishedListingByRef.mockResolvedValue({
    id: "listing-1",
    publicId: "jc6r2T3d",
    sellerId: "seller-1",
    // Web wizard reads extractSellerRequiredCriteria(listing.negotiationAgentSnapshot).
    negotiationAgentSnapshot: {
      negotiationAgentBuilderMemory: { categoryCriteria: [IMEI_REQUIRED] },
    },
  });
  loadListingStrategyContext.mockResolvedValue({
    askPriceMinor: 100_00,
    floorPriceMinor: 80_00,
    listedAtMs: Date.now() - 60_000,
    deadlineAtMs: Date.now() + 86_400_000,
    sellerNegotiationAgentPresetId: "balancer",
    listingContext: { category: "electronics", tags: ["iphone"] },
    // Empty memory: a memory-only mock must not make this gate pass with a session.
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

describe("startBuyerNegotiation buyerCriteria gate", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    listingFixture();
  });

  it("rejects MCP start from listing snapshot required checks when buyerCriteria is empty", async () => {
    const result = await startBuyerNegotiation({} as never, {
      body: {
        listing_public_id: "jc6r2T3d",
        negotiation_agent_preset_id: "balancer",
      },
      buyerId: "buyer-1",
      isGuest: false,
      driver: "mcp",
      allowGuest: false,
    });
    expect(result).toMatchObject({
      ok: false,
      status: 409,
      body: {
        error: "BUYER_CRITERIA_REQUIRED",
        required_check_ids: ["imei_verification"],
        required_criteria: [
          { checkId: "imei_verification", ask: "Should the agent require a clean IMEI?" },
        ],
      },
    });
    expect(result.status).not.toBe(202);
    expect(result.body).not.toHaveProperty("session_id");
    expect(createSession).not.toHaveBeenCalled();
  });

  it("returns BUYER_CRITERIA_REQUIRED before ATTEMPT_LIMIT_EXCEEDED when remaining attempts are 0", async () => {
    evaluateAttemptControl.mockResolvedValue({
      allowed: false,
      error: "ATTEMPT_LIMIT_EXCEEDED",
      retryAfterSeconds: 86_400,
      attemptControl: {
        remaining_marketplace_attempts: 0,
        marketplace_daily_attempts: 5,
        max_rounds_per_session: 8,
      },
    });
    const result = await startBuyerNegotiation({} as never, {
      body: {
        listing_public_id: "joUdQ7Tw",
        negotiation_agent_preset_id: "balancer",
      },
      buyerId: "buyer-1",
      isGuest: false,
      driver: "mcp",
      allowGuest: false,
    });
    expect(result).toMatchObject({
      ok: false,
      status: 409,
      body: {
        error: "BUYER_CRITERIA_REQUIRED",
        required_check_ids: ["imei_verification"],
        required_criteria: [
          { checkId: "imei_verification", ask: "Should the agent require a clean IMEI?" },
        ],
      },
    });
    if (!result.ok) {
      expect(result.body.error).not.toBe("ATTEMPT_LIMIT_EXCEEDED");
    }
    expect(result.body).not.toHaveProperty("session_id");
    expect(evaluateAttemptControl).not.toHaveBeenCalled();
    expect(quoteNegotiationCredits).not.toHaveBeenCalled();
    expect(createSession).not.toHaveBeenCalled();
  });

  it("creates a session when the listing snapshot has no required checks", async () => {
    getPublishedListingByRef.mockResolvedValue({
      id: "listing-1",
      publicId: "jc6r2T3d",
      sellerId: "seller-1",
      negotiationAgentSnapshot: {
        negotiationAgentBuilderMemory: { categoryCriteria: [] },
      },
    });
    const result = await startBuyerNegotiation({} as never, {
      body: {
        listing_public_id: "jc6r2T3d",
        negotiation_agent_preset_id: "balancer",
      },
      buyerId: "buyer-1",
      isGuest: false,
      driver: "mcp",
      allowGuest: false,
    });
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.body.session_id).toBe("sess-new");
    }
    expect(createSession).toHaveBeenCalled();
  });

  it("creates a session when buyerCriteria answers the listing snapshot required checks", async () => {
    const result = await startBuyerNegotiation({} as never, {
      body: {
        listing_public_id: "jc6r2T3d",
        negotiation_agent_preset_id: "balancer",
        buyerCriteria: [{ checkId: "imei_verification", stance: "clean IMEI required" }],
      },
      buyerId: "buyer-1",
      isGuest: false,
      driver: "mcp",
      allowGuest: false,
    });
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.body).not.toHaveProperty("buyer_criteria_required");
      expect(result.body.session_id).toBe("sess-new");
    }
    expect(createSession).toHaveBeenCalled();
  });
});
