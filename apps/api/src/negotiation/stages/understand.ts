/**
 * Stage 1: Understand
 *
 * Parse incoming message into structured UnderstandOutput.
 * Supports structured input bypass — when offerPriceMinor is provided directly,
 * skips LLM parsing and produces UnderstandOutput deterministically.
 */

import type { UnderstandInput, UnderstandOutput } from '../pipeline/types.js';

/**
 * Understand an incoming negotiation message.
 *
 * If the input already contains a structured price (from API's offerPriceMinor),
 * bypass LLM parsing entirely for speed and cost savings.
 */
export function understand(
  input: UnderstandInput | UnderstandOutput,
): UnderstandOutput {
  // Bypass: already parsed structured input
  if (isUnderstandOutput(input)) {
    return input;
  }

  // Structured price detection from raw message patterns like "Offer: $850"
  const priceMatch = input.raw_message.match(/\$(\d[\d,]*(?:\.\d{1,2})?)/);
  const price = priceMatch ? Number(priceMatch[1]!.replace(/,/g, '')) : undefined;

  // Detect action intent from message content
  const actionIntent = detectActionIntent(input.raw_message);

  // Detect sentiment
  const sentiment = detectSentiment(input.raw_message);

  // Extract conditions (simple key-value detection)
  const conditions = extractConditions(input.raw_message);

  return {
    price_offer: price,
    action_intent: actionIntent,
    conditions,
    sentiment,
    raw_text: input.raw_message,
  };
}

/**
 * Create an UnderstandOutput from a structured price offer.
 * Used when the API already provides offerPriceMinor.
 */
export function understandFromStructured(
  price: number,
  senderRole: 'buyer' | 'seller',
): UnderstandOutput {
  return {
    price_offer: price,
    action_intent: 'OFFER',
    conditions: {},
    sentiment: 'neutral',
    raw_text: `Offer: $${price}`,
  };
}

// ---------------------------------------------------------------------------
// Type guard
// ---------------------------------------------------------------------------

function isUnderstandOutput(input: unknown): input is UnderstandOutput {
  const obj = input as Record<string, unknown>;
  return 'action_intent' in obj && 'sentiment' in obj && 'raw_text' in obj;
}

// ---------------------------------------------------------------------------
// Intent detection
// ---------------------------------------------------------------------------

function detectActionIntent(text: string): UnderstandOutput['action_intent'] {
  const lower = text.toLowerCase();

  if (/\baccept\b|\bdeal\b|\bagreed?\b/.test(lower)) return 'ACCEPT';
  if (/\breject\b|\bno deal\b|\bpass\b|\bdecline\b/.test(lower)) return 'REJECT';
  if (/\bcounter\b|\bhow about\b|\bwhat about\b|\bi('d| would) (like|offer)\b/.test(lower)) return 'COUNTER';
  if (/\?/.test(text) && !/\$\d/.test(text)) return 'QUESTION';
  if (/\$\d/.test(text) || /\boffer\b/i.test(text)) return 'OFFER';

  return 'INFO';
}

// ---------------------------------------------------------------------------
// Sentiment detection
// ---------------------------------------------------------------------------

function detectSentiment(text: string): UnderstandOutput['sentiment'] {
  const lower = text.toLowerCase();

  const positiveWords = ['great', 'deal', 'agree', 'perfect', 'thanks', 'fair', 'good', 'love', 'happy'];
  const negativeWords = ['no', 'reject', 'terrible', 'ridiculous', 'awful', 'scam', 'rip-off', 'unfair'];

  let score = 0;
  for (const word of positiveWords) {
    if (lower.includes(word)) score += 1;
  }
  for (const word of negativeWords) {
    if (lower.includes(word)) score -= 1;
  }

  if (score > 0) return 'positive';
  if (score < 0) return 'negative';
  return 'neutral';
}

// ---------------------------------------------------------------------------
// Condition extraction
// ---------------------------------------------------------------------------

function extractConditions(text: string): Record<string, unknown> {
  const conditions: Record<string, unknown> = {};
  const lower = text.toLowerCase();

  if (/warranty/i.test(lower)) conditions.warranty_mentioned = true;
  if (/shipping|deliver/i.test(lower)) conditions.shipping_mentioned = true;
  if (/battery/i.test(lower)) conditions.battery_mentioned = true;
  if (/imei/i.test(lower)) conditions.imei_mentioned = true;
  if (/find my/i.test(lower)) conditions.find_my_mentioned = true;

  return conditions;
}
