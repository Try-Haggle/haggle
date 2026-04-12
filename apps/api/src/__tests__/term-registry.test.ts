import { describe, it, expect, beforeEach } from 'vitest';
import { TermRegistry } from '../negotiation/term/term-registry.js';
import { ELECTRONICS_TERMS } from '../negotiation/term/standard-terms.js';
import type { SkillTermDeclaration, CategoryTerm } from '../negotiation/types.js';

describe('TermRegistry', () => {
  let registry: TermRegistry;

  beforeEach(() => {
    registry = new TermRegistry();
  });

  // ─── Standard Term registration/resolve (3) ───

  describe('standard terms', () => {
    it('should register and resolve standard terms', () => {
      registry.registerStandardTerms(ELECTRONICS_TERMS);
      const term = registry.resolve('battery_health');
      expect(term).not.toBeNull();
      expect(term!.id).toBe('battery_health');
      expect(term!.parent_category).toBe('CONDITION');
    });

    it('should return null for unknown term', () => {
      registry.registerStandardTerms(ELECTRONICS_TERMS);
      expect(registry.resolve('nonexistent_term')).toBeNull();
    });

    it('should resolve all registered standard terms', () => {
      registry.registerStandardTerms(ELECTRONICS_TERMS);
      for (const t of ELECTRONICS_TERMS) {
        expect(registry.resolve(t.id)).not.toBeNull();
      }
    });
  });

  // ─── Custom Term registration + parent_category fallback (3) ───

  describe('custom terms', () => {
    it('should register and resolve a custom term', () => {
      const ct = registry.registerCustomTerm({
        id: 'custom_engraving',
        display_name: 'Custom Engraving',
        parent_category: 'CUSTOM',
        value_type: 'text',
        buyer_value_assessment: 15,
      });
      expect(ct.id).toBe('custom_engraving');
      expect(registry.resolve('custom_engraving')).toBe(ct);
    });

    it('should use parent_category evaluate_hint for non-CUSTOM category', () => {
      const ct = registry.registerCustomTerm({
        id: 'custom_warranty_ext',
        display_name: 'Extended Warranty',
        parent_category: 'WARRANTY',
        value_type: 'boolean',
        buyer_value_assessment: 30,
      });
      expect(ct.evaluate_hint).toContain('WARRANTY');
      expect(ct.evaluate_hint).toContain('$30');
    });

    it('should prefer standard over custom when same id exists', () => {
      registry.registerStandardTerms(ELECTRONICS_TERMS);
      registry.registerCustomTerm({
        id: 'battery_health',
        display_name: 'Override Battery',
        parent_category: 'CUSTOM',
        value_type: 'number',
        buyer_value_assessment: 50,
      });
      const resolved = registry.resolve('battery_health');
      // Standard takes priority
      expect(resolved!.display_name).toBe('배터리 잔여 수명');
    });
  });

  // ─── Skill compatibility: direct match (2) ───

  describe('canSkillHandle — direct match', () => {
    const skillDeclaration: SkillTermDeclaration = {
      supported_terms: ['battery_health', 'carrier_lock', 'CONDITION'],
      category_terms: [
        {
          id: 'skill_specific_term',
          parent_category: 'CONDITION',
          display_name: 'Skill Specific',
          value_type: 'boolean',
          typical_impact: 'test',
          evaluate_hint: 'test',
        },
      ],
      custom_term_handling: 'basic',
    };

    it('should return true for directly supported term', () => {
      registry.registerSkillTerms('electronics-v1', skillDeclaration);
      expect(registry.canSkillHandle('electronics-v1', 'battery_health')).toBe(true);
    });

    it('should return true for skill-defined category term', () => {
      registry.registerSkillTerms('electronics-v1', skillDeclaration);
      expect(registry.canSkillHandle('electronics-v1', 'skill_specific_term')).toBe(true);
    });
  });

  // ─── Skill compatibility: parent_category fallback (2) ───

  describe('canSkillHandle — parent_category fallback', () => {
    const skillDeclaration: SkillTermDeclaration = {
      supported_terms: ['CONDITION', 'WARRANTY'],
      category_terms: [],
      custom_term_handling: 'basic',
    };

    it('should return true when custom term parent_category matches supported_terms', () => {
      registry.registerSkillTerms('generic-skill', skillDeclaration);
      registry.registerCustomTerm({
        id: 'custom_condition_item',
        display_name: 'Custom Condition',
        parent_category: 'CONDITION',
        value_type: 'text',
        buyer_value_assessment: 20,
      });
      expect(registry.canSkillHandle('generic-skill', 'custom_condition_item')).toBe(true);
    });

    it('should return false when parent_category not in supported_terms', () => {
      registry.registerSkillTerms('generic-skill', skillDeclaration);
      registry.registerCustomTerm({
        id: 'custom_financial_item',
        display_name: 'Custom Financial',
        parent_category: 'FINANCIAL',
        value_type: 'number',
        buyer_value_assessment: 100,
      });
      expect(registry.canSkillHandle('generic-skill', 'custom_financial_item')).toBe(false);
    });
  });

  // ─── buildActiveTerms (2) ───

  describe('buildActiveTerms', () => {
    it('should build ActiveTerm list from session terms', () => {
      registry.registerStandardTerms(ELECTRONICS_TERMS);
      const active = registry.buildActiveTerms([
        { termId: 'battery_health', status: 'proposed', value: 85 },
        { termId: 'carrier_lock', status: 'agreed', value: 'unlocked' },
      ]);
      expect(active).toHaveLength(2);
      expect(active[0]!.term_id).toBe('battery_health');
      expect(active[0]!.category).toBe('CONDITION');
      expect(active[0]!.status).toBe('proposed');
      expect(active[0]!.value).toBe(85);
      expect(active[1]!.term_id).toBe('carrier_lock');
      expect(active[1]!.status).toBe('agreed');
    });

    it('should skip unresolvable terms', () => {
      registry.registerStandardTerms(ELECTRONICS_TERMS);
      const active = registry.buildActiveTerms([
        { termId: 'battery_health', status: 'proposed' },
        { termId: 'nonexistent', status: 'proposed' },
      ]);
      expect(active).toHaveLength(1);
      expect(active[0]!.term_id).toBe('battery_health');
    });
  });
});
