import { describe, expect, it } from "vitest";
import { CATEGORY_TAXONOMY, getCategoryNode, resolveChecks } from "../taxonomy.js";

const ids = (tags: string[]) => resolveChecks(tags).map((c) => c.id);

describe("CATEGORY_TAXONOMY integrity", () => {
  it("has unique node paths", () => {
    const paths = CATEGORY_TAXONOMY.map((n) => n.path);
    expect(new Set(paths).size).toBe(paths.length);
  });

  it("every check has an id, question, and valid enforcement", () => {
    for (const node of CATEGORY_TAXONOMY) {
      for (const c of node.checks) {
        expect(c.id.length).toBeGreaterThan(0);
        expect(c.questionKo.length).toBeGreaterThan(0);
        expect(["hard", "soft"]).toContain(c.enforcement);
      }
    }
  });
});

describe("resolveChecks (hierarchical inheritance)", () => {
  it("iphone inherits electronics + phones + iphone checks (incl IMEI gate)", () => {
    const got = ids(["iphone"]);
    // ancestors
    expect(got).toContain("working_status"); // electronics
    expect(got).toContain("battery_health"); // electronics/phones
    // node
    expect(got).toContain("imei_verification"); // iphone
    expect(got).toContain("find_my_status");
  });

  it("resolves the full path directly too", () => {
    expect(ids(["electronics/phones/iphone"])).toContain("imei_verification");
  });

  it("a non-phone electronics item does NOT get IMEI", () => {
    const got = ids(["electronics/laptops"]);
    expect(got).toContain("battery_cycles");
    expect(got).toContain("working_status"); // inherited
    expect(got).not.toContain("imei_verification");
  });

  it("a bare electronics category gets only the top-level checks", () => {
    const got = ids(["electronics"]);
    expect(got).toContain("working_status");
    expect(got).not.toContain("battery_health"); // phones-level, not inherited upward
    expect(got).not.toContain("imei_verification");
  });

  it("non-electronics categories get their own checks, never IMEI", () => {
    const clothing = ids(["clothing"]);
    expect(clothing).toContain("authenticity");
    expect(clothing).not.toContain("imei_verification");

    const vehicles = ids(["vehicles"]);
    expect(vehicles).toContain("title_status");
    expect(vehicles).not.toContain("imei_verification");
  });

  it("matches by alias (fashion → clothing, 아이폰 → iphone)", () => {
    expect(ids(["fashion"])).toContain("authenticity");
    expect(ids(["아이폰"])).toContain("imei_verification");
  });

  it("dedupes shared check ids across levels (cosmetic_grade)", () => {
    const got = resolveChecks(["clothing"]).filter((c) => c.id === "cosmetic_grade");
    expect(got).toHaveLength(1);
  });

  it("unknown / empty tags resolve to no checks", () => {
    expect(resolveChecks(["nonsense"])).toHaveLength(0);
    expect(resolveChecks([])).toHaveLength(0);
  });

  it("getCategoryNode looks up by exact path", () => {
    expect(getCategoryNode("vehicles")?.checks.length).toBeGreaterThan(0);
    expect(getCategoryNode("nope")).toBeUndefined();
  });
});
