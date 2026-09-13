import { type NegotiationAgent, resolveEffectivePreset } from "@haggle/shared";
import { describe, expect, it } from "vitest";
import { agentStrategySnapshotFromState } from "../../agents/_components/AgentBuilder";
import {
  agentStateFromPick,
  EMPTY_SELLER_AGENT_PICK,
  pickFromSnapshot,
  type SellerAgentPick,
  savedAgentOption,
} from "./seller-agent-pick";

const savedRow: NegotiationAgent = {
  id: "agent-1",
  name: "Firm lister",
  role: "seller",
  emoji: "wolf",
  accentColor: "#64748b",
  negotiationAgentPresetId: "hunter",
  weights: { w_p: 0.7, w_t: 0.1, w_r: 0.1, w_s: 0.1 },
  engineParams: { beta: 3.2 },
  builderChatMemory: { dealBreakers: ["no trades"] },
  createdAt: 1_757_030_400_000,
  updatedAt: 1_757_030_400_000,
};

describe("agentStateFromPick", () => {
  it("is null until something is picked", () => {
    expect(agentStateFromPick(EMPTY_SELLER_AGENT_PICK, [])).toBeNull();
  });

  it("builds a bare preset as the old step did", () => {
    const state = agentStateFromPick(
      { ...EMPTY_SELLER_AGENT_PICK, selection: { kind: "preset", id: "closer" } },
      [],
    );
    expect(state?.source).toEqual({ kind: "preset", id: "closer" });
    expect(state?.side).toBe("seller");
    expect(state?.agent.weights).toBeUndefined();
  });

  it("starts a saved agent from its own row, memory and face included", () => {
    const state = agentStateFromPick(
      {
        ...EMPTY_SELLER_AGENT_PICK,
        selection: { kind: "saved", id: "agent-1", presetId: "hunter" },
      },
      [savedRow],
    );
    expect(state?.source).toEqual({ kind: "custom", id: "agent-1" });
    expect(state?.agent.emoji).toBe("wolf");
    expect(state?.agent.builderChatMemory).toEqual({ dealBreakers: ["no trades"] });
  });

  it("layers this wizard's tuning and face over the starting point", () => {
    const pick: SellerAgentPick = {
      selection: { kind: "saved", id: "agent-1", presetId: "hunter" },
      overrides: {
        "saved:agent-1": { weights: { w_p: 0.4, w_t: 0.4, w_r: 0.1, w_s: 0.1 }, alpha: 0.9 },
      },
      identity: { "saved:agent-1": { emoji: "fox", accentColor: "#ec4899" } },
    };
    const effective = resolveEffectivePreset(agentStateFromPick(pick, [savedRow])!);
    expect(effective.weights).toEqual({ w_p: 0.4, w_t: 0.4, w_r: 0.1, w_s: 0.1 });
    expect(effective.alpha).toBe(0.9);
    // Knobs the wizard did not touch keep the saved agent's value.
    expect(effective.beta).toBe(3.2);
    expect(effective.emoji).toBe("fox");
    expect(effective.accentColor).toBe("#ec4899");
  });

  it("falls back to the archetype when a saved agent is no longer in the list", () => {
    const state = agentStateFromPick(
      {
        ...EMPTY_SELLER_AGENT_PICK,
        selection: { kind: "saved", id: "gone", presetId: "verifier" },
      },
      [],
    );
    expect(state?.agent.presetId).toBe("verifier");
  });
});

describe("pickFromSnapshot — resuming a draft", () => {
  it("reopens the same agent the seller had, tuning and face included", () => {
    const pick: SellerAgentPick = {
      selection: { kind: "preset", id: "verifier" },
      overrides: {
        "preset:verifier": {
          weights: { w_p: 0.2, w_t: 0.2, w_r: 0.5, w_s: 0.1 },
          u_threshold: 0.7,
        },
      },
      identity: { "preset:verifier": { emoji: "owl", accentColor: "#14b8a6" } },
    };
    const before = resolveEffectivePreset(agentStateFromPick(pick, [])!);
    const snapshot = agentStrategySnapshotFromState(agentStateFromPick(pick, [])!, null);
    const after = resolveEffectivePreset(agentStateFromPick(pickFromSnapshot(snapshot), [])!);

    expect(after.weights).toEqual(before.weights);
    expect(after.u_threshold).toBe(before.u_threshold);
    expect(after.emoji).toBe("owl");
    expect(after.accentColor).toBe("#14b8a6");
  });

  it("reopens a saved agent as that saved agent", () => {
    const state = agentStateFromPick(
      {
        ...EMPTY_SELLER_AGENT_PICK,
        selection: { kind: "saved", id: "agent-1", presetId: "hunter" },
      },
      [savedRow],
    );
    const pick = pickFromSnapshot(agentStrategySnapshotFromState(state!, null));
    expect(pick.selection).toEqual({ kind: "saved", id: "agent-1", presetId: "hunter" });
  });

  it("starts empty for drafts saved before step 5 or with an unknown preset", () => {
    expect(pickFromSnapshot(null).selection).toBeNull();
    expect(pickFromSnapshot({ sellingDeadlineLocalDate: "2026-10-01" }).selection).toBeNull();
    expect(pickFromSnapshot({ preset: "not-a-preset" }).selection).toBeNull();
  });
});

describe("savedAgentOption", () => {
  it("projects a saved agent the way the picker lists it", () => {
    expect(savedAgentOption(savedRow)).toMatchObject({
      id: "agent-1",
      name: "Firm lister",
      emoji: "wolf",
      accentColor: "#64748b",
      presetId: "hunter",
      strategy: { weights: savedRow.weights, beta: 3.2 },
    });
  });
});
