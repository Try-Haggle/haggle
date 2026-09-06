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
  // Pass-through: unit tests mock evaluate/create; gate just runs the callback.
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

const { parseStartBuyerNegotiationBody, startBuyerNegotiation } = await import(
  "../services/start-buyer-negotiation.service.js"
);

const IMEI_REQUIRED = {
  checkId: "imei_verification",
  questionKo: "IMEI가 깨끗한지 확인 가능한가요?",
  buyerAskKo: "Should the agent require a clean IMEI?",
  enforcement: "hard" as const,
  requirement: "required" as const,
  stance: "clean IMEI, seller confirmed",
};

const FIND_MY_REQUIRED = {
  checkId: "find_my_status",
  questionKo: "Find My가 꺼져 있나요?",
  buyerAskKo: "Must Find My be turned off?",
  enforcement: "hard" as const,
  requirement: "required" as const,
  stance: "Find My off, seller confirmed",
};

function listingFixture() {
  getPublishedListingByRef.mockResolvedValue({
    id: "listing-1",
    publicId: "jc6r2T3d",
    sellerId: "seller-1",
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

/**
 * A7 golden fixtures — pass / missing / type / partial for buyerCriteria on start.
 * Partial: every listing required key must be present + non-empty (fake keys do not count).
 */
describe("A7 buyerCriteria golden fixtures", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    listingFixture();
  });

  it("pass: required buyerCriteria with correct types creates a session", async () => {
    const parsed = parseStartBuyerNegotiationBody({
      listing_public_id: "jc6r2T3d",
      negotiation_agent_preset_id: "balancer",
      buyerCriteria: [{ checkId: "imei_verification", stance: "clean IMEI required" }],
    });
    expect(parsed.ok).toBe(true);
    if (!parsed.ok) return;

    const result = await startBuyerNegotiation({} as never, {
      body: parsed.data,
      buyerId: "buyer-1",
      isGuest: false,
      driver: "mcp",
      allowGuest: false,
    });
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.status).toBe(202);
      expect(result.body.session_id).toBe("sess-new");
    }
    expect(createSession).toHaveBeenCalled();
  });

  it("missing: omit required buyerCriteria rejects start without creating a session", async () => {
    const parsed = parseStartBuyerNegotiationBody({
      listing_public_id: "jc6r2T3d",
      negotiation_agent_preset_id: "balancer",
    });
    expect(parsed.ok).toBe(true);
    if (!parsed.ok) return;

    const result = await startBuyerNegotiation({} as never, {
      body: parsed.data,
      buyerId: "buyer-1",
      isGuest: false,
      driver: "mcp",
      allowGuest: false,
    });
    expect(result).toMatchObject({
      ok: false,
      status: 409,
      body: { error: "BUYER_CRITERIA_REQUIRED" },
    });
    expect(result.body).not.toHaveProperty("session_id");
    expect(createSession).not.toHaveBeenCalled();
  });

  it("type: wrong stance/checkId shape rejects start without creating a session", async () => {
    const parsed = parseStartBuyerNegotiationBody({
      listing_public_id: "jc6r2T3d",
      negotiation_agent_preset_id: "balancer",
      buyerCriteria: [{ checkId: 42, stance: { not: "a-string" } }],
    });
    expect(parsed.ok).toBe(false);
    if (parsed.ok) return;
    expect(parsed.status).toBe(400);
    expect(parsed.body.error).toBe("BUYER_CRITERIA_TYPE_INVALID");
    expect(parsed.body.error).not.toBe("BUYER_CRITERIA_REQUIRED");
    expect(parsed.body.error).not.toBe("INVALID_START_REQUEST");
    expect(createSession).not.toHaveBeenCalled();
  });

  it("partial: imei + fake checkId with other required missing rejects without session", async () => {
    getPublishedListingByRef.mockResolvedValue({
      id: "listing-1",
      publicId: "joUdQ7Tw",
      sellerId: "seller-1",
      negotiationAgentSnapshot: {
        negotiationAgentBuilderMemory: {
          categoryCriteria: [IMEI_REQUIRED, FIND_MY_REQUIRED],
        },
      },
    });

    const parsed = parseStartBuyerNegotiationBody({
      listing_public_id: "joUdQ7Tw",
      negotiation_agent_preset_id: "balancer",
      buyerCriteria: [
        { checkId: "imei_verification", stance: "clean IMEI required" },
        { checkId: "fake_check_id", stance: "not a real required key" },
      ],
    });
    expect(parsed.ok).toBe(true);
    if (!parsed.ok) return;

    const result = await startBuyerNegotiation({} as never, {
      body: parsed.data,
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
        required_check_ids: ["find_my_status"],
      },
    });
    expect(result.body).not.toHaveProperty("session_id");
    expect(createSession).not.toHaveBeenCalled();
  });

  it("partial: empty stance on a required key rejects without session", async () => {
    getPublishedListingByRef.mockResolvedValue({
      id: "listing-1",
      publicId: "joUdQ7Tw",
      sellerId: "seller-1",
      negotiationAgentSnapshot: {
        negotiationAgentBuilderMemory: {
          categoryCriteria: [IMEI_REQUIRED, FIND_MY_REQUIRED],
        },
      },
    });

    const parsed = parseStartBuyerNegotiationBody({
      listing_public_id: "joUdQ7Tw",
      negotiation_agent_preset_id: "balancer",
      buyerCriteria: [
        { checkId: "imei_verification", stance: "clean IMEI required" },
        { checkId: "find_my_status", stance: "   " },
      ],
    });
    expect(parsed.ok).toBe(true);
    if (!parsed.ok) return;

    const result = await startBuyerNegotiation({} as never, {
      body: parsed.data,
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
        required_check_ids: ["find_my_status"],
      },
    });
    expect(createSession).not.toHaveBeenCalled();
  });
});
