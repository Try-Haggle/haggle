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

describe("chosen accent on the builder state", () => {
  it("defaults to the preset's own colour", () => {
    const state = createBuilderState({ side: "seller", presetId: "hunter" });
    expect(resolveEffectivePreset(state).accentColor).toBe(
      getNegotiationAgentPreset("hunter")?.accentColor,
    );
  });

  it("overrides the preset's colour, normalized", () => {
    const state = createBuilderState({ side: "seller", presetId: "hunter" });
    const chosen = { ...state, agent: { ...state.agent, accentColor: "#6366F1" } };
    expect(resolveEffectivePreset(chosen).accentColor).toBe("#6366f1");
  });

  it("never lets an unusable stored value replace the preset colour", () => {
    const state = createBuilderState({ side: "buyer", presetId: "verifier" });
    const bad = { ...state, agent: { ...state.agent, accentColor: "blue-ish" } };
    expect(resolveEffectivePreset(bad).accentColor).toBe(
      getNegotiationAgentPreset("verifier")?.accentColor,
    );
  });

  it("is identity, not strategy", () => {
    const state = createBuilderState({ side: "buyer", presetId: "closer" });
    expect(
      isBuilderCustomized({ ...state, agent: { ...state.agent, accentColor: "#ec4899" } }),
    ).toBe(false);
  });

  it("round-trips through a saved row", () => {
    const row: NegotiationAgent = {
      id: "a2",
      name: "Pink closer",
      role: "seller",
      accentColor: "#ec4899",
      negotiationAgentPresetId: "closer",
      createdAt: 1_757_030_400_000,
      updatedAt: 1_757_030_400_000,
    };
    const state = builderStateFromAgentRow(row, "seller");
    expect(resolveEffectivePreset(state).accentColor).toBe("#ec4899");
  });
});
