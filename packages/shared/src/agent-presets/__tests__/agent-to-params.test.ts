import { describe, expect, it } from "vitest";
import {
  AGENT_PRESETS,
  type EngineStats,
  getNegotiationAgentPreset,
  type NegotiationAgent,
  presetToEngineParameters,
  resolveAgentToEngineParameters,
} from "../../index.js";

const NOW = 1_700_000_000_000;

function makeBaseAgent(extra: Partial<NegotiationAgent> = {}): NegotiationAgent {
  return {
    id: "test-1",
    name: "Test",
    createdAt: NOW,
    updatedAt: NOW,
    ...extra,
  };
}

const FLAT_STATS: EngineStats = {
  anchoring: 50,
  tenacity: 50,
  resolve: 50,
  market_sense: 50,
  risk_radar: 50,
  scrutiny: 50,
  patience: 50,
  rapport: 50,
};

describe("resolveAgentToEngineParameters", () => {
  describe("new 4D-weight path", () => {
    it("resolves a preset-only agent to the preset's parameters", () => {
      const agent = makeBaseAgent({ negotiationAgentPresetId: "hunter" });
      const params = resolveAgentToEngineParameters(agent);
      const expected = presetToEngineParameters(getNegotiationAgentPreset("hunter")!);
      expect(params).toEqual(expected);
    });

    it("top-level weights override the preset's weights", () => {
      const agent = makeBaseAgent({
        negotiationAgentPresetId: "hunter",
        weights: { w_p: 0.25, w_t: 0.25, w_r: 0.25, w_s: 0.25 },
      });
      const params = resolveAgentToEngineParameters(agent)!;
      expect(params.weights).toEqual({
        w_p: 0.25,
        w_t: 0.25,
        w_r: 0.25,
        w_s: 0.25,
      });
      // alpha/beta still come from the preset
      const hunter = getNegotiationAgentPreset("hunter")!;
      expect(params.alpha).toBe(hunter.alpha);
      expect(params.beta).toBe(hunter.beta);
    });

    it("engineParams partial overrides individual knobs", () => {
      const agent = makeBaseAgent({
        negotiationAgentPresetId: "balancer",
        engineParams: { alpha: 2.5, u_threshold: 0.6 },
      });
      const params = resolveAgentToEngineParameters(agent)!;
      const balancer = getNegotiationAgentPreset("balancer")!;
      expect(params.alpha).toBe(2.5);
      expect(params.u_threshold).toBe(0.6);
      // beta is not overridden
      expect(params.beta).toBe(balancer.beta);
      // weights still from preset
      expect(params.weights).toEqual(balancer.weights);
    });

    it("agent with weights only (no preset id) falls back to default preset for non-weight knobs", () => {
      const agent = makeBaseAgent({
        weights: { w_p: 0.4, w_t: 0.3, w_r: 0.2, w_s: 0.1 },
      });
      const params = resolveAgentToEngineParameters(agent)!;
      const fallback = getNegotiationAgentPreset("balancer")!;
      expect(params.weights).toEqual({
        w_p: 0.4,
        w_t: 0.3,
        w_r: 0.2,
        w_s: 0.1,
      });
      expect(params.alpha).toBe(fallback.alpha);
      expect(params.beta).toBe(fallback.beta);
    });

    it("explicit fallbackPresetId option is honored", () => {
      const agent = makeBaseAgent({
        weights: { w_p: 0.4, w_t: 0.3, w_r: 0.2, w_s: 0.1 },
      });
      const params = resolveAgentToEngineParameters(agent, {
        fallbackPresetId: "closer",
      })!;
      const closer = getNegotiationAgentPreset("closer")!;
      expect(params.alpha).toBe(closer.alpha);
      expect(params.beta).toBe(closer.beta);
    });

    it("returns a fresh weights object (no shared reference with preset)", () => {
      const agent = makeBaseAgent({ negotiationAgentPresetId: "hunter" });
      const params = resolveAgentToEngineParameters(agent)!;
      const hunter = getNegotiationAgentPreset("hunter")!;
      expect(params.weights).not.toBe(hunter.weights);
    });
  });

  describe("legacy 8-stat path", () => {
    it("resolves a stats-only agent via statsToParameters", () => {
      const agent = makeBaseAgent({ stats: FLAT_STATS });
      const params = resolveAgentToEngineParameters(agent)!;
      // Flat stats → balanced derived weights (all close to 0.25)
      const sum = Object.values(params.weights).reduce((s, v) => s + v, 0);
      expect(Math.abs(sum - 1)).toBeLessThan(1e-6);
    });

    it("an agent migrated from the 6-animal presets resolves cleanly", () => {
      const tigerStats = AGENT_PRESETS[0].stats;
      const agent = makeBaseAgent({
        basePresetId: "tiger",
        stats: tigerStats,
      });
      const params = resolveAgentToEngineParameters(agent)!;
      // Tiger anchors hard → high w_p
      expect(params.weights.w_p).toBeGreaterThan(0.3);
    });
  });

  describe("precedence between paths", () => {
    it("new flow wins when both are present", () => {
      const agent = makeBaseAgent({
        stats: FLAT_STATS,
        negotiationAgentPresetId: "hunter",
      });
      const params = resolveAgentToEngineParameters(agent)!;
      const hunter = getNegotiationAgentPreset("hunter")!;
      expect(params.weights).toEqual(hunter.weights);
    });
  });

  describe("empty agent", () => {
    it("returns null when neither stats nor new-flow fields are set", () => {
      const agent = makeBaseAgent();
      expect(resolveAgentToEngineParameters(agent)).toBeNull();
    });
  });
});
