/**
 * Agent Studio — shared types.
 *
 * The studio is the unified surface for building a negotiation agent. Today
 * agents are built in three different-looking places (the buyer's listing
 * page, step 5 of the seller wizard, and the standalone /buy|sell/agents
 * pages); the studio is the one design all of them converge on. It starts as
 * a full page, but every pane is its own component so an embedding surface
 * can take just the pieces it needs.
 */

import type { NegotiationAgent, NegotiationAgentPresetId } from "@haggle/shared";

/**
 * What the user is pointing at in the roster. A preset is a starting template;
 * a saved agent is one of their own. The studio keeps one in-progress build
 * per selection so flipping between them never loses work.
 */
export type StudioSelection =
  | { kind: "preset"; id: NegotiationAgentPresetId }
  | { kind: "saved"; id: string };

/** Stable string key for a selection — used for per-thread state and storage. */
export function selectionKey(selection: StudioSelection): string {
  return `${selection.kind}:${selection.id}`;
}

/** A saved agent as the roster needs it — the full row, so selecting one can
 *  seed the build state with its overrides via `builderStateFromAgentRow`. */
export type StudioSavedAgent = NegotiationAgent;
