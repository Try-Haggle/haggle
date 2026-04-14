/**
 * skills/electronics-knowledge.ts
 *
 * Default knowledge skill for electronics category.
 * Provides: term definitions, valuation rules, constraints, category context.
 * Pure data — no strategy recommendations, no coaching.
 */

import type {
  SkillManifest,
  SkillRuntime,
  HookContext,
  HookResult,
  UnderstandHookResult,
  DecideHookResult,
  ValidateHookResult,
  RespondHookResult,
} from './skill-types.js';
import { ELECTRONICS_TERMS } from '../term/standard-terms.js';

const manifest: SkillManifest = {
  id: 'electronics-knowledge-v1',
  version: '1.0.0',
  type: 'knowledge',
  name: 'Electronics Knowledge',
  description: 'Term definitions, valuation rules, and verification requirements for consumer electronics.',
  categoryTags: [
    'electronics',
    'electronics/phones',
    'electronics/tablets',
    'electronics/laptops',
    'electronics/wearables',
    'electronics/audio',
    'electronics/gaming',
    'electronics/cameras',
    'electronics/components',
  ],
  hooks: ['understand', 'decide', 'validate', 'respond'],
  pricing: { model: 'free' },
};

// ─── Term hints for UNDERSTAND stage ────────────────────────────

function buildTermHints() {
  return ELECTRONICS_TERMS.map(t => ({
    id: t.id,
    parseAs: t.value_type as 'number' | 'enum' | 'boolean' | 'string',
    range: t.value_range,
    unit: t.unit,
  }));
}

// ─── Valuation rules for DECIDE stage ───────────────────────────

function buildValuationRules(): string[] {
  return ELECTRONICS_TERMS
    .filter(t => t.evaluate_hint)
    .map(t => t.evaluate_hint);
}

// ─── Constraint rules for VALIDATE stage ────────────────────────

const HARD_RULES = [
  { rule: 'IMEI_REQUIRED', description: 'IMEI must be verified before CLOSING phase.' },
  { rule: 'FIND_MY_OFF', description: 'Find My must be disabled before sale.' },
];

const SOFT_RULES = [
  { rule: 'BATTERY_DISCLOSURE', description: 'Battery below 80% triggers mandatory disclosure.' },
  { rule: 'COSMETIC_DISCLOSURE', description: 'Cosmetic grade "fair" or below should be disclosed early.' },
];

// ─── Skill Runtime ──────────────────────────────────────────────

export class ElectronicsKnowledgeSkill implements SkillRuntime {
  readonly manifest = manifest;

  async onHook(context: HookContext): Promise<HookResult> {
    switch (context.stage) {
      case 'understand':
        return this.onUnderstand();
      case 'decide':
        return this.onDecide();
      case 'validate':
        return this.onValidate();
      case 'respond':
        return this.onRespond();
      default:
        return { content: {} };
    }
  }

  private onUnderstand(): UnderstandHookResult {
    return {
      content: {
        termHints: buildTermHints(),
        parsingContext: 'Parse battery health as 0-100%. Carrier lock as unlocked/locked. Storage as GB/TB enum.',
      },
    };
  }

  private onDecide(): DecideHookResult {
    return {
      content: {
        categoryBrief: [
          'Category: Consumer Electronics (US used market).',
          'Reference pricing: Swappa 30-day median.',
          'Key factors: battery health, carrier lock, screen condition, storage capacity, cosmetic grade.',
          'Verification deal-breakers: IMEI clean check, Find My disabled.',
        ].join(' '),
        valuationRules: buildValuationRules(),
        tactics: [
          'anchoring',
          'reciprocal_concession',
          'condition_trade',
          'time_pressure_close',
          'nibble',
          'bundling',
        ],
      },
    };
  }

  private onValidate(): ValidateHookResult {
    return {
      content: {
        hardRules: HARD_RULES,
        softRules: SOFT_RULES,
      },
    };
  }

  private onRespond(): RespondHookResult {
    return {
      content: {
        toneGuidance: 'Professional. Reference market data when justifying price. Use condition terms accurately.',
        terminology: {
          'mint': 'like-new condition',
          'DS': 'deadstock / brand new sealed',
          'OEM': 'original equipment manufacturer parts',
          'unlocked': 'not carrier-locked, works with any carrier',
        },
      },
    };
  }
}
