import { describe, expect, it } from "vitest";
import {
  DEFAULT_NEGOTIATION_AGENT_PRESET_ID,
  NEGOTIATION_AGENT_PRESETS,
  getNegotiationAgentPreset,
  presetToEngineParameters,
} from "../index.js";

const WEIGHT_SUM_TOLERANCE = 1e-6;

describe("NEGOTIATION_AGENT_PRESETS", () => {
  it("ships exactly the four presets — one per dominant 4D axis", () => {
    expect(NEGOTIATION_AGENT_PRESETS.map((p) => p.id)).toEqual([
      "hunter",
      "closer",
      "verifier",
      "balancer",
    ]);
  });

  it("default id resolves to a real preset", () => {
    expect(getNegotiationAgentPreset(DEFAULT_NEGOTIATION_AGENT_PRESET_ID)).toBeDefined();
  });

  it("getNegotiationAgentPreset returns undefined for unknown id", () => {
    expect(getNegotiationAgentPreset("unknown")).toBeUndefined();
  });

  describe.each(NEGOTIATION_AGENT_PRESETS)("preset %s", (preset) => {
    it(`${preset.id}: weights sum to 1.0`, () => {
      const { w_p, w_t, w_r, w_s } = preset.weights;
      const sum = w_p + w_t + w_r + w_s;
      expect(Math.abs(sum - 1)).toBeLessThan(WEIGHT_SUM_TOLERANCE);
    });

    it(`${preset.id}: all weights are non-negative`, () => {
      const { w_p, w_t, w_r, w_s } = preset.weights;
      expect(w_p).toBeGreaterThanOrEqual(0);
      expect(w_t).toBeGreaterThanOrEqual(0);
      expect(w_r).toBeGreaterThanOrEqual(0);
      expect(w_s).toBeGreaterThanOrEqual(0);
    });

    it(`${preset.id}: alpha and beta are in engine envelope [0.3, 3.0]`, () => {
      expect(preset.alpha).toBeGreaterThanOrEqual(0.3);
      expect(preset.alpha).toBeLessThanOrEqual(3.0);
      expect(preset.beta).toBeGreaterThanOrEqual(0.3);
      expect(preset.beta).toBeLessThanOrEqual(3.0);
    });

    it(`${preset.id}: u_threshold and u_aspiration are in [0.3, 0.85]`, () => {
      expect(preset.u_threshold).toBeGreaterThanOrEqual(0.3);
      expect(preset.u_threshold).toBeLessThanOrEqual(0.85);
      expect(preset.u_aspiration).toBeGreaterThanOrEqual(0.3);
      expect(preset.u_aspiration).toBeLessThanOrEqual(0.85);
    });

    it(`${preset.id}: u_aspiration > u_threshold`, () => {
      expect(preset.u_aspiration).toBeGreaterThan(preset.u_threshold);
    });

    it(`${preset.id}: tier-3 sub-params are within their envelopes`, () => {
      expect(preset.anchor_ratio).toBeGreaterThanOrEqual(0);
      expect(preset.anchor_ratio).toBeLessThanOrEqual(1);
      expect(preset.v_t_floor).toBeGreaterThanOrEqual(0);
      expect(preset.v_t_floor).toBeLessThanOrEqual(1);
      expect(preset.w_rep).toBeGreaterThanOrEqual(0);
      expect(preset.w_rep).toBeLessThanOrEqual(1);
      expect(preset.r_score_minimum).toBeGreaterThanOrEqual(0);
      expect(preset.r_score_minimum).toBeLessThanOrEqual(1);
      expect(preset.i_completeness_minimum).toBeGreaterThanOrEqual(0);
      expect(preset.i_completeness_minimum).toBeLessThanOrEqual(1);
      expect(preset.v_s_base).toBeGreaterThanOrEqual(0);
      expect(preset.v_s_base).toBeLessThanOrEqual(1);
      expect(Number.isInteger(preset.n_threshold)).toBe(true);
      expect(preset.n_threshold).toBeGreaterThanOrEqual(5);
      expect(preset.n_threshold).toBeLessThanOrEqual(15);
      expect(preset.late_round_aggression_modifier).toBeGreaterThanOrEqual(0.5);
      expect(preset.late_round_aggression_modifier).toBeLessThanOrEqual(1.5);
    });

    it(`${preset.id}: has both buyer and seller copy`, () => {
      expect(preset.copy.buyer.name.length).toBeGreaterThan(0);
      expect(preset.copy.buyer.nameKo.length).toBeGreaterThan(0);
      expect(preset.copy.seller.name.length).toBeGreaterThan(0);
      expect(preset.copy.seller.nameKo.length).toBeGreaterThan(0);
    });
  });

  it("hunter emphasizes price", () => {
    const hunter = getNegotiationAgentPreset("hunter")!;
    expect(hunter.weights.w_p).toBeGreaterThan(hunter.weights.w_t);
    expect(hunter.weights.w_p).toBeGreaterThan(hunter.weights.w_r);
    expect(hunter.weights.w_p).toBeGreaterThan(hunter.weights.w_s);
  });

  it("closer emphasizes time", () => {
    const closer = getNegotiationAgentPreset("closer")!;
    expect(closer.weights.w_t).toBeGreaterThan(closer.weights.w_p);
    expect(closer.weights.w_t).toBeGreaterThan(closer.weights.w_r);
    expect(closer.weights.w_t).toBeGreaterThan(closer.weights.w_s);
  });

  it("verifier emphasizes risk", () => {
    const verifier = getNegotiationAgentPreset("verifier")!;
    expect(verifier.weights.w_r).toBeGreaterThan(verifier.weights.w_p);
    expect(verifier.weights.w_r).toBeGreaterThan(verifier.weights.w_t);
    expect(verifier.weights.w_r).toBeGreaterThan(verifier.weights.w_s);
  });

  it("balancer is closer to flat than the others", () => {
    const balancer = getNegotiationAgentPreset("balancer")!;
    const w = balancer.weights;
    const max = Math.max(w.w_p, w.w_t, w.w_r, w.w_s);
    const min = Math.min(w.w_p, w.w_t, w.w_r, w.w_s);
    expect(max - min).toBeLessThan(0.2);
  });
});

