import { describe, it, expect, beforeEach } from "vitest";
import { SkillRegistry } from "../registry.js";
import type { SkillManifest, RegisteredSkill } from "../types.js";

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

function isRegistered(result: RegisteredSkill | { error: string }): result is RegisteredSkill {
  return !("error" in result);
}

describe("SkillRegistry", () => {
  let registry: SkillRegistry;

  beforeEach(() => {
    registry = new SkillRegistry();
  });

  describe("register", () => {
    it("creates a DRAFT skill from a valid manifest", () => {
      const result = registry.register(makeManifest());
      expect(isRegistered(result)).toBe(true);
      if (isRegistered(result)) {
        expect(result.status).toBe("DRAFT");
        expect(result.usageCount).toBe(0);
        expect(result.averageLatencyMs).toBe(0);
        expect(result.errorRate).toBe(0);
        expect(result.manifest.skillId).toBe("test-skill-v1");
      }
    });

    it("returns error for invalid manifest", () => {
      const result = registry.register(makeManifest({ skillId: "" }));
      expect("error" in result).toBe(true);
    });

    it("returns error for duplicate skillId", () => {
      registry.register(makeManifest());
      const result = registry.register(makeManifest());
      expect("error" in result).toBe(true);
      if ("error" in result) {
        expect(result.error).toContain("already registered");
      }
    });
  });

  describe("activate", () => {
    it("transitions DRAFT to ACTIVE", () => {
      registry.register(makeManifest());
      expect(registry.activate("test-skill-v1")).toBe(true);
      expect(registry.get("test-skill-v1")?.status).toBe("ACTIVE");
    });

    it("fails for non-existent skill", () => {
      expect(registry.activate("nonexistent")).toBe(false);
    });

    it("fails if skill is not DRAFT", () => {
      registry.register(makeManifest());
      registry.activate("test-skill-v1");
      // Already ACTIVE, cannot activate again
      expect(registry.activate("test-skill-v1")).toBe(false);
    });
  });

  describe("suspend", () => {
    it("transitions ACTIVE to SUSPENDED", () => {
      registry.register(makeManifest());
      registry.activate("test-skill-v1");
      expect(registry.suspend("test-skill-v1")).toBe(true);
      expect(registry.get("test-skill-v1")?.status).toBe("SUSPENDED");
    });

    it("fails if skill is DRAFT", () => {
      registry.register(makeManifest());
      expect(registry.suspend("test-skill-v1")).toBe(false);
    });
  });

  describe("deprecate", () => {
    it("transitions ACTIVE to DEPRECATED", () => {
      registry.register(makeManifest());
      registry.activate("test-skill-v1");
      expect(registry.deprecate("test-skill-v1")).toBe(true);
      expect(registry.get("test-skill-v1")?.status).toBe("DEPRECATED");
    });

    it("transitions SUSPENDED to DEPRECATED", () => {
      registry.register(makeManifest());
      registry.activate("test-skill-v1");
      registry.suspend("test-skill-v1");
      expect(registry.deprecate("test-skill-v1")).toBe(true);
      expect(registry.get("test-skill-v1")?.status).toBe("DEPRECATED");
    });

    it("fails if skill is DRAFT", () => {
      registry.register(makeManifest());
      expect(registry.deprecate("test-skill-v1")).toBe(false);
    });

    it("fails if skill is already DEPRECATED", () => {
      registry.register(makeManifest());
      registry.activate("test-skill-v1");
      registry.deprecate("test-skill-v1");
      expect(registry.deprecate("test-skill-v1")).toBe(false);
    });
  });

  describe("get", () => {
    it("returns registered skill", () => {
      registry.register(makeManifest());
      const skill = registry.get("test-skill-v1");
      expect(skill).toBeDefined();
      expect(skill?.manifest.name).toBe("Test Skill");
    });

    it("returns undefined for unknown skillId", () => {
      expect(registry.get("nonexistent")).toBeUndefined();
    });
  });

  describe("findByHookPoint", () => {
    it("returns ACTIVE skills matching hook point", () => {
      registry.register(makeManifest({ skillId: "s1", hookPoints: ["PRE_SESSION"] }));
      registry.activate("s1");
      registry.register(makeManifest({ skillId: "s2", hookPoints: ["POST_ROUND"] }));
      registry.activate("s2");

      const results = registry.findByHookPoint("PRE_SESSION");
      expect(results).toHaveLength(1);
      expect(results[0].manifest.skillId).toBe("s1");
    });

    it("filters by product category when provided", () => {
      registry.register(
        makeManifest({
          skillId: "s1",
          hookPoints: ["PRE_SESSION"],
          supportedCategories: ["sneakers"],
        }),
      );
      registry.activate("s1");
      registry.register(
        makeManifest({
          skillId: "s2",
          hookPoints: ["PRE_SESSION"],
          supportedCategories: ["watches"],
        }),
      );
      registry.activate("s2");

      const results = registry.findByHookPoint("PRE_SESSION", "sneakers");
      expect(results).toHaveLength(1);
      expect(results[0].manifest.skillId).toBe("s1");
    });

    it("ignores non-ACTIVE skills", () => {
      registry.register(makeManifest({ skillId: "draft-skill" }));
      // Not activated — stays DRAFT
      const results = registry.findByHookPoint("PRE_SESSION");
      expect(results).toHaveLength(0);
    });

    it("returns empty for no matches", () => {
      const results = registry.findByHookPoint("ON_DISPUTE_OPEN");
      expect(results).toHaveLength(0);
    });
  });

  describe("findByCategory", () => {
    it("returns ACTIVE skills of given category", () => {
      registry.register(makeManifest({ skillId: "s1", category: "STRATEGY" }));
      registry.activate("s1");
      registry.register(makeManifest({ skillId: "s2", category: "DATA" }));
      registry.activate("s2");

      const results = registry.findByCategory("STRATEGY");
      expect(results).toHaveLength(1);
      expect(results[0].manifest.skillId).toBe("s1");
    });

    it("ignores non-ACTIVE skills", () => {
      registry.register(makeManifest({ skillId: "s1", category: "STRATEGY" }));
      const results = registry.findByCategory("STRATEGY");
      expect(results).toHaveLength(0);
    });
  });

  describe("listAll", () => {
    it("returns all skills regardless of status", () => {
      registry.register(makeManifest({ skillId: "s1" }));
      registry.register(makeManifest({ skillId: "s2" }));
      registry.activate("s2");
      expect(registry.listAll()).toHaveLength(2);
    });

    it("returns empty array for empty registry", () => {
      expect(registry.listAll()).toHaveLength(0);
    });
  });

  describe("recordUsage", () => {
    it("updates usage count", () => {
      registry.register(makeManifest());
      registry.recordUsage("test-skill-v1", 100, true);
      const skill = registry.get("test-skill-v1")!;
      expect(skill.usageCount).toBe(1);
    });

    it("computes rolling average latency", () => {
      registry.register(makeManifest());
      registry.recordUsage("test-skill-v1", 100, true);
      registry.recordUsage("test-skill-v1", 200, true);
      const skill = registry.get("test-skill-v1")!;
      expect(skill.averageLatencyMs).toBe(150);
    });

    it("computes error rate", () => {
      registry.register(makeManifest());
      registry.recordUsage("test-skill-v1", 100, true);
      registry.recordUsage("test-skill-v1", 100, false);
      const skill = registry.get("test-skill-v1")!;
      expect(skill.errorRate).toBe(0.5);
    });

    it("does nothing for unknown skillId", () => {
      // Should not throw
      registry.recordUsage("nonexistent", 100, true);
    });
  });
});
