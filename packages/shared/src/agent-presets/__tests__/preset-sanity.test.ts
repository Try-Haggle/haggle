/**
 * §4-5 검증 — 4 NEGOTIATION_AGENT_PRESETS produce *differentiated* outcomes when
 * driven through the engine-core utility/decision/Faratin functions.
 *
 * Same scenario in → 4 visibly different decisions/counter-offers out. If
 * this test ever goes flat (all four produce identical numbers), the preset
 * data is no longer differentiated and the UI is showing fake variety.
 */

import {
  computeCounterOffer,
  computeUtility,
  type DecisionAction,
  makeDecision,
  type NegotiationContext,
} from "@haggle/engine-core";
import { describe, expect, it } from "vitest";
import {
  getNegotiationAgentPreset,
  NEGOTIATION_AGENT_PRESETS,
  type NegotiationAgentPreset,
  presetToEngineParameters,
} from "../../index.js";

/** Scenario: seller listing $1000 target, $1500 walk-away ceiling, buyer
 *  offered $1200 at the 12-hour mark of a 24-hour deadline. Trust + info
 *  signals moderate. */
function makeContext(preset: NegotiationAgentPreset): NegotiationContext {
  const params = presetToEngineParameters(preset);
  return {
    weights: params.weights,
    price: {
      p_effective: 1200,
      p_target: 1000,
      p_limit: 1500,
    },
    time: {
      t_elapsed: 12 * 3600 * 1000,
      t_deadline: 24 * 3600 * 1000,
      alpha: params.alpha,
      v_t_floor: params.v_t_floor,
    },
    risk: {
      r_score: 0.6,
      i_completeness: 0.5,
      w_rep: params.w_rep,
      w_info: params.w_info,
    },
    relationship: {
      n_success: 0,
      n_dispute_losses: 0,
      n_threshold: params.n_threshold,
      v_s_base: params.v_s_base,
    },
  };
}

function decisionFor(preset: NegotiationAgentPreset): {
  utility: ReturnType<typeof computeUtility>;
  decision: ReturnType<typeof makeDecision>;
} {
  const ctx = makeContext(preset);
  const utility = computeUtility(ctx);
  const params = presetToEngineParameters(preset);
  const decision = makeDecision(
    utility,
    {
      u_aspiration: params.u_aspiration,
      u_threshold: params.u_threshold,
    },
    { rounds_no_concession: 0 },
  );
  return { utility, decision };
}

describe("Preset Sanity — 4 presets differ in engine outcomes", () => {
  it("u_total differs across all four presets (no two identical)", () => {
    const utilities = NEGOTIATION_AGENT_PRESETS.map((p) =>
      decisionFor(p).utility.u_total.toFixed(4),
    );
    const unique = new Set(utilities);
    expect(unique.size).toBe(NEGOTIATION_AGENT_PRESETS.length);
  });

  it("Hunter resists time pressure (high v_t) more than Closer", () => {
    const hunter = decisionFor(getNegotiationAgentPreset("hunter")!);
    const closer = decisionFor(getNegotiationAgentPreset("closer")!);
    // Hunter has alpha=0.5 (calm under deadline) and v_t_floor=0.7 (holds firm).
    // Closer has alpha=2.0 (anxious) and v_t_floor=0.3 (crumbles).
    // At t=12h of 24h, Hunter's v_t should stay high while Closer's drops.
    expect(hunter.utility.v_t).toBeGreaterThan(closer.utility.v_t);
  });

  it("Hunter is strictly pickier than Closer (higher u_threshold)", () => {
    const hunter = presetToEngineParameters(getNegotiationAgentPreset("hunter")!);
    const closer = presetToEngineParameters(getNegotiationAgentPreset("closer")!);
    expect(hunter.u_threshold).toBeGreaterThan(closer.u_threshold);
    expect(hunter.u_aspiration).toBeGreaterThan(closer.u_aspiration);
  });

  it("Closer reaches counter-offer closer to walk-away faster than Hunter (beta)", () => {
    const hunterCounter = computeCounterOffer({
      p_start: 1000,
      p_limit: 1500,
      t: 12 * 3600 * 1000,
      T: 24 * 3600 * 1000,
      beta: getNegotiationAgentPreset("hunter")!.beta,
    });
    const closerCounter = computeCounterOffer({
      p_start: 1000,
      p_limit: 1500,
      t: 12 * 3600 * 1000,
      T: 24 * 3600 * 1000,
      beta: getNegotiationAgentPreset("closer")!.beta,
    });
    // At the midpoint, Hunter (beta=0.4, slow) should still be near p_start;
    // Closer (beta=2.0, conceder) should be closer to p_limit.
    expect(hunterCounter).toBeLessThan(closerCounter);
  });

  it("Verifier requires more trust than Closer (r_score_minimum)", () => {
    const verifier = presetToEngineParameters(getNegotiationAgentPreset("verifier")!);
    const closer = presetToEngineParameters(getNegotiationAgentPreset("closer")!);
    expect(verifier.r_score_minimum).toBeGreaterThan(closer.r_score_minimum);
    expect(verifier.i_completeness_minimum).toBeGreaterThan(closer.i_completeness_minimum);
  });

  it("u_aspiration ordering matches preset intent", () => {
    const u_asp = (id: string) =>
      presetToEngineParameters(getNegotiationAgentPreset(id)!).u_aspiration;
    // Verifier most demanding to ACCEPT, Closer most lenient.
    expect(u_asp("verifier")).toBeGreaterThan(u_asp("hunter"));
    expect(u_asp("hunter")).toBeGreaterThan(u_asp("balancer"));
    expect(u_asp("balancer")).toBeGreaterThan(u_asp("closer"));
  });

  it("Decision actions are sane (no preset crashes or returns nonsense)", () => {
    const validActions: DecisionAction[] = ["ACCEPT", "COUNTER", "REJECT", "NEAR_DEAL", "ESCALATE"];
    for (const preset of NEGOTIATION_AGENT_PRESETS) {
      const { decision } = decisionFor(preset);
      expect(validActions).toContain(decision.action);
    }
  });

  it("scenario summary — humans can eyeball the differences", () => {
    // Logged for manual review when running with --reporter=verbose.
    const summary = NEGOTIATION_AGENT_PRESETS.map((p) => {
      const { utility, decision } = decisionFor(p);
      return {
        preset: p.id,
        u_total: Number(utility.u_total.toFixed(3)),
        v_p: Number(utility.v_p.toFixed(3)),
        v_t: Number(utility.v_t.toFixed(3)),
        decision: decision.action,
      };
    });
    // Just assert it ran — actual values printed via console for inspection.
    expect(summary).toHaveLength(4);
    // Keep this around for `vitest --reporter=verbose` debugging.
    // eslint-disable-next-line no-console
    console.table(summary);
  });
});
