import { describe, it, expect, beforeEach } from "vitest";
import { SkillRegistry } from "../registry.js";
import {
  defaultPipelineConfig,
  resolveSkills,
  createExecutionPlan,
} from "../pipeline.js";
import type { SkillManifest } from "../types.js";

function makeManifest(overrides?: Partial<SkillManifest>): SkillManifest {
  return {
    skillId: "test-skill-v1",
    name: "Test Skill",
    description: "A test skill",
    version: "1.0.0",
    category: "STRATEGY",
    provider: "FIRST_PARTY",
    supportedCategories: ["sneakers"],
    hookPoints: ["PRE_SESSION"],
    pricing: { model: "FREE" },
    ...overrides,
  };
}

describe("defaultPipelineConfig", () => {
  it("returns expected defaults", () => {
    const config = defaultPipelineConfig();
    expect(config.maxSkillsPerHookPoint).toBe(5);
    expect(config.timeoutMs).toBe(5000);
    expect(config.failurePolicy).toBe("SKIP");
  });
});

describe("resolveSkills", () => {
  let registry: SkillRegistry;

  beforeEach(() => {
    registry = new SkillRegistry();
  });

  it("returns ACTIVE skills matching hook point and category", () => {
    registry.register(
      makeManifest({ skillId: "s1", hookPoints: ["PRE_SESSION"], supportedCategories: ["sneakers"] }),
    );
    registry.activate("s1");

    const skills = resolveSkills(registry, "PRE_SESSION", "sneakers");
    expect(skills).toHaveLength(1);
    expect(skills[0].manifest.skillId).toBe("s1");
  });

  it("respects maxSkillsPerHookPoint limit", () => {
    for (let i = 0; i < 8; i++) {
      registry.register(makeManifest({ skillId: `s${i}` }));
      registry.activate(`s${i}`);
    }

    const skills = resolveSkills(registry, "PRE_SESSION", "sneakers", 3);
    expect(skills).toHaveLength(3);
  });

  it("returns empty array when no skills match", () => {
    const skills = resolveSkills(registry, "ON_DISPUTE_OPEN", "sneakers");
    expect(skills).toHaveLength(0);
  });

  it("respects default max of 5", () => {
    for (let i = 0; i < 8; i++) {
      registry.register(makeManifest({ skillId: `s${i}` }));
      registry.activate(`s${i}`);
    }

    const skills = resolveSkills(registry, "PRE_SESSION", "sneakers");
    expect(skills).toHaveLength(5);
  });
});

describe("createExecutionPlan", () => {
  let registry: SkillRegistry;

  beforeEach(() => {
    registry = new SkillRegistry();
  });

  it("returns a plan with matching skills and config", () => {
    registry.register(makeManifest({ skillId: "s1" }));
    registry.activate("s1");

    const plan = createExecutionPlan(registry, "PRE_SESSION", "sneakers");
    expect(plan.hookPoint).toBe("PRE_SESSION");
    expect(plan.skills).toHaveLength(1);
    expect(plan.config.maxSkillsPerHookPoint).toBe(5);
    expect(plan.config.timeoutMs).toBe(5000);
    expect(plan.config.failurePolicy).toBe("SKIP");
  });

  it("merges partial config with defaults", () => {
    const plan = createExecutionPlan(registry, "PRE_SESSION", "sneakers", {
      timeoutMs: 10000,
      failurePolicy: "ABORT",
    });
    expect(plan.config.timeoutMs).toBe(10000);
    expect(plan.config.failurePolicy).toBe("ABORT");
    expect(plan.config.maxSkillsPerHookPoint).toBe(5); // default preserved
  });

  it("returns empty skills for empty registry", () => {
    const plan = createExecutionPlan(registry, "PRE_SESSION", "sneakers");
    expect(plan.skills).toHaveLength(0);
  });

  it("returns empty skills when no skills match", () => {
    registry.register(makeManifest({ skillId: "s1", hookPoints: ["POST_ROUND"] }));
    registry.activate("s1");

    const plan = createExecutionPlan(registry, "PRE_SESSION", "sneakers");
    expect(plan.skills).toHaveLength(0);
  });

  it("respects maxSkillsPerHookPoint from config override", () => {
    for (let i = 0; i < 8; i++) {
      registry.register(makeManifest({ skillId: `s${i}` }));
      registry.activate(`s${i}`);
    }

    const plan = createExecutionPlan(registry, "PRE_SESSION", "sneakers", {
      maxSkillsPerHookPoint: 2,
    });
    expect(plan.skills).toHaveLength(2);
  });
});
