import { describe, expect, it, vi } from "vitest";
import { executeAutoPlayNext } from "../services/execute-auto-play-next.service.js";

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

vi.mock("../services/negotiation-auto-play.service.js", () => ({
  getNegotiationAutoPlayContext: vi.fn(() => ({ maxRounds: 8, buyerSnapshot: {} })),
  isNegotiationAutoPlayTerminal: vi.fn(() => false),
  planNegotiationAutoPlayRound: vi.fn(),
  attachNegotiationAutoPlayContext: vi.fn(),
}));

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
