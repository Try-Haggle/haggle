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

// ─── Time Constants ───────────────────────────────────────────────────

/** Default max duration per category (ms) */
const CATEGORY_MAX_DURATION: Record<string, number> = {
  electronics: 24 * 60 * 60 * 1000,     // 24h
  smartphones: 24 * 60 * 60 * 1000,     // 24h
  laptops: 48 * 60 * 60 * 1000,         // 48h
  tablets: 24 * 60 * 60 * 1000,         // 24h
  gaming: 24 * 60 * 60 * 1000,          // 24h
  audio: 24 * 60 * 60 * 1000,           // 24h
  sneakers: 12 * 60 * 60 * 1000,        // 12h (hype items move fast)
  default: 24 * 60 * 60 * 1000,         // 24h
};

/** Urgency → Faratin beta multiplier (lower beta = concede faster) */
const URGENCY_BETA_MULTIPLIER: Record<string, number> = {
  low: 1.3,      // 느긋 — 양보 매우 느림
  normal: 1.0,   // 기본
  high: 0.7,     // 급함 — 양보 빠름
  urgent: 0.4,   // 매우 급함 — 매우 빠른 양보
};

/** Urgency → time pressure alpha amplifier (higher = steeper decay) */
const URGENCY_ALPHA_AMPLIFIER: Record<string, number> = {
  low: 0.8,
  normal: 1.0,
  high: 1.5,
  urgent: 2.5,
};

// ─── Real-Time Elapsed ────────────────────────────────────────────────

/**
 * Compute real-time t_elapsed ratio [0, 1].
 * Uses actual wall-clock time, not round count.
 *
 * t_elapsed = (now - session_created_at) / max_duration
 *
 * Urgency amplifies: "빨리 팔고 싶다" → effective max_duration shrinks.
 */
function computeRealTimeElapsed(memory: CoreMemory, nowMs?: number): number {
  const session = memory.session;
  const now = nowMs ?? Date.now();

  const createdAt = session.created_at_ms ?? now;
  const maxDuration = session.max_duration_ms ?? CATEGORY_MAX_DURATION.default;
  const urgency = session.urgency ?? "normal";

  // Urgency shrinks effective deadline
  const urgencyFactor = URGENCY_ALPHA_AMPLIFIER[urgency] ?? 1.0;
  const effectiveMaxDuration = maxDuration / urgencyFactor;

  const elapsed = now - createdAt;
  return Math.min(1, Math.max(0, elapsed / effectiveMaxDuration));
}

// ─── Utility Helper ───────────────────────────────────────────────────

/**
 * Compute 4D utility using engine-core's real computeUtility.
 * Uses REAL elapsed time (wall clock), not round count.
 */
function compute4DUtility(memory: CoreMemory): UtilityResult | null {
  try {
    const { boundaries } = memory;
    const strategy = memory.strategy;
    if (!strategy) return null;

    const tElapsed = computeRealTimeElapsed(memory);

    const roundData = {
      p_effective: boundaries.opponent_offer,
      r_score: 0.5, // default trust score without DB
      i_completeness: 1.0,
      t_elapsed: tElapsed, // REAL time, not round ratio
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

    // Real-time elapsed for Faratin curve (not round-based)
    const tElapsed = computeRealTimeElapsed(memory);

    // Urgency adjusts concession speed
    const urgency = session.urgency ?? "normal";
    const urgencyBetaMul = URGENCY_BETA_MULTIPLIER[urgency] ?? 1.0;
    const baseBeta = deriveBeta(opponentPattern);
    const adjustedBeta = baseBeta * urgencyBetaMul;

    const faratinPrice = computeCounterOffer({
      p_start: boundaries.my_target,
      p_limit: boundaries.my_floor,
      t: tElapsed,  // REAL time ratio, not round ratio
      T: 1,
      beta: adjustedBeta,  // urgency-adjusted
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
          `Engine-core Faratin: $${(faratinPrice / 100).toFixed(2)} (beta=${adjustedBeta.toFixed(1)}, t_real=${tElapsed.toFixed(3)}, urgency=${urgency})`,
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

    // BARGAINING — Faratin curve with real time + urgency
    const tElapsed = computeRealTimeElapsed(memory);
    const urgency = session.urgency ?? "normal";
    const urgencyBetaMul = URGENCY_BETA_MULTIPLIER[urgency] ?? 1.0;
    const beta = deriveBeta(opponentPattern) * urgencyBetaMul;
    const price = computeCounterOffer({
      p_start: boundaries.my_target,
      p_limit: boundaries.my_floor,
      t: tElapsed,  // REAL time, not round ratio
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
      reasoning: `Faratin curve counter at t_real=${tElapsed.toFixed(3)}, beta=${beta.toFixed(1)}, urgency=${urgency}.`,
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
