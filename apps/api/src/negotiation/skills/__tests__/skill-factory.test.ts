import { describe, it, expect } from 'vitest';
import { DefaultSkillFactory, type SkillTemplate } from '../skill-factory.js';

describe('DefaultSkillFactory', () => {
  it('should have electronics template registered on construction', () => {
    const factory = new DefaultSkillFactory();
    const templates = factory.listTemplates();
    expect(templates).toHaveLength(1);
    expect(templates[0]!.category).toBe('electronics');
  });

  it('should retrieve electronics skill by category', () => {
    const factory = new DefaultSkillFactory();
    const skill = factory.getSkillForCategory('electronics');
    expect(skill).toBeDefined();
    expect(skill!.id).toBe('electronics-v1');
  });

  it('should return undefined for unknown category', () => {
    const factory = new DefaultSkillFactory();
    expect(factory.getSkillForCategory('sneakers')).toBeUndefined();
  });

  it('should create skill from custom template', () => {
    const factory = new DefaultSkillFactory();
    const template: SkillTemplate = {
      category: 'sneakers',
      terms: [],
      constraints: [{ rule: 'SIZE_REQUIRED', description: 'Shoe size must be specified' }],
      tactics: ['anchoring', 'time_pressure_close'],
      llm_context: '## Category: Sneakers',
    };

    const skill = factory.createFromTemplate(template);
    expect(skill.id).toBe('sneakers-v1');
    expect(skill.getLLMContext()).toBe('## Category: Sneakers');
    expect(skill.getTactics()).toEqual(['anchoring', 'time_pressure_close']);
    expect(skill.getConstraints()).toHaveLength(1);
    expect(skill.getConstraints()[0]!.rule).toBe('SIZE_REQUIRED');
  });

  it('should make custom skill retrievable by category', () => {
    const factory = new DefaultSkillFactory();
    factory.createFromTemplate({
      category: 'sneakers',
      terms: [],
      constraints: [],
      tactics: [],
      llm_context: 'sneakers context',
    });
    expect(factory.getSkillForCategory('sneakers')).toBeDefined();
    expect(factory.listTemplates()).toHaveLength(2); // electronics + sneakers
  });

  it('electronics skill should have correct term declaration', () => {
    const factory = new DefaultSkillFactory();
    const skill = factory.getSkillForCategory('electronics')!;
    const decl = skill.getTermDeclaration();
    expect(decl.supported_terms).toContain('battery_health');
    expect(decl.supported_terms).toContain('imei_verification');
    expect(decl.category_terms.length).toBeGreaterThan(0);
  });

  it('electronics skill should generate moves (delegates to DefaultEngineSkill)', async () => {
    const factory = new DefaultSkillFactory();
    const skill = factory.getSkillForCategory('electronics')!;
    const memory = {
      session: {
        session_id: 'test', phase: 'OPENING' as const, round: 1, rounds_remaining: 14,
        role: 'buyer' as const, max_rounds: 15, intervention_mode: 'FULL_AUTO' as const,
      },
      boundaries: { my_target: 50000, my_floor: 65000, current_offer: 50000, opponent_offer: 70000, gap: 20000 },
      terms: { active: [], resolved_summary: '' },
      coaching: {
        recommended_price: 55000, acceptable_range: { min: 48000, max: 65000 },
        suggested_tactic: 'anchoring', hint: '', opponent_pattern: 'UNKNOWN' as const,
        convergence_rate: 0, time_pressure: 0,
        utility_snapshot: { u_price: 0, u_time: 0, u_risk: 0, u_quality: 0, u_total: 0 },
        strategic_hints: [], warnings: [],
      },
      buddy_dna: {
        style: 'balanced' as const, preferred_tactic: 'reciprocal_concession',
        category_experience: 'electronics', condition_trade_success_rate: 0.5,
        best_timing: 'mid-session',
        tone: { style: 'professional' as const, formality: 'neutral' as const, emoji_use: false },
      },
      skill_summary: 'test',
    };

    const move = await skill.generateMove(memory, [], null, 'OPENING');
    expect(move.action).toBe('COUNTER');
    expect(move.price).toBeDefined();
  });

  it('template with market_reference stores correctly', () => {
    const factory = new DefaultSkillFactory();
    const templates = factory.listTemplates();
    const elec = templates.find((t) => t.category === 'electronics');
    expect(elec?.market_reference).toBeDefined();
    expect(elec!.market_reference!.baseline_source).toBe('swappa_30d_median');
    expect(elec!.market_reference!.avg_discount_rate).toBe(0.12);
  });
});
