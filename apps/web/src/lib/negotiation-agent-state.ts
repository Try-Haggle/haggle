/**
 * What a negotiating agent is doing, reduced to the seven states its avatar
 * can show.
 *
 * The avatar artwork has its eyes baked in, so a state cannot live on the face.
 * It lives on the frame instead — a ring, a corner badge, a little motion — and
 * every surface that shows an agent mid-negotiation (the live arena, replay,
 * the seller's screen, the dashboards) asks this one function which state to
 * draw. Two screens disagreeing about whether an agent is "thinking" or
 * "waiting" would be worse than showing neither.
 */

export type NegotiationAgentState =
  | "idle"
  | "thinking"
  | "offer"
  | "waiting"
  | "question"
  | "deal"
  | "walked";

export type NegotiationSide = "BUYER" | "SELLER";

export interface NegotiationAgentStateInput {
  /** Whose agent is being drawn. */
  side: NegotiationSide;
  /** Server session status (`ACTIVE`, `ACCEPTED`, `NEAR_DEAL`, …). */
  status: string;
  /** Who sent the latest round, or null before the first one. */
  lastSender: NegotiationSide | null;
  /** The round loop stopped on purpose to ask the buyer something. */
  pausedForBuyer?: boolean;
  /**
   * Who is producing the next move right now, when the surface knows. Absent
   * means "the side that did not move last". Null means nobody is working —
   * a failed round, say — so no side is shown thinking.
   */
  activeRole?: NegotiationSide | null;
  /**
   * `arena` shows the side that just moved as having made an offer — it is the
   * moment you watch. A `list` row is read later, when "it's their turn" is
   * the useful thing to say, so the same situation reads as waiting.
   */
  surface: "arena" | "list";
}

const WALKED_STATUSES = new Set(["REJECTED", "EXPIRED", "SUPERSEDED"]);

export function negotiationAgentState(input: NegotiationAgentStateInput): NegotiationAgentState {
  const { side, status, lastSender, pausedForBuyer = false, surface } = input;

  if (status === "ACCEPTED") return "deal";
  if (WALKED_STATUSES.has(status)) return "walked";

  // The one state that needs a person. It goes to whoever must answer.
  if (pausedForBuyer) return side === "BUYER" ? "question" : "waiting";
  // The buyer's loop stops at a near-deal; closing it is the seller's call.
  if (status === "NEAR_DEAL") return side === "SELLER" ? "question" : "waiting";
  if (status === "STALLED" || status === "ESCALATED") return "waiting";

  const activeRole =
    input.activeRole === undefined
      ? lastSender === null
        ? null
        : lastSender === "BUYER"
          ? "SELLER"
          : "BUYER"
      : input.activeRole;

  if (activeRole === side) return "thinking";
  if (lastSender === null) return "idle";
  if (lastSender === side) return surface === "arena" ? "offer" : "waiting";
  return "idle";
}

/** Short human label for a state, as a dashboard row or a screen reader says it. */
export const NEGOTIATION_AGENT_STATE_LABEL: Record<NegotiationAgentState, string> = {
  idle: "Not started",
  thinking: "Thinking",
  offer: "Made an offer",
  waiting: "Their turn",
  question: "Needs your answer",
  deal: "Deal",
  walked: "No deal",
};
