/**
 * C2 goldens (startBuyerNegotiation wire): evaluate-pass then create race.
 * Loser must surface concurrent_on_listing via create-time recheck — not
 * silent double-create and not listing_cooldown / ATTEMPT_COOLDOWN.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

const getPublishedListingByRef = vi.fn();
const loadListingStrategyContext = vi.fn();
const assertListingAcceptsNewSession = vi.fn();
const evaluateAttemptControl = vi.fn();
const withBuyerListingStartGate = vi.fn();
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
  withBuyerListingStartGate: (...args: unknown[]) => withBuyerListingStartGate(...args),
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

describe("C2 startBuyerNegotiation evaluate→create TOCTOU goldens", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    listingFixture();
  });

  it("successful start uses create-time gate (not bare createSession)", async () => {
    evaluateAttemptControl.mockResolvedValue({
      allowed: true,
      attemptControl: cooldownLeftoverSnapshot,
    });
    withBuyerListingStartGate.mockImplementation(async (_db, _input, run) => {
      const value = await run({} as never, cooldownLeftoverSnapshot);
      return { ok: true, value, attemptControl: cooldownLeftoverSnapshot };
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
    expect(withBuyerListingStartGate).toHaveBeenCalledOnce();
    expect(createSession).toHaveBeenCalledOnce();
  });

  it("create-time recheck loser surfaces concurrent_on_listing, not cooldown", async () => {
    // Early evaluate still allows (TOCTOU window); create-time recheck blocks.
    evaluateAttemptControl.mockResolvedValue({
      allowed: true,
      attemptControl: cooldownLeftoverSnapshot,
    });
    withBuyerListingStartGate.mockResolvedValue({
      ok: false,
      attemptResult: {
        allowed: false,
        error: "CONCURRENT_SESSION_LIMIT_EXCEEDED",
        rule: "concurrent_on_listing",
        attemptControl: {
          ...cooldownLeftoverSnapshot,
          remaining_sessions: 1,
          active_sessions: 1,
          active_sessions_on_listing: 1,
        },
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
    expect(withBuyerListingStartGate).toHaveBeenCalledOnce();
    // createSession only runs inside the gate run callback — loser never invokes it.
    expect(createSession).not.toHaveBeenCalled();
  });
});
