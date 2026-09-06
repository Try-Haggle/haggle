/**
 * B10 goldens (startBuyerNegotiation wire): remaining>0·active0 overlapping start
 * must not surface listing_cooldown / ATTEMPT_COOLDOWN; concurrent loser names
 * concurrent_on_listing.
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

vi.mock("@haggle/commerce-core", () => ({
  quoteNegotiationCredits: (...args: unknown[]) => quoteNegotiationCredits(...args),
}));

const { startBuyerNegotiation } = await import("../services/start-buyer-negotiation.service.js");

const cooldownLeftoverSnapshot = {
  remaining_sessions: 2,
  remaining_marketplace_attempts: 5,
  active_sessions: 0,
  active_sessions_on_listing: 0,
  retry_after_seconds: 3 * 3600,
  max_rounds_per_session: 8,
};

function listingFixture() {
  getPublishedListingByRef.mockResolvedValue({
    id: "listing-1",
    publicId: "joUdQ7Tw",
    sellerId: "seller-1",
    negotiationAgentSnapshot: {
      negotiationAgentBuilderMemory: { categoryCriteria: [] },
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
  assertListingAcceptsNewSession.mockResolvedValue(undefined);
  createSession.mockResolvedValue({ id: "sess-new", status: "ACTIVE" });
}

describe("B10 startBuyerNegotiation concurrent start / cooldown goldens", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    listingFixture();
  });

  it("allows start when remaining>0·active0 even with cooldown leftover in snapshot", async () => {
    evaluateAttemptControl.mockResolvedValue({
      allowed: true,
      attemptControl: cooldownLeftoverSnapshot,
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

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.status).toBe(202);
      expect(result.body.session_id).toBe("sess-new");
      expect(result.body.attempt_control?.retry_after_seconds).toBe(3 * 3600);
    }
    expect(createSession).toHaveBeenCalled();
    expect(evaluateAttemptControl).toHaveBeenCalledOnce();
  });

  it("overlapping start loser surfaces concurrent_on_listing, not listing_cooldown", async () => {
    evaluateAttemptControl.mockResolvedValue({
      allowed: false,
      error: "CONCURRENT_SESSION_LIMIT_EXCEEDED",
      rule: "concurrent_on_listing",
      attemptControl: {
        ...cooldownLeftoverSnapshot,
        remaining_sessions: 1,
        active_sessions: 1,
        active_sessions_on_listing: 1,
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
        error: "CONCURRENT_SESSION_LIMIT_EXCEEDED",
        rule: "concurrent_on_listing",
      },
    });
    if (!result.ok) {
      expect(result.body.error).not.toBe("ATTEMPT_COOLDOWN");
      expect(result.body.error).not.toBe("ATTEMPT_LIMIT_EXCEEDED");
      expect(result.body.rule).not.toBe("listing_cooldown");
    }
    expect(createSession).not.toHaveBeenCalled();
  });
});
