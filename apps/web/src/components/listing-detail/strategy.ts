import type { NegotiationAgentPreset } from "@haggle/shared";
import type { AgentSelection, SavedAgentOption } from "./agent-picker";
import type { StrategyOverride } from "./types";

/**
 * Selection → effective preset, in one place.
 *
 * Both agent surfaces (the buyer's listing page and the seller's listing
 * wizard) do the same three things with a pick: key its tuning, merge that
 * tuning onto the archetype, and re-label the result when the pick is one of
 * the user's own saved agents. Keeping the three together is what stops the
 * two surfaces from drifting into two slightly different meanings of "the
 * agent you picked".
 */

/** Stable key for per-selection override storage. */
export function selectionOverrideKey(selection: AgentSelection): string {
  return `${selection.kind}:${selection.id}`;
}

/** Preset with a surface's strategy overrides merged on top. The spread order
 *  does the sparseness: any knob absent from the override resolves from the
 *  preset, so the merged object stays a complete NegotiationAgentPreset. */
export function mergeOverride(
  preset: NegotiationAgentPreset,
  override: StrategyOverride | undefined,
): NegotiationAgentPreset {
  if (!override) return preset;
  const { weights, ...knobs } = override;
  const defined = Object.fromEntries(
    Object.entries(knobs).filter(([, value]) => value !== undefined),
  );
  return { ...preset, ...defined, weights: { ...weights } };
}

/** Re-label a merged preset with a saved agent's own name and emoji, on the
 *  side that is picking. Without it, choosing "Firm lister" produced a chat
 *  that introduced itself as "Patient Lister". */
export function nameAfterSavedAgent(
  merged: NegotiationAgentPreset,
  saved: SavedAgentOption | undefined,
  role: "buyer" | "seller",
): NegotiationAgentPreset {
  if (!saved) return merged;
  return {
    ...merged,
    emoji: saved.emoji ?? merged.emoji,
    copy: { ...merged.copy, [role]: { ...merged.copy[role], name: saved.name } },
  };
}

export interface AgentView {
  /** Override-storage key for this pick, or null when nothing is picked. */
  key: string | null;
  /** Tuning in effect: this surface's edits, else the saved agent's own. */
  override: StrategyOverride | null;
  /** Archetype + tuning. Keeps the archetype's name ("Based on …" needs it). */
  merged: NegotiationAgentPreset | undefined;
  /** Same, re-labeled with a saved agent's name/emoji. What the user sees. */
  named: NegotiationAgentPreset | undefined;
}

/**
 * Everything a surface needs to present a selection, derived in one place.
 *
 * A saved agent starts from the tuning it was saved with; surface edits layer
 * on top. "Reset to preset" then means the bare archetype, which is the
 * meaning the label promises.
 */
export function deriveAgentView({
  selection,
  overrides,
  savedAgents,
  role,
  resolvePreset,
}: {
  selection: AgentSelection | null;
  overrides: Record<string, StrategyOverride>;
  savedAgents: SavedAgentOption[];
  role: "buyer" | "seller";
  resolvePreset: (selection: AgentSelection | null) => NegotiationAgentPreset | undefined;
}): AgentView {
  const key = selection ? selectionOverrideKey(selection) : null;
  const saved =
    selection?.kind === "saved" ? savedAgents.find((a) => a.id === selection.id) : undefined;
  const override = key ? (overrides[key] ?? saved?.strategy ?? null) : null;
  const base = resolvePreset(selection);
  const merged = base ? mergeOverride(base, override ?? undefined) : undefined;
  const named = merged ? nameAfterSavedAgent(merged, saved, role) : undefined;
  return { key, override, merged, named };
}
