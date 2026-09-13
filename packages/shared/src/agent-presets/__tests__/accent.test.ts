import { describe, expect, it } from "vitest";
import {
  AGENT_ACCENT_MIN_CONTRAST,
  AGENT_ACCENT_SURFACES,
  AGENT_ACCENT_SWATCHES,
  accentContrast,
  normalizeAgentAccent,
  readableAgentAccent,
  resolveAgentAccent,
} from "../accent.js";
import { NEGOTIATION_AGENT_PRESETS } from "../negotiation-agent-presets.js";

const { light, dark } = AGENT_ACCENT_SURFACES;
const clearsBoth = (hex: string) =>
  accentContrast(hex, light) >= AGENT_ACCENT_MIN_CONTRAST &&
  accentContrast(hex, dark) >= AGENT_ACCENT_MIN_CONTRAST;

describe("AGENT_ACCENT_SWATCHES", () => {
  it("offers ten distinct colours", () => {
    const hexes = AGENT_ACCENT_SWATCHES.map((s) => s.hex);
    expect(hexes).toHaveLength(10);
    expect(new Set(hexes).size).toBe(10);
  });

  it("includes every preset accent, so a preset-coloured agent shows as selected", () => {
    const hexes = new Set<string>(AGENT_ACCENT_SWATCHES.map((s) => s.hex));
    for (const preset of NEGOTIATION_AGENT_PRESETS) {
      expect(hexes.has(preset.accentColor.toLowerCase())).toBe(true);
    }
  });

  it("are all readable in both themes, and so pass through untouched", () => {
    for (const { hex } of AGENT_ACCENT_SWATCHES) {
      expect(clearsBoth(hex)).toBe(true);
      expect(readableAgentAccent(hex)).toBe(hex);
    }
  });
});

describe("normalizeAgentAccent", () => {
  it("returns lowercase #rrggbb", () => {
    expect(normalizeAgentAccent("#EF4444")).toBe("#ef4444");
    expect(normalizeAgentAccent("ef4444")).toBe("#ef4444");
    expect(normalizeAgentAccent(" #f0a ")).toBe("#ff00aa");
  });

  it("rejects anything the hex-alpha append would break on", () => {
    for (const bad of ["red", "rgb(1,2,3)", "#12345", "#ef4444ff", "", null, undefined, 42]) {
      expect(normalizeAgentAccent(bad)).toBeNull();
    }
  });
});

describe("readableAgentAccent", () => {
  it("darkens a colour too pale to read on cream, only as far as the floor", () => {
    const fixed = readableAgentAccent("#ffee00");
    expect(clearsBoth(fixed)).toBe(true);
    expect(accentContrast(fixed, light)).toBeLessThan(AGENT_ACCENT_MIN_CONTRAST + 0.05);
  });

  it("lightens a colour too dark to read on navy", () => {
    const fixed = readableAgentAccent("#0a0a0a");
    expect(clearsBoth(fixed)).toBe(true);
  });

  it("keeps the hue: a pale yellow stays yellow", () => {
    const [r, g, b] = [1, 3, 5].map((i) =>
      Number.parseInt(readableAgentAccent("#ffee00").slice(i, i + 2), 16),
    );
    expect(r).toBeGreaterThan(b);
    expect(g).toBeGreaterThan(b);
  });
});

describe("resolveAgentAccent", () => {
  it("normalizes then keeps readable", () => {
    expect(resolveAgentAccent("#3B82F6")).toBe("#3b82f6");
    expect(clearsBoth(resolveAgentAccent("#FFF") ?? "")).toBe(true);
  });

  it("is null when there is nothing usable, so callers fall back to the preset", () => {
    expect(resolveAgentAccent("not a colour")).toBeNull();
    expect(resolveAgentAccent(undefined)).toBeNull();
  });
});
