import { engineParamsFromPreset, getNegotiationAgentPreset } from "@haggle/shared";
import { describe, expect, it } from "vitest";
import { planListingAgentPromotion, type SourceAgent } from "../lib/listing-agent-promotion.js";

const hunter = getNegotiationAgentPreset("hunter")!;

/** What the wizard writes for an agent, mirroring agentStrategySnapshotFromState. */
function snapshot(overrides: Record<string, unknown> = {}) {
  return {
    preset: "hunter",
    emoji: hunter.emoji,
    accentColor: hunter.accentColor,
    weights: { ...hunter.weights },
    engineParams: engineParamsFromPreset(hunter),
    source: "preset",
    sourceId: "hunter",
    customized: false,
    ...overrides,
  };
}

const savedAgent: SourceAgent = {
  id: "11111111-1111-4111-8111-111111111111",
  name: "Firm lister",
  negotiationAgentConfig: {
    negotiationAgentPresetId: "hunter",
    emoji: "wolf",
    accentColor: "#64748B",
    weights: { w_p: 0.7, w_t: 0.1, w_r: 0.1, w_s: 0.1 },
    // Sparse, as saved rows often are: only the knob it changed.
    engineParams: { beta: 3.2 },
  },
};

function savedAsIs(extra: Record<string, unknown> = {}) {
  return snapshot({
    emoji: "wolf",
    accentColor: "#64748b",
    weights: { w_p: 0.7, w_t: 0.1, w_r: 0.1, w_s: 0.1 },
    engineParams: { ...engineParamsFromPreset(hunter), beta: 3.2 },
    source: "custom",
    sourceId: savedAgent.id,
    customized: true,
    ...extra,
  });
}

const plan = (input: Partial<Parameters<typeof planListingAgentPromotion>[0]>) =>
  planListingAgentPromotion({
    snapshot: snapshot(),
    owned: true,
    sourceAgent: null,
    title: "brass telescope",
    ...input,
  });

describe("planListingAgentPromotion", () => {
  it("references the preset when the seller published it untouched", () => {
    expect(plan({})).toEqual({ kind: "preset", presetId: "hunter" });
  });

  it("never touches a library for a listing without an owner", () => {
    expect(plan({ owned: false, snapshot: snapshot({ customized: true }) })).toEqual({
      kind: "preset",
      presetId: "hunter",
    });
  });

  it("references a saved agent published as it was, instead of copying it again", () => {
    expect(plan({ snapshot: savedAsIs(), sourceAgent: savedAgent })).toEqual({
      kind: "existing",
      agentId: savedAgent.id,
    });
  });

  it("does not count this listing's briefing as a change to the saved agent", () => {
    const withBriefing = savedAsIs({
      negotiationAgentBuilderMemory: { dealBreakers: ["no trades"] },
    });
    expect(plan({ snapshot: withBriefing, sourceAgent: savedAgent }).kind).toBe("existing");
  });

  it.each([
    ["its strategy", { weights: { w_p: 0.4, w_t: 0.4, w_r: 0.1, w_s: 0.1 } }],
    ["one engine knob", { engineParams: { ...engineParamsFromPreset(hunter), beta: 1.1 } }],
    ["its animal", { emoji: "fox" }],
    ["its colour", { accentColor: "#ec4899" }],
  ])("makes one new agent when the seller changed %s on a saved agent", (_what, change) => {
    const result = plan({ snapshot: savedAsIs(change), sourceAgent: savedAgent });
    expect(result.kind).toBe("create");
    if (result.kind === "create") expect(result.name).toBe("Firm lister · brass telescope");
  });

  it("makes one new agent from a tuned preset, carrying its face and colour", () => {
    const result = plan({
      snapshot: snapshot({
        customized: true,
        weights: { w_p: 0.5, w_t: 0.2, w_r: 0.2, w_s: 0.1 },
        emoji: "penguin",
        accentColor: "#14B8A6",
      }),
    });
    expect(result).toMatchObject({
      kind: "create",
      name: "Patient Lister · brass telescope",
      config: {
        negotiationAgentPresetId: "hunter",
        emoji: "penguin",
        accentColor: "#14b8a6",
        weights: { w_p: 0.5, w_t: 0.2, w_r: 0.2, w_s: 0.1 },
      },
    });
  });

  it("still keeps a tuned agent when the saved agent it came from is gone", () => {
    const result = plan({ snapshot: savedAsIs(), sourceAgent: null });
    expect(result.kind).toBe("create");
  });

  it("keeps names within the column limit", () => {
    const result = plan({ snapshot: snapshot({ customized: true }), title: "x".repeat(300) });
    expect(result.kind === "create" && result.name.length).toBe(100);
  });
});
