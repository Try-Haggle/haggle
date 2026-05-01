/**
 * Stage 1: Understand
 *
 * Parse incoming message into structured UnderstandOutput.
 * Supports structured input bypass — when offerPriceMinor is provided directly,
 * skips LLM parsing and produces UnderstandOutput deterministically.
 */

import { extractConversationSignals } from '../../services/conversation-signal-extractor.js';
import type { ConversationSignal } from '../../services/conversation-signal-extractor.js';
import { resolveTagGardenQuestionForSlot } from '../../services/tag-garden-requirements.js';
import type {
  ConversationType,
  InformationLink,
  MissingInformationNeed,
  UnderstandInput,
  UnderstandOutput,
} from '../pipeline/types.js';

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
  const signals = extractConversationSignals({
    text: input.raw_message,
    rolePerspective: input.sender_role,
  });
  const informationLinks = buildInformationLinks(signals);
  const conversationType = classifyConversationType(input.raw_message, actionIntent, signals, conditions);
  const missingInformation = inferMissingInformation(
    input.raw_message,
    conversationType,
    actionIntent,
    informationLinks,
    conditions,
    price,
  );

  return {
    price_offer: price,
    action_intent: actionIntent,
    conditions,
    sentiment,
    raw_text: input.raw_message,
    conversation_type: conversationType,
    information_links: informationLinks,
    missing_information: missingInformation,
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
    conversation_type: 'PRICE_NEGOTIATION',
    information_links: [{
      signal_type: 'price_anchor',
      entity_type: 'price',
      key: 'price',
      value: String(price),
      confidence: 1,
      connects_to: 'pricing',
    }],
    missing_information: [],
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

// ---------------------------------------------------------------------------
// Conversation intelligence
// ---------------------------------------------------------------------------

function classifyConversationType(
  text: string,
  actionIntent: UnderstandOutput['action_intent'],
  signals: ConversationSignal[],
  conditions: Record<string, unknown>,
): ConversationType {
  const lower = text.toLowerCase();
  const signalTypes = new Set(signals.map((s) => s.type));
  const termEntities = new Set(signals.filter((s) => s.type === 'term_preference').map((s) => s.entityType));

  if (actionIntent === 'ACCEPT' || /\b(confirm|confirmed|ready to pay|checkout)\b/.test(lower)) {
    return 'CLOSING_CONFIRMATION';
  }
  if (signalTypes.has('security_threat')) return 'TRUST_SAFETY';
  if (signalTypes.has('trust_risk')) return 'TRUST_SAFETY';
  if (
    actionIntent === 'OFFER' ||
    actionIntent === 'COUNTER' ||
    signalTypes.has('price_anchor') ||
    signalTypes.has('price_resistance')
  ) {
    return 'PRICE_NEGOTIATION';
  }
  if (actionIntent === 'QUESTION') return 'INFORMATION_REQUEST';
  if (termEntities.has('shipping') || termEntities.has('fulfillment') || /shipping|deliver|pickup|meet locally/i.test(text)) {
    return 'LOGISTICS_NEGOTIATION';
  }
  if (
    signalTypes.has('condition_claim') ||
    conditions.battery_mentioned ||
    conditions.warranty_mentioned ||
    conditions.imei_mentioned ||
    conditions.find_my_mentioned
  ) {
    return 'CONDITION_NEGOTIATION';
  }
  if (signalTypes.has('product_identity') || signalTypes.has('demand_intent')) return 'READINESS_DISCOVERY';
  if (signalTypes.size > 0) return 'INFORMATION_PROVIDED';
  return text.trim() ? 'SMALL_TALK' : 'READINESS_DISCOVERY';
}

function buildInformationLinks(signals: ConversationSignal[]): InformationLink[] {
  return signals.slice(0, 12).map((signal) => ({
    signal_type: signal.type,
    entity_type: signal.entityType,
    key: `${signal.type}:${signal.entityType}`,
    value: signal.normalizedValue,
    confidence: signal.confidence,
    connects_to: mapSignalToContext(signal),
  }));
}

function mapSignalToContext(signal: ConversationSignal): InformationLink['connects_to'] {
  switch (signal.type) {
    case 'price_anchor':
    case 'price_resistance':
      return 'pricing';
    case 'product_identity':
    case 'product_attribute':
    case 'tag_candidate':
      return 'product';
    case 'condition_claim':
      return 'condition';
    case 'term_preference':
    case 'term_candidate':
      return 'terms';
    case 'trust_risk':
    case 'security_threat':
      return 'trust';
    case 'demand_intent':
    case 'deal_blocker':
      return 'demand';
    case 'market_outcome':
      return 'outcome';
    default:
      return 'memory';
  }
}

function inferMissingInformation(
  text: string,
  conversationType: ConversationType,
  actionIntent: UnderstandOutput['action_intent'],
  links: InformationLink[],
  conditions: Record<string, unknown>,
  price?: number,
): MissingInformationNeed[] {
  const needs: MissingInformationNeed[] = [];
  const lower = text.toLowerCase();
  const hasLink = (connectsTo: InformationLink['connects_to'], entityType?: string) =>
    links.some((link) => link.connects_to === connectsTo && (!entityType || link.entity_type === entityType));

  if (conversationType === 'READINESS_DISCOVERY' && !hasLink('product')) {
    addNeed(needs, {
      slot: 'product_identity',
      priority: 'high',
      reason: 'No product or category is clear enough to choose the right negotiation skill.',
      question: 'What product or category should I negotiate for?',
    });
  }

  if ((actionIntent === 'OFFER' || actionIntent === 'COUNTER') && price === undefined && !hasLink('pricing')) {
    addNeed(needs, {
      slot: 'price_anchor',
      priority: 'high',
      reason: 'The message looks like a price move, but no price was extracted.',
      question: 'What price are you proposing?',
    });
  }

  if (/\bbattery\b/i.test(text) && !hasLink('condition', 'battery_health')) {
    addNeed(needs, {
      slot: 'battery_health',
      priority: 'medium',
      reason: 'Battery was mentioned without a concrete health percentage.',
      question: 'What is the battery health percentage?',
    });
  }

  if (/\b(unlocked|carrier|locked)\b/i.test(text) && (actionIntent === 'QUESTION' || !hasLink('product', 'carrier'))) {
    addNeed(needs, {
      slot: 'carrier_lock',
      priority: 'medium',
      reason: 'Carrier status matters for device value but was not resolved.',
      question: 'Is the device unlocked or tied to a carrier?',
    });
  }

  if (
    (conditions.imei_mentioned || conditions.find_my_mentioned || /\b(serial|verification|authentic)\b/i.test(text)) &&
    (actionIntent === 'QUESTION' || !hasLink('condition', 'verification'))
  ) {
    addNeed(needs, {
      slot: 'verification_status',
      priority: 'high',
      reason: 'Verification was raised but not confirmed.',
      question: 'Can you confirm IMEI or serial verification status?',
    });
  }

  if (conditions.warranty_mentioned && (actionIntent === 'QUESTION' || !/active|included|until|expires|expired/i.test(lower))) {
    addNeed(needs, {
      slot: 'warranty_status',
      priority: 'medium',
      reason: 'Warranty was mentioned without status or expiration detail.',
      question: 'Is warranty or AppleCare active, and until when?',
    });
  }

  if (
    (conditions.shipping_mentioned || conversationType === 'LOGISTICS_NEGOTIATION') &&
    (actionIntent === 'QUESTION' || !/\b(included|insured|pickup|local|free|\$\d|tracking)\b/i.test(text))
  ) {
    addNeed(needs, {
      slot: 'shipping_terms',
      priority: 'medium',
      reason: 'Shipping was mentioned without cost, insurance, or pickup details.',
      question: 'Is shipping included, insured, or would this be local pickup?',
    });
  }

  if (conversationType === 'TRUST_SAFETY') {
    addNeed(needs, {
      slot: 'payment_safety',
      priority: 'high',
      reason: 'The message contains a trust or off-platform payment risk.',
      question: 'Should we keep payment and messaging inside Haggle checkout?',
    });
  }

  return needs.slice(0, 4);
}

function addNeed(needs: MissingInformationNeed[], need: MissingInformationNeed): void {
  if (needs.some((existing) => existing.slot === need.slot)) return;
  const tagGardenQuestion = resolveTagGardenQuestionForSlot(need.slot);
  needs.push(tagGardenQuestion
    ? {
        ...need,
        question: tagGardenQuestion.question,
        question_source: tagGardenQuestion.source,
        tag_slot_id: tagGardenQuestion.slotId,
        enforcement: tagGardenQuestion.enforcement,
        answer_options: tagGardenQuestion.answerOptions,
      }
    : { ...need, question_source: 'fallback' });
}
