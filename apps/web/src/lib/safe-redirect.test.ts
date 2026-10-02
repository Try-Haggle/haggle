import { describe, expect, it } from "vitest";
import { postSignInPath, safeNextPath } from "./safe-redirect";

describe("postSignInPath", () => {
  it("sends a claim token to the seller dashboard, ahead of any next", () => {
    expect(postSignInPath("abc123", "/orders")).toBe("/sell/dashboard?claim=abc123");
  });

  it("encodes the claim token", () => {
    expect(postSignInPath("a&b=c", null)).toBe("/sell/dashboard?claim=a%26b%3Dc");
  });

  it("honours a same-origin next path", () => {
    expect(postSignInPath(null, "/orders/42?tab=ship")).toBe("/orders/42?tab=ship");
  });

  it("falls back to the buyer dashboard", () => {
    expect(postSignInPath(null, null)).toBe("/buy/dashboard");
  });
});

describe("safeNextPath", () => {
  it("keeps path, query and hash", () => {
    expect(safeNextPath("/l/abc?from=share#offer")).toBe("/l/abc?from=share#offer");
  });

  it.each([
    "//evil.example",
    "https://evil.example",
    "evil.example",
    "@evil.example", // glued onto an origin, becomes userinfo → host evil.example
    ".evil.example",
    "/\\evil.example", // browsers read the backslash as a slash → //evil.example
    "/\\/evil.example",
    "/\t/evil.example", // tabs and newlines are stripped while parsing
    "/\n/evil.example",
    "",
    null,
    undefined,
  ])("refuses %j", (next) => {
    expect(safeNextPath(next)).toBeNull();
    expect(postSignInPath(null, next ?? null)).toBe("/buy/dashboard");
  });
});
