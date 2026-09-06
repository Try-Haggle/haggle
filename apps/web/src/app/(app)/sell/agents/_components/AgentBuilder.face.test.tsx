import { createBuilderState } from "@haggle/shared";
import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { AgentBuilder, agentStrategySnapshotFromState } from "./AgentBuilder";

describe("AgentBuilder face", () => {
  it("lets the seller change the face in embedded mode (the listing wizard)", () => {
    const onChange = vi.fn();
    // `role` is AgentBuilder's own prop, not ARIA; a literal here trips the
    // a11y lint, so it goes through a const like the real callers' variable.
    const role = "seller" as const;
    const value = createBuilderState({ side: role, presetId: "hunter" });
    render(<AgentBuilder role={role} value={value} onChange={onChange} embedded />);

    fireEvent.click(screen.getByRole("button", { name: "Change face" }));
    fireEvent.click(screen.getByRole("button", { name: "owl" }));

    expect(onChange).toHaveBeenCalledTimes(1);
    const next = onChange.mock.calls[0][0];
    expect(next.agent.emoji).toBe("owl");
    // A face is a change worth saving, but not a strategy override.
    expect(next.dirty).toBe(true);
    expect(next.agent.weights).toBeUndefined();
    expect(next.agent.engineParams).toBeUndefined();
  });

  it("puts the chosen face on the listing snapshot, and the preset's own when none was chosen", () => {
    const base = createBuilderState({ side: "seller", presetId: "hunter" });
    expect(agentStrategySnapshotFromState(base).emoji).toBe("fox");
    const chosen = { ...base, agent: { ...base.agent, emoji: "owl" } };
    expect(agentStrategySnapshotFromState(chosen).emoji).toBe("owl");
  });
});
