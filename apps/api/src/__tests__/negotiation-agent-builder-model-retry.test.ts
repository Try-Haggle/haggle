import { beforeEach, describe, expect, it, vi } from "vitest";

const { callLLMMock } = vi.hoisted(() => ({ callLLMMock: vi.fn() }));
vi.mock("../negotiation/adapters/deepseek-client.js", () => ({ callLLM: callLLMMock }));

import {
  negotiationAgentBuilderTurnBodySchema,
  processNegotiationAgentBuilderTurn,
} from "../services/negotiation-agent-builder-chat.service.js";

const memory = {
  categoryInterest: "iPhone 15 Pro",
  mustHave: [],
  avoid: [],
  riskStyle: "balanced",
  negotiationStyle: "balanced",
  openingTactic: "fair_market_anchor",
  questions: [],
  source: [],
  targetPrice: 680,
  budgetMax: 850,
};

const input = negotiationAgentBuilderTurnBodySchema.parse({
  agent_id: "bargain-hunter",
  message: "My target is $680 and my maximum is $850.",
  previous_memory: { ...memory, targetPrice: undefined, budgetMax: undefined },
  listings: [
    {
      id: "iphone-15-pro",
      title: "iPhone 15 Pro",
      category: "electronics",
      condition: "good",
      askPriceMinor: 85000,
      floorPriceMinor: 68000,
      marketMedianMinor: 85000,
      tags: ["iphone"],
    },
  ],
});

function modelResponse(content: string, finish_reason = "stop") {
  return {
    content,
    finish_reason,
    usage: { prompt_tokens: 100, completion_tokens: 50 },
    reasoning_used: false,
  };
}

const validResponse = modelResponse(
  JSON.stringify({
    memory,
    reply: "I'll aim for $680 and stay under $850.",
    reasoning_summary: "",
  }),
);

beforeEach(() => callLLMMock.mockReset());

describe("builder model output recovery", () => {
  it.each([
    { pendingSlots: ["battery_health", "carrier_unlock", "imei", "box", "condition"] },
    { globalPreferences: { budgetMax: "unknown" } },
    null,
  ])("rebuilds malformed optional structured memory without retrying the model", async (structured) => {
    callLLMMock.mockResolvedValueOnce(
      modelResponse(
        JSON.stringify({
          memory: { ...memory, structured },
          reply: "I'll aim for $680 and stay under $850.",
        }),
      ),
    );

    const result = await processNegotiationAgentBuilderTurn(input);

    expect(callLLMMock).toHaveBeenCalledTimes(1);
    expect(result.memory).toMatchObject({ targetPrice: 680, budgetMax: 850 });
    expect(result.memory.structured?.globalPreferences).toMatchObject({
      targetPrice: 680,
      budgetMax: 850,
    });
    expect(result.memory.structured?.pendingSlots.length).toBeGreaterThan(0);
    for (const slot of result.memory.structured?.pendingSlots ?? []) {
      expect(slot).toMatchObject({
        slotId: expect.any(String),
        question: expect.any(String),
        status: "pending",
      });
    }
    // The server-built result remains valid as input to the next turn.
    expect(
      negotiationAgentBuilderTurnBodySchema.safeParse({ ...input, previous_memory: result.memory })
        .success,
    ).toBe(true);
  });

  it("keeps previous scope decisions when discarding a malformed model scratchpad", async () => {
    const decision = {
      slotId: "battery",
      sourceScope: "iphone",
      targetScope: "galaxy",
      decision: "rejected" as const,
    };
    const previousInput = negotiationAgentBuilderTurnBodySchema.parse({
      ...input,
      previous_memory: {
        ...input.previous_memory,
        structured: { scopedConditionDecisions: [decision] },
      },
    });
    callLLMMock.mockResolvedValueOnce(
      modelResponse(
        JSON.stringify({
          memory: { ...memory, structured: { pendingSlots: ["imei"] } },
          reply: "I'll aim for $680 and stay under $850.",
        }),
      ),
    );

    const result = await processNegotiationAgentBuilderTurn(previousInput);

    expect(result.memory.structured?.scopedConditionDecisions).toContainEqual(decision);
  });

  it("still rejects malformed structured memory supplied by a caller", () => {
    expect(
      negotiationAgentBuilderTurnBodySchema.safeParse({
        ...input,
        previous_memory: { ...memory, structured: { pendingSlots: ["imei"] } },
      }).success,
    ).toBe(false);
  });

  it.each([
    modelResponse("{incomplete"),
    modelResponse("", "length"),
    modelResponse(JSON.stringify({ reply: "missing memory" })),
  ])("retries an unusable model response once and keeps the buyer's budget", async (first) => {
    callLLMMock.mockResolvedValueOnce(first).mockResolvedValueOnce(validResponse);

    const result = await processNegotiationAgentBuilderTurn(input);

    expect(callLLMMock).toHaveBeenCalledTimes(2);
    expect(result.memory.targetPrice).toBe(680);
    expect(result.memory.budgetMax).toBe(850);
    expect(result.reply).toContain("$680");
    expect(result.turn_cost.tokens).toMatchObject({ prompt: 200, completion: 100 });
  });

  it("stops after two unusable outputs", async () => {
    callLLMMock.mockResolvedValue(modelResponse("{incomplete"));

    await expect(processNegotiationAgentBuilderTurn(input)).rejects.toThrow();
    expect(callLLMMock).toHaveBeenCalledTimes(2);
  });

  it("does not repeat a transport failure already handled by the model client", async () => {
    callLLMMock.mockRejectedValueOnce(new Error("DeepSeek API error 401"));

    await expect(processNegotiationAgentBuilderTurn(input)).rejects.toThrow(
      "DeepSeek API error 401",
    );
    expect(callLLMMock).toHaveBeenCalledTimes(1);
  });
});
