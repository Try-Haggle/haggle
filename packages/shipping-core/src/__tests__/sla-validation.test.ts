import { describe, it, expect } from "vitest";
import { validateSla } from "../sla-validation.js";

describe("validateSla", () => {
  it("accepts valid SLA within range", () => {
    const r = validateSla(3, "BOOKS_MEDIA");
    expect(r.valid).toBe(true);
    expect(r.effective_days).toBe(3);
    expect(r.reason).toBeUndefined();
  });

  it("rejects SLA below category minimum", () => {
    const r = validateSla(2, "VEHICLES"); // minimum is 5
    expect(r.valid).toBe(false);
    expect(r.effective_days).toBe(5);
    expect(r.reason).toContain("below the minimum");
  });

  it("rejects SLA above 14 days", () => {
    const r = validateSla(20, "BOOKS_MEDIA");
    expect(r.valid).toBe(false);
    expect(r.effective_days).toBe(14);
    expect(r.reason).toContain("exceeds the maximum");
  });

  it("floors non-integer values", () => {
    const r = validateSla(3.9, "BOOKS_MEDIA");
    expect(r.valid).toBe(true);
    expect(r.effective_days).toBe(3);
  });

  it("rejects zero", () => {
    const r = validateSla(0, "CLOTHING");
    expect(r.valid).toBe(false);
    expect(r.effective_days).toBe(1);
    expect(r.reason).toContain("positive");
  });

  it("rejects negative values", () => {
    const r = validateSla(-5, "CLOTHING");
    expect(r.valid).toBe(false);
    expect(r.effective_days).toBe(1);
  });

  it("validates VEHICLES minimum correctly", () => {
    const r = validateSla(5, "VEHICLES");
    expect(r.valid).toBe(true);
    expect(r.effective_days).toBe(5);
  });

  it("validates REAL_ESTATE minimum correctly", () => {
    const below = validateSla(5, "REAL_ESTATE");
    expect(below.valid).toBe(false);
    expect(below.effective_days).toBe(7);

    const at = validateSla(7, "REAL_ESTATE");
    expect(at.valid).toBe(true);
  });

  it("uses default minimum of 1 for unknown category", () => {
    const r = validateSla(1, "SOME_UNKNOWN");
    expect(r.valid).toBe(true);
    expect(r.effective_days).toBe(1);
  });
});
