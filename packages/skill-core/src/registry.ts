import type {
  SkillManifest,
  RegisteredSkill,
  SkillStatus,
  SkillCategory,
  HookPoint,
} from "./types.js";
import { validateManifest, isCompatibleHookPoint, isCompatibleCategory } from "./manifest.js";

export class SkillRegistry {
  private skills: Map<string, RegisteredSkill> = new Map();

  register(manifest: SkillManifest): RegisteredSkill | { error: string } {
    const validation = validateManifest(manifest);
    if (!validation.valid) {
      return { error: `Invalid manifest: ${validation.errors.join("; ")}` };
    }

    if (this.skills.has(manifest.skillId)) {
      return { error: `Skill '${manifest.skillId}' is already registered` };
    }

    const now = new Date().toISOString();
    const registered: RegisteredSkill = {
      manifest,
      status: "DRAFT",
      registeredAt: now,
      updatedAt: now,
      usageCount: 0,
      averageLatencyMs: 0,
      errorRate: 0,
    };

    this.skills.set(manifest.skillId, registered);
    return registered;
  }

  activate(skillId: string): boolean {
    return this.transition(skillId, "DRAFT", "ACTIVE");
  }

  suspend(skillId: string): boolean {
    return this.transition(skillId, "ACTIVE", "SUSPENDED");
  }

  deprecate(skillId: string): boolean {
    const skill = this.skills.get(skillId);
    if (!skill) return false;
    if (skill.status !== "ACTIVE" && skill.status !== "SUSPENDED") return false;
    skill.status = "DEPRECATED";
    skill.updatedAt = new Date().toISOString();
    return true;
  }

  get(skillId: string): RegisteredSkill | undefined {
    return this.skills.get(skillId);
  }

  findByHookPoint(hookPoint: HookPoint, productCategory?: string): RegisteredSkill[] {
    const results: RegisteredSkill[] = [];
    for (const skill of this.skills.values()) {
      if (skill.status !== "ACTIVE") continue;
      if (!isCompatibleHookPoint(skill.manifest, hookPoint)) continue;
      if (productCategory && !isCompatibleCategory(skill.manifest, productCategory)) continue;
      results.push(skill);
    }
    return results;
  }

  findByCategory(skillCategory: SkillCategory): RegisteredSkill[] {
    const results: RegisteredSkill[] = [];
    for (const skill of this.skills.values()) {
      if (skill.status !== "ACTIVE") continue;
      if (skill.manifest.category !== skillCategory) continue;
      results.push(skill);
    }
    return results;
  }

  listAll(): RegisteredSkill[] {
    return Array.from(this.skills.values());
  }

  recordUsage(skillId: string, latencyMs: number, success: boolean): void {
    const skill = this.skills.get(skillId);
    if (!skill) return;

    const prevCount = skill.usageCount;
    const prevAvg = skill.averageLatencyMs;
    const prevErrors = Math.round(skill.errorRate * prevCount);

    skill.usageCount = prevCount + 1;
    // Rolling average for latency
    skill.averageLatencyMs = (prevAvg * prevCount + latencyMs) / skill.usageCount;
    // Rolling error rate
    skill.errorRate = (prevErrors + (success ? 0 : 1)) / skill.usageCount;
  }

  private transition(skillId: string, from: SkillStatus, to: SkillStatus): boolean {
    const skill = this.skills.get(skillId);
    if (!skill) return false;
    if (skill.status !== from) return false;
    skill.status = to;
    skill.updatedAt = new Date().toISOString();
    return true;
  }
}
