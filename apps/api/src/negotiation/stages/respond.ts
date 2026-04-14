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

  const locale = resolveLocale(memory);

  const message = templateRenderer.render(final_decision, {
    phase: memory.session.phase,
    role: memory.session.role,
    locale,
    activeTerms: memory.terms.active,
    tone: buddy_dna.tone,
  });

  return {
    message,
    tone: buddy_dna.tone.style,
  };
}
