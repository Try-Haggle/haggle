/**
 * Agent Builder — pure derivations over AgentBuilderState.
 *
 * These replace the component-local NegotiationAgentDraft helpers: the build
 * state stores only the base preset id + sparse overrides; everything else
 * (the fully-resolved preset, the serialized engine knobs) is derived here so
 * there is ONE implementation shared by every surface.
 */

import {
  getNegotiationAgentPreset,
  NEGOTIATION_AGENT_PRESETS,
} from "../agent-presets/negotiation-agent-presets.js";
import type { NegotiationAgentPreset, NegotiationAgentPresetId } from "../agent-presets/types.js";
import type { NegotiationAgent } from "../agent-stats/types.js";
import {
  type AgentBuilderState,
  type BuilderSide,
  type ChatStrategy,
  emptyChatData,
  type ItemContext,
} from "./types.js";

const DEFAULT_PRESET_ID: NegotiationAgentPresetId = "balancer";

function basePreset(id: NegotiationAgentPresetId): NegotiationAgentPreset {
  return (
    getNegotiationAgentPreset(id) ??
    getNegotiationAgentPreset(DEFAULT_PRESET_ID) ??
    NEGOTIATION_AGENT_PRESETS[0]
  );
}

/**
 * Resolve the build state's agent into a fully-applied NegotiationAgentPreset
 * (base preset + weight / engineParams overrides). Replaces the old
 * `effectivePreset` field — the radar, sliders, and serialization read this.
 */
export function resolveEffectivePreset(state: AgentBuilderState): NegotiationAgentPreset {
  const base = basePreset(state.agent.presetId);
  return {
    ...base,
    ...(state.agent.weights ? { weights: { ...state.agent.weights } } : {}),
    ...(state.agent.engineParams ?? {}),
  };
}

/**
 * The 12 engine-curve knobs (everything except the 4 weights) from a resolved
 * preset. Single source so every serialization boundary emits the COMPLETE set
 * — no knob can silently drop on the way to the backend.
 */
export function engineParamsFromPreset(ep: NegotiationAgentPreset) {
  return {
    alpha: ep.alpha,
    beta: ep.beta,
    u_threshold: ep.u_threshold,
    u_aspiration: ep.u_aspiration,
    anchor_ratio: ep.anchor_ratio,
    v_t_floor: ep.v_t_floor,
    w_rep: ep.w_rep,
    r_score_minimum: ep.r_score_minimum,
    i_completeness_minimum: ep.i_completeness_minimum,
    v_s_base: ep.v_s_base,
    n_threshold: ep.n_threshold,
    late_round_aggression_modifier: ep.late_round_aggression_modifier,
  };
}

/** True when the agent differs from the bare preset (has weight/knob overrides). */
export function isBuilderCustomized(state: AgentBuilderState): boolean {
  return Boolean(state.agent.weights) || Boolean(state.agent.engineParams);
}

/**
 * Apply an LLM / advanced-chat strategy (4 weights + 4 curves) to the build
 * state. Sparse: only the 8 touched knobs become overrides; the rest resolve
 * from the base preset. Marks dirty.
 */
export function applyChatStrategyToState(
  state: AgentBuilderState,
  strategy: ChatStrategy,
): AgentBuilderState {
  return {
    ...state,
    agent: {
      ...state.agent,
      weights: { ...strategy.weights },
      engineParams: {
        ...state.agent.engineParams,
        alpha: strategy.alpha,
        beta: strategy.beta,
        u_threshold: strategy.u_threshold,
        u_aspiration: strategy.u_aspiration,
      },
    },
    dirty: true,
  };
}

/** Build state seeded from a saved custom agent (My Agents → builder). */
export function builderStateFromAgentRow(
  agent: NegotiationAgent,
  side: BuilderSide,
  item?: ItemContext,
): AgentBuilderState {
  return {
    side,
    source: { kind: "custom", id: agent.id },
    agent: {
      presetId: agent.negotiationAgentPresetId ?? DEFAULT_PRESET_ID,
      name: agent.name,
      weights: agent.weights ? { ...agent.weights } : undefined,
      engineParams: agent.engineParams ? { ...agent.engineParams } : undefined,
      categoryAnswers: agent.categoryAnswers,
      voiceId: agent.voiceId,
      builderChatMemory: agent.builderChatMemory ? { ...agent.builderChatMemory } : undefined,
    },
    item,
    chatData: emptyChatData(),
    dirty: false,
  };
}
