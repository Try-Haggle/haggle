import type { RegisteredSkill, HookPoint } from "./types.js";
import { SkillRegistry } from "./registry.js";

export interface PipelineConfig {
  maxSkillsPerHookPoint: number;
  timeoutMs: number;
  failurePolicy: "SKIP" | "ABORT";
}

export interface SkillExecutionPlan {
  hookPoint: HookPoint;
  skills: RegisteredSkill[];
  config: PipelineConfig;
}

export function defaultPipelineConfig(): PipelineConfig {
  return {
    maxSkillsPerHookPoint: 5,
    timeoutMs: 5000,
    failurePolicy: "SKIP",
  };
}

/**
 * Determine which skills should run for a given hook point + category.
 * Returns at most maxSkillsPerHookPoint skills (default 5).
 */
export function resolveSkills(
  registry: SkillRegistry,
  hookPoint: HookPoint,
  productCategory: string,
  maxSkills?: number,
): RegisteredSkill[] {
  const max = maxSkills ?? defaultPipelineConfig().maxSkillsPerHookPoint;
  const matching = registry.findByHookPoint(hookPoint, productCategory);
  return matching.slice(0, max);
}

/**
 * Create an execution plan for a given hook point + category.
 * This is a pure planning function — it does NOT execute skills.
 * Actual execution happens at the API layer where async calls are possible.
 */
export function createExecutionPlan(
  registry: SkillRegistry,
  hookPoint: HookPoint,
  productCategory: string,
  config?: Partial<PipelineConfig>,
): SkillExecutionPlan {
  const fullConfig: PipelineConfig = {
    ...defaultPipelineConfig(),
    ...config,
  };

  const skills = resolveSkills(registry, hookPoint, productCategory, fullConfig.maxSkillsPerHookPoint);

  return {
    hookPoint,
    skills,
    config: fullConfig,
  };
}
