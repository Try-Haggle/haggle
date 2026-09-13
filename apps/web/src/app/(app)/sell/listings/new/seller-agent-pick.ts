import {
  type AgentBuilderState,
  builderStateFromAgentRow,
  createBuilderState,
  getNegotiationAgentPreset,
  type NegotiationAgent,
  type NegotiationAgentPresetId,
} from "@haggle/shared";
import type {
  AgentSelection,
  SavedAgentOption,
  StrategyOverride,
} from "@/components/listing-detail";
import { selectionOverrideKey } from "@/components/listing-detail/strategy";

/**
 * Step 5 of the listing wizard, between the two shapes it has to speak.
 *
 * The screen is the listing page's picker and drawer, which think in a
 * selection plus per-selection tuning. Everything downstream of the step —
 * the draft save, the listing snapshot, the agent saved to the seller's
 * library, the required-question gate — was built on one `AgentBuilderState`.
 * Converting at this seam keeps every one of those unchanged: the new screen
 * produces exactly the state the old one did.
 */

/** The face and colour a seller chose for a pick, when they chose one. */
export interface AgentIdentity {
  emoji?: string;
  accentColor?: string;
}

export interface SellerAgentPick {
  selection: AgentSelection | null;
  overrides: Record<string, StrategyOverride>;
  identity: Record<string, AgentIdentity>;
}

export const EMPTY_SELLER_AGENT_PICK: SellerAgentPick = {
  selection: null,
  overrides: {},
  identity: {},
};

function presetIdOf(selection: AgentSelection): NegotiationAgentPresetId {
  const id = selection.kind === "preset" ? selection.id : selection.presetId;
  return (getNegotiationAgentPreset(id)?.id ?? "balancer") as NegotiationAgentPresetId;
}

/**
 * The builder state for the current pick — what the rest of the wizard reads.
 *
 * A saved agent starts from its own row (name, tuning, face, briefing memory);
 * a preset from the bare archetype. Tuning made in this wizard replaces the
 * starting tuning, and a face or colour picked here replaces the starting one.
 */
export function agentStateFromPick(
  pick: SellerAgentPick,
  savedRows: NegotiationAgent[],
): AgentBuilderState | null {
  const { selection } = pick;
  if (!selection) return null;

  const row =
    selection.kind === "saved" ? savedRows.find((agent) => agent.id === selection.id) : undefined;
  const base = row
    ? builderStateFromAgentRow(row, "seller")
    : createBuilderState({ side: "seller", presetId: presetIdOf(selection) });

  const key = selectionOverrideKey(selection);
  const override = pick.overrides[key];
  const identity = pick.identity[key];

  let agent = base.agent;
  if (override) {
    const { weights, ...knobs } = override;
    const defined = Object.fromEntries(
      Object.entries(knobs).filter(([, value]) => value !== undefined),
    );
    agent = {
      ...agent,
      weights: { ...weights },
      engineParams: { ...agent.engineParams, ...defined },
    };
  }
  if (identity?.emoji) agent = { ...agent, emoji: identity.emoji };
  if (identity?.accentColor) agent = { ...agent, accentColor: identity.accentColor };

  return { ...base, agent };
}

/**
 * Rebuild a pick from a saved draft's snapshot, so resuming a draft reopens
 * the agent the seller had — not just its archetype.
 *
 * The step used to restore only the preset id, which quietly dropped a saved
 * agent, every tuned knob and the chosen face on resume, and then wrote that
 * bare preset back over the snapshot on the next save.
 */
export function pickFromSnapshot(snapshot: Record<string, unknown> | null): SellerAgentPick {
  if (!snapshot || typeof snapshot.preset !== "string") return EMPTY_SELLER_AGENT_PICK;
  const presetId = snapshot.preset;
  if (!getNegotiationAgentPreset(presetId)) return EMPTY_SELLER_AGENT_PICK;

  const selection: AgentSelection =
    snapshot.source === "custom" && typeof snapshot.sourceId === "string"
      ? { kind: "saved", id: snapshot.sourceId, presetId }
      : { kind: "preset", id: presetId };
  const key = selectionOverrideKey(selection);

  const overrides: Record<string, StrategyOverride> = {};
  const weights = snapshot.weights as StrategyOverride["weights"] | undefined;
  if (snapshot.customized === true && weights && typeof weights === "object") {
    const engineParams =
      snapshot.engineParams && typeof snapshot.engineParams === "object"
        ? (snapshot.engineParams as Omit<StrategyOverride, "weights">)
        : {};
    overrides[key] = { ...engineParams, weights: { ...weights } };
  }

  const identity: Record<string, AgentIdentity> = {};
  const emoji = typeof snapshot.emoji === "string" ? snapshot.emoji : undefined;
  const accentColor = typeof snapshot.accentColor === "string" ? snapshot.accentColor : undefined;
  if (emoji || accentColor) identity[key] = { emoji, accentColor };

  return { selection, overrides, identity };
}

/** A saved agent as the picker lists it — the same projection the buyer's page uses. */
export function savedAgentOption(agent: NegotiationAgent): SavedAgentOption {
  return {
    id: agent.id,
    name: agent.name,
    emoji: agent.emoji ?? null,
    accentColor: agent.accentColor ?? null,
    presetId: agent.negotiationAgentPresetId ?? agent.basePresetId ?? "balancer",
    strategy: agent.weights
      ? ({ weights: { ...agent.weights }, ...(agent.engineParams ?? {}) } as StrategyOverride)
      : undefined,
  };
}
