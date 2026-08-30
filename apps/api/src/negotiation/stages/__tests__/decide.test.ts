import { describe, expect, it, vi } from "vitest";
import { DeepSeekAdapter } from "../../adapters/deepseek-adapter.js";
import { callLLM } from "../../adapters/deepseek-client.js";
import { DEFAULT_BUDDY_DNA } from "../../config.js";
import type { ContextOutput } from "../../pipeline/types.js";
import { DefaultEngineSkill } from "../../skills/default-engine-skill.js";
import type { RefereeBriefing } from "../../skills/skill-types.js";
import type { CoreMemory, OpponentPattern, RefereeCoaching, StageConfig } from "../../types.js";
import { decide } from "../decide.js";

vi.mock("../../adapters/deepseek-client.js", () => ({
  callLLM: vi.fn().mockRejectedValue(new Error("mock llm unavailable")),
}));

const adapter = new DeepSeekAdapter();
const skill = new DefaultEngineSkill();

function makeCoaching(): RefereeCoaching {
  return {
    recommended_price: 87000,
    acceptable_range: { min: 83000, max: 95000 },
    suggested_tactic: "reciprocal_concession",
    hint: "",
    opponent_pattern: "LINEAR",
    convergence_rate: 0.5,
    time_pressure: 0.3,
    utility_snapshot: { u_price: 0.6, u_time: 0.7, u_risk: 0.5, u_quality: 0.5, u_total: 0.6 },
    strategic_hints: [],
    warnings: [],
  };
}

function makeMemory(phase: CoreMemory["session"]["phase"] = "BARGAINING"): CoreMemory {
  return {
    session: {
      session_id: "test-session",
      phase,
      round: 3,
      rounds_remaining: 7,
      role: "buyer",
      max_rounds: 10,
      intervention_mode: "FULL_AUTO",
    },
    boundaries: {
      my_target: 83000,
      my_floor: 95000,
      current_offer: 85000,
      opponent_offer: 90000,
      gap: 5000,
    },
    terms: { active: [], resolved_summary: "" },
    coaching: makeCoaching(),
    buddy_dna: DEFAULT_BUDDY_DNA,
    skill_summary: "electronics-iphone-pro-v1",
  };
}

function makeConfig(): StageConfig {
  return {
    adapters: { UNDERSTAND: adapter, DECIDE: adapter, RESPOND: adapter },
    modes: { RESPOND: "template", VALIDATE: "full" },
    memoEncoding: "codec",
  };
}

function makeBriefing(): RefereeBriefing {
  return {
    opponentPattern: "LINEAR",
    timePressure: 0.3,
    gapTrend: [],
    opponentMoves: [],
    stagnation: false,
    utilitySnapshot: { u_price: 0.6, u_time: 0.7, u_risk: 0.5, u_total: 0.6 },
    warnings: [],
  };
}

function makeContextOutput(): ContextOutput {
  const briefing = makeBriefing();
  return {
    layers: {
      L0_protocol: "protocol",
      L1_model: "model",
      L2_skill: "skill",
      L3_coaching: "coaching",
      L4_history: "",
      L5_signals: "",
    },
    briefing,
    coaching: briefing,
    memo_snapshot: "NS:BARGAINING",
    skills_applied: [],
  };
}

const defaultOpponent: OpponentPattern = {
  aggression: 0.5,
  concession_rate: 0.03,
  preferred_tactics: ["reciprocal_concession"],
  condition_flexibility: 0.5,
  estimated_floor: 88000,
};

