/** Copy the host model should speak, so Grok does not stop on raw JSON. */

import { sellerCriteriaHoldChatMessage } from "../../negotiation/phase/seller-criteria-pause.js";

export type BargainRole = "BUYER" | "SELLER";

export function formatMinorAsDollars(minor: string | number | null | undefined): string | null {
  const value = Number(minor);
  if (!Number.isFinite(value) || value <= 0) return null;
  return `$${(value / 100).toFixed(value % 100 === 0 ? 0 : 2)}`;
}

/**
 * One DB round is an exchange: sender_role + price_minor is the incoming offer,
 * message + counter_price_minor is the other side answering. Web flips the
 * speaker the same way. MCP must not label the answer as the incoming sender.
 */
export function spokenRoundSpeaker(input: {
  senderRole?: BargainRole | null;
  message?: string | null;
  heldForCriteriaPause?: boolean;
  pauseDump?: string | null;
}): BargainRole {
  const sender = input.senderRole === "BUYER" ? "BUYER" : "SELLER";
  // Match web getRoundSpeaker: a criteria HOLD keeps the persisted sender.
  // Flipping it labeled R3 as BUYER while the stored line was still the seller's.
  if (input.heldForCriteriaPause) return sender;
  void input.pauseDump;
  const spoken = input.message?.trim() ?? "";
  if (!spoken) return sender;
  return sender === "BUYER" ? "SELLER" : "BUYER";
}

export function spokenRoundPriceMinor(input: {
  priceMinor?: string | number | null;
  counterPriceMinor?: string | number | null;
}): string | number | null {
  const counter = Number(input.counterPriceMinor);
  if (Number.isFinite(counter) && counter > 0) return input.counterPriceMinor ?? counter;
  return input.priceMinor ?? null;
}

export type McpTranscriptRound = {
  roundNo: number;
  senderRole?: BargainRole | null;
  message?: string | null;
  decision?: string | null;
  priceminor?: string | number | null;
  counterPriceMinor?: string | number | null;
  heldForCriteriaPause?: boolean;
  pauseQuestions?: string[];
};

export type McpRecentMessage = {
  round_no: number;
  speaker: BargainRole;
  sender_role: BargainRole;
  offer_sender_role: BargainRole | null;
  message: string | null;
  decision: string | null;
  price_minor: string | number | null;
  incoming_price_minor: string | number | null;
  counter_price_minor: string | number | null;
  held_for_criteria_pause: boolean;
};

/** Same buyer-open line the web live chat synthesizes from price_minor. */
export function buyerOpeningMessage(priceMinor: string | number | null | undefined): string {
  const major = Number(priceMinor) / 100;
  const formatted = Number.isFinite(major)
    ? major.toLocaleString("en-US", {
        style: "currency",
        currency: "USD",
        maximumFractionDigits: 0,
      })
    : "$0";
  return `Hi, I'm interested in this listing. I'd like to offer ${formatted}.`;
}

function asBargainRole(role: BargainRole | null | undefined): BargainRole | null {
  if (role === "BUYER" || role === "SELLER") return role;
  return null;
}

/** True when the stored line is already the web/MCP buyer-open copy. */
export function isBuyerOpeningCopy(message: string | null | undefined): boolean {
  const text = message?.trim() ?? "";
  return text.startsWith("Hi, I'm interested in this listing. I'd like to offer");
}

/**
 * Web stores one DB row per exchange, then prepends a synthetic BUYER OPENING
 * so chat shows two lines. MCP used to return that one row, so Grok saw a
 * fold: current_round 1 and a single recent_message.
 *
 * Gate on persisted senderRole (incoming offer), not the flipped speaker.
 * After #98 a folded first row speaks as SELLER with offer_sender_role BUYER.
 */
export function expandMcpTranscript(rounds: McpTranscriptRound[]): McpRecentMessage[] {
  const mapped = rounds.map((round) => {
    const pauseQuestions = round.pauseQuestions ?? [];
    const held = Boolean(round.heldForCriteriaPause);
    const openingCopy = isBuyerOpeningCopy(round.message);
    const speaker = openingCopy
      ? "BUYER"
      : spokenRoundSpeaker({
          senderRole: round.senderRole,
          message: round.message,
          heldForCriteriaPause: held,
          pauseDump: pauseQuestions.join(" "),
        });
    const priceMinor = spokenRoundPriceMinor({
      priceMinor: round.priceminor,
      counterPriceMinor: round.counterPriceMinor,
    });
    const message = held
      ? sellerCriteriaHoldChatMessage({
          incomingMessage: null,
          incomingPriceMinor: Number(priceMinor ?? round.priceminor ?? 0),
          senderRole: speaker,
          pauseQuestions,
          decision: round.decision,
        })
      : (round.message ?? null);
    return {
      round_no: round.roundNo,
      speaker,
      sender_role: speaker,
      offer_sender_role: asBargainRole(round.senderRole ?? null),
      message,
      decision: round.decision ?? null,
      price_minor: priceMinor,
      incoming_price_minor: round.priceminor ?? null,
      counter_price_minor: round.counterPriceMinor ?? null,
      held_for_criteria_pause: held,
    };
  });

  const first = rounds[0];
  // Same gate as web transformNegotiationPlayback, plus skip when the first
  // row is already a real BUYER OPENING so we do not duplicate it.
  const hasSyntheticBuyerOpen =
    !!first &&
    first.senderRole === "BUYER" &&
    Boolean(first.message?.trim()) &&
    !isBuyerOpeningCopy(first.message);
  if (!hasSyntheticBuyerOpen) return mapped;

  const opening: McpRecentMessage = {
    round_no: 1,
    speaker: "BUYER",
    sender_role: "BUYER",
    offer_sender_role: "BUYER",
    message: buyerOpeningMessage(first.priceminor),
    decision: "OPENING",
    price_minor: first.priceminor ?? null,
    incoming_price_minor: first.priceminor ?? null,
    counter_price_minor: null,
    held_for_criteria_pause: false,
  };

  return [
    opening,
    ...mapped.map((msg, index) => {
      const source = rounds[index];
      const decision =
        source?.roundNo === 1 && msg.decision === "OPENING" ? "COUNTER" : msg.decision;
      return {
        ...msg,
        round_no: (source?.roundNo ?? index + 1) + 1,
        decision,
      };
    }),
  ];
}

