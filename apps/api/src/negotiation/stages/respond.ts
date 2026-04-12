/**
 * Stage 5: Respond
 *
 * Generate user-facing message from validated decision.
 * Supports template mode (existing renderer) and LLM mode (future).
 */

import type { RespondInput, RespondOutput } from '../pipeline/types.js';
import { TemplateMessageRenderer } from '../rendering/message-renderer.js';

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

function respondWithTemplate(input: RespondInput): RespondOutput {
  const { validated, memory } = input;
  const { final_decision } = validated;
  const { buddy_dna } = memory;

  const message = templateRenderer.render(final_decision, {
    phase: memory.session.phase,
    role: memory.session.role,
    locale: 'en',
    activeTerms: memory.terms.active,
    tone: buddy_dna.tone,
  });

  return {
    message,
    tone: buddy_dna.tone.style,
  };
}
