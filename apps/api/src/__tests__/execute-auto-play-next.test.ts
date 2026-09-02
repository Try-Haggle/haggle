import { describe, expect, it, vi } from "vitest";
import { buildHostHnpOfferEnvelope } from "../hnp/host-envelope.js";
import { submitHnpOffer } from "../hnp/submit-offer.js";
import { executeAutoPlayNext } from "../services/execute-auto-play-next.service.js";
import {
  getNegotiationAutoPlayContext,
  planNegotiationAutoPlayRound,
} from "../services/negotiation-auto-play.service.js";
import { getSessionById, setSessionPerspective } from "../services/negotiation-session.service.js";

vi.mock("../hnp/host-envelope.js", () => ({
  buildHostHnpOfferEnvelope: vi.fn((args: unknown) => args),
}));
vi.mock("../hnp/submit-offer.js", () => ({
  submitHnpOffer: vi.fn(async () => ({
    ok: true,
    idempotent: false,
    roundId: "round-3",
    roundNo: 3,
    decision: "COUNTER",
    sessionStatus: "ACTIVE",
  })),
}));

vi.mock("../services/negotiation-session.service.js", () => ({
  getSessionById: vi.fn(async () => ({
    id: "sess-1",
    driver: "web",
    buyerId: "buyer-1",
    sellerId: "seller-1",
    status: "ACTIVE",
    currentRound: 1,
    version: 1,
    negotiationAgentSnapshot: {},
  })),
  setSessionPerspective: vi.fn(),
  updateSessionState: vi.fn(),
}));

vi.mock("../services/negotiation-auto-play.service.js", async (importOriginal) => {
  const actual =
    await importOriginal<typeof import("../services/negotiation-auto-play.service.js")>();
  return {
    ...actual,
    getNegotiationAutoPlayContext: vi.fn(() => ({ maxRounds: 8, buyerSnapshot: {} })),
    isNegotiationAutoPlayTerminal: vi.fn(() => false),
    planNegotiationAutoPlayRound: vi.fn(),
    attachNegotiationAutoPlayContext: vi.fn(),
  };
});

vi.mock("../services/negotiation-round.service.js", () => ({
  getRoundsBySessionId: vi.fn(async () => []),
}));

describe("executeAutoPlayNext driver guard", () => {
  it("rejects an MCP play against a web-driven session", async () => {
    const result = await executeAutoPlayNext({} as never, {
      sessionId: "sess-1",
      actor: { id: "buyer-1", role: "user" },
      expectedDriver: "mcp",
    });
    expect(result).toEqual({
      ok: false,
      status: 409,
      body: { error: "DRIVER_MISMATCH" },
    });
  });
});

const sellerRequiredSnap = {
  pause_seller_required_criteria: [
    {
      checkId: "imei_verification",
      questionKo: "IMEI가 깨끗한지 확인 가능한가요?",
      buyerAskKo: "Should the agent require a clean IMEI?",
      enforcement: "hard",
      requirement: "required",
    },
  ],
  buyer_negotiation_agent_builder_memory: { categoryCriteria: [] },
  listing_context: {
    seller_facts: [{ checkId: "imei_verification", label: "IMEI", value: "Clean" }],
  },
};