/** Folded get_negotiation window — never the full chat unless expand=transcript. */
export const MCP_GET_NEGOTIATION_RECENT_LIMIT = 4;

export type McpNegotiationOffer = {
  round_no: number;
  speaker: BargainRole;
  offer_sender_role: BargainRole | null;
  decision: string | null;
  price_minor: string | number | null;
  incoming_price_minor: string | number | null;
  counter_price_minor: string | number | null;
};

/** Price/decision history without chat copy — expand=offers. */
export function mcpNegotiationOffers(messages: McpRecentMessage[]): McpNegotiationOffer[] {
  return messages.map((m) => ({
    round_no: m.round_no,
    speaker: m.speaker,
    offer_sender_role: m.offer_sender_role,
    decision: m.decision,
    price_minor: m.price_minor,
    incoming_price_minor: m.incoming_price_minor,
    counter_price_minor: m.counter_price_minor,
  }));
}

export function mcpNegotiationTranscript(
  rounds: McpTranscriptRound[],
  sessionCurrentRound: number,
): { current_round: number; recent_messages: McpRecentMessage[] } {
  const view = buildMcpGetNegotiationExpandView(rounds, sessionCurrentRound, []);
  return {
    current_round: view.current_round,
    recent_messages: view.recent_messages,
  };
}

/**
 * Fold/expand view builder for haggle_get_negotiation:
 * - expand includes "transcript": full OPENING-aware transcript
 * - expand includes "offers": price/decision offer rows from that transcript
 * - empty expand: recent_messages only (last N) — used by internal helpers
 *   (mcpNegotiationTranscript). MCP tool default goes through
 *   normalizeGetNegotiationExpand, which supplies transcript+offers (E1).
 */
export function buildMcpGetNegotiationExpandView(
  rounds: McpTranscriptRound[],
  sessionCurrentRound: number,
  expand: ReadonlyArray<"transcript" | "offers"> = [],
): {
  current_round: number;
  recent_messages: McpRecentMessage[];
  transcript?: McpRecentMessage[];
  offers?: McpNegotiationOffer[];
} {
  const messages = expandMcpTranscript(rounds);
  const last = messages.at(-1);
  const body: {
    current_round: number;
    recent_messages: McpRecentMessage[];
    transcript?: McpRecentMessage[];
    offers?: McpNegotiationOffer[];
  } = {
    current_round: last?.round_no ?? sessionCurrentRound,
    recent_messages: messages.slice(-MCP_GET_NEGOTIATION_RECENT_LIMIT),
  };
  if (expand.includes("transcript")) body.transcript = messages;
  if (expand.includes("offers")) body.offers = mcpNegotiationOffers(messages);
  return body;
}

export function negotiationSayToUser(input: {
  counterpartRole?: BargainRole | null;
  counterpartMessage?: string | null;
  decision?: string | null;
  priceMinor?: string | number | null;
  pauseQuestions?: string[];
  sessionStatus?: string;
}): { say_to_user: string; ask_user: string } {
  const who = input.counterpartRole === "BUYER" ? "Buyer" : "Seller";
  const price = formatMinorAsDollars(input.priceMinor);
  const spoken = input.counterpartMessage?.trim();
  const decision = input.decision?.trim();
  const parts: string[] = [];
  if (spoken) parts.push(`${who} said: ${spoken}`);
  else if (decision && price) parts.push(`${who} is at ${price} (${decision}).`);
  else if (price) parts.push(`${who} is at ${price}.`);
  const questions = (input.pauseQuestions ?? []).map((q) => q.trim()).filter(Boolean);
  // Pause asks live in pause_checks / the answer panel — not say_to_user or chat bubbles.
  void questions;
  if (input.sessionStatus === "ACCEPTED") {
    parts.push("Deal is accepted. Open the Haggle checkout URL to pay.");
  }
  const say_to_user =
    parts.join(" ") || "The negotiation is waiting. Tell me your next price or answer.";
  const ask_user = (input.pauseQuestions ?? []).some((q) => q.trim())
    ? "Answer pause_checks via haggle_answer_pause (or the answer panel). Do not treat them as chat."
    : input.sessionStatus === "ACCEPTED"
      ? "Open checkout on Haggle to finish payment."
      : "Quote that line, then ask what price to offer or whether to accept. Submit the user's counter via haggle_play_next with price_minor (cents) and optional message. Do not use hnp_submit_offer.";
  return { say_to_user, ask_user };
}

/** After start: never advertise play_next when seller required criteria still need buyerCriteria. */
export function mcpStartNextActions(buyerCriteriaRequired: boolean): string[] {
  return buyerCriteriaRequired
    ? ["haggle_get_negotiation"]
    : ["haggle_play_next", "haggle_get_negotiation"];
}
