import { AGENT_ANIMALS } from "@haggle/shared";
import { fireEvent, render, screen, within } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { AgentAvatarPicker, agentAvatarLabel } from "./agent-avatar-picker";

function mount(value: string | null, onChange = vi.fn()) {
  render(
    <AgentAvatarPicker
      value={value}
      onChange={onChange}
      trigger={<button type="button">Change face</button>}
    />,
  );
  return onChange;
}

describe("AgentAvatarPicker", () => {
  it("opens to every vendored animal, with the current one checked", () => {
    mount("owl");
    fireEvent.click(screen.getByRole("button", { name: "Change face" }));
    const group = within(screen.getByRole("group", { name: "Choose an avatar" }));
    expect(group.getAllByRole("button")).toHaveLength(AGENT_ANIMALS.length);
    expect(group.getByRole("button", { name: "owl" })).toHaveAttribute("aria-pressed", "true");
    expect(group.getByRole("button", { name: "fox" })).toHaveAttribute("aria-pressed", "false");
  });

  it("reports the pick and closes", () => {
    const onChange = mount("fox");
    fireEvent.click(screen.getByRole("button", { name: "Change face" }));
    fireEvent.click(screen.getByRole("button", { name: "polar bear" }));
    expect(onChange).toHaveBeenCalledWith("polar-bear");
    expect(screen.queryByRole("group", { name: "Choose an avatar" })).toBeNull();
  });

  it("checks nothing when the stored value is a plain glyph", () => {
    mount("🤝");
    fireEvent.click(screen.getByRole("button", { name: "Change face" }));
    const group = within(screen.getByRole("group", { name: "Choose an avatar" }));
    expect(group.queryAllByRole("button", { pressed: true })).toHaveLength(0);
  });
});

describe("agentAvatarLabel", () => {
  it("names an animal the way a person would say it", () => {
    expect(agentAvatarLabel("fox")).toBe("Fox");
    expect(agentAvatarLabel("polar-bear")).toBe("Polar bear");
  });

  it("names a legacy emoji by the animal it resolves to", () => {
    expect(agentAvatarLabel("🎯")).toBe("Fox");
  });

  it("has no name for a plain glyph", () => {
    expect(agentAvatarLabel("🤝")).toBeNull();
    expect(agentAvatarLabel(null)).toBeNull();
  });
});
