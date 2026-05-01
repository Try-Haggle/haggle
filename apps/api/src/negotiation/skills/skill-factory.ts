/**
 * skills/skill-factory.ts
 *
 * Factory for creating NegotiationSkills from templates.
 * Step 67-D — interface + electronics-only default implementation.
 * DefaultEngineSkill is NOT modified; factory wraps it with template overrides.
 */

import type {
  NegotiationSkill,
  SkillConstraint,
  SkillTermDeclaration,
  CategoryTerm,
  CoreMemory,
  RoundFact,
  OpponentPattern,
  NegotiationPhase,
  EngineDecision,
} from '../types.js';
import { DefaultEngineSkill } from './default-engine-skill.js';
import { ELECTRONICS_TERMS } from '../term/standard-terms.js';

// ---------------------------------------------------------------------------
// Template types
// ---------------------------------------------------------------------------

export interface SkillTemplate {
  category: string;
  terms: CategoryTerm[];
  constraints: SkillConstraint[];
  tactics: string[];
  llm_context: string;
  market_reference?: {
    baseline_source: string;
    avg_discount_rate: number;
  };
}

// ---------------------------------------------------------------------------
// Factory interface
// ---------------------------------------------------------------------------

export interface SkillFactory {
  /** Create a NegotiationSkill from a template */
  createFromTemplate(template: SkillTemplate): NegotiationSkill;

  /** List all registered templates */
  listTemplates(): SkillTemplate[];

  /** Get skill by category (returns undefined if not registered) */
  getSkillForCategory(category: string): NegotiationSkill | undefined;
}

// ---------------------------------------------------------------------------
// Template-wrapped skill
// ---------------------------------------------------------------------------

class TemplateSkill implements NegotiationSkill {
  readonly id: string;
  readonly version = '1.0.0';

  private readonly _base: DefaultEngineSkill;
  private readonly _template: SkillTemplate;

  constructor(template: SkillTemplate) {
    this.id = `${template.category}-v1`;
    this._base = new DefaultEngineSkill();
    this._template = template;
  }

  getLLMContext(): string {
    return this._template.llm_context;
  }

  getTactics(): string[] {
    return this._template.tactics;
  }

  getConstraints(): SkillConstraint[] {
    return this._template.constraints;
  }

  getTermDeclaration(): SkillTermDeclaration {
    return {
      supported_terms: this._template.terms.map((t) => t.id),
      category_terms: this._template.terms,
      custom_term_handling: 'basic',
    };
  }

  generateMove(
    memory: CoreMemory,
    recentFacts: RoundFact[],
    opponentPattern: OpponentPattern | null,
    phase: NegotiationPhase,
  ): Promise<EngineDecision> {
    return this._base.generateMove(memory, recentFacts, opponentPattern, phase);
  }

  evaluateOffer(
    memory: CoreMemory,
    incomingOffer: { price: number; non_price_terms?: Record<string, unknown> },
    recentFacts: RoundFact[],
    phase: NegotiationPhase,
  ): Promise<EngineDecision> {
    return this._base.evaluateOffer(memory, incomingOffer, recentFacts, phase);
  }
}

// ---------------------------------------------------------------------------
// Default factory implementation
// ---------------------------------------------------------------------------

export class DefaultSkillFactory implements SkillFactory {
  private templates = new Map<string, SkillTemplate>();
  private skills = new Map<string, NegotiationSkill>();

  constructor() {
    this.registerElectronicsTemplate();
  }

  createFromTemplate(template: SkillTemplate): NegotiationSkill {
    const skill = new TemplateSkill(template);
    this.templates.set(template.category, template);
    this.skills.set(template.category, skill);
    return skill;
  }

  listTemplates(): SkillTemplate[] {
    return Array.from(this.templates.values());
  }

  getSkillForCategory(category: string): NegotiationSkill | undefined {
    return this.skills.get(category);
  }

  private registerElectronicsTemplate(): void {
    const template: SkillTemplate = {
      category: 'electronics',
      terms: ELECTRONICS_TERMS,
      constraints: [
        { rule: 'IMEI_REQUIRED', description: 'IMEI must be verified before CLOSING phase' },
        { rule: 'FIND_MY_REQUIRED', description: 'Find My must be disabled before sale' },
        { rule: 'BATTERY_THRESHOLD', description: 'Battery below 80% triggers mandatory disclosure' },
      ],
      tactics: [
        'anchoring',
        'reciprocal_concession',
        'condition_trade',
        'time_pressure_close',
        'nibble',
        'bundling',
      ],
      llm_context: [
        '## Category: Electronics - iPhone Pro',
        'Market: US used iPhone Pro (13/14/15). Reference: Swappa 30d median.',
        'Key factors: battery health, carrier lock, screen condition, storage, cosmetic grade.',
        'IMEI and Find My verification are deal-breakers.',
      ].join('\n'),
      market_reference: {
        baseline_source: 'swappa_30d_median',
        avg_discount_rate: 0.12,
      },
    };

    this.createFromTemplate(template);
  }
}
