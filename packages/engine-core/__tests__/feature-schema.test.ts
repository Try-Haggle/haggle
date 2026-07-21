import { describe, expect, it } from "vitest";
import { FEATURE_SCHEMA, getFeatureDef, isKnownFeatureKey } from "../src/features/schema.js";

describe("FEATURE_SCHEMA integrity (H4)", () => {
  it("has unique keys", () => {
    const keys = FEATURE_SCHEMA.map((f) => f.key);
    expect(new Set(keys).size).toBe(keys.length);
  });

  it("every entry has a valid routing", () => {
    for (const f of FEATURE_SCHEMA) {
      expect(["value_adjust", "term"]).toContain(f.routing);
    }
  });

  it("term-routed features declare a termKind; value_adjust ones do not", () => {
    for (const f of FEATURE_SCHEMA) {
      if (f.routing === "term") {
        expect(f.termKind, `${f.key} is a term but has no termKind`).toBeDefined();
        expect(["negotiable", "informational"]).toContain(f.termKind);
      } else {
        expect(f.termKind, `${f.key} is value_adjust but declares a termKind`).toBeUndefined();
      }
    }
  });

  it("enum features list enumValues; non-enum features do not", () => {
    for (const f of FEATURE_SCHEMA) {
      if (f.valueType === "enum") {
        expect(f.enumValues, `${f.key} is enum but has no enumValues`).toBeDefined();
        expect(f.enumValues!.length).toBeGreaterThan(0);
      } else {
        expect(f.enumValues, `${f.key} is not enum but lists enumValues`).toBeUndefined();
      }
    }
  });

  it("every entry has a non-empty description and category", () => {
    for (const f of FEATURE_SCHEMA) {
      expect(f.description.length).toBeGreaterThan(0);
      expect(f.category.length).toBeGreaterThan(0);
    }
  });

  it("includes the phones-first + universal keys the sensor/rules will target", () => {
    const keys = new Set(FEATURE_SCHEMA.map((f) => f.key));
    // value_adjust
    expect(keys).toContain("battery_health");
    expect(keys).toContain("storage_capacity");
    expect(keys).toContain("cosmetic_grade");
    // informational gates
    expect(keys).toContain("imei_verification");
    expect(keys).toContain("find_my_status");
    // negotiable terms
    expect(keys).toContain("shipping_method");
    expect(keys).toContain("warranty_period");
  });

  it("gates (IMEI / Find My) route to term/informational, not value_adjust", () => {
    for (const key of ["imei_verification", "find_my_status"]) {
      const def = getFeatureDef(key);
      expect(def).toBeDefined();
      expect(def!.routing).toBe("term");
      expect(def!.termKind).toBe("informational");
    }
  });

  it("getFeatureDef / isKnownFeatureKey resolve known vs unknown keys", () => {
    expect(getFeatureDef("battery_health")?.unit).toBe("%");
    expect(getFeatureDef("nonexistent_key")).toBeUndefined();
    expect(isKnownFeatureKey("shipping_method")).toBe(true);
    expect(isKnownFeatureKey("made_up")).toBe(false);
  });
});
