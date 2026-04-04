import { describe, it, expect } from "vitest";
import {
  normalizeTagName,
  validateTag,
  extractHierarchy,
  getParentPath,
} from "../normalize.js";
import { defaultTagConfig } from "../types.js";

describe("normalizeTagName", () => {
  it("lowercases and trims", () => {
    expect(normalizeTagName("  Electronics  ")).toBe("electronics");
  });

  it("collapses internal whitespace", () => {
    expect(normalizeTagName("home   and   garden")).toBe("home and garden");
  });

  it("truncates to maxTagLength", () => {
    const config = { ...defaultTagConfig(), maxTagLength: 10 };
    expect(normalizeTagName("a very long tag name here", config)).toBe(
      "a very lon",
    );
  });

  it("handles empty string", () => {
    expect(normalizeTagName("")).toBe("");
  });

  it("preserves hierarchy separators", () => {
    expect(normalizeTagName("Electronics/Phones/iPhone")).toBe(
      "electronics/phones/iphone",
    );
  });
});

describe("validateTag", () => {
  it("passes valid tag", () => {
    const result = validateTag("Electronics");
    expect(result.valid).toBe(true);
    expect(result.normalized).toBe("electronics");
    expect(result.errors).toHaveLength(0);
  });

  it("rejects empty string", () => {
    const result = validateTag("");
    expect(result.valid).toBe(false);
    expect(result.errors).toContain("Tag name must not be empty");
  });

  it("rejects whitespace-only string", () => {
    const result = validateTag("   ");
    expect(result.valid).toBe(false);
    expect(result.errors).toContain("Tag name must not be empty");
  });

  it("rejects tag with no alphanumeric characters", () => {
    const result = validateTag("---");
    expect(result.valid).toBe(false);
    expect(result.errors).toContain(
      "Tag name must contain at least one alphanumeric character",
    );
  });

  it("warns when tag exceeds max length", () => {
    const config = { ...defaultTagConfig(), maxTagLength: 5 };
    const result = validateTag("electronics", config);
    expect(result.valid).toBe(false);
    expect(result.errors[0]).toContain("exceeds maximum length");
  });

  it("passes hierarchical tag", () => {
    const result = validateTag("electronics/phones");
    expect(result.valid).toBe(true);
    expect(result.normalized).toBe("electronics/phones");
  });
});

describe("extractHierarchy", () => {
  it("returns full hierarchy chain", () => {
    expect(extractHierarchy("electronics/phones/iphone")).toEqual([
      "electronics",
      "electronics/phones",
      "electronics/phones/iphone",
    ]);
  });

  it("returns single element for flat tag", () => {
    expect(extractHierarchy("electronics")).toEqual(["electronics"]);
  });

  it("handles empty string", () => {
    expect(extractHierarchy("")).toEqual([]);
  });

  it("returns empty array for separator-only input", () => {
    expect(extractHierarchy("///")).toEqual([]);
  });
});

describe("getParentPath", () => {
  it("returns parent for nested tag", () => {
    expect(getParentPath("electronics/phones/iphone")).toBe(
      "electronics/phones",
    );
  });

  it("returns parent for two-level tag", () => {
    expect(getParentPath("electronics/phones")).toBe("electronics");
  });

  it("returns undefined for flat tag", () => {
    expect(getParentPath("electronics")).toBeUndefined();
  });
});
