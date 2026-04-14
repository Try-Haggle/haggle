/**
 * HaggleEngineSkill — Default free Skill wrapping engine-core math functions.
 *
 * Provides:
 * - computeUtility (4D: price/time/risk/quality) → briefing + decide hooks
 * - computeCounterOffer (Faratin concession curve) → decide hook
 * - makeDecision (utility → action mapping) → decide hook
 * - Rule-based fallback moves → generateMove (when LLM fails)
 *
 * This is the free "Haggle 기본 엔진" that every user gets.
 * Principle: engine-core 순수 수학 함수들을 Skill v2로 캡슐화.
 */

import {
  computeUtility,
  makeDecision,
  computeCounterOffer,
  type NegotiationContext,
  type UtilityResult,
  type DecisionAction,
} from "@haggle/engine-core";
import { assembleContext } from "@haggle/engine-session";

import type {
  SkillManifest,
  SkillRuntime,
  HookContext,
  HookResult,
} from "./skill-types.js";
import type {
  CoreMemory,
  RoundFact,
  OpponentPattern,
  NegotiationPhase,
  ProtocolDecision,
} from "../types.js";

const manifest: SkillManifest = {
  id: "haggle-engine-v1",
  version: "1.0.0",
  type: "composite",
  name: "Haggle Engine",
  description:
    "Default negotiation engine: 4D utility computation, Faratin concession curves, and rule-based decision making. Free for all Haggle users.",
  categoryTags: ["*"], // applies to all categories
  hooks: ["context", "decide"],
  pricing: { model: "free" },
  verification: {
    status: "haggle_verified",
    verifiedAt: "2026-04-14",
    verifiedBy: "haggle-core",
    securityAudit: true,
  },
};

// ─── Utility Helper ───────────────────────────────────────────────────

/**
 * Compute 4D utility using engine-core's real computeUtility.
 * Maps CoreMemory fields to NegotiationContext.
 */
function compute4DUtility(memory: CoreMemory): UtilityResult | null {
  try {
    const { session, boundaries } = memory;
    const strategy = memory.strategy;
    if (!strategy) return null;

    // Build NegotiationContext from CoreMemory
    const roundData = {
      p_effective: boundaries.opponent_offer,
      r_score: 0.5, // default trust score without DB
      i_completeness: 1.0,
      t_elapsed: session.round / Math.max(session.max_rounds, 1),
      n_success: 0,
      n_dispute_losses: 0,
    };

    const ctx = assembleContext(strategy, roundData);
    return computeUtility(ctx);
  } catch {
    return null;
  }
}

// ─── Skill Implementation ─────────────────────────────────────────────

export class HaggleEngineSkill implements SkillRuntime {
  readonly manifest = manifest;

  async onHook(context: HookContext): Promise<HookResult> {
    if (context.stage === "context") {
      return this.onContext(context);
    }
    if (context.stage === "decide") {
      return this.onDecide(context);
    }
    return { content: {} };
  }

  /** Context hook: provide 4D utility snapshot as factual data */
  private onContext(context: HookContext): HookResult {
    const utility = compute4DUtility(context.memory);
    if (!utility) return { content: {} };

    return {
      content: {
        observations: [
          `Engine utility: total=${utility.u_total.toFixed(3)} (price=${utility.v_p.toFixed(2)}, time=${utility.v_t.toFixed(2)}, risk=${utility.v_r.toFixed(2)}, quality=${utility.v_s.toFixed(2)})`,
        ],
        utilitySnapshot: {
          u_total: utility.u_total,
          u_price: utility.v_p,
          u_time: utility.v_t,
          u_risk: utility.v_r,
          u_quality: utility.v_s,
        },
      },
    };
  }

