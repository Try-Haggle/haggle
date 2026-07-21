import { computeCounterOffer } from "@haggle/engine-core";
import type {
  CoreMemory,
  EngineDecision,
  NegotiationPhase,
  NegotiationSkill,
  OpponentPattern,
  RoundFact,
  SkillConstraint,
  SkillTermDeclaration,
} from "../types.js";
import { type CategoryProfile, ELECTRONICS_PHONE_PROFILE } from "./category-profiles.js";

export class DefaultEngineSkill implements NegotiationSkill {
  readonly id: string;
  readonly version = "1.0.0";
  private readonly profile: CategoryProfile;

  /**
   * Category-specific content (LLM context, constraints, terms) comes from the
   * profile. Production constructs this per-session via resolveCategoryProfile;
   * the default stays the electronics/phone profile for backward compatibility
   * with legacy no-arg call sites (tests, the out-of-path llm executor).
   */
  constructor(profile: CategoryProfile = ELECTRONICS_PHONE_PROFILE) {
    this.profile = profile;
    this.id = profile.id;
  }

  getLLMContext(): string {
    return this.profile.llmContext;
  }

  getTactics(): string[] {
    return [
      "anchoring",
      "reciprocal_concession",
      "condition_trade",
      "time_pressure_close",
      "nibble",
      "bundling",
    ];
  }

  getConstraints(): SkillConstraint[] {
    return this.profile.constraints;
  }

  getTermDeclaration(): SkillTermDeclaration {
    return this.profile.termDeclaration;
  }

  async generateMove(
    memory: CoreMemory,
    _recentFacts: RoundFact[],
    opponentPattern: OpponentPattern | null,
    phase: NegotiationPhase,
  ): Promise<EngineDecision> {
    // Rule-based fallback — used when LLM is unavailable or for non-BARGAINING phases
    const { session, boundaries } = memory;

    if (phase === "DISCOVERY") {
      return {
        action: "DISCOVER",
        reasoning: "Discovery phase — gathering item information.",
      };
    }

    if (phase === "OPENING") {
      // Seller anchors above target; buyer holds at target (already opened there —
      // going lower would mean countering below the buyer's own initial offer).
      // Anchor strength comes from the agent's anchor_ratio when set (lower ratio
      // = more extreme anchor), else the default 10%.
      const anchorRatio = memory.strategy_params?.anchor_ratio;
      const margin = anchorRatio !== undefined ? (1 - anchorRatio) * 0.2 : 0.1;
      const price =
        session.role === "buyer" ? boundaries.my_target : boundaries.my_target * (1 + margin);
      return {
        action: "COUNTER",
        price: Math.round(price),
        reasoning: "Opening anchor.",
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

    // BARGAINING — use Faratin curve. Concession speed (beta) comes from the
    // agent's tuned strategy when present (preset / advanced sliders), else the
    // opponent-derived heuristic.
    const t = session.max_rounds > 0 ? session.round / session.max_rounds : 0;
    const beta = memory.strategy_params?.beta ?? this.deriveBeta(opponentPattern);
    const price = computeCounterOffer({
      p_start: boundaries.my_target,
      p_limit: boundaries.my_floor,
      t,
      T: 1,
      beta,
    });

    // Check if near deal
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

  async evaluateOffer(
    memory: CoreMemory,
    incomingOffer: { price: number; non_price_terms?: Record<string, unknown> },
    recentFacts: RoundFact[],
    phase: NegotiationPhase,
  ): Promise<EngineDecision> {
    const { boundaries, session } = memory;

    // Auto-accept if at or better than target
    const isAtTarget =
      session.role === "buyer"
        ? incomingOffer.price <= boundaries.my_target
        : incomingOffer.price >= boundaries.my_target;

    if (isAtTarget) {
      return {
        action: "ACCEPT",
        price: incomingOffer.price,
        reasoning: "Offer meets or exceeds target price.",
      };
    }

    // Beyond floor: counter-anchor instead of immediate REJECT.
    // Real negotiations don't end because the opening price is "too low" — they
    // counter back toward target. Only REJECT when there are no rounds left to
    // negotiate, or the price is so extreme that countering is meaningless.
    const isBeyondFloor =
      session.role === "buyer"
        ? incomingOffer.price > boundaries.my_floor
        : incomingOffer.price < boundaries.my_floor;

    if (isBeyondFloor) {
      const roundsLeft = session.rounds_remaining;
      // Extreme price: more than 2x the (target..floor) range away from floor.
      const range = Math.abs(boundaries.my_target - boundaries.my_floor) || 1;
      const distanceFromFloor = Math.abs(incomingOffer.price - boundaries.my_floor);
      const isExtreme = distanceFromFloor > range * 2;

      if (roundsLeft <= 1 || isExtreme) {
        return {
          action: "REJECT",
          reasoning:
            roundsLeft <= 1
              ? `Offer $${incomingOffer.price} is beyond floor $${boundaries.my_floor} with no rounds left.`
              : `Offer $${incomingOffer.price} is implausible (>${(range * 2).toFixed(0)} from floor $${boundaries.my_floor}).`,
        };
      }
      // Otherwise: counter-anchor toward our target.
      return this.generateMove(memory, recentFacts, null, phase);
    }

    // In between — generate counter
    return this.generateMove(memory, recentFacts, null, phase);
  }

  private deriveBeta(opponentPattern: OpponentPattern | null): number {
    if (!opponentPattern) return 1.0;
    // Against BOULWARE (firm opponent), concede slowly (high beta)
    if (opponentPattern.aggression > 0.7) return 2.0;
    // Against CONCEDER, concede slowly too (take advantage)
    if (opponentPattern.aggression < 0.3) return 1.5;
    return 1.0;
  }
}
