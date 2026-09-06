import { describe, expect, it } from "vitest";
import { getNegotiationAgentPreset } from "../../agent-presets/negotiation-agent-presets.js";
import type { NegotiationAgent } from "../../agent-stats/types.js";
import {
  builderStateFromAgentRow,
  createBuilderState,
  isBuilderCustomized,
  resolveEffectivePreset,
} from "../index.js";

describe("chosen avatar on the builder state", () => {
  it("defaults to the preset's own animal", () => {
    const state = createBuilderState({ side: "buyer", presetId: "verifier" });
    expect(resolveEffectivePreset(state).emoji).toBe(getNegotiationAgentPreset("verifier")?.emoji);
  });

  it("overrides the preset's animal on the effective preset", () => {
    const state = createBuilderState({ side: "buyer", presetId: "hunter" });
    const chosen = { ...state, agent: { ...state.agent, emoji: "panda" } };
    expect(resolveEffectivePreset(chosen).emoji).toBe("panda");
    // Only the face changed — the strategy numbers are still the preset's.
    expect(resolveEffectivePreset(chosen).beta).toBe(getNegotiationAgentPreset("hunter")?.beta);
  });

  it("is identity, not strategy: a chosen face does not make the agent customized", () => {
    const state = createBuilderState({ side: "seller", presetId: "closer" });
    expect(isBuilderCustomized({ ...state, agent: { ...state.agent, emoji: "owl" } })).toBe(false);
  });

  it("round-trips through a saved row", () => {
    const row: NegotiationAgent = {
      id: "a1",
      name: "Careful checker",
      role: "buyer",
      emoji: "raccoon",
      negotiationAgentPresetId: "verifier",
      createdAt: 1_757_030_400_000,
      updatedAt: 1_757_030_400_000,
    };
    const state = builderStateFromAgentRow(row, "buyer");
    expect(state.agent.emoji).toBe("raccoon");
    expect(resolveEffectivePreset(state).emoji).toBe("raccoon");
  });
});
