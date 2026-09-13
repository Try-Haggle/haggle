import { AGENT_ACCENT_SWATCHES, AGENT_ANIMALS, accentContrast } from "@haggle/shared";
import { fireEvent, render, screen, within } from "@testing-library/react";
import { useState } from "react";
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

describe("AgentAvatarPicker — colour", () => {
  function mountWithAccent(accent: string, onAccentChange = vi.fn(), onChange = vi.fn()) {
    render(
      <AgentAvatarPicker
        value="fox"
        onChange={onChange}
        accent={accent}
        onAccentChange={onAccentChange}
        trigger={<button type="button">Change avatar</button>}
      />,
    );
    fireEvent.click(screen.getByRole("button", { name: "Change avatar" }));
    return { onAccentChange, onChange };
  }

  it("has no colour section unless the caller can store a colour", () => {
    mount("fox");
    fireEvent.click(screen.getByRole("button", { name: "Change face" }));
    expect(screen.queryByRole("group", { name: "Color" })).toBeNull();
  });

  it("offers every swatch with the current one checked", () => {
    mountWithAccent("#3b82f6");
    const group = within(screen.getByRole("group", { name: "Color" }));
    for (const swatch of AGENT_ACCENT_SWATCHES) {
      expect(group.getByRole("button", { name: swatch.id })).toHaveAttribute(
        "aria-pressed",
        swatch.hex === "#3b82f6" ? "true" : "false",
      );
    }
  });

  it("reports a swatch pick as its hex", () => {
    const { onAccentChange } = mountWithAccent("#3b82f6");
    fireEvent.click(screen.getByRole("button", { name: "pink" }));
    expect(onAccentChange).toHaveBeenCalledWith("#ec4899");
  });

  it("stays open after a face is picked, so the colour can be chosen too", () => {
    const { onChange } = mountWithAccent("#3b82f6");
    fireEvent.click(screen.getByRole("button", { name: "owl" }));
    expect(onChange).toHaveBeenCalledWith("owl");
    expect(screen.getByRole("group", { name: "Color" })).toBeInTheDocument();
  });

  it("keeps a pale custom colour readable and says so", () => {
    const { onAccentChange } = mountWithAccent("#3b82f6");
    fireEvent.click(screen.getByRole("button", { name: "Custom color" }));
    fireEvent.change(screen.getByRole("textbox", { name: "Hex color" }), {
      target: { value: "#ffee00" },
    });
    const stored = onAccentChange.mock.calls.at(-1)?.[0] as string;
    expect(stored).not.toBe("#ffee00");
    expect(accentContrast(stored, "#fbf9f5")).toBeGreaterThanOrEqual(2);
  });

  it("opens straight to the custom picker when the current colour is not a swatch", () => {
    mountWithAccent("#123456");
    expect(screen.getByRole("textbox", { name: "Hex color" })).toBeInTheDocument();
  });

  it("opens Custom on the colour the agent has now, with no false adjustment notice", () => {
    // A real parent: the pick flows back in as the new accent, which is the
    // case where the picker's own starting colour could go stale.
    function Host() {
      const [accent, setAccent] = useState("#3b82f6");
      return (
        <AgentAvatarPicker
          value="fox"
          onChange={() => {}}
          accent={accent}
          onAccentChange={setAccent}
          trigger={<button type="button">Change avatar</button>}
        />
      );
    }
    render(<Host />);
    fireEvent.click(screen.getByRole("button", { name: "Change avatar" }));
    fireEvent.click(screen.getByRole("button", { name: "pink" }));
    fireEvent.click(screen.getByRole("button", { name: "Custom color" }));
    expect(screen.getByRole("textbox", { name: "Hex color" })).toHaveValue("#ec4899");
    expect(screen.queryByText(/stays readable/)).toBeNull();
  });
});