describe("presetToEngineParameters", () => {
  it("preserves preset-specified knobs verbatim", () => {
    const hunter = getNegotiationAgentPreset("hunter")!;
    const params = presetToEngineParameters(hunter);
    expect(params.weights).toEqual(hunter.weights);
    expect(params.alpha).toBe(hunter.alpha);
    expect(params.beta).toBe(hunter.beta);
    expect(params.u_threshold).toBe(hunter.u_threshold);
    expect(params.u_aspiration).toBe(hunter.u_aspiration);
  });

  it("returns a fresh weights object (no shared reference)", () => {
    const hunter = getNegotiationAgentPreset("hunter")!;
    const params = presetToEngineParameters(hunter);
    expect(params.weights).not.toBe(hunter.weights);
  });

  it("populates all 17 EngineParameters fields", () => {
    const params = presetToEngineParameters(getNegotiationAgentPreset("balancer")!);
    const expectedKeys = [
      "weights",
      "anchor_ratio",
      "alpha",
      "beta",
      "v_t_floor",
      "u_threshold",
      "u_aspiration",
      "gamma",
      "market_utilization",
      "cross_pressure_sensitivity",
      "w_rep",
      "w_info",
      "r_score_minimum",
      "i_completeness_minimum",
      "v_s_base",
      "n_threshold",
      "late_round_aggression_modifier",
    ];
    for (const key of expectedKeys) {
      expect(params).toHaveProperty(key);
    }
  });

  it("produces w_info derived as 1 - w_rep for every preset", () => {
    for (const preset of NEGOTIATION_AGENT_PRESETS) {
      const params = presetToEngineParameters(preset);
      expect(Math.abs(params.w_rep + params.w_info - 1)).toBeLessThan(
        WEIGHT_SUM_TOLERANCE,
      );
      expect(params.w_rep).toBe(preset.w_rep);
    }
  });

  it("propagates tier-3 sub-params verbatim", () => {
    const verifier = getNegotiationAgentPreset("verifier")!;
    const params = presetToEngineParameters(verifier);
    expect(params.anchor_ratio).toBe(verifier.anchor_ratio);
    expect(params.v_t_floor).toBe(verifier.v_t_floor);
    expect(params.r_score_minimum).toBe(verifier.r_score_minimum);
    expect(params.i_completeness_minimum).toBe(verifier.i_completeness_minimum);
    expect(params.v_s_base).toBe(verifier.v_s_base);
    expect(params.n_threshold).toBe(verifier.n_threshold);
    expect(params.late_round_aggression_modifier).toBe(
      verifier.late_round_aggression_modifier,
    );
  });

  it("market-awareness fields stay neutral across all presets", () => {
    for (const preset of NEGOTIATION_AGENT_PRESETS) {
      const params = presetToEngineParameters(preset);
      expect(params.gamma).toBe(0.1);
      expect(params.market_utilization).toBe(0.5);
      expect(params.cross_pressure_sensitivity).toBe(0.5);
    }
  });
});
