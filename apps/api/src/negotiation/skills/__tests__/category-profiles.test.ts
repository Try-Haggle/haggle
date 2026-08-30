import { describe, expect, it } from "vitest";
import {
  DEFAULT_PROFILE,
  ELECTRONICS_PHONE_PROFILE,
  resolveCategoryProfile,
} from "../category-profiles.js";
import { DefaultEngineSkill } from "../default-engine-skill.js";

describe("resolveCategoryProfile (P3 — taxonomy-driven)", () => {
  it("a real iphone listing (bare electronics + iphone-15-pro tag) gets IMEI in DECIDE context", () => {
    // Mirrors production tags: bare category + hyphenated tag (not a synthetic token).
    const p = resolveCategoryProfile(["electronics", "iphone-15-pro"]);
    expect(p.llmContext).toContain("criteria few-shot");
    expect(p.constraints.some((c) => c.rule === "IMEI_VERIFICATION")).toBe(true);
  });

  it("non-phone electronics (laptops) gets its own checks, NOT IMEI (fixes L4a residual)", () => {
    const p = resolveCategoryProfile(["electronics/laptops"]);
    expect(p.llmContext).toContain("criteria few-shot");
    expect(p.constraints.some((c) => c.rule === "IMEI_VERIFICATION")).toBe(false);
  });

  it("bare electronics gets only top-level checks (no phone/IMEI)", () => {
    const p = resolveCategoryProfile(["electronics"]);
    expect(p.llmContext).toContain("criteria few-shot");
    expect(p.constraints.some((c) => c.rule === "IMEI_VERIFICATION")).toBe(false);
  });

  it("non-electronics categories get their own checks, never IMEI", () => {
    const vehicles = resolveCategoryProfile(["vehicles"]);
    expect(vehicles.llmContext).toContain("criteria few-shot");
    expect(vehicles.constraints.some((c) => c.rule === "IMEI_VERIFICATION")).toBe(false);
    expect(vehicles.constraints.some((c) => c.rule === "TITLE_STATUS")).toBe(true);
    expect(resolveCategoryProfile(["fashion"]).llmContext).toContain("criteria few-shot");
  });

  it("unknown / empty tags fall back to the neutral profile", () => {
    expect(resolveCategoryProfile([])).toBe(DEFAULT_PROFILE);
    expect(resolveCategoryProfile(["nonsense-tag"])).toBe(DEFAULT_PROFILE);
  });
});

describe("DefaultEngineSkill category profile", () => {
  it("non-electronics session gets no iPhone/IMEI content", () => {
    const skill = new DefaultEngineSkill(DEFAULT_PROFILE);
    expect(skill.id).toBe("generic-v1");
    expect(skill.getLLMContext()).not.toMatch(/iPhone|IMEI/i);
    expect(skill.getConstraints()).toHaveLength(0);
    expect(skill.getTermDeclaration().category_terms).toHaveLength(0);
  });

  it("electronics session keeps iPhone/IMEI content", () => {
    const skill = new DefaultEngineSkill(ELECTRONICS_PHONE_PROFILE);
    expect(skill.id).toBe("electronics-iphone-pro-v1");
    expect(skill.getLLMContext()).toMatch(/Electronics/);
    expect(skill.getConstraints().some((c) => c.rule === "IMEI_REQUIRED")).toBe(true);
  });

  it("defaults to the electronics profile for legacy no-arg construction", () => {
    const skill = new DefaultEngineSkill();
    expect(skill.id).toBe("electronics-iphone-pro-v1");
    expect(skill.getConstraints().some((c) => c.rule === "IMEI_REQUIRED")).toBe(true);
  });

  it("decision logic is unchanged (tactics stay category-neutral)", () => {
    const neutral = new DefaultEngineSkill(DEFAULT_PROFILE);
    const phone = new DefaultEngineSkill(ELECTRONICS_PHONE_PROFILE);
    expect(neutral.getTactics()).toEqual(phone.getTactics());
    expect(neutral.getTactics()).toContain("anchoring");
  });
});
