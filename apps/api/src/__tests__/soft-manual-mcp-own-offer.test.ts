/**
 * Handler-level coverage for MCP hnp_submit_offer. Registers the real tools
 * onto a fake server, then invokes the captured handler with an actor in the
 * MCP AsyncLocalStorage the scope check reads.
 */

import type { Database } from "@haggle/db";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { beforeAll, describe, expect, it, vi } from "vitest";
import { buildHostHnpOfferEnvelope } from "../hnp/host-envelope.js";
import { runWithMcpActor } from "../lib/mcp-actor.js";
import { registerTools } from "../mcp/tools/index.js";
import type { AuthUser } from "../middleware/auth.js";

const { mockGetSessionById, mockSubmitHnpOffer } = vi.hoisted(() => ({
  mockGetSessionById: vi.fn(),
  mockSubmitHnpOffer: vi.fn(),
}));

vi.mock("../hnp/submit-offer.js", () => ({
  submitHnpOffer: (...args: unknown[]) => mockSubmitHnpOffer(...args),
}));

vi.mock("../services/negotiation-session.service.js", async (importOriginal) => {
  const actual =
    await importOriginal<typeof import("../services/negotiation-session.service.js")>();
  return {
    ...actual,
    getSessionById: (...args: unknown[]) => mockGetSessionById(...args),
  };
});

const SESSION_ID = "00000000-0000-4000-a000-0000000000bb";
const BUYER_ID = "buyer-manual-1";

type ToolResult = {
  isError?: boolean;
  content?: Array<{ type: string; text: string }>;
};

type ToolHandler = (args: {
  envelope: ReturnType<typeof buildHostHnpOfferEnvelope>;
}) => Promise<ToolResult>;

const tools = new Map<string, ToolHandler>();

function captureTool(name: string, ...rest: unknown[]) {
  const handler = [...rest].reverse().find((arg) => typeof arg === "function");
  if (typeof handler === "function") {
    tools.set(name, handler as ToolHandler);
  }
  return {
    enabled: true,
    enable() {
      return this;
    },
    disable() {
      return this;
    },
    remove() {
      return this;
    },
    update() {
      return this;
    },
  };
}

const server = {
  tool: captureTool,
  registerTool: captureTool,
};

const buyerActor: AuthUser = {
  id: BUYER_ID,
  role: "user",
  tokenKind: "jwt",
};

function ownBuyerEnvelope() {
  return buildHostHnpOfferEnvelope({
    sessionId: SESSION_ID,
    roundNo: 2,
    senderRole: "BUYER",
    priceMinor: 42_000,
    nowMs: Date.now(),
    senderAgentId: BUYER_ID,
  });
}

function manualBuyerSession(role: "BUYER" | "SELLER") {
  return {
    id: SESSION_ID,
    buyerId: BUYER_ID,
    sellerId: "seller-auto-1",
    role,
    status: "ACTIVE",
    buyerControlMode: "manual",
    sellerControlMode: "auto",
  };
}

