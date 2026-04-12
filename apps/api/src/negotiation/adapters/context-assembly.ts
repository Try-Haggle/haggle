import type {
  CoreMemory,
  RoundFact,
  ContextLayers,
  NegotiationSkill,
  ModelAdapter,
  RefereeCoaching,
} from '../types.js';
import { NEGOTIATION_PROTOCOL_RULES } from '../prompts/protocol-rules.js';

/**
 * Assemble context layers for LLM prompt construction.
 * Each layer is independent — adapter decides how to combine/compress them.
 */
export function assembleContextLayers(params: {
  skill: NegotiationSkill;
  adapter: ModelAdapter;
  memory: CoreMemory;
  recentFacts: RoundFact[];
  coaching: RefereeCoaching;
  signals?: string[];
}): ContextLayers {
  const { skill, adapter, memory, recentFacts, coaching, signals } = params;

  // L0: Protocol rules (immutable)
  const L0_protocol = NEGOTIATION_PROTOCOL_RULES;

  // L1: Model-specific system prompt
  const L1_model = adapter.buildSystemPrompt(skill.getLLMContext());

  // L2: Skill context (category expertise, tactics, constraints)
  const L2_skill = buildSkillLayer(skill);

  // L3: Coaching (referee recommendations)
  const L3_coaching = buildCoachingLayer(coaching, adapter.coachingLevel());

  // L4: History (recent round facts)
  const L4_history = buildHistoryLayer(recentFacts);

  // L5: Signals (competition, warnings, etc.)
  const L5_signals = signals && signals.length > 0 ? signals.join('\n') : '';

  return { L0_protocol, L1_model, L2_skill, L3_coaching, L4_history, L5_signals };
}

function buildSkillLayer(skill: NegotiationSkill): string {
  const parts: string[] = [];

  parts.push(skill.getLLMContext());

  const tactics = skill.getTactics();
  if (tactics.length > 0) {
    parts.push('Available tactics: ' + tactics.join(', '));
  }

  const constraints = skill.getConstraints();
  if (constraints.length > 0) {
    parts.push('Constraints:');
    for (const c of constraints) {
      parts.push(`- ${c.rule}: ${c.description}`);
    }
  }

  return parts.join('\n');
}

function buildCoachingLayer(coaching: RefereeCoaching, level: 'DETAILED' | 'STANDARD' | 'LIGHT'): string {
  if (level === 'LIGHT') {
    return `rec:${coaching.recommended_price}|tactic:${coaching.suggested_tactic}|opp:${coaching.opponent_pattern}`;
  }

  const parts: string[] = [];
  parts.push(`Recommended price: $${coaching.recommended_price}`);
  parts.push(`Acceptable range: $${coaching.acceptable_range.min}-$${coaching.acceptable_range.max}`);
  parts.push(`Suggested tactic: ${coaching.suggested_tactic}`);
  parts.push(`Opponent pattern: ${coaching.opponent_pattern}`);

  if (level === 'DETAILED') {
    parts.push(`Convergence: ${(coaching.convergence_rate * 100).toFixed(1)}%`);
    parts.push(`Time pressure: ${(coaching.time_pressure * 100).toFixed(0)}%`);
    const u = coaching.utility_snapshot;
    parts.push(`Utility: price=${u.u_price.toFixed(2)} time=${u.u_time.toFixed(2)} total=${u.u_total.toFixed(2)}`);
    if (coaching.strategic_hints.length > 0) {
      parts.push('Hints: ' + coaching.strategic_hints.join('; '));
    }
    if (coaching.warnings.length > 0) {
      parts.push('Warnings: ' + coaching.warnings.join('; '));
    }
  }

  return parts.join('\n');
}

function buildHistoryLayer(facts: RoundFact[]): string {
  if (facts.length === 0) return '';

  return facts.map((f) => {
    let line = `R${f.round}[${f.phase}]: buyer=$${f.buyer_offer} seller=$${f.seller_offer} gap=$${f.gap}`;
    if (f.buyer_tactic) line += ` bt:${f.buyer_tactic}`;
    if (f.seller_tactic) line += ` st:${f.seller_tactic}`;
    if (Object.keys(f.conditions_changed).length > 0) {
      line += ' cond:' + Object.entries(f.conditions_changed).map(([k, v]) => `${k}=${v}`).join(',');
    }
    return line;
  }).join('\n');
}
