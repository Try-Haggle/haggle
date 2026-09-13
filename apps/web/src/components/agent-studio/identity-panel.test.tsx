import { createBuilderState, resolveEffectivePreset } from "@haggle/shared";
import { fireEvent, render, screen, within } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { AgentIdentityPanel } from "./identity-panel";

function mount() {
  const onAvatarChange = vi.fn();
  const onAccentChange = vi.fn();
  // `role` is the panel's own prop, not ARIA; a literal trips the a11y lint.
  const role = "buyer" as const;
  const state = createBuilderState({ side: role, presetId: "hunter" });
  render(
    <AgentIdentityPanel
      effective={resolveEffectivePreset(state)}
      state={state}
      role={role}
      memory={null}
      name=""
      onNameChange={() => {}}
      onAvatarChange={onAvatarChange}
      onAccentChange={onAccentChange}
    />,
  );
  return { onAvatarChange, onAccentChange };
}

describe("AgentIdentityPanel avatar", () => {
  // Both ways in must offer the same choices. The labelled field once opened
  // faces only while the header chip offered colours too.
  it.each([
    ["the Agent avatar field", /agent avatar/i],
    ["the header face", /change avatar/i],
  ])("opens faces and colours from %s", (_where, name) => {
    const { onAccentChange } = mount();
    fireEvent.click(screen.getByRole("button", { name }));
    expect(screen.getByRole("group", { name: "Choose an avatar" })).toBeInTheDocument();
    const colours = within(screen.getByRole("group", { name: "Color" }));
    fireEvent.click(colours.getByRole("button", { name: "teal" }));
    expect(onAccentChange).toHaveBeenCalledWith("#14b8a6");
  });
});
