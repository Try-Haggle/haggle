import { render } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { OpponentCard } from "./opponent-card";

const src = (container: HTMLElement) => container.querySelector("img")?.getAttribute("src");

describe("OpponentCard face", () => {
  it("shows the seller's chosen face over the preset's own", () => {
    const { container } = render(<OpponentCard presetId="hunter" emoji="owl" />);
    expect(src(container)).toBe("/vendor/fluent-emoji/owl.svg");
  });

  it("falls back to the preset's face on listings published before faces existed", () => {
    const { container } = render(<OpponentCard presetId="hunter" emoji={null} />);
    expect(src(container)).toBe("/vendor/fluent-emoji/fox.svg");
  });
});
