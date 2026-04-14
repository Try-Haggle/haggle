/**
 * skills/faratin-coaching.ts
 *
 * Strategy advisor skill based on Faratin concession curves.
 * Provides: recommended price, acceptable range, tactic suggestion.
 *
 * These are ADVISORY — the LLM may ignore them.
 * Hard enforcement is done by the Referee (VALIDATE stage), not by coaching.
 *
 * This is Haggle's built-in default coaching. Users/sessions can:
 *   - Replace it with a different coaching skill
 *   - Remove it entirely (LLM decides with just NSV + knowledge)
 *   - Stack multiple advisors (LLM sees all recommendations)
 */

import { computeCounterOffer } from '@haggle/engine-core';
import type {
  SkillManifest,
  SkillRuntime,
  HookContext,
  HookResult,
  DecideHookResult,
} from './skill-types.js';
import type { BuddyDNA } from '../types.js';

// ─── Constants ──────────────────────────────────────────────────

const STYLE_MARGIN: Record<BuddyDNA['style'], number> = {
  aggressive: 0.15,
  balanced: 0.10,
  defensive: 0.05,
};

const manifest: SkillManifest = {
  id: 'faratin-coaching-v1',
  version: '1.0.0',
  type: 'advisor',
  name: 'Faratin Concession Coaching',
  description: 'Price recommendations based on Faratin time-dependent concession curves. Advisory only — LLM decides.',
  categoryTags: ['*'],  // applies to all categories
  hooks: ['decide'],
  pricing: { model: 'free' },
};

// ─── Helpers ────────────────────────────────────────────────────

function deriveBeta(style: BuddyDNA['style']): number {
  switch (style) {
    case 'aggressive': return 2.0;
    case 'defensive': return 0.5;
    default: return 1.0;
  }
}

function deriveTactic(
  phase: string,
  timePressure: number,
  opponentAggression: number | null,
  style: BuddyDNA['style'],
): string {
  if (phase === 'DISCOVERY') return 'ask_questions';
  if (phase === 'CLOSING') return 'confirm_terms';
  if (timePressure > 0.7) return 'time_pressure_close';
  if (opponentAggression !== null) {
    if (opponentAggression > 0.7) return 'nibble';
    if (opponentAggression < 0.3) return 'anchoring';
  }
  switch (style) {
    case 'aggressive': return 'anchoring';
    case 'defensive': return 'reciprocal_concession';
    default: return 'reciprocal_concession';
  }
}

// ─── Skill Runtime ──────────────────────────────────────────────

export interface FaratinCoachingOptions {
  /** BuddyDNA style — determines beta and margin */
  buddyStyle: BuddyDNA['style'];
}

export class FaratinCoachingSkill implements SkillRuntime {
  readonly manifest = manifest;
  private style: BuddyDNA['style'];

  constructor(options?: FaratinCoachingOptions) {
    this.style = options?.buddyStyle ?? 'balanced';
  }

  async onHook(context: HookContext): Promise<HookResult> {
    if (context.stage !== 'decide') return { content: {} };
    return this.onDecide(context);
  }

  private onDecide(ctx: HookContext): DecideHookResult {
    const { memory, phase, opponentPattern } = ctx;
    const { session, boundaries } = memory;
    const { round, max_rounds } = session;

    const timePressure = max_rounds > 0 ? 1 - session.rounds_remaining / max_rounds : 0;

    // ── Recommended price (Faratin curve) ──
    let recommendedPrice: number;

    if (phase === 'DISCOVERY') {
      recommendedPrice = 0;
    } else if (phase === 'OPENING') {
      const margin = STYLE_MARGIN[this.style] ?? 0.10;
      recommendedPrice = session.role === 'buyer'
        ? boundaries.my_target * (1 - margin)
        : boundaries.my_target * (1 + margin);
    } else if (phase === 'BARGAINING') {
      const t = max_rounds > 0 ? round / max_rounds : 0;
      const beta = deriveBeta(this.style);
      recommendedPrice = computeCounterOffer({
        p_start: boundaries.my_target,
        p_limit: boundaries.my_floor,
        t,
        T: 1,
        beta,
      });
    } else {
      recommendedPrice = boundaries.current_offer || boundaries.my_target;
    }

    // ── Acceptable range ──
    const rangePadding = Math.abs(boundaries.my_target - boundaries.my_floor) * 0.1;
    const acceptableRange = session.role === 'buyer'
      ? { min: Math.max(0, recommendedPrice - rangePadding), max: boundaries.my_floor }
      : { min: boundaries.my_floor, max: recommendedPrice + rangePadding };

    // ── Tactic ──
    const opponentAgg = opponentPattern?.aggression ?? null;
    const suggestedTactic = deriveTactic(phase, timePressure, opponentAgg, this.style);

    // ── Observations (facts, not instructions) ──
    const observations: string[] = [];
    if (timePressure > 0.7) observations.push(`Time pressure high (${(timePressure * 100).toFixed(0)}%).`);
    if (opponentPattern && opponentPattern.aggression > 0.7) {
      observations.push('Opponent pattern: firm/boulware.');
    }
    if (opponentPattern && opponentPattern.aggression < 0.3) {
      observations.push('Opponent pattern: flexible/conceder.');
    }

    return {
      content: {
        recommendedPrice: Math.round(recommendedPrice),
        acceptableRange,
        suggestedTactic,
        observations,
      },
    };
  }
}
