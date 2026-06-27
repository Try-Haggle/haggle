/**
 * NegotiationAgent → EngineParameters resolver.
 *
 * Handles both strategy shapes (legacy 8-stat and new 4D-weight) and returns a
 * complete EngineParameters object suitable for use as a session strategy
 * snapshot. Returns null if the agent has neither shape populated.
 *
 * Override precedence for the new flow:
 *   preset → engineParams partial → top-level weights override
 */

import { statsToParameters } from "../agent-stats/stats-to-params.js";
import type { EngineParameters, NegotiationAgent } from "../agent-stats/types.js";
import { getNegotiationAgentPreset } from "./negotiation-agent-presets.js";
import { presetToEngineParameters } from "./preset-to-params.js";
import { DEFAULT_NEGOTIATION_AGENT_PRESET_ID, type NegotiationAgentPresetId } from "./types.js";

export interface ResolveOptions {
  /** Preset to fall back to when the new-flow agent has neither
   *  negotiationAgentPresetId nor weights. Defaults to the canonical default. */
  fallbackPresetId?: NegotiationAgentPresetId;
}

/** Detect which strategy path the agent declares. */
function declaresNewFlow(agent: NegotiationAgent): boolean {
  return Boolean(
    agent.negotiationAgentPresetId || agent.weights || agent.engineParams || agent.categoryAnswers,
  );
}

/**
 * Resolve an NegotiationAgent to a complete EngineParameters object.
 *
 * Returns null when the agent has no strategy at all (no stats, no preset,
 * no weights). Callers should treat this as "agent not ready to negotiate".
 */
export function resolveAgentToEngineParameters(
  agent: NegotiationAgent,
  options: ResolveOptions = {},
): EngineParameters | null {
  if (declaresNewFlow(agent)) {
    const presetId =
      agent.negotiationAgentPresetId ??
      options.fallbackPresetId ??
      DEFAULT_NEGOTIATION_AGENT_PRESET_ID;
    const preset = getNegotiationAgentPreset(presetId);
    if (!preset) return null;

    const base = presetToEngineParameters(preset);
    return {
      ...base,
      ...(agent.engineParams ?? {}),
      weights: agent.weights ? { ...agent.weights } : base.weights,
    };
  }

  if (agent.stats) {
    return statsToParameters(agent.stats);
  }

  return null;
}
