import type {
  NegotiationSkill,
  SkillConstraint,
  SkillTermDeclaration,
  CoreMemory,
  RoundFact,
  OpponentPattern,
  NegotiationPhase,
  EngineDecision,
} from '../types.js';
import { computeCounterOffer } from '@haggle/engine-core';
import { ELECTRONICS_TERMS } from '../term/standard-terms.js';

export class DefaultEngineSkill implements NegotiationSkill {
  readonly id = 'electronics-iphone-pro-v1';
  readonly version = '1.0.0';

  getLLMContext(): string {
    return [
      '## Category: Electronics — iPhone Pro',
      'Market: US used iPhone Pro (13/14/15). Reference: Swappa 30d median.',
      'Key factors: battery health, carrier lock, screen condition, storage, cosmetic grade.',
      'IMEI and Find My verification are deal-breakers.',
    ].join('\n');
  }

  getTactics(): string[] {
    return [
      'anchoring',
      'reciprocal_concession',
      'condition_trade',
      'time_pressure_close',
      'nibble',
      'bundling',
    ];
  }

  getConstraints(): SkillConstraint[] {
    return [
      { rule: 'IMEI_REQUIRED', description: 'IMEI must be verified before CLOSING phase' },
      { rule: 'FIND_MY_REQUIRED', description: 'Find My must be disabled before sale' },
      { rule: 'BATTERY_THRESHOLD', description: 'Battery below 80% triggers mandatory disclosure' },
    ];
  }

  getTermDeclaration(): SkillTermDeclaration {
    return {
      supported_terms: ELECTRONICS_TERMS.map((t) => t.id),
      category_terms: ELECTRONICS_TERMS,
      custom_term_handling: 'basic',
    };
  }

  async generateMove(
    memory: CoreMemory,
    recentFacts: RoundFact[],
    opponentPattern: OpponentPattern | null,
    phase: NegotiationPhase,
  ): Promise<EngineDecision> {
    // Rule-based fallback — used when LLM is unavailable or for non-BARGAINING phases
    const { session, boundaries } = memory;

    if (phase === 'DISCOVERY') {
      return {
        action: 'DISCOVER',
        reasoning: 'Discovery phase — gathering item information.',
      };
    }

    if (phase === 'OPENING') {
      // Seller anchors 10% above target; buyer holds at target (already opened there —
      // going lower would mean countering below the buyer's own initial offer).
      const price = session.role === 'buyer'
        ? boundaries.my_target
        : boundaries.my_target * 1.10;
      return {
        action: 'COUNTER',
        price: Math.round(price),
        reasoning: 'Opening anchor.',
        tactic_used: 'anchoring',
      };
    }

    if (phase === 'CLOSING') {
      return {
        action: 'CONFIRM',
        price: boundaries.current_offer,
        reasoning: 'Confirming current offer for closing.',
      };
    }

    // BARGAINING — use Faratin curve
    const t = session.max_rounds > 0 ? session.round / session.max_rounds : 0;
    const beta = this.deriveBeta(opponentPattern);
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
        action: 'ACCEPT',
        price: boundaries.opponent_offer,
        reasoning: `Gap is ${((gap / range) * 100).toFixed(1)}% of range — accepting.`,
        tactic_used: 'near_deal_acceptance',
      };
    }

    return {
      action: 'COUNTER',
      price: Math.round(price),
      reasoning: `Faratin curve counter at t=${t.toFixed(2)}, beta=${beta.toFixed(1)}.`,
      tactic_used: 'reciprocal_concession',
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
    const isAtTarget = session.role === 'buyer'
      ? incomingOffer.price <= boundaries.my_target
      : incomingOffer.price >= boundaries.my_target;

    if (isAtTarget) {
      return {
        action: 'ACCEPT',
        price: incomingOffer.price,
        reasoning: 'Offer meets or exceeds target price.',
      };
    }

    // Beyond floor: counter-anchor instead of immediate REJECT.
    // Real negotiations don't end because the opening price is "too low" — they
    // counter back toward target. Only REJECT when there are no rounds left to
    // negotiate, or the price is so extreme that countering is meaningless.
    const isBeyondFloor = session.role === 'buyer'
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
          action: 'REJECT',
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
