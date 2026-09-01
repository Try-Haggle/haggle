/** Copy the host model should speak, so Grok does not stop on raw JSON. */

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
  const spoken = input.message?.trim() ?? "";
  if (!spoken) return sender;
  if (input.heldForCriteriaPause && spoken === (input.pauseDump ?? "").trim()) return sender;
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

/**
 * Web stores one DB row per exchange, then prepends a synthetic BUYER OPENING
 * so chat shows two lines. MCP used to return that one row, so Grok saw a
 * fold: current_round 1 and a single recent_message.
 */
export function expandMcpTranscript(rounds: McpTranscriptRound[]): McpRecentMessage[] {
  const mapped = rounds.map((round) => {
    const pauseQuestions = round.pauseQuestions ?? [];
    const held = Boolean(round.heldForCriteriaPause);
    const speaker = spokenRoundSpeaker({
      senderRole: round.senderRole,
      message: round.message,
      heldForCriteriaPause: held,
      pauseDump: pauseQuestions.join(" "),
    });
    return {
      round_no: round.roundNo,
      speaker,
      sender_role: speaker,
      offer_sender_role: asBargainRole(round.senderRole ?? null),
      message: round.message ?? null,
      decision: round.decision ?? null,
      price_minor: spokenRoundPriceMinor({
        priceMinor: round.priceminor,
        counterPriceMinor: round.counterPriceMinor,
      }),
      incoming_price_minor: round.priceminor ?? null,
      counter_price_minor: round.counterPriceMinor ?? null,
      held_for_criteria_pause: held,
    };
  });

  const first = rounds[0];
  const hasSyntheticBuyerOpen =
    !!first && first.senderRole === "BUYER" && Boolean(first.message?.trim());
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

export function mcpNegotiationTranscript(
  rounds: McpTranscriptRound[],
  sessionCurrentRound: number,
): { current_round: number; recent_messages: McpRecentMessage[] } {
  const messages = expandMcpTranscript(rounds);
  const last = messages.at(-1);
  return {
    current_round: last?.round_no ?? sessionCurrentRound,
    recent_messages: messages.slice(-4),
  };
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
  if (questions.length > 0) {
    parts.push(`Before we continue they need answers: ${questions.join(" / ")}`);
  }
  if (input.sessionStatus === "ACCEPTED") {
    parts.push("Deal is accepted. Open the Haggle checkout URL to pay.");
  }
  const say_to_user =
    parts.join(" ") || "The negotiation is waiting. Tell me your next price or answer.";
  const ask_user =
    questions.length > 0
      ? "Answer each question, then say whether to accept or counter and at what price."
      : input.sessionStatus === "ACCEPTED"
        ? "Open checkout on Haggle to finish payment."
        : "Quote that line, then ask what price to offer or whether to accept.";
  return { say_to_user, ask_user };
}
