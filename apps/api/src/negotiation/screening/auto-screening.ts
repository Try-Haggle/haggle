import type { ScreeningResult } from '../types.js';

interface ScreeningInput {
  messageText: string;
  senderTrustScore?: number;
  listingAge?: number; // days
  priceDeviation?: number; // % from market price
}

const SPAM_PATTERNS = [
  /\b(?:paypal|venmo|zelle|cashapp)\s+(?:only|me)\b/i,
  /\b(?:send|wire|transfer)\s+(?:money|cash|funds)\b/i,
  /\b(?:nigerian|prince|lottery|winner)\b/i,
  /\b(?:click|visit|go\s+to)\s+(?:this|my)\s+(?:link|site|page)\b/i,
  /(?:https?:\/\/)?(?:bit\.ly|tinyurl|t\.co)\//i,
  /\b(?:whatsapp|telegram|signal)\s+(?:me|only)\b/i,
];

const LOW_QUALITY_PATTERNS = [
  /^[A-Z\s!?]{20,}$/, // ALL CAPS screaming
  /(.)\1{4,}/, // repeated characters (e.g., "!!!!!!!")
];

/**
 * Screen incoming negotiation messages for spam/abuse.
 * Returns screening result with confidence and upgrade recommendation.
 */
export function screenMessage(input: ScreeningInput): ScreeningResult {
  const { messageText, senderTrustScore, priceDeviation } = input;

  let spamScore = 0;
  const reasons: string[] = [];

  // Pattern matching
  for (const pattern of SPAM_PATTERNS) {
    if (pattern.test(messageText)) {
      spamScore += 0.4;
      reasons.push(`Spam pattern match: ${pattern.source.slice(0, 30)}`);
    }
  }

  for (const pattern of LOW_QUALITY_PATTERNS) {
    if (pattern.test(messageText)) {
      spamScore += 0.15;
      reasons.push('Low-quality message pattern');
    }
  }

  // Trust score penalty
  if (senderTrustScore !== undefined && senderTrustScore < 0.3) {
    spamScore += 0.2;
    reasons.push(`Low trust score: ${senderTrustScore}`);
  }

  // Price deviation check (e.g., offering $10 for a $500 phone)
  if (priceDeviation !== undefined && priceDeviation > 80) {
    spamScore += 0.15;
    reasons.push(`Extreme price deviation: ${priceDeviation}%`);
  }

  // Empty or very short messages
  if (messageText.trim().length < 5) {
    spamScore += 0.3;
    reasons.push('Message too short');
  }

  const confidence = Math.min(1, spamScore);
  const is_spam = confidence >= 0.5;

  // Recommend model upgrade for borderline cases
  const should_upgrade_model = confidence >= 0.3 && confidence < 0.5;

  return {
    is_spam,
    confidence,
    reason: reasons.length > 0 ? reasons.join('; ') : undefined,
    should_upgrade_model,
  };
}
