import { describe, expect, it } from "vitest";
import {
  DEFAULT_PROFILE,
  ELECTRONICS_PHONE_PROFILE,
  resolveCategoryProfile,
} from "../category-profiles.js";
import { DefaultEngineSkill } from "../default-engine-skill.js";

describe("resolveCategoryProfile (L4a / HAGGLE-9-B)", () => {
  it("maps electronics tags to the phone profile", () => {
    expect(resolveCategoryProfile(["electronics"])).toBe(ELECTRONICS_PHONE_PROFILE);
    expect(resolveCategoryProfile(["electronics/phones"])).toBe(ELECTRONICS_PHONE_PROFILE);
    expect(resolveCategoryProfile(["electronics/laptops"])).toBe(ELECTRONICS_PHONE_PROFILE);
  });

  it("maps non-electronics (and empty) tags to the neutral profile", () => {
    expect(resolveCategoryProfile(["fashion"])).toBe(DEFAULT_PROFILE);
    expect(resolveCategoryProfile(["home/furniture"])).toBe(DEFAULT_PROFILE);
    expect(resolveCategoryProfile([])).toBe(DEFAULT_PROFILE);
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