describe("executeAutoPlayNext buyerCriteria start gate", () => {
  it("rejects play_next when seller required exist and buyerCriteria is empty", async () => {
    vi.mocked(getSessionById).mockResolvedValueOnce({
      id: "sess-1",
      driver: "mcp",
      buyerId: "buyer-1",
      sellerId: "seller-1",
      status: "ACTIVE",
      currentRound: 0,
      version: 1,
      negotiationAgentSnapshot: {},
    } as never);
    vi.mocked(getNegotiationAutoPlayContext).mockReturnValueOnce({
      maxRounds: 8,
      buyerSnapshot: sellerRequiredSnap,
    } as never);

    const result = await executeAutoPlayNext({} as never, {
      sessionId: "sess-1",
      actor: { id: "buyer-1", role: "user" },
      expectedDriver: "mcp",
    });
    expect(result.ok).toBe(false);
    expect(result.status).toBe(409);
    expect(result.body.error).toBe("BUYER_CRITERIA_REQUIRED");
    expect(result.body.required_check_ids).toEqual(["imei_verification"]);
    expect(planNegotiationAutoPlayRound).not.toHaveBeenCalled();
  });

  it("does not reject when the buyer already answered at start", async () => {
    vi.mocked(getSessionById).mockResolvedValueOnce({
      id: "sess-1",
      driver: "mcp",
      buyerId: "buyer-1",
      sellerId: "seller-1",
      status: "ACTIVE",
      currentRound: 0,
      version: 1,
      negotiationAgentSnapshot: {},
    } as never);
    vi.mocked(getNegotiationAutoPlayContext).mockReturnValueOnce({
      maxRounds: 8,
      buyerSnapshot: {
        ...sellerRequiredSnap,
        buyer_negotiation_agent_builder_memory: {
          categoryCriteria: [
            {
              checkId: "imei_verification",
              questionKo: "IMEI?",
              enforcement: "hard",
              requirement: "required",
              stance: "clean IMEI required",
            },
          ],
        },
      },
    } as never);
    vi.mocked(planNegotiationAutoPlayRound).mockReturnValueOnce(null);

    const result = await executeAutoPlayNext({} as never, {
      sessionId: "sess-1",
      actor: { id: "buyer-1", role: "user" },
      expectedDriver: "mcp",
    });
    expect(result.body.error).not.toBe("BUYER_CRITERIA_REQUIRED");
    expect(planNegotiationAutoPlayRound).toHaveBeenCalled();
  });

  it("still rejects BUYER_CRITERIA_REQUIRED when price_minor is supplied", async () => {
    vi.mocked(planNegotiationAutoPlayRound).mockClear();
    vi.mocked(getSessionById).mockResolvedValueOnce({
      id: "sess-1",
      driver: "mcp",
      buyerId: "buyer-1",
      sellerId: "seller-1",
      status: "ACTIVE",
      currentRound: 0,
      version: 1,
      negotiationAgentSnapshot: {},
    } as never);
    vi.mocked(getNegotiationAutoPlayContext).mockReturnValueOnce({
      maxRounds: 8,
      buyerSnapshot: sellerRequiredSnap,
    } as never);

    const result = await executeAutoPlayNext({} as never, {
      sessionId: "sess-1",
      actor: { id: "buyer-1", role: "user" },
      expectedDriver: "mcp",
      priceMinor: 42000,
      message: "Listing doesn't spec storage.",
    });
    expect(result.ok).toBe(false);
    expect(result.status).toBe(409);
    expect(result.body.error).toBe("BUYER_CRITERIA_REQUIRED");
    expect(planNegotiationAutoPlayRound).not.toHaveBeenCalled();
  });
});

