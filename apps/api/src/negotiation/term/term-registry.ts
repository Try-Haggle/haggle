import type {
  CategoryTerm,
  TermCategory,
  SkillTermDeclaration,
  ActiveTerm,
} from '../types.js';

/**
 * Term Registry — manages standard, skill, and custom terms.
 * Search order: standard → skill → custom.
 */
export class TermRegistry {
  private standardTerms = new Map<string, CategoryTerm>();
  private skillTerms = new Map<string, Map<string, CategoryTerm>>();
  private skillDeclarations = new Map<string, SkillTermDeclaration>();
  private customTerms = new Map<string, CategoryTerm>();

  /** Register standard terms (at app init) */
  registerStandardTerms(terms: CategoryTerm[]): void {
    for (const term of terms) {
      this.standardTerms.set(term.id, term);
    }
  }

  /** Register a skill's term declaration */
  registerSkillTerms(skillId: string, declaration: SkillTermDeclaration): void {
    this.skillDeclarations.set(skillId, declaration);
    const termMap = new Map<string, CategoryTerm>();
    for (const ct of declaration.category_terms) {
      termMap.set(ct.id, ct);
    }
    this.skillTerms.set(skillId, termMap);
  }

  /** Register a custom term — user must provide buyer_value_assessment */
  registerCustomTerm(term: {
    id: string;
    display_name: string;
    parent_category: TermCategory;
    value_type: 'number' | 'enum' | 'boolean' | 'text';
    buyer_value_assessment: number;
  }): CategoryTerm {
    const categoryTerm: CategoryTerm = {
      id: term.id,
      parent_category: term.parent_category,
      display_name: term.display_name,
      value_type: term.value_type,
      typical_impact: `User-assessed value: $${term.buyer_value_assessment}`,
      evaluate_hint:
        term.parent_category !== 'CUSTOM'
          ? `Custom term under ${term.parent_category}. User-assessed monetary value: $${term.buyer_value_assessment}.`
          : `Custom term. User-assessed monetary value: $${term.buyer_value_assessment}.`,
    };
    this.customTerms.set(term.id, categoryTerm);
    return categoryTerm;
  }

  /** Resolve a term by id — standard → skill → custom search order */
  resolve(termId: string): CategoryTerm | null {
    const standard = this.standardTerms.get(termId);
    if (standard) return standard;

    for (const termMap of this.skillTerms.values()) {
      const skill = termMap.get(termId);
      if (skill) return skill;
    }

    const custom = this.customTerms.get(termId);
    if (custom) return custom;

    return null;
  }

  /** Check if a skill can handle a given term */
  canSkillHandle(skillId: string, termId: string): boolean {
    const declaration = this.skillDeclarations.get(skillId);
    if (!declaration) return false;

    // Direct match: term id is in supported_terms
    if (declaration.supported_terms.includes(termId)) return true;

    // Check skill's own category_terms
    const skillMap = this.skillTerms.get(skillId);
    if (skillMap?.has(termId)) return true;

    // Parent category fallback: resolve the term and check if its parent_category
    // is in supported_terms (for custom terms that belong to a known category)
    const resolved = this.resolve(termId);
    if (resolved && declaration.supported_terms.includes(resolved.parent_category)) {
      return true;
    }

    return false;
  }

  /** Build ActiveTerm list for CoreMemory */
  buildActiveTerms(
    sessionTerms: Array<{ termId: string; status: ActiveTerm['status']; value?: unknown; proposed_by?: 'buyer' | 'seller' | 'protocol'; round_introduced?: number }>,
  ): ActiveTerm[] {
    const result: ActiveTerm[] = [];
    for (const st of sessionTerms) {
      const resolved = this.resolve(st.termId);
      if (!resolved) continue;
      result.push({
        term_id: st.termId,
        category: resolved.parent_category,
        display_name: resolved.display_name,
        status: st.status,
        value: st.value,
        proposed_by: st.proposed_by ?? 'protocol',
        round_introduced: st.round_introduced ?? 0,
      });
    }
    return result;
  }
}
