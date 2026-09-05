import { existsSync } from "node:fs";
import path from "node:path";
import { AGENT_ANIMALS } from "@haggle/shared";
import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { AgentAvatar } from "./agent-avatar";

describe("AgentAvatar", () => {
  it("renders a stored emoji glyph as text", () => {
    render(<AgentAvatar value="🎯" />);
    expect(screen.getByText("🎯")).toBeInTheDocument();
    expect(document.querySelector("img")).toBeNull();
  });

  it("renders an animal slug as the vendored artwork", () => {
    const { container } = render(<AgentAvatar value="fox" />);
    const img = container.querySelector("img");
    expect(img).not.toBeNull();
    expect(img?.getAttribute("src")).toBe("/vendor/fluent-emoji/fox.svg");
    // Decorative: the name next to it is the accessible label.
    expect(img?.getAttribute("alt")).toBe("");
  });

  it("falls back for an empty value, and passes unknown strings through", () => {
    render(<AgentAvatar value={null} fallback="✦" />);
    expect(screen.getByText("✦")).toBeInTheDocument();
    render(<AgentAvatar value="not-an-animal" />);
    expect(screen.getByText("not-an-animal")).toBeInTheDocument();
  });

  it("has artwork on disk for every animal the shared package allows", () => {
    // Guards drift between AGENT_ANIMALS and scripts/vendor-fluent-emoji.mjs:
    // a slug without a file would ship as a broken image.
    const dir = path.resolve(__dirname, "../../../public/vendor/fluent-emoji");
    const missing = AGENT_ANIMALS.filter((slug) => !existsSync(path.join(dir, `${slug}.svg`)));
    expect(missing).toEqual([]);
  });
});