describe("executeAutoPlayNext user-specified counter", () => {
  it("overrides autoplay price and message on a buyer-incoming plan (Math.max case)", async () => {
    vi.mocked(submitHnpOffer).mockClear();
    vi.mocked(buildHostHnpOfferEnvelope).mockClear();
    vi.mocked(getSessionById).mockResolvedValue({
      id: "sess-1",
      driver: "mcp",
      buyerId: "buyer-1",
      sellerId: "seller-1",
      status: "ACTIVE",
      currentRound: 2,
      version: 1,
      negotiationAgentSnapshot: {},
    } as never);
    vi.mocked(getNegotiationAutoPlayContext).mockReturnValue({
      maxRounds: 8,
      buyerSnapshot: { side: "buyer" },
      sellerSnapshot: { side: "seller" },
    } as never);
    vi.mocked(planNegotiationAutoPlayRound).mockReturnValue({
      roundNo: 3,
      senderRole: "BUYER",
      responderRole: "SELLER",
      responderSnapshot: { side: "seller" },
      offerPriceMinor: 49500,
      messageText: "autoplay",
    } as never);
    vi.mocked(setSessionPerspective).mockResolvedValue(true);

    const result = await executeAutoPlayNext({} as never, {
      sessionId: "sess-1",
      actor: { id: "buyer-1", role: "user" },
      expectedDriver: "mcp",
      priceMinor: 42000,
      message:
        "Listing doesn’t spec storage or battery, and 14 Plus is a discontinued size. $495 is still asking.",
    });
    expect(result.ok).toBe(true);
    expect(result.body).toMatchObject({ applied_price_minor: 42000 });
    expect(buildHostHnpOfferEnvelope).toHaveBeenCalledWith(
      expect.objectContaining({ priceMinor: 42000, senderRole: "BUYER" }),
    );
    expect(submitHnpOffer).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ priceMinor: 42000, senderRole: "BUYER" }),
      expect.objectContaining({
        messageText:
          "Listing doesn’t spec storage or battery, and 14 Plus is a discontinued size. $495 is still asking.",
        requireSignature: false,
      }),
    );
  });

  it("after persisted BUYER round (plan SELLER incoming) forces BUYER COUNTER 42000 — not 409, not 49500", async () => {
    vi.mocked(submitHnpOffer).mockClear();
    vi.mocked(buildHostHnpOfferEnvelope).mockClear();
    vi.mocked(getSessionById).mockResolvedValue({
      id: "sess-1",
      driver: "mcp",
      buyerId: "buyer-1",
      sellerId: "seller-1",
      status: "ACTIVE",
      currentRound: 1,
      version: 1,
      negotiationAgentSnapshot: {},
    } as never);
    vi.mocked(getNegotiationAutoPlayContext).mockReturnValue({
      maxRounds: 8,
      buyerSnapshot: { side: "buyer" },
      sellerSnapshot: { side: "seller" },
    } as never);
    // After persisted BUYER R1, autoplay plans next incoming as SELLER at seller last.
    vi.mocked(planNegotiationAutoPlayRound).mockReturnValue({
      roundNo: 2,
      senderRole: "SELLER",
      responderRole: "BUYER",
      responderSnapshot: { side: "buyer" },
      offerPriceMinor: 49500,
      messageText: "autoplay seller",
    } as never);
    vi.mocked(setSessionPerspective).mockResolvedValue(true);

    const result = await executeAutoPlayNext({} as never, {
      sessionId: "sess-1",
      actor: { id: "buyer-1", role: "user" },
      expectedDriver: "mcp",
      priceMinor: 42000,
      message:
        "Listing doesn’t spec storage or battery, and 14 Plus is a discontinued size. $495 is still asking.",
    });
    expect(result.ok).toBe(true);
    expect(result.body).not.toMatchObject({ error: "NOT_BUYER_TURN" });
    expect(result.body).toMatchObject({ applied_price_minor: 42000 });
    // Exact envelope assertion for the SELLER-plan + user-price case:
    expect(buildHostHnpOfferEnvelope).toHaveBeenCalledWith(
      expect.objectContaining({
        sessionId: "sess-1",
        roundNo: 2,
        senderRole: "BUYER",
        priceMinor: 42000,
      }),
    );
    expect(submitHnpOffer).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ senderRole: "BUYER", priceMinor: 42000 }),
      expect.objectContaining({
        messageText:
          "Listing doesn’t spec storage or battery, and 14 Plus is a discontinued size. $495 is still asking.",
        requireSignature: false,
      }),
    );
    // Must NOT submit seller last / ACCEPT at 49500
    expect(buildHostHnpOfferEnvelope).not.toHaveBeenCalledWith(
      expect.objectContaining({ priceMinor: 49500 }),
    );
  });

  it("autoplays unchanged when price_minor and message are omitted (seller incoming 49500)", async () => {
    vi.mocked(submitHnpOffer).mockClear();
    vi.mocked(buildHostHnpOfferEnvelope).mockClear();
    vi.mocked(getSessionById).mockResolvedValue({
      id: "sess-1",
      driver: "mcp",
      buyerId: "buyer-1",
      sellerId: "seller-1",
      status: "ACTIVE",
      currentRound: 1,
      version: 1,
      negotiationAgentSnapshot: {},
    } as never);
    vi.mocked(getNegotiationAutoPlayContext).mockReturnValue({
      maxRounds: 8,
      buyerSnapshot: { side: "buyer" },
      sellerSnapshot: { side: "seller" },
    } as never);
    vi.mocked(planNegotiationAutoPlayRound).mockReturnValue({
      roundNo: 2,
      senderRole: "SELLER",
      responderRole: "BUYER",
      responderSnapshot: { side: "buyer" },
      offerPriceMinor: 49500,
      messageText: "autoplay seller",
    } as never);
    vi.mocked(setSessionPerspective).mockResolvedValue(true);

    const result = await executeAutoPlayNext({} as never, {
      sessionId: "sess-1",
      actor: { id: "buyer-1", role: "user" },
      expectedDriver: "mcp",
    });
    expect(result.ok).toBe(true);
    expect(result.body.applied_price_minor).toBeUndefined();
    expect(buildHostHnpOfferEnvelope).toHaveBeenCalledWith(
      expect.objectContaining({ priceMinor: 49500, senderRole: "SELLER" }),
    );
    expect(submitHnpOffer).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ priceMinor: 49500, senderRole: "SELLER" }),
      expect.objectContaining({ messageText: "autoplay seller", requireSignature: false }),
    );
  });
});
