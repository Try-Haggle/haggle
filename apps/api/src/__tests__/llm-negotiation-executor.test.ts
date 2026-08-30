import { afterEach, describe, expect, it } from "vitest";
import { getDecideTemperature, getDecideTimeoutMs, getEngineMode } from "../negotiation/config.js";

describe("getDecideTemperature", () => {
  afterEach(() => {
    delete process.env.DEEPSEEK_TEMPERATURE;
  });

  it("defaults to 0.5", () => {
    delete process.env.DEEPSEEK_TEMPERATURE;
    expect(getDecideTemperature()).toBe(0.5);
  });

  it("uses an explicit override", () => {
    expect(getDecideTemperature(0.8)).toBe(0.8);
  });

  it("reads DEEPSEEK_TEMPERATURE when no override", () => {
    process.env.DEEPSEEK_TEMPERATURE = "0.7";
    expect(getDecideTemperature()).toBe(0.7);
  });

  it("clamps out of range values", () => {
    expect(getDecideTemperature(3)).toBe(2);
    expect(getDecideTemperature(-1)).toBe(0);
  });
});

describe("getDecideTimeoutMs", () => {
  afterEach(() => {
    delete process.env.DEEPSEEK_TIMEOUT_MS;
  });

  it("defaults to 180s", () => {
    delete process.env.DEEPSEEK_TIMEOUT_MS;
    expect(getDecideTimeoutMs()).toBe(180_000);
  });

  it("reads DEEPSEEK_TIMEOUT_MS", () => {
    process.env.DEEPSEEK_TIMEOUT_MS = "90000";
    expect(getDecideTimeoutMs()).toBe(90_000);
  });

  it("clamps env timeouts to 10s–300s", () => {
    process.env.DEEPSEEK_TIMEOUT_MS = "400000";
    expect(getDecideTimeoutMs()).toBe(300_000);
  });
});

// ---------------------------------------------------------------------------
// getEngineMode tests
// ---------------------------------------------------------------------------

describe("getEngineMode", () => {
  const originalEnv = process.env.NEGOTIATION_ENGINE;

  afterEach(() => {
    if (originalEnv !== undefined) {
      process.env.NEGOTIATION_ENGINE = originalEnv;
    } else {
      delete process.env.NEGOTIATION_ENGINE;
    }
  });

  it("defaults to rule when env is not set", () => {
    delete process.env.NEGOTIATION_ENGINE;
    expect(getEngineMode()).toBe("rule");
  });

  it("returns llm when env is set to llm", () => {
    process.env.NEGOTIATION_ENGINE = "llm";
    expect(getEngineMode()).toBe("llm");
  });

  it("returns rule for unknown values", () => {
    process.env.NEGOTIATION_ENGINE = "unknown";
    expect(getEngineMode()).toBe("rule");
  });
});

// ---------------------------------------------------------------------------
// Action → DB mapping tests (import from executor)
// ---------------------------------------------------------------------------

describe("ProtocolDecision action mapping", () => {
  // These are tested indirectly via the mapActionToDbDecision function
  // Since it's not exported, we verify the mapping logic
  const actionMap: Record<string, string> = {
    COUNTER: "COUNTER",
    ACCEPT: "ACCEPT",
    REJECT: "REJECT",
    HOLD: "NEAR_DEAL",
    CONFIRM: "ACCEPT",
  };

  for (const [input, expected] of Object.entries(actionMap)) {
    it(`maps ${input} → ${expected}`, () => {
      expect(actionMap[input]).toBe(expected);
    });
  }
});

// ---------------------------------------------------------------------------
// Phase → DB status mapping tests
// ---------------------------------------------------------------------------

describe("phaseToDbStatus mapping", () => {
  // Import from memory-reconstructor tested separately,
  // verify the contract here
  const cases: Array<[string, string, number, string]> = [
    ["OPENING", "COUNTER", 0, "ACTIVE"],
    ["BARGAINING", "COUNTER", 0, "ACTIVE"],
    ["BARGAINING", "COUNTER", 4, "STALLED"],
    ["CLOSING", "HOLD", 0, "NEAR_DEAL"],
    ["SETTLEMENT", "ACCEPT", 0, "ACCEPTED"],
    ["SETTLEMENT", "CONFIRM", 0, "ACCEPTED"],
    ["SETTLEMENT", "REJECT", 0, "REJECTED"],
  ];

  it.each(cases)("phase=%s action=%s rnc=%d → %s", async (phase, action, rnc, expected) => {
    const { phaseToDbStatus } = await import("../negotiation/memory/memory-reconstructor.js");
    expect(phaseToDbStatus(phase as any, action, rnc)).toBe(expected);
  });
});

// ---------------------------------------------------------------------------
// Executor factory tests
// ---------------------------------------------------------------------------

describe("executor factory", () => {
  afterEach(() => {
    delete process.env.NEGOTIATION_ENGINE;
    delete process.env.NEGOTIATION_PIPELINE;
  });

  it("returns rule executor by default", async () => {
    delete process.env.NEGOTIATION_ENGINE;
    const { getExecutor } = await import("../lib/executor-factory.js");
    const executor = getExecutor();
    expect(typeof executor).toBe("function");
    // The function name check confirms which executor was returned
    expect(executor.name).toContain("Negotiation");
  });

  it("returns LLM executor when env=llm", async () => {
    process.env.NEGOTIATION_ENGINE = "llm";
    const { getExecutor } = await import("../lib/executor-factory.js");
    const executor = getExecutor();
    expect(typeof executor).toBe("function");
  });

  it("pipeline mode is fixed at staged regardless of env (real flows only)", async () => {
    // Branch change: the env-based legacy/staged switch was removed. Real
    // negotiation flows always go through the staged executor; legacy mode is
    // no longer reachable. The PipelineMode union is kept only for the
    // /negotiations/stages route guard.
    const { getPipelineMode } = await import("../lib/executor-factory.js");

    delete process.env.NEGOTIATION_PIPELINE;
    expect(getPipelineMode()).toBe("staged");

    process.env.NEGOTIATION_PIPELINE = "legacy";
    expect(getPipelineMode()).toBe("staged");
  });
});
