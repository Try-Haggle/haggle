import type {
  ModelAdapter,
  CoreMemory,
  RoundFact,
  ProtocolDecision,
  NegotiationPhase,
} from '../types.js';
import { PHASE_TOKEN_BUDGET as TOKEN_BUDGET } from '../types.js';

/**
 * GrokFast Model Adapter — Tier: basic.
 * Uses Structured Output (JSON mode) for reliable parsing.
 * Implements Differential Context to minimize token usage.
 */
export class GrokFastAdapter implements ModelAdapter {
  readonly modelId = 'grok-fast';
  readonly tier = 'basic' as const;
  readonly location = 'remote' as const;
  readonly capabilities = ['parse', 'reason', 'generate'] as const;

  buildSystemPrompt(skillContext: string): string {
    return [
      skillContext,
      '',
      'Respond ONLY with valid JSON matching this schema:',
      '{"action":"COUNTER|ACCEPT|REJECT|HOLD|DISCOVER|CONFIRM","price":number,"reasoning":"string","non_price_terms":{},"tactic_used":"string"}',
      'Do NOT include markdown, code blocks, or any text outside the JSON.',
    ].join('\n');
  }

  buildUserPrompt(
    memory: CoreMemory,
    recentFacts: RoundFact[],
    signals?: string[],
    prevMemory?: CoreMemory,
  ): string {
    const parts: string[] = [];

    // L3: Core Memory (compact encoding)
    if (prevMemory) {
      // Differential Context — only send what changed
      parts.push(this.encodeDelta(prevMemory, memory));
    } else {
      parts.push(this.encodeCoreMemoCompact(memory));
    }

    // L4: History (compact)
    if (recentFacts.length > 0) {
      parts.push('HIST:' + recentFacts.map((f) =>
        `R${f.round}:${f.buyer_offer}/${f.seller_offer}|g${f.gap}${f.buyer_tactic ? '|t:' + f.buyer_tactic : ''}`,
      ).join(';'));
    }

    // L5: Signals
    if (signals && signals.length > 0) {
      parts.push('SIG:' + signals.join(';'));
    }

    // Token budget check
    const budget = TOKEN_BUDGET[memory.session.phase];
    const estimated = parts.join('\n').length / 4; // rough estimate
    if (estimated > budget) {
      // Truncate history to fit
      const truncatedFacts = recentFacts.slice(-2);
      parts[1] = 'HIST:' + truncatedFacts.map((f) =>
        `R${f.round}:${f.buyer_offer}/${f.seller_offer}|g${f.gap}`,
      ).join(';');
    }

    return parts.join('\n');
  }

  parseResponse(raw: string): ProtocolDecision {
    // Strip markdown code blocks if present
    let cleaned = raw.trim();
    if (cleaned.startsWith('```')) {
      cleaned = cleaned.replace(/^```(?:json)?\n?/, '').replace(/\n?```$/, '');
    }

    try {
      const parsed = JSON.parse(cleaned);

      // Validate required fields
      if (!parsed.action || typeof parsed.action !== 'string') {
        throw new Error('Missing or invalid "action" field');
      }
      if (!parsed.reasoning || typeof parsed.reasoning !== 'string') {
        throw new Error('Missing or invalid "reasoning" field');
      }

      const decision: ProtocolDecision = {
        action: parsed.action,
        reasoning: parsed.reasoning,
      };

      if (typeof parsed.price === 'number' && parsed.price > 0) {
        decision.price = parsed.price;
      }
      if (parsed.non_price_terms && typeof parsed.non_price_terms === 'object') {
        decision.non_price_terms = parsed.non_price_terms;
      }
      if (typeof parsed.tactic_used === 'string') {
        decision.tactic_used = parsed.tactic_used;
      }

      return decision;
    } catch (err) {
      // Fallback: try to extract action from malformed response
      const actionMatch = cleaned.match(/"action"\s*:\s*"(\w+)"/);
      if (actionMatch) {
        return {
          action: actionMatch[1] as ProtocolDecision['action'],
          reasoning: `Parse recovery from malformed response: ${(err as Error).message}`,
        };
      }
      throw new Error(`Failed to parse LLM response: ${(err as Error).message}`);
    }
  }

  coachingLevel(): 'DETAILED' | 'STANDARD' | 'LIGHT' {
    return 'STANDARD';
  }

  // ─── Private helpers ───

  private encodeCoreMemoCompact(m: CoreMemory): string {
    const s = m.session;
    const b = m.boundaries;
    const c = m.coaching;
    const parts = [
      `S:${s.phase}|R${s.round}/${s.max_rounds}|${s.role}|${s.intervention_mode}`,
      `B:t${b.my_target}/f${b.my_floor}/c${b.current_offer}/o${b.opponent_offer}/g${b.gap}`,
      `C:rec${c.recommended_price}|${c.suggested_tactic}|opp:${c.opponent_pattern}|conv:${c.convergence_rate.toFixed(2)}|tp:${c.time_pressure.toFixed(2)}`,
    ];

    if (m.terms.active.length > 0) {
      parts.push('T:' + m.terms.active.map((t) =>
        `${t.term_id}:${t.status}${t.value !== undefined ? '=' + String(t.value) : ''}`,
      ).join(','));
    }

    if (m.competition) {
      const cp = m.competition;
      parts.push(`CP:batna${cp.batna_price}|n${cp.n_active_sessions}|rank${cp.my_rank}`);
    }

    return parts.join('\n');
  }

  private encodeDelta(prev: CoreMemory, curr: CoreMemory): string {
    const diffs: string[] = ['DELTA:'];

    if (prev.session.phase !== curr.session.phase) {
      diffs.push(`phase:${prev.session.phase}→${curr.session.phase}`);
    }
    if (prev.session.round !== curr.session.round) {
      diffs.push(`round:${curr.session.round}/${curr.session.max_rounds}`);
    }
    if (prev.boundaries.current_offer !== curr.boundaries.current_offer) {
      diffs.push(`myOffer:${prev.boundaries.current_offer}→${curr.boundaries.current_offer}`);
    }
    if (prev.boundaries.opponent_offer !== curr.boundaries.opponent_offer) {
      diffs.push(`oppOffer:${prev.boundaries.opponent_offer}→${curr.boundaries.opponent_offer}`);
    }
    if (prev.boundaries.gap !== curr.boundaries.gap) {
      diffs.push(`gap:${curr.boundaries.gap}`);
    }
    if (prev.coaching.recommended_price !== curr.coaching.recommended_price) {
      diffs.push(`rec:${curr.coaching.recommended_price}`);
    }
    if (prev.coaching.opponent_pattern !== curr.coaching.opponent_pattern) {
      diffs.push(`opp:${curr.coaching.opponent_pattern}`);
    }
    if (prev.coaching.suggested_tactic !== curr.coaching.suggested_tactic) {
      diffs.push(`tactic:${curr.coaching.suggested_tactic}`);
    }

    // If nothing changed (shouldn't happen), send full memo
    if (diffs.length <= 1) {
      return this.encodeCoreMemoCompact(curr);
    }

    return diffs.join('|');
  }
}