describe("MCP hnp_submit_offer handler", () => {
  let handler: ToolHandler;

  beforeAll(() => {
    registerTools(server as unknown as McpServer, {} as Database);
    const registered = tools.get("hnp_submit_offer");
    if (!registered) {
      throw new Error(
        `hnp_submit_offer was not registered (tools: ${[...tools.keys()].join(",")})`,
      );
    }
    handler = registered;
  });

  it("Manual buyer own offer reaches submitHnpOffer and returns a success payload", async () => {
    mockGetSessionById.mockResolvedValue(manualBuyerSession("SELLER"));
    mockSubmitHnpOffer.mockResolvedValue({
      ok: true,
      roundId: "round-own",
      roundNo: 2,
      decision: "COUNTER",
      counterPrice: 42_000,
      sessionStatus: "ACTIVE",
      idempotent: false,
      proposalHash: "sha256:abc",
      utility: {},
    });

    const envelope = ownBuyerEnvelope();
    const result = await runWithMcpActor(buyerActor, () => handler({ envelope }));

    expect(mockGetSessionById).toHaveBeenCalledWith(expect.anything(), SESSION_ID);
    expect(mockSubmitHnpOffer).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ sender_role: "BUYER", session_id: SESSION_ID }),
      expect.any(Object),
    );
    expect(mockSubmitHnpOffer.mock.calls[0]?.[2]).not.toHaveProperty("softAiInflightClaim");
    expect(result.isError).not.toBe(true);
    expect(JSON.parse(result.content?.[0]?.text ?? "{}")).toMatchObject({
      protocol: "hnp",
      round_id: "round-own",
      round_no: 2,
      decision: "COUNTER",
      counter_price: 42_000,
      session_status: "ACTIVE",
    });
  });

  it("returns isError when submitHnpOffer returns the 409 SOFT_MANUAL_WAITING body", async () => {
    mockSubmitHnpOffer.mockReset();
    mockGetSessionById.mockResolvedValue(manualBuyerSession("BUYER"));
    const waiting = {
      error: "SOFT_MANUAL_WAITING",
      waiting_for_manual: true,
      party: "buyer",
      buyer_control_mode: "manual",
      seller_control_mode: "auto",
      session_status: "ACTIVE",
      current_round: 2,
    };
    mockSubmitHnpOffer.mockResolvedValue({ ok: false, status: 409, body: waiting });

    const result = await runWithMcpActor(buyerActor, () =>
      handler({ envelope: ownBuyerEnvelope() }),
    );

    expect(mockSubmitHnpOffer).toHaveBeenCalledOnce();
    expect(result.isError).toBe(true);
    expect(JSON.parse(result.content?.[0]?.text ?? "{}")).toMatchObject({
      ...waiting,
      status: 409,
    });
  });

  it("success payload includes awaiting_manual_counterpart and ignores force flags", async () => {
    mockSubmitHnpOffer.mockReset();
    mockGetSessionById.mockResolvedValue(manualBuyerSession("SELLER"));
    mockSubmitHnpOffer.mockResolvedValue({
      ok: true,
      roundId: "round-wait",
      roundNo: 2,
      decision: "AWAITING_COUNTERPART",
      counterPrice: 42_000,
      sessionStatus: "ACTIVE",
      idempotent: false,
      awaitingManualCounterpart: "seller",
      utility: {},
    });

    const envelope = {
      ...ownBuyerEnvelope(),
      force_ai_reply: true,
      skip_ai_reply: false,
      softAiInflightClaim: "seller",
    };
    const result = await runWithMcpActor(buyerActor, () => handler({ envelope }));
    expect(result.isError).not.toBe(true);
    expect(JSON.parse(result.content?.[0]?.text ?? "{}")).toMatchObject({
      protocol: "hnp",
      decision: "AWAITING_COUNTERPART",
      awaiting_manual_counterpart: "seller",
    });
    expect(mockSubmitHnpOffer.mock.calls[0]?.[2]).not.toHaveProperty("softAiInflightClaim");
    expect(mockSubmitHnpOffer.mock.calls[0]?.[2]).not.toHaveProperty("force_ai_reply");
  });

  it("returns isError NOT_YOUR_TURN when submitHnpOffer says the sender is off-turn", async () => {
    mockSubmitHnpOffer.mockReset();
    mockGetSessionById.mockResolvedValue(manualBuyerSession("SELLER"));
    mockSubmitHnpOffer.mockResolvedValue({
      ok: false,
      status: 409,
      body: { error: "NOT_YOUR_TURN" },
    });
    const result = await runWithMcpActor(buyerActor, () =>
      handler({ envelope: ownBuyerEnvelope() }),
    );
    expect(result.isError).toBe(true);
    expect(JSON.parse(result.content?.[0]?.text ?? "{}")).toMatchObject({
      error: "NOT_YOUR_TURN",
      status: 409,
    });
  });
});
