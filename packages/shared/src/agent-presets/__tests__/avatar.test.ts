import { describe, expect, it } from "vitest";
import {
  AGENT_ANIMALS,
  isAgentAnimal,
  LEGACY_AGENT_EMOJI_ANIMAL,
  resolveAgentAvatar,
} from "../avatar.js";
import { NEGOTIATION_AGENT_PRESETS } from "../negotiation-agent-presets.js";

describe("resolveAgentAvatar", () => {
  it("resolves a known animal slug", () => {
    expect(resolveAgentAvatar("owl")).toEqual({ kind: "animal", animal: "owl" });
  });

  it("maps the presets' pre-animal glyphs to their animals, so old rows follow", () => {
    for (const [glyph, animal] of Object.entries(LEGACY_AGENT_EMOJI_ANIMAL)) {
      expect(resolveAgentAvatar(glyph)).toEqual({ kind: "animal", animal });
    }
    // Whitespace around a stored glyph must not defeat the mapping.
    expect(resolveAgentAvatar(" 🎯 ")).toEqual({ kind: "animal", animal: "fox" });
  });

  it("passes any other glyph through untouched", () => {
    expect(resolveAgentAvatar("🤝")).toEqual({ kind: "glyph", glyph: "🤝" });
    expect(resolveAgentAvatar("dragon")).toEqual({ kind: "glyph", glyph: "dragon" });
  });

  it("uses the fallback only for an empty value", () => {
    expect(resolveAgentAvatar(null)).toEqual({ kind: "glyph", glyph: "✦" });
    expect(resolveAgentAvatar("   ", "🤝")).toEqual({ kind: "glyph", glyph: "🤝" });
  });
});

describe("preset avatars", () => {
  it("every preset's default face is a known animal", () => {
    for (const preset of NEGOTIATION_AGENT_PRESETS) {
      expect(isAgentAnimal(preset.emoji), `${preset.id}: ${preset.emoji}`).toBe(true);
    }
  });

  it("no two presets share an animal", () => {
    const faces = NEGOTIATION_AGENT_PRESETS.map((p) => p.emoji);
    expect(new Set(faces).size).toBe(faces.length);
  });

  it("every legacy glyph maps to an allowed animal", () => {
    for (const animal of Object.values(LEGACY_AGENT_EMOJI_ANIMAL)) {
      expect(AGENT_ANIMALS).toContain(animal);
    }
  });
});
