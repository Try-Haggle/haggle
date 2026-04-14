/**
 * Stage 3: Decide
 *
 * Core decision logic extracted from the 13-step executor.
 * Routes to Skill (rule-based) or LLM depending on phase + action.
 */

import type { DecideInput, DecideOutput } from '../pipeline/types.js';
import type { ProtocolDecision } from '../types.js';
import { shouldUseReasoning } from '../config.js';
import { callLLM } from '../adapters/xai-client.js';

/**
 * Make a negotiation decision.
 *
 * Decision routing:
 * - BARGAINING + COUNTER → LLM augmentation (with skill fallback)
 * - All other cases → Skill rule-based (fallback when LLM unavailable)
 */
export async function decide(input: DecideInput): Promise<DecideOutput> {
  const { context, adapter, skill, phase, config, memory, facts, opponent } = input;
  const startMs = Date.now();

  // Step 1: Skill evaluateOffer (rule-based fallback, LLM augments in BARGAINING)
  const incomingOffer = memory.boundaries.opponent_offer;
  let decision: ProtocolDecision = await skill.evaluateOffer(
    memory,
    { price: incomingOffer },
    facts,
    phase,
  );
  let source: DecideOutput['source'] = 'skill';
  let reasoningMode = false;
  let llmRaw: string | undefined;
  let tokens: DecideOutput['tokens'];

  // Step 2: BARGAINING + COUNTER → LLM augmentation
  if (phase === 'BARGAINING' && decision.action === 'COUNTER') {
    try {
      const useReasoning = config.reasoningEnabled && shouldUseReasoning({
        gap: memory.boundaries.gap,
        gapRatio: memory.boundaries.gap /
          Math.abs(memory.boundaries.my_target - memory.boundaries.my_floor || 1),
        coachWarnings: context.briefing.warnings,
        opponentPattern: context.briefing.opponentPattern as import('../types.js').OpponentPatternType,
        softViolationCount: 0,
      });

      reasoningMode = useReasoning;

      // Build prompts
      const systemPrompt = adapter.buildSystemPrompt(skill.getLLMContext());
      const userPrompt = adapter.buildUserPrompt(memory, facts.slice(-5));

      // Call LLM
      const llmResponse = await callLLM(systemPrompt, userPrompt, {
        reasoning: useReasoning,
        correlationId: memory.session.session_id,
      });

      llmRaw = llmResponse.content;
      tokens = {
        prompt: llmResponse.usage.prompt_tokens,
        completion: llmResponse.usage.completion_tokens,
      };

      // Parse response
      const llmDecision = adapter.parseResponse(llmResponse.content);

      // Use LLM decision if it has a valid price for COUNTER
      if (llmDecision.action === 'COUNTER' && llmDecision.price && llmDecision.price > 0) {
        decision = llmDecision;
        source = 'llm';
      } else if (['ACCEPT', 'REJECT', 'HOLD'].includes(llmDecision.action)) {
        decision = llmDecision;
        source = 'llm';
      }
      // Otherwise, keep skill decision as fallback
    } catch (err) {
      // LLM failure → graceful fallback to skill decision
      console.warn('[decide] LLM fallback:', (err as Error).message);
      // decision already set from skill.evaluateOffer()
    }
  }

  const latencyMs = Date.now() - startMs;

  return {
    decision,
    source,
    reasoning_mode: reasoningMode,
    llm_raw: llmRaw,
    tokens,
    latency_ms: latencyMs,
  };
}
