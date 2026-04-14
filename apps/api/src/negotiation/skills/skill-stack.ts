/**
 * skills/skill-stack.ts
 *
 * SkillStack — session-level skill composition and pipeline integration.
 *
 * Resolves which skills apply to a session based on item tags,
 * dispatches hook calls to all relevant skills, and merges results.
 */

import type {
  SkillRuntime,
  SkillManifest,
  PipelineStage,
  HookContext,
  HookResult,
  DecideHookResult,
  ValidateHookResult,
} from './skill-types.js';

// ─── Skill Registry (global, all registered skills) ─────────────

const globalRegistry: SkillRuntime[] = [];

/** Register a skill globally. Called at startup. */
export function registerSkill(skill: SkillRuntime): void {
  // Avoid duplicate registration
  if (globalRegistry.some(s => s.manifest.id === skill.manifest.id)) return;
  globalRegistry.push(skill);
}

/** Get all registered skills */
export function getRegisteredSkills(): readonly SkillRuntime[] {
  return globalRegistry;
}

/** Clear registry (for testing) */
export function clearRegistry(): void {
  globalRegistry.length = 0;
}

// ─── SkillStack (session-level) ─────────────────────────────────

export class SkillStack {
  private skills: SkillRuntime[];

  constructor(skills: SkillRuntime[]) {
    this.skills = skills;
  }

  /** Resolve skills for a session based on item tag paths */
  static fromTags(tagPaths: string[]): SkillStack {
    const matched = globalRegistry.filter(skill =>
      skill.manifest.categoryTags.some(ct =>
        ct === '*' || tagPaths.some(tp => tp === ct || tp.startsWith(ct + '/'))
      )
    );
    return new SkillStack(matched);
  }

  /** Manually create a stack with specific skills */
  static of(...skills: SkillRuntime[]): SkillStack {
    return new SkillStack(skills);
  }

  /** Get all skills in this stack */
  getSkills(): readonly SkillRuntime[] {
    return this.skills;
  }

  /** Get skills that hook into a specific stage */
  getSkillsForStage(stage: PipelineStage): SkillRuntime[] {
    return this.skills.filter(s => s.manifest.hooks.includes(stage));
  }

  /** Dispatch a hook to all skills that registered for this stage, merge results */
  async dispatchHook(context: HookContext): Promise<MergedHookResult> {
    const relevantSkills = this.getSkillsForStage(context.stage);
    const results: Array<{ skillId: string; result: HookResult }> = [];

    for (const skill of relevantSkills) {
      const result = await skill.onHook(context);
      results.push({ skillId: skill.manifest.id, result });
    }

    return mergeHookResults(context.stage, results);
  }

  /** Find an on-demand skill by id */
  findOnDemandSkill(skillId: string): SkillRuntime | undefined {
    return this.skills.find(s => s.manifest.id === skillId && s.manifest.onDemand);
  }

  /** Get manifest summary for all skills in stack */
  getManifests(): SkillManifest[] {
    return this.skills.map(s => s.manifest);
  }
}

// ─── Merged Hook Results ────────────────────────────────────────

export interface MergedHookResult {
  /** All skill contributions, keyed by skill ID */
  bySkill: Record<string, HookResult>;

  /** Merged decide-stage content (if applicable) */
  decide?: {
    /** Combined category briefs from all knowledge skills */
    categoryBrief: string;
    /** All valuation rules from all knowledge skills */
    valuationRules: string[];
    /** Union of all tactics */
    tactics: string[];
    /** Advisory recommendations (from advisor skills) */
    advisories: Array<{
      skillId: string;
      recommendedPrice?: number;
      acceptableRange?: { min: number; max: number };
      suggestedTactic?: string;
      observations?: string[];
    }>;
    /** Market data (from service skills) */
    marketData?: Array<{ skillId: string; price: number; source: string }>;
  };

  /** Merged validate-stage content */
  validate?: {
    hardRules: Array<{ rule: string; description: string; skillId: string }>;
    softRules: Array<{ rule: string; description: string; skillId: string }>;
  };
}

function mergeHookResults(
  stage: PipelineStage,
  results: Array<{ skillId: string; result: HookResult }>,
): MergedHookResult {
  const bySkill: Record<string, HookResult> = {};
  for (const { skillId, result } of results) {
    bySkill[skillId] = result;
  }

  const merged: MergedHookResult = { bySkill };

  if (stage === 'decide') {
    const briefs: string[] = [];
    const rules: string[] = [];
    const tactics = new Set<string>();
    const advisories: MergedHookResult['decide'] extends undefined ? never : NonNullable<MergedHookResult['decide']>['advisories'] = [];
    const marketData: Array<{ skillId: string; price: number; source: string }> = [];

    for (const { skillId, result } of results) {
      const c = result.content as DecideHookResult['content'];
      if (c.categoryBrief) briefs.push(c.categoryBrief);
      if (c.valuationRules) rules.push(...c.valuationRules);
      if (c.tactics) c.tactics.forEach(t => tactics.add(t));
      if (c.recommendedPrice !== undefined || c.suggestedTactic || c.observations) {
        advisories.push({
          skillId,
          recommendedPrice: c.recommendedPrice,
          acceptableRange: c.acceptableRange,
          suggestedTactic: c.suggestedTactic,
          observations: c.observations,
        });
      }
      if (c.marketData) {
        marketData.push({ skillId, price: c.marketData.price, source: c.marketData.source });
      }
    }

    merged.decide = {
      categoryBrief: briefs.join('\n'),
      valuationRules: rules,
      tactics: Array.from(tactics),
      advisories,
      marketData: marketData.length > 0 ? marketData : undefined,
    };
  }

  if (stage === 'validate') {
    const hardRules: MergedHookResult['validate'] extends undefined ? never : NonNullable<MergedHookResult['validate']>['hardRules'] = [];
    const softRules: typeof hardRules = [];

    for (const { skillId, result } of results) {
      const c = result.content as ValidateHookResult['content'];
      if (c.hardRules) hardRules.push(...c.hardRules.map(r => ({ ...r, skillId })));
      if (c.softRules) softRules.push(...c.softRules.map(r => ({ ...r, skillId })));
    }

    merged.validate = { hardRules, softRules };
  }

  return merged;
}