describe("Stage 3: decide", () => {
  it("holds without a Faratin fill when OPENING LLM misses and there is no last offer", async () => {
    const memory = makeMemory("OPENING");
    const result = await decide({
      context: makeContextOutput(),
      adapter,
      skill,
      phase: "OPENING",
      config: makeConfig(),
      memory,
      facts: [],
      opponent: defaultOpponent,
    });

    expect(result.source).toBe("skill");
    expect(result.decision.action).toBe("HOLD");
    expect(result.decision.price).toBeUndefined();
    expect(result.reasoning_mode).toBe(false);
  });

  it("uses skill for DISCOVERY phase", async () => {
    const memory = makeMemory("DISCOVERY");
    const result = await decide({
      context: makeContextOutput(),
      adapter,
      skill,
      phase: "DISCOVERY",
      config: makeConfig(),
      memory,
      facts: [],
      opponent: defaultOpponent,
    });

    expect(result.source).toBe("skill");
    expect(result.decision.action).toBe("DISCOVER");
  });

  it("uses skill for CLOSING phase", async () => {
    const memory = makeMemory("CLOSING");
    const result = await decide({
      context: makeContextOutput(),
      adapter,
      skill,
      phase: "CLOSING",
      config: makeConfig(),
      memory,
      facts: [],
      opponent: defaultOpponent,
    });

    expect(result.source).toBe("skill");
    expect(result.decision.action).toBe("CONFIRM");
  });

  it("repeats the standing offer when BARGAINING LLM fails", async () => {
    const memory = makeMemory("BARGAINING");
    const result = await decide({
      context: makeContextOutput(),
      adapter,
      skill,
      phase: "BARGAINING",
      config: makeConfig(),
      memory,
      facts: [],
      opponent: defaultOpponent,
    });

    expect(result.source).toBe("skill");
    expect(result.decision.action).toBe("COUNTER");
    expect(result.decision.price).toBe(85000);
    expect(result.decision.tactic_used).toBe("hold_last");
    expect(result.latency_ms).toBeGreaterThanOrEqual(0);
  });

  it("prefers my_last_offer over current_offer when LLM fails", async () => {
    const memory = makeMemory("BARGAINING");
    memory.boundaries.my_last_offer = 84000;
    const result = await decide({
      context: makeContextOutput(),
      adapter,
      skill,
      phase: "BARGAINING",
      config: makeConfig(),
      memory,
      facts: [],
      opponent: defaultOpponent,
    });

    expect(result.decision.action).toBe("COUNTER");
    expect(result.decision.price).toBe(84000);
    expect(result.decision.tactic_used).toBe("hold_last");
  });

  it("does not fill Faratin when LLM returns an unusable COUNTER", async () => {
    vi.mocked(callLLM).mockResolvedValueOnce({
      content: '{"action":"COUNTER"}',
      usage: { prompt_tokens: 1, completion_tokens: 1 },
      reasoning_used: false,
    });
    const memory = makeMemory("BARGAINING");
    memory.boundaries.my_last_offer = 84000;
    const result = await decide({
      context: makeContextOutput(),
      adapter,
      skill,
      phase: "BARGAINING",
      config: makeConfig(),
      memory,
      facts: [],
      opponent: defaultOpponent,
    });

    expect(result.source).toBe("skill");
    expect(result.decision.action).toBe("COUNTER");
    expect(result.decision.price).toBe(84000);
    expect(result.decision.tactic_used).toBe("hold_last");
  });

  it("encodes skill slots into the system prompt", async () => {
    const memory = makeMemory("BARGAINING");
    const promptAdapter = new DeepSeekAdapter();
    const systemSpy = vi.spyOn(promptAdapter, "buildSystemPrompt");

    await decide({
      context: makeContextOutput(),
      adapter: promptAdapter,
      skill,
      phase: "BARGAINING",
      config: {
        ...makeConfig(),
        adapters: { UNDERSTAND: promptAdapter, DECIDE: promptAdapter, RESPOND: promptAdapter },
      },
      memory,
      facts: [],
      opponent: defaultOpponent,
      skillSlots: {
        knowledge: ["Category: Consumer Electronics"],
        tactics: ["condition_trade"],
      },
    });

    expect(systemSpy).toHaveBeenCalled();
    const skillContext = systemSpy.mock.calls[0]?.[0] ?? "";
    expect(skillContext).toContain("## Skills");
    expect(skillContext).toContain("### Knowledge");
    expect(skillContext).toContain("Category: Consumer Electronics");
    expect(skillContext).toContain("### Tactics");
    expect(skillContext).toContain("condition_trade");
  });

  it("passes Stage 2 L5 signal lines into the LLM prompt", async () => {
    const memory = makeMemory("BARGAINING");
    const promptAdapter = new DeepSeekAdapter();
    const promptSpy = vi.spyOn(promptAdapter, "buildUserPrompt");
    const context = makeContextOutput();
    context.layers.L5_signals = [
      "USER_MEMORY_HINTS:non_authoritative",
      "MEM:pricing:ceiling_70000|strength:0.65",
    ].join("\n");

    await decide({
      context,
      adapter: promptAdapter,
      skill,
      phase: "BARGAINING",
      config: {
        ...makeConfig(),
        adapters: { UNDERSTAND: promptAdapter, DECIDE: promptAdapter, RESPOND: promptAdapter },
      },
      memory,
      facts: [],
      opponent: defaultOpponent,
    });

    expect(promptSpy).toHaveBeenCalled();
    expect(promptSpy.mock.calls[0]?.[2]).toEqual([
      "USER_MEMORY_HINTS:non_authoritative",
      "MEM:pricing:ceiling_70000|strength:0.65",
    ]);
  });

  it("routes a cheap published ask to Flash", async () => {
    vi.mocked(callLLM).mockClear();
    vi.mocked(callLLM).mockResolvedValueOnce({
      content: '{"action":"COUNTER","price":40}',
      usage: {
        prompt_tokens: 1,
        completion_tokens: 1,
        prompt_cache_hit_tokens: 0,
        prompt_cache_miss_tokens: 1,
      },
      reasoning_used: false,
    });
    const memory = makeMemory("BARGAINING");
    memory.listing_context = { published_ask_minor: 4500 };
    await decide({
      context: makeContextOutput(),
      adapter,
      skill,
      phase: "BARGAINING",
      config: makeConfig(),
      memory,
      facts: [],
      opponent: defaultOpponent,
    });
    expect(vi.mocked(callLLM).mock.calls[0]?.[2]).toMatchObject({ model: "deepseek-v4-flash" });
  });

  it("uses the server-set allowed_model on a cheap ask", async () => {
    vi.mocked(callLLM).mockClear();
    vi.mocked(callLLM).mockResolvedValueOnce({
      content: '{"action":"COUNTER","price":40}',
      usage: {
        prompt_tokens: 1,
        completion_tokens: 1,
        prompt_cache_hit_tokens: 0,
        prompt_cache_miss_tokens: 1,
      },
      reasoning_used: false,
    });
    const memory = makeMemory("BARGAINING");
    memory.listing_context = { published_ask_minor: 4500 };
    memory.session.allowed_model = "deepseek-v4-pro";
    await decide({
      context: makeContextOutput(),
      adapter,
      skill,
      phase: "BARGAINING",
      config: makeConfig(),
      memory,
      facts: [],
      opponent: defaultOpponent,
    });
    expect(vi.mocked(callLLM).mock.calls[0]?.[2]).toMatchObject({ model: "deepseek-v4-pro" });
  });

  it("keeps Pro on a cheap ask when pro credit is on", async () => {
    vi.mocked(callLLM).mockClear();
    vi.mocked(callLLM).mockResolvedValueOnce({
      content: '{"action":"COUNTER","price":40}',
      usage: {
        prompt_tokens: 1,
        completion_tokens: 1,
        prompt_cache_hit_tokens: 0,
        prompt_cache_miss_tokens: 1,
      },
      reasoning_used: false,
    });
    const memory = makeMemory("BARGAINING");
    memory.listing_context = { published_ask_minor: 4500 };
    memory.session.pro_model_credit = true;
    await decide({
      context: makeContextOutput(),
      adapter,
      skill,
      phase: "BARGAINING",
      config: makeConfig(),
      memory,
      facts: [],
      opponent: defaultOpponent,
    });
    expect(vi.mocked(callLLM).mock.calls[0]?.[2]).toMatchObject({ model: "deepseek-v4-pro" });
  });

  it("keeps Pro when the published ask is missing", async () => {
    vi.mocked(callLLM).mockClear();
    vi.mocked(callLLM).mockResolvedValueOnce({
      content: '{"action":"COUNTER","price":850}',
      usage: {
        prompt_tokens: 1,
        completion_tokens: 1,
        prompt_cache_hit_tokens: 0,
        prompt_cache_miss_tokens: 1,
      },
      reasoning_used: false,
    });
    const memory = makeMemory("BARGAINING");
    await decide({
      context: makeContextOutput(),
      adapter,
      skill,
      phase: "BARGAINING",
      config: makeConfig(),
      memory,
      facts: [],
      opponent: defaultOpponent,
    });
    expect(vi.mocked(callLLM).mock.calls[0]?.[2]).toMatchObject({ model: "deepseek-v4-pro" });
  });

  it("returns latency_ms", async () => {
    const memory = makeMemory("OPENING");
    const result = await decide({
      context: makeContextOutput(),
      adapter,
      skill,
      phase: "OPENING",
      config: makeConfig(),
      memory,
      facts: [],
      opponent: defaultOpponent,
    });

    expect(typeof result.latency_ms).toBe("number");
  });

  it("auto-accepts when gap is near zero", async () => {
    const memory = makeMemory("BARGAINING");
    memory.boundaries.current_offer = 89900;
    memory.boundaries.opponent_offer = 90000;
    memory.boundaries.gap = 100;

    const result = await decide({
      context: makeContextOutput(),
      adapter,
      skill,
      phase: "BARGAINING",
      config: makeConfig(),
      memory,
      facts: [],
      opponent: defaultOpponent,
    });

    // Near deal → skill should ACCEPT
    expect(result.decision.action).toBe("ACCEPT");
    expect(result.source).toBe("skill");
  });
});
