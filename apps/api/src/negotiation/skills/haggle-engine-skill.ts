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
  type UtilityResult,
} from "@haggle/engine-core";
import { assembleContext, buildTimeValueWindow } from "@haggle/engine-session";

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
  EngineDecision,
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

const DEFAULT_TIME_WINDOW_MS = 7 * 24 * 60 * 60 * 1000;

/**
 * Floor protection ratio — time pressure가 아무리 높아도
 * absolute floor까지 바로 양보하지 않음.
 *
 * 예: floor=$500, FLOOR_PROTECTION=0.90
 *   buyer: 최대 $500 * 0.90 = $450까지 → 아니, floor 자체가 한계
 *   seller: floor의 90% 지점에서 멈춤 → $500 + ($target-$500)*0.10
 *
 * 실제로는: Faratin의 p_limit을 floor에서 10% 안쪽으로 제한
 */
const FLOOR_PROTECTION_RATIO = 0.90;

// ─── Real-Time Elapsed ────────────────────────────────────────────────

/**
 * Compute the continuous time-value window.
 * Uses actual wall-clock time and the listing/session deadline, not urgency labels.
 */
function computeTimeWindow(memory: CoreMemory, nowMs?: number) {
  const session = memory.session;

  return buildTimeValueWindow({
    listedAtMs: session.created_at_ms,
    deadlineAtMs: session.deadline_at_ms,
    nowMs,
    fallbackTotalMs: session.max_duration_ms ?? DEFAULT_TIME_WINDOW_MS,
  });
}

// ─── Utility Helper ───────────────────────────────────────────────────

/**
 * Compute 4D utility using engine-core's real computeUtility.
 * Uses REAL elapsed time (wall clock), not round count.
 */
function compute4DUtility(memory: CoreMemory): UtilityResult | null {
  try {
    const { boundaries } = memory;
    const strategy = (memory as unknown as Record<string, unknown>).strategy as unknown;
    if (!strategy) return null;

    const timeWindow = computeTimeWindow(memory);

    const roundData = {
      p_effective: boundaries.opponent_offer,
      r_score: 0.5, // default trust score without DB
      i_completeness: 1.0,
      t_elapsed: timeWindow.elapsedMs,
      n_success: 0,
      n_dispute_losses: 0,
    };

    const ctx = assembleContext(strategy as Parameters<typeof assembleContext>[0], roundData);
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

    // Real-time elapsed for Faratin curve (not round-based, no urgency labels)
    const timeWindow = computeTimeWindow(memory);
    const baseBeta = deriveBeta(opponentPattern);
    const adjustedBeta = baseBeta;

    // Floor protection: even near deadline, never concede straight to the absolute floor
    // p_protected keeps a 10% buffer between the concession limit and the absolute floor
    const range = Math.abs(boundaries.my_target - boundaries.my_floor);
    const buffer = range * (1 - FLOOR_PROTECTION_RATIO);
    const p_protected = session.role === "buyer"
      ? boundaries.my_floor - buffer   // buyer: don't go higher than floor - buffer
      : boundaries.my_floor + buffer;  // seller: don't go lower than floor + buffer

    const faratinPrice = computeCounterOffer({
      p_start: boundaries.my_target,
      p_limit: p_protected,  // protected floor, not raw floor
      t: timeWindow.elapsedMs,
      T: timeWindow.totalMs,
      beta: adjustedBeta,
    });

    // Engine-core decision recommendation
    const utility = compute4DUtility(memory);
    let engineAction: string | undefined;
    const strategyObj = (memory as unknown as Record<string, unknown>).strategy as Record<string, unknown> | undefined;
    if (utility && strategyObj) {
      const thresholds = {
        u_threshold: (strategyObj.u_threshold as number) ?? 0.4,
        u_aspiration: (strategyObj.u_aspiration as number) ?? 0.7,
      };
      const decision = makeDecision(utility, thresholds, {
        rounds_no_concession: 0,
      });
      engineAction = decision.action;
    }

    return {
      content: {
        recommendedPrice: Math.round(faratinPrice),
        suggestedTactic: "reciprocal_concession",
        observations: [
          `Engine-core Faratin: $${(faratinPrice / 100).toFixed(2)} (beta=${adjustedBeta.toFixed(1)}, deadline_progress=${timeWindow.progress.toFixed(3)}, remaining_ms=${Math.round(timeWindow.remainingMs)})`,
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
  ): Promise<EngineDecision> {
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

    // BARGAINING — Faratin curve with real time + floor protection
    const timeWindow = computeTimeWindow(memory);
    const beta = deriveBeta(opponentPattern);

    // Floor protection: keep 10% buffer
    const range = Math.abs(boundaries.my_target - boundaries.my_floor);
    const buffer = range * (1 - FLOOR_PROTECTION_RATIO);
    const p_protected = session.role === "buyer"
      ? boundaries.my_floor - buffer
      : boundaries.my_floor + buffer;

    const price = computeCounterOffer({
      p_start: boundaries.my_target,
      p_limit: p_protected,
      t: timeWindow.elapsedMs,
      T: timeWindow.totalMs,
      beta,
    });

    // Near-deal detection
    const gap = Math.abs(boundaries.current_offer - boundaries.opponent_offer);
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
      reasoning: `Faratin curve counter at deadline_progress=${timeWindow.progress.toFixed(3)}, beta=${beta.toFixed(1)}.`,
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
