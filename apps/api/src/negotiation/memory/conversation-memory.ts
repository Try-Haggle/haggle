/**
 * Conversation memory for a live negotiation.
 *
 * HNP compresses the public act sequence into compact state. The engine reloads
 * every persisted turn, maps it to public acts, and lets the protocol reducer
 * produce what the LLM reads.
 */

import type { HnpPublicAct } from "@haggle/engine-session";
import type { ConversationContext, ConversationTurn } from "../types.js";

export type PersistedTalkRound = {
  roundNo: number;
  senderRole: "BUYER" | "SELLER";
  message?: string | null;
  counterPriceMinor?: string | number | null;
  priceminor?: string | number | null;
};

function toPriceMinor(round: PersistedTalkRound): number | undefined {
  const raw = round.counterPriceMinor ?? round.priceminor;
  if (raw == null) return undefined;
  const price = Number(raw);
  return Number.isFinite(price) ? price : undefined;
}

/**
 * Rebuild every spoken turn from stored rounds.
 *
 * Generated `message` is the responder's line — the side opposite `senderRole`.
 */
export function collectConversationTurns(rounds: readonly PersistedTalkRound[]): ConversationTurn[] {
  const turns: ConversationTurn[] = [];
  for (const round of rounds) {
    const text = typeof round.message === "string" ? round.message.trim() : "";
    if (!text) continue;
    turns.push({
      round: round.roundNo,
      sender: round.senderRole === "BUYER" ? "SELLER" : "BUYER",
      text,
      price_minor: toPriceMinor(round),
    });
  }
  return turns;
}

/**
 * Full-thread context for Decide. Never drops earlier turns.
 */
export function buildConversationContext(
  dbRounds: readonly PersistedTalkRound[],
  incomingMessage: string | undefined,
  incomingSenderRole: "BUYER" | "SELLER",
  incomingPriceMinor: number,
): ConversationContext {
  const turns = collectConversationTurns(dbRounds);

  const opponent_message =
    typeof incomingMessage === "string" && incomingMessage.trim().length > 0
      ? incomingMessage.trim()
      : undefined;

  if (opponent_message) {
    turns.push({
      round: (dbRounds[dbRounds.length - 1]?.roundNo ?? 0) + 1,
      sender: incomingSenderRole,
      text: opponent_message,
      price_minor: incomingPriceMinor,
    });
  }

  return { opponent_message, recent_turns: turns };
}

/** Map stored turns to HNP public acts. Claims stay public and short. */
export function turnsToHnpPublicActs(turns: readonly ConversationTurn[]): HnpPublicAct[] {
  return turns.map((turn, index) => ({
    sequence: turn.round > 0 ? turn.round : index + 1,
    role: turn.sender,
    type: index === 0 ? "OFFER" : "COUNTER",
    total_price:
      typeof turn.price_minor === "number"
        ? { currency: "USD", units_minor: turn.price_minor }
        : undefined,
    claim: turn.text,
  }));
}
