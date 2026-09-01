import { beforeEach, describe, expect, it, vi } from "vitest";

const getPublishedListingByRef = vi.fn();
const loadListingStrategyContext = vi.fn();
const assertListingAcceptsNewSession = vi.fn();
const evaluateAttemptControl = vi.fn();
const createSession = vi.fn();
const compileNegotiationAgentSnapshot = vi.fn(() => ({ compiled: true }));
const quoteNegotiationCredits = vi.fn(() => ({ quoted: true }));

vi.mock("../services/draft.service.js", () => ({
  getPublishedListingByRef: (...args: unknown[]) => getPublishedListingByRef(...args),
}));

vi.mock("../services/listing-strategy.service.js", () => ({
  loadListingStrategyContext: (...args: unknown[]) => loadListingStrategyContext(...args),
}));

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
    negotiationAgentSnapshot: {},
  });
  loadListingStrategyContext.mockResolvedValue({
    askPriceMinor: 100_00,
    floorPriceMinor: 80_00,
    listedAtMs: Date.now() - 60_000,
    deadlineAtMs: Date.now() + 86_400_000,
    sellerNegotiationAgentPresetId: "balancer",
    listingContext: { category: "electronics", tags: ["iphone"] },
    sellerNegotiationAgentBuilderMemory: { categoryCriteria: [IMEI_REQUIRED] },
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

  it("rejects start when seller required criteria exist and buyerCriteria is empty", async () => {
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
      },
    });
    expect(createSession).not.toHaveBeenCalled();
  });

  it("creates a session when buyerCriteria answers the seller required checks", async () => {
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
    expect(createSession).toHaveBeenCalled();
  });
});