  /** Decide hook: provide engine-core's recommended action + Faratin price */
  private onDecide(context: HookContext): HookResult {
    const { memory, recentFacts, opponentPattern, phase } = context;
    const { session, boundaries } = memory;

    // Faratin counter-offer price
    const t =
      session.max_rounds > 0 ? session.round / session.max_rounds : 0;
    const beta = deriveBeta(opponentPattern);
    const faratinPrice = computeCounterOffer({
      p_start: boundaries.my_target,
      p_limit: boundaries.my_floor,
      t,
      T: 1,
      beta,
    });

    // Engine-core decision recommendation
    const utility = compute4DUtility(memory);
    let engineAction: string | undefined;
    if (utility && memory.strategy) {
      const thresholds = {
        u_threshold: memory.strategy.u_threshold ?? 0.4,
        u_aspiration: memory.strategy.u_aspiration ?? 0.7,
        max_rounds: session.max_rounds,
        rounds_no_concession_limit: 4,
      };
      const decision = makeDecision(utility, thresholds, {
        current_round: session.round,
        rounds_no_concession: 0,
      });
      engineAction = decision;
    }

    return {
      content: {
        recommendedPrice: Math.round(faratinPrice),
        suggestedTactic: "reciprocal_concession",
        observations: [
          `Engine-core Faratin: $${(faratinPrice / 100).toFixed(2)} (beta=${beta.toFixed(1)}, t=${t.toFixed(2)})`,
          ...(engineAction ? [`Engine-core decision: ${engineAction}`] : []),
          ...(utility
            ? [
                `4D utility: ${utility.u_total.toFixed(3)} (P=${utility.v_p.toFixed(2)} T=${utility.v_t.toFixed(2)} R=${utility.v_r.toFixed(2)} S=${utility.v_s.toFixed(2)})`,
              ]
            : []),
        ],
      },
    };
  }

  /**
   * Rule-based fallback move — used when LLM is unavailable.
   * Delegates to engine-core computeCounterOffer + makeDecision.
   */
  async generateMove(
    memory: CoreMemory,
    recentFacts: RoundFact[],
    opponentPattern: OpponentPattern | null,
    phase: NegotiationPhase,
  ): Promise<ProtocolDecision> {
    const { session, boundaries } = memory;

    if (phase === "DISCOVERY") {
      return {
        action: "DISCOVER",
        reasoning: "Discovery phase — gathering item information.",
      };
    }

    if (phase === "OPENING") {
      const margin = 0.1;
      const price =
        session.role === "buyer"
          ? boundaries.my_target * (1 - margin)
          : boundaries.my_target * (1 + margin);
      return {
        action: "COUNTER",
        price: Math.round(price),
        reasoning: "Opening anchor based on target with 10% margin.",
        tactic_used: "anchoring",
      };
    }

    if (phase === "CLOSING") {
      return {
        action: "CONFIRM",
        price: boundaries.current_offer,
        reasoning: "Confirming current offer for closing.",
      };
    }

    // BARGAINING — Faratin curve
    const t =
      session.max_rounds > 0 ? session.round / session.max_rounds : 0;
    const beta = deriveBeta(opponentPattern);
    const price = computeCounterOffer({
      p_start: boundaries.my_target,
      p_limit: boundaries.my_floor,
      t,
      T: 1,
      beta,
    });

    // Near-deal detection
    const gap = Math.abs(boundaries.current_offer - boundaries.opponent_offer);
    const range = Math.abs(boundaries.my_target - boundaries.my_floor);
    if (range > 0 && gap / range < 0.05) {
      return {
        action: "ACCEPT",
        price: boundaries.opponent_offer,
        reasoning: `Gap is ${((gap / range) * 100).toFixed(1)}% of range — accepting.`,
        tactic_used: "near_deal_acceptance",
      };
    }

    return {
      action: "COUNTER",
      price: Math.round(price),
      reasoning: `Faratin curve counter at t=${t.toFixed(2)}, beta=${beta.toFixed(1)}.`,
      tactic_used: "reciprocal_concession",
    };
  }
}

function deriveBeta(opponent: OpponentPattern | null): number {
  if (!opponent) return 1.0;
  if (opponent.aggression > 0.7) return 2.0; // BOULWARE → concede slowly
  if (opponent.aggression < 0.3) return 1.5; // CONCEDER → take advantage
  return 1.0;
}
