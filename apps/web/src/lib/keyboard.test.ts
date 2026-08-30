import { describe, expect, it } from "vitest";
import { isImeComposing, isSubmitEnter } from "./keyboard";

function key(overrides: Record<string, unknown> = {}) {
  const { key = "Enter", shiftKey = false, ...native } = overrides;
  return { key, shiftKey, nativeEvent: native } as Parameters<typeof isSubmitEnter>[0];
}

describe("isImeComposing", () => {
  it("recognises a composing keydown", () => {
    expect(isImeComposing(key({ isComposing: true }))).toBe(true);
  });

  it("recognises the legacy composition keycode", () => {
    // Some Safari and Windows IME combinations report only this.
    expect(isImeComposing(key({ keyCode: 229 }))).toBe(true);
  });

  it("is false for an ordinary keydown", () => {
    expect(isImeComposing(key({ isComposing: false, keyCode: 13 }))).toBe(false);
    expect(isImeComposing(key())).toBe(false);
  });
});

describe("isSubmitEnter", () => {
  it("is true for a plain Enter", () => {
    expect(isSubmitEnter(key())).toBe(true);
  });

  it("is false while composing — that Enter belongs to the IME", () => {
    expect(isSubmitEnter(key({ isComposing: true }))).toBe(false);
    expect(isSubmitEnter(key({ keyCode: 229 }))).toBe(false);
  });

  it("is false for Shift+Enter and for other keys", () => {
    expect(isSubmitEnter(key({ shiftKey: true }))).toBe(false);
    expect(isSubmitEnter(key({ key: "a" }))).toBe(false);
  });
});
