import { describe, it, expect, beforeEach } from 'vitest';
import { TermRegistry } from '../term-registry.js';
import { ELECTRONICS_TERMS } from '../standard-terms.js';
import type { SkillTermDeclaration } from '../../types.js';

describe('TermRegistry', () => {
  let registry: TermRegistry;

  beforeEach(() => {
    registry = new TermRegistry();
    registry.registerStandardTerms(ELECTRONICS_TERMS);
  });

  it('should register and resolve standard terms', () => {
    const term = registry.resolve('battery_health');
    expect(term).not.toBeNull();
    expect(term!.parent_category).toBe('CONDITION');
    expect(term!.value_type).toBe('number');
  });

  it('should return null for unknown term', () => {
    expect(registry.resolve('nonexistent')).toBeNull();
  });

  it('should resolve all 12 electronics terms', () => {
    for (const t of ELECTRONICS_TERMS) {
      expect(registry.resolve(t.id)).not.toBeNull();
    }
  });

  it('should register and resolve skill terms', () => {
    const declaration: SkillTermDeclaration = {
      supported_terms: ['custom_test_term'],
      category_terms: [{
        id: 'custom_test_term',
        parent_category: 'SERVICE',
        display_name: 'Test Service',
        value_type: 'boolean',
        typical_impact: 'test',
        evaluate_hint: 'test hint',
      }],
      custom_term_handling: 'full',
    };

    registry.registerSkillTerms('skill-1', declaration);
    const term = registry.resolve('custom_test_term');
    expect(term).not.toBeNull();
    expect(term!.parent_category).toBe('SERVICE');
  });

  it('should register custom terms', () => {
    const ct = registry.registerCustomTerm({
      id: 'my_custom',
      display_name: 'My Custom',
      parent_category: 'CUSTOM',
      value_type: 'text',
      buyer_value_assessment: 25,
    });

    expect(ct.id).toBe('my_custom');
    const resolved = registry.resolve('my_custom');
    expect(resolved).not.toBeNull();
    expect(resolved!.typical_impact).toContain('$25');
  });

  it('should follow resolution order: standard > skill > custom', () => {
    // Register skill term with same id as standard
    const declaration: SkillTermDeclaration = {
      supported_terms: ['battery_health'],
      category_terms: [{
        id: 'battery_health',
        parent_category: 'SERVICE',
        display_name: 'Skill Battery',
        value_type: 'text',
        typical_impact: 'skill version',
        evaluate_hint: 'skill',
      }],
      custom_term_handling: 'basic',
    };
    registry.registerSkillTerms('skill-2', declaration);

    // Standard should win
    const resolved = registry.resolve('battery_health');
    expect(resolved!.parent_category).toBe('CONDITION'); // standard, not SERVICE
  });

  it('should check if skill can handle term', () => {
    const declaration: SkillTermDeclaration = {
      supported_terms: ['battery_health', 'screen_condition'],
      category_terms: ELECTRONICS_TERMS.filter((t) => t.id === 'battery_health'),
      custom_term_handling: 'basic',
    };
    registry.registerSkillTerms('skill-3', declaration);

    expect(registry.canSkillHandle('skill-3', 'battery_health')).toBe(true);
    expect(registry.canSkillHandle('skill-3', 'screen_condition')).toBe(true);
    expect(registry.canSkillHandle('skill-3', 'warranty_period')).toBe(false);
    expect(registry.canSkillHandle('unknown-skill', 'battery_health')).toBe(false);
  });

  it('should build active terms list', () => {
    const activeTerms = registry.buildActiveTerms([
      { termId: 'battery_health', status: 'agreed', value: 92 },
      { termId: 'carrier_lock', status: 'unresolved', proposed_by: 'buyer', round_introduced: 2 },
      { termId: 'nonexistent', status: 'proposed' }, // should be skipped
    ]);

    expect(activeTerms).toHaveLength(2);
    expect(activeTerms[0]!.term_id).toBe('battery_health');
    expect(activeTerms[0]!.status).toBe('agreed');
    expect(activeTerms[0]!.value).toBe(92);
    expect(activeTerms[1]!.proposed_by).toBe('buyer');
  });
});
