/**
 * Stage 5: Respond
 *
 * Generate user-facing message from validated decision.
 * Supports template mode (existing renderer) and LLM mode (future).
 */

import type { RespondInput, RespondOutput } from "../pipeline/types.js";
import { detectLanguage, type SupportedLocale } from "../rendering/language-detect.js";
import { TemplateMessageRenderer } from "../rendering/message-renderer.js";
import { isDealClosingAction } from "../types.js";
import { messageLeaksPrivateState } from "./public-message-guard.js";

const templateRenderer = new TemplateMessageRenderer();

/**
 * Generate a response message.
 *
 * Mode routing:
 * - 'template': Uses TemplateMessageRenderer (current production)
 * - 'llm': Future LLM-generated messages (falls back to template for now)
 */
export function respond(input: RespondInput): RespondOutput {
  // Both modes currently render via the template path (LLM message generation is a
  // future mode); routing is kept explicit so the seam stays visible.
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
function resolveLocale(memory: import("../types.js").CoreMemory): SupportedLocale {
  // Check if session has a stored locale
  const sessionAny = memory.session as Record<string, unknown>;
  if (typeof sessionAny.detected_locale === "string") {
    return sessionAny.detected_locale as SupportedLocale;
  }

  // Auto-detect from the last opponent message if available
  if (typeof sessionAny.last_opponent_message === "string") {
    const detection = detectLanguage(sessionAny.last_opponent_message as string);
    if (detection.confidence > 0.5) {
      return detection.locale;
    }
  }

  return "en";
}

function respondWithTemplate(input: RespondInput): RespondOutput {
  const { validated, memory } = input;
  const { final_decision } = validated;
  const { buddy_dna } = memory;

  const myLocale = resolveLocale(memory);
  const counterpartyLocale = resolveCounterpartyLocale(memory);

  // Prefer the LLM-authored message when one survived validation. Otherwise
  // fall back to the deterministic template renderer. The guards below catch
  // obvious failure modes (prompt-injection, too long, and — when closing — a message
  // that confirms a different price than the agreed one). The pipeline pins
  // `final_decision.price` to the offer being accepted before this stage runs, and the
  // template renders that same value, so the fallback states the real number. Anything
  // more aggressive is the referee's job.
  const llmMessage = pickValidLLMMessage(final_decision, memory);
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
 * vectors that states the correct price. What we reject: anything missing, over
 * MAX_LLM_MESSAGE_CHARS, a code fence / jailbreak attempt, OR (when the decision
 * carries a price) a message that does not state that exact price — which prevents
 * the LLM from confirming a deal at a number that isn't the agreed one.
 */
function pickValidLLMMessage(
  decision: import("../types.js").EngineDecision,
  memory: import("../types.js").CoreMemory,
): string | null {
  const raw = decision.message;
  if (typeof raw !== "string") return null;
  const text = raw.trim();
  if (text.length === 0) return null;
  if (text.length > MAX_LLM_MESSAGE_CHARS) return null;
  for (const pat of INJECTION_PATTERNS) {
    if (pat.test(text)) return null;
  }
  if (messageLeaksPrivateState(text, memory, decision.price)) {
    return null;
  }
  // Only enforce the price echo when the deal is closing — a confirmation must state
  // the agreed number, and this is where the LLM tends to echo its own last offer
  // instead. COUNTER/others keep the LLM's phrasing untouched (they reliably echo
  // their own counter). CONFIRM must be covered too: the CLOSING-phase skills emit
  // CONFIRM rather than ACCEPT, so an ACCEPT-only check never fired on a real close.
  if (isDealClosingAction(decision.action) && !messageStatesPrice(text, decision.price)) {
    return null;
  }
  return text;
}

/**
 * Whether `text` states the given price (in minor units) as its own figure.
 *
 * Compares by VALUE, not by string shape: every number in the message is parsed to
 * minor units and matched against the price, so "$217.75", "217.75" and "$13,400" all
 * work, and "$215.00" satisfies a price of 21500. Building a regex from the dollar
 * amount instead — which is what this did first — rounded 21775 to "218", so it threw
 * away the message that named the price EXACTLY right and would have accepted one off
 * by 25c. That is the same class of mismatch this guard exists to prevent.
 *
 * When there is no meaningful price to state (e.g. REJECT), returns true.
 */
function messageStatesPrice(text: string, priceMinor: number | undefined): boolean {
  if (priceMinor == null || priceMinor <= 0) return true;
  const figures = text.match(/\d[\d,]*(?:\.\d+)?/g);
  if (!figures) return false;
  return figures.some(
    (raw) => Math.round(Number(raw.replace(/,/g, "")) * 100) === Math.round(priceMinor),
  );
}

/**
 * Resolve the counterparty's locale.
 * Used to generate a second message in their language.
 */
function resolveCounterpartyLocale(memory: import("../types.js").CoreMemory): SupportedLocale {
  const sessionAny = memory.session as Record<string, unknown>;
  if (typeof sessionAny.counterparty_locale === "string") {
    return sessionAny.counterparty_locale as SupportedLocale;
  }
  return "en"; // default: counterparty uses English
}
