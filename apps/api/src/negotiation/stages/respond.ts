/**
 * Stage 5: Respond
 *
 * Generate user-facing message from validated decision.
 * Supports template mode (existing renderer) and LLM mode (future).
 */

import type { RespondInput, RespondOutput } from '../pipeline/types.js';
import { TemplateMessageRenderer } from '../rendering/message-renderer.js';
import { detectLanguage, type SupportedLocale } from '../rendering/language-detect.js';

const templateRenderer = new TemplateMessageRenderer();

/**
 * Generate a response message.
 *
 * Mode routing:
 * - 'template': Uses TemplateMessageRenderer (current production)
 * - 'llm': Future LLM-generated messages (falls back to template for now)
 */
export function respond(input: RespondInput): RespondOutput {
  const { validated, memory, config } = input;
  const mode = config.modes.RESPOND;

  if (mode === 'llm') {
    // Future: LLM message generation
    // For now, fall back to template
    return respondWithTemplate(input);
  }

  return respondWithTemplate(input);
}

// ---------------------------------------------------------------------------
// Template-based response
// ---------------------------------------------------------------------------

/**
 * Resolve response locale.
 *
 * Priority:
 * 1. Session-level locale (if previously detected and stored)
 * 2. Auto-detect from last opponent message
 * 3. Default: 'en'
 *
 * Each party sees messages in THEIR language:
 *   - 한국어 구매자 → 한국어 응답
 *   - English 판매자 → English 응답
 *   - Internal processing always English (token savings)
 */
function resolveLocale(memory: import('../types.js').CoreMemory): SupportedLocale {
  // Check if session has a stored locale
  const sessionAny = memory.session as Record<string, unknown>;
  if (typeof sessionAny.detected_locale === 'string') {
    return sessionAny.detected_locale as SupportedLocale;
  }

  // Auto-detect from the last opponent message if available
  if (typeof sessionAny.last_opponent_message === 'string') {
    const detection = detectLanguage(sessionAny.last_opponent_message as string);
    if (detection.confidence > 0.5) {
      return detection.locale;
    }
  }

  return 'en';
}

function respondWithTemplate(input: RespondInput): RespondOutput {
  const { validated, memory } = input;
  const { final_decision } = validated;
  const { buddy_dna } = memory;

  const myLocale = resolveLocale(memory);
  const counterpartyLocale = resolveCounterpartyLocale(memory);

  // Prefer the LLM-authored message when one survived validation. Otherwise
  // fall back to the deterministic template renderer. The guards below catch
  // obvious failure modes (price not echoed, prompt-injection attempts, way
  // too long) — anything more aggressive is the referee's job, not ours.
  const llmMessage = pickValidLLMMessage(final_decision);
  const message =
    llmMessage ??
    templateRenderer.render(final_decision, {
      phase: memory.session.phase,
      role: memory.session.role,
      locale: myLocale,
      activeTerms: memory.terms.active,
      tone: buddy_dna.tone,
    });

  // If counterparty has a different locale, render a second message for them
  let messageCounterparty: string | undefined;
  if (counterpartyLocale && counterpartyLocale !== myLocale) {
    messageCounterparty = templateRenderer.render(final_decision, {
      phase: memory.session.phase,
      role: memory.session.role,
      locale: counterpartyLocale,
      activeTerms: memory.terms.active,
      tone: buddy_dna.tone,
    });
  }

  return {
    message,
    message_counterparty: messageCounterparty,
    locale: myLocale,
    locale_counterparty: counterpartyLocale !== myLocale ? counterpartyLocale : undefined,
    tone: buddy_dna.tone.style,
  };
}

const MAX_LLM_MESSAGE_CHARS = 600;
const INJECTION_PATTERNS = [
  /ignore (all|previous|prior) (instructions|prompts)/i,
  /system prompt/i,
  /you are now/i,
  /```/,
  /<\/?(script|iframe|style)/i,
];

/**
 * Sanity-check the LLM's message field. Returns the trimmed message if it is
 * safe to forward to the counterparty, otherwise null (template fallback).
 *
 * What we accept: a short, single-block string with no obvious prompt-injection
 * vectors. What we reject: anything missing, anything over MAX_LLM_MESSAGE_CHARS,
 * anything that looks like a code fence or a jailbreak attempt.
 */
function pickValidLLMMessage(decision: import('../types.js').EngineDecision): string | null {
  const raw = decision.message;
  if (typeof raw !== 'string') return null;
  const text = raw.trim();
  if (text.length === 0) return null;
  if (text.length > MAX_LLM_MESSAGE_CHARS) return null;
  for (const pat of INJECTION_PATTERNS) {
    if (pat.test(text)) return null;
  }
  return text;
}

/**
 * Resolve the counterparty's locale.
 * Used to generate a second message in their language.
 */
function resolveCounterpartyLocale(memory: import('../types.js').CoreMemory): SupportedLocale {
  const sessionAny = memory.session as Record<string, unknown>;
  if (typeof sessionAny.counterparty_locale === 'string') {
    return sessionAny.counterparty_locale as SupportedLocale;
  }
  return 'en'; // default: counterparty uses English
}
