import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import type { NegotiationAgentState } from "@/lib/negotiation-agent-state";
import { AgentPresence } from "./agent-presence";

describe("AgentPresence", () => {
  it("names the agent and its state for assistive tech", () => {
    render(<AgentPresence value="fox" accent="#ef4444" state="question" label="Bargain Hunter" />);
    expect(
      screen.getByRole("img", { name: "Bargain Hunter — Needs your answer" }),
    ).toBeInTheDocument();
  });

  it.each<[NegotiationAgentState, boolean]>([
    ["idle", false],
    ["thinking", false],
    ["offer", true],
    ["waiting", true],
    ["question", true],
    ["deal", true],
    ["walked", true],
  ])("%s carries a corner badge: %s", (state, hasBadge) => {
    const { container } = render(<AgentPresence value="owl" accent="#3b82f6" state={state} />);
    const root = container.querySelector(`[data-state="${state}"]`);
    expect(root).not.toBeNull();
    // chip + optional badge are the root's span children
    const spans = root?.querySelectorAll(":scope > span") ?? [];
    expect(spans.length).toBe(hasBadge ? 2 : 1);
  });
});
