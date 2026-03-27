import { describe, it, expect } from "vitest";
import { classifyColdStart } from "../cold-start.js";

describe("classifyColdStart", () => {
  it("returns NEW for 0 trades", () => {
    expect(classifyColdStart(0)).toBe("NEW");
  });

  it("returns NEW for 1-4 trades", () => {
    expect(classifyColdStart(1)).toBe("NEW");
    expect(classifyColdStart(4)).toBe("NEW");
  });

  it("returns SCORING at exactly 5 trades", () => {
    expect(classifyColdStart(5)).toBe("SCORING");
  });

  it("returns SCORING for 5-19 trades", () => {
    expect(classifyColdStart(10)).toBe("SCORING");
    expect(classifyColdStart(19)).toBe("SCORING");
  });

  it("returns MATURE at exactly 20 trades", () => {
    expect(classifyColdStart(20)).toBe("MATURE");
  });

  it("returns MATURE for 20+ trades", () => {
    expect(classifyColdStart(50)).toBe("MATURE");
    expect(classifyColdStart(1000)).toBe("MATURE");
  });
});
