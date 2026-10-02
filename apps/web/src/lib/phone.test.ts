import { describe, expect, it } from "vitest";
import { formatUsPhone, isCompleteUsPhone, phoneDigits } from "./phone";

describe("formatUsPhone", () => {
  it.each([
    ["", ""],
    ["5", "(5"],
    ["555", "(555"],
    ["5551", "(555) 1"],
    ["555123", "(555) 123"],
    ["5551234", "(555) 123-4"],
    ["5551234567", "(555) 123-4567"],
  ])("formats %j as %j", (input, expected) => {
    expect(formatUsPhone(input)).toBe(expected);
  });

  it("ignores letters and punctuation, and caps at 10 digits", () => {
    expect(formatUsPhone("55a5-12x3 4567 89")).toBe("(555) 123-4567");
  });

  it("drops a leading US country code on paste", () => {
    expect(formatUsPhone("+1 (555) 123-4567")).toBe("(555) 123-4567");
    expect(phoneDigits("1-555-123-4567")).toBe("5551234567");
  });

  it("keeps a leading 1 that is typed", () => {
    expect(formatUsPhone("1")).toBe("(1");
    expect(formatUsPhone("123")).toBe("(123");
  });
});

describe("isCompleteUsPhone", () => {
  it("needs all 10 digits", () => {
    expect(isCompleteUsPhone("(555) 123-4567")).toBe(true);
    expect(isCompleteUsPhone("(555) 123-45")).toBe(false);
  });
});
