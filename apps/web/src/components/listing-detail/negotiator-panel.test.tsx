import { getNegotiationAgentPreset } from "@haggle/shared";
import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { NegotiatorPanel } from "./negotiator-panel";

const hunter = getNegotiationAgentPreset("hunter")!;

function mount(extra: Partial<React.ComponentProps<typeof NegotiatorPanel>> = {}) {
  render(
    <NegotiatorPanel
      selection={{ kind: "preset", id: "hunter" }}
      onSelect={vi.fn()}
      effective={hunter}
      override={null}
      onOverrideChange={vi.fn()}
      onResetOverride={vi.fn()}
      {...extra}
    />,
  );
}

describe("NegotiatorPanel avatar row", () => {
  it("is absent on the buyer's listing page, which passes no avatar handler", () => {
    mount();
    expect(screen.queryByRole("button", { name: /avatar/i })).toBeNull();
  });

  it("appears for the seller, naming the current animal", () => {
    mount({ role: "seller", onAvatarChange: vi.fn(), onAccentChange: vi.fn() });
    expect(screen.getByRole("button", { name: /Avatar Fox/ })).toBeInTheDocument();
  });
});

describe("NegotiatorPanel saved agents", () => {
  it("shows an agent saved without a face wearing its archetype's, as the Agent Studio does", () => {
    const { container } = render(
      <NegotiatorPanel
        selection={null}
        onSelect={vi.fn()}
        savedAgents={[
          { id: "a1", name: "brass telescope agent", emoji: null, presetId: "verifier" },
        ]}
        override={null}
        onOverrideChange={vi.fn()}
        onResetOverride={vi.fn()}
      />,
    );
    const tile = screen.getByRole("button", { name: /brass telescope agent/ });
    expect(tile.innerHTML).toContain("owl.svg");
    expect(container.textContent).not.toContain("✦");
  });
});
