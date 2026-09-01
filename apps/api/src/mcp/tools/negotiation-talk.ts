/** Copy the host model should speak, so Grok does not stop on raw JSON. */

export function formatMinorAsDollars(minor: string | number | null | undefined): string | null {
  const value = Number(minor);
  if (!Number.isFinite(value) || value <= 0) return null;
  return `$${(value / 100).toFixed(value % 100 === 0 ? 0 : 2)}`;
}

export function negotiationSayToUser(input: {
  counterpartRole?: "BUYER" | "SELLER" | null;
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
