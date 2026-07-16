/**
 * Smoke + validation tests for POST /negotiations/agents/builder/chat-turn.
 *
 * The endpoint delegates to processNegotiationAgentBuilderTurn (a carbon copy
 * of the demo logic). We mock that service to keep this test fast — the
 * production code path is otherwise identical to the demo route, which is
 * covered by intelligence-demo-route.test.ts.
 */

import Fastify from "fastify";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { AuthUser } from "../middleware/auth.js";

vi.mock("@haggle/db", () => ({
  eq: (c: unknown, v: unknown) => ({ __op: "eq", c, v }),
  and: (...c: unknown[]) => ({ __op: "and", c }),
  or: (...c: unknown[]) => ({ __op: "or", c }),
  inArray: (c: unknown, vs: unknown[]) => ({ __op: "inArray", c, vs }),
  sql: (strings: TemplateStringsArray, ...values: unknown[]) => ({
    raw: strings.join("?"),
    values,
  }),
  negotiationAgents: { id: {}, role: {}, isSystem: {}, userId: {} },
}));

const { processMock } = vi.hoisted(() => ({ processMock: vi.fn() }));

vi.mock("../services/negotiation-agent-builder-chat.service.js", async () => {
  const actual = await vi.importActual<
    typeof import("../services/negotiation-agent-builder-chat.service.js")
  >("../services/negotiation-agent-builder-chat.service.js");
  return {
    // Reuse the real body schema so validation logic stays under test.
    negotiationAgentBuilderTurnBodySchema: actual.negotiationAgentBuilderTurnBodySchema,
    processNegotiationAgentBuilderTurn: processMock,
  };
});

import { registerNegotiationAgentRoutes } from "../routes/negotiation-agents.js";

function buildApp(user?: AuthUser) {
  const app = Fastify();
  app.decorateRequest("user", undefined);
  app.addHook("onRequest", async (request) => {
    request.user = user;
  });
  registerNegotiationAgentRoutes(app, {} as unknown as import("@haggle/db").Database);
  return app;
}

const VALID_BODY = {
  agent_id: "hunter",
  message: "I want an iPhone Pro with battery >= 90%, budget $900.",
  previous_memory: {
    categoryInterest: "iPhone",
    mustHave: [],
    avoid: [],
    riskStyle: "balanced",
    negotiationStyle: "balanced",
    openingTactic: "fair_market_anchor",
    questions: [],
    source: [],
  },
  listings: [],
};

beforeEach(() => {
  processMock.mockReset();
});

describe("POST /negotiations/agents/builder/chat-turn", () => {
  it("rejects body without a message", async () => {
    const app = buildApp();
    const res = await app.inject({
      method: "POST",
      url: "/negotiations/agents/builder/chat-turn",
      payload: { ...VALID_BODY, message: "" },
    });
    expect(res.statusCode).toBe(400);
    expect(res.json().error).toBe("INVALID_BODY");
    expect(processMock).not.toHaveBeenCalled();
    await app.close();
  });

  it("accepts anonymous callers (no auth required)", async () => {
    processMock.mockResolvedValueOnce({
      memory: VALID_BODY.previous_memory,
      reply: "ok",
    });
    const app = buildApp();
    const res = await app.inject({
      method: "POST",
      url: "/negotiations/agents/builder/chat-turn",
      payload: VALID_BODY,
    });
    expect(res.statusCode).toBe(200);
    expect(processMock).toHaveBeenCalledTimes(1);
    // user_id stays undefined for guests.
    expect(processMock.mock.calls[0][0].user_id).toBeUndefined();
    expect(res.json().user_id).toBeNull();
    await app.close();
  });

  it("overrides body.user_id with request.user.id when authenticated", async () => {
    processMock.mockResolvedValueOnce({
      memory: VALID_BODY.previous_memory,
      reply: "ok",
    });
    const user: AuthUser = {
      id: "11111111-1111-4111-8111-111111111111",
      email: "u@h.test",
      role: "user",
    };
    const app = buildApp(user);
    const res = await app.inject({
      method: "POST",
      url: "/negotiations/agents/builder/chat-turn",
      payload: {
        ...VALID_BODY,
        user_id: "ffffffff-ffff-4fff-8fff-ffffffffffff", // should be ignored
      },
    });
    expect(res.statusCode).toBe(200);
    expect(processMock.mock.calls[0][0].user_id).toBe(user.id);
    expect(res.json().user_id).toBe(user.id);
    await app.close();
  });

  it("returns 502 with the service error message on failure", async () => {
    processMock.mockRejectedValueOnce(new Error("deepseek timeout"));
    const app = buildApp();
    const res = await app.inject({
      method: "POST",
      url: "/negotiations/agents/builder/chat-turn",
      payload: VALID_BODY,
    });
    expect(res.statusCode).toBe(502);
    expect(res.json()).toMatchObject({
      error: "CHAT_TURN_FAILED",
      message: "The negotiation advisor could not complete its response. Please try again.",
    });
    await app.close();
  });
});
