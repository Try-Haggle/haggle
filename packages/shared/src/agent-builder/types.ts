/**
 * Agent Builder — unified state model.
 *
 * One object (`AgentBuilderState`) is the single source of truth for building a
 * negotiation agent, regardless of surface (listing wizard, buyer page,
 * standalone agent page, MCP widget). It serves four roles at once:
 *   1. React state while building
 *   2. localStorage cache (resume mid-build)
 *   3. the payload passed to the builder chat / chat-turn API
 *   4. the basis for the persisted record on save
 *
 * See the design doc: agent-builder-unified-design.html (v3).
 */

import type { NegotiationAgentPresetId, NegotiationWeights } from "../agent-presets/types.js";
import type { EngineParameters } from "../agent-stats/types.js";

/**
 * Which side the user is on while building. Captures the only real
 * buyer/seller difference; everything else is label/prompt derivation.
 * (Note: persisted agents may also be "both"; during a build it is always one.)
 */
export type BuilderSide = "buyer" | "seller";

/**
 * The agent strategy being built. Numbers (`weights`/`engineParams`) live here —
 * written by three sources with last-write-wins: preset selection, chat
 * numericize (LLM), and advanced sliders.
 */
export interface AgentBuilderAgent {
  /** Preset used as the starting point. Required (defaults to "balancer"). */
  presetId: NegotiationAgentPresetId;
  /** User-given name. Optional during build. */
  name?: string;
  /**
   * User-chosen face — an animal slug from `AGENT_ANIMALS`. Absent means the
   * preset's own animal. Like `name`, this is identity rather than strategy:
   * it never counts as "customized" and survives a reset to the preset.
   */
  emoji?: string;
  /** 4D weight vector. Overrides preset weights when present. */
  weights?: NegotiationWeights;
  /** Per-knob overrides for the rest of EngineParameters (weights live above). */
  engineParams?: Partial<Omit<EngineParameters, "weights">>;
  /** Per-category form answers, keyed by category id (e.g. "iphone"). */
  categoryAnswers?: Record<string, Record<string, unknown>>;
  /** Voice profile id — wiring reserved for a later sprint. */
  voiceId?: string;
  /**
   * Durable builder-chat memory carried from a saved agent (must-haves,
   * deal-breakers, urgency, style). Surfaced so reusing a saved agent sends its
   * negotiation posture even when the user doesn't re-run the builder chat.
   */
  builderChatMemory?: Record<string, unknown>;
}

/**
 * The deal/item context — present only when there is a listing (wizard,
 * buyer page, widget). Absent for standalone reusable agents.
 *
 * All prices are in MINOR UNITS (integer cents) to match the engine/API.
 */
export interface ItemContext {
  title?: string;
  description?: string;
  category?: string;
  condition?: string;
  tags?: string[];
  photoUrl?: string;
  /** The actual listed ask (seller's own ask / buyer sees counterparty's ask). */
  listingPrice?: number;
  /** What the user is aiming for (both sides). */
  targetPrice?: number;
  /** Walk-away limit. side decides meaning: seller=floor, buyer=ceiling. */
  priceLimit?: number;
  /** Market reference price. */
  marketMedian?: number;
  /** ISO timestamp. */
  deadline?: string;
}

/** A single chat turn, stored raw. */
export interface ChatTurn {
  role: "user" | "agent";
  text: string;
  /** Epoch ms. Pass in from the caller (do not generate inside pure code). */
  ts: number;
}

/** One answered builder question. */
export interface AnsweredQuestion {
  question: string;
  answer: string;
}

/**
 * Raw record of what the user said in the builder chat.
 *
 * This is NOT the numbers — it holds the conversation and free-form, possibly
 * hard-to-quantify preferences. It is passed to the LLM as-is (raw is fine),
 * and the LLM numericizes it into `agent.weights`/`agent.engineParams`.
 */
export interface AgentBuilderChatData {
  /** The conversation transcript. */
  transcript: ChatTurn[];
  /** Free-form things the user stated (e.g. "it's a gift", "not in a hurry"). */
  statedPreferences: string[];
  /** Which builder questions were answered, and how. */
  answeredQuestions: AnsweredQuestion[];
  /** Questions the agent still wants to ask. */
  openQuestions: string[];
}

/**
 * Where the build started from — drives picker selection, analytics, and the
 * publish "mint a fresh agent?" decision.
 *  - "preset": id is a NegotiationAgentPresetId (hunter/closer/…)
 *  - "custom": id is a previously-saved agent's id (agent.presetId stays the base)
 */
export interface AgentBuilderSource {
  kind: "preset" | "custom";
  id: string;
}

/**
 * The unified builder state. The whole object is passed to the chat and cached.
 * Single in-memory source of truth for the build session across every surface.
 */
export interface AgentBuilderState {
  side: BuilderSide;
  /** Provenance of the current selection. */
  source: AgentBuilderSource;
  agent: AgentBuilderAgent;
  /** Present only when building against a concrete listing. */
  item?: ItemContext;
  chatData: AgentBuilderChatData;
  /** True once the user changes anything (chat tuning / advanced sliders) since
   *  selecting the source. Drives Save gating. */
  dirty: boolean;
}

/**
 * The 8 numbers the builder chat can adjust live — exactly the radar axes
 * (4 weights + 4 behavior curves). The LLM returns these; the UI applies them
 * to the agent (last-write-wins with the advanced sliders). Other engine knobs
 * stay from the preset/overrides.
 */
export interface ChatStrategy {
  weights: { w_p: number; w_t: number; w_r: number; w_s: number };
  alpha: number;
  beta: number;
  u_threshold: number;
  u_aspiration: number;
}

/** Empty chat data — the starting point of every build. */
export function emptyChatData(): AgentBuilderChatData {
  return {
    transcript: [],
    statedPreferences: [],
    answeredQuestions: [],
    openQuestions: [],
  };
}

/** Create a fresh builder state from a preset (the default build entry point). */
export function createBuilderState(input: {
  side: BuilderSide;
  presetId: NegotiationAgentPresetId;
  item?: ItemContext;
  name?: string;
}): AgentBuilderState {
  return {
    side: input.side,
    source: { kind: "preset", id: input.presetId },
    agent: { presetId: input.presetId, name: input.name },
    item: input.item,
    chatData: emptyChatData(),
    dirty: false,
  };
}
