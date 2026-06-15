import { describe, it, expect } from 'vitest';
import { DeepSeekAdapter } from '../deepseek-adapter.js';
import type { CoreMemory, RoundFact } from '../../types.js';

function makeMemory(overrides: Partial<CoreMemory['session']> = {}): CoreMemory {
  return {
    session: {
      session_id: 'test', phase: 'BARGAINING', round: 5, rounds_remaining: 10,
      role: 'buyer', max_rounds: 15, intervention_mode: 'FULL_AUTO', ...overrides,
    },
    boundaries: { my_target: 500, my_floor: 650, current_offer: 520, opponent_offer: 620, gap: 100 },
    terms: { active: [], resolved_summary: '' },
    coaching: {
      recommended_price: 530, acceptable_range: { min: 480, max: 650 },
      suggested_tactic: 'anchoring', hint: '', opponent_pattern: 'LINEAR',
      convergence_rate: 0.1, time_pressure: 0.3,
      utility_snapshot: { u_price: 0.7, u_time: 0.7, u_risk: 0.5, u_quality: 0.5, u_total: 0.65 },
      strategic_hints: [], warnings: [],
    },
    buddy_dna: {
      style: 'balanced', preferred_tactic: 'reciprocal_concession',
      category_experience: 'electronics', condition_trade_success_rate: 0.7,
      best_timing: 'mid-bargaining',
      tone: { style: 'professional', formality: 'neutral', emoji_use: false },
    },
    skill_summary: 'test',
  };
}

describe('DeepSeekAdapter', () => {
  const adapter = new DeepSeekAdapter();

  it('should have correct model config', () => {
    expect(adapter.modelId).toBe('deepseek');
    expect(adapter.tier).toBe('basic');
    expect(adapter.coachingLevel()).toBe('STANDARD');
  });

  it('should build system prompt', () => {
    const prompt = adapter.buildSystemPrompt('Electronics skill context');
    expect(prompt).toContain('Electronics skill context');
    expect(prompt).toContain('JSON');
  });

  it('should build compact user prompt', () => {
    const prompt = adapter.buildUserPrompt(makeMemory(), []);
    expect(prompt).toContain('S:BARGAINING');
    expect(prompt).toContain('B:t$5.00');
  });

  it('should build user prompt with history', () => {
    const facts: RoundFact[] = [{
      round: 3, phase: 'BARGAINING', buyer_offer: 510, seller_offer: 640, gap: 130,
      conditions_changed: {}, coaching_given: { recommended: 520, tactic: 'anchoring' },
      coaching_followed: true, human_intervened: false, timestamp: Date.now(),
    }];
    const prompt = adapter.buildUserPrompt(makeMemory(), facts);
    expect(prompt).toContain('HIST:');
    expect(prompt).toContain('R3');
  });

  it('should build differential context', () => {
    const prev = makeMemory({ round: 4, rounds_remaining: 11 });
    const curr = makeMemory({ round: 5, rounds_remaining: 10 });
    const prompt = adapter.buildUserPrompt(curr, [], undefined, prev);
    expect(prompt).toContain('DELTA:');
    expect(prompt).toContain('round:5');
  });

  it('should parse valid JSON response and convert USD to minor units', () => {
    const raw = '{"action":"COUNTER","price":540,"reasoning":"Faratin curve","tactic_used":"anchoring"}';
    const decision = adapter.parseResponse(raw);
    expect(decision.action).toBe('COUNTER');
    expect(decision.price).toBe(54000);
    expect(decision.reasoning).toBe('Faratin curve');
    expect(decision.tactic_used).toBe('anchoring');
  });

  it('should parse response with markdown code blocks', () => {
    const raw = '```json\n{"action":"ACCEPT","price":600,"reasoning":"good price"}\n```';
    const decision = adapter.parseResponse(raw);
    expect(decision.action).toBe('ACCEPT');
  });

  it('should handle missing optional fields', () => {
    const raw = '{"action":"REJECT","reasoning":"too expensive"}';
    const decision = adapter.parseResponse(raw);
    expect(decision.action).toBe('REJECT');
    expect(decision.price).toBeUndefined();
    expect(decision.tactic_used).toBeUndefined();
  });

  it('should recover from malformed response', () => {
    const raw = 'Sure, here is my response: {"action":"HOLD"...broken';
    const decision = adapter.parseResponse(raw);
    expect(decision.action).toBe('HOLD');
    expect(decision.reasoning).toContain('Parse recovery');
  });

  it('should throw on completely unparseable response', () => {
    expect(() => adapter.parseResponse('I am not JSON at all')).toThrow('Failed to parse');
  });

  it('should include signals in prompt', () => {
    const prompt = adapter.buildUserPrompt(makeMemory(), [], ['competition_active', 'time_critical']);
    expect(prompt).toContain('SIG:');
    expect(prompt).toContain('competition_active');
  });

  it('should render OPP_SAID and THREAD when conversation is supplied', () => {
    const prompt = adapter.buildUserPrompt(makeMemory(), [], undefined, undefined, {
      opponent_message: 'The battery is at 92% and it has minor scratches.',
      recent_turns: [
        { round: 1, sender: 'BUYER', text: 'Hi, would $370 work?', price_minor: 37000 },
        { round: 2, sender: 'SELLER', text: 'The battery is at 92% and it has minor scratches.', price_minor: 48000 },
      ],
    });
    expect(prompt).toContain('OPP_SAID:');
    expect(prompt).toContain('battery is at 92%');
    expect(prompt).toContain('THREAD:');
    // memory.session.role is 'buyer' in makeMemory() — buyer turn is ME, seller turn is OPP
    expect(prompt).toContain('R1 ME');
    expect(prompt).toContain('R2 OPP');
  });

  it('should embed seller persona language in system prompt', () => {
    const prompt = adapter.buildSystemPrompt('skill context', 'seller');
    expect(prompt).toContain('SELLER');
    expect(prompt).toContain('my item');
  });

  it('should emit NEGOTIATION_HINT when gap ratio is tiny', () => {
    // Buyer: target $400, floor $500, my offer $462.50, opp offer $465 → gap $2.50
    const memory = makeMemory({ round: 9 });
    memory.boundaries = {
      my_target: 40000,
      my_floor: 50000,
      current_offer: 46250,
      opponent_offer: 46500,
      gap: 250,
    };
    const prompt = adapter.buildUserPrompt(memory, []);
    expect(prompt).toContain('NEGOTIATION_HINT:');
    expect(prompt).toMatch(/ACCEPT/);
  });

  it('should NOT emit NEGOTIATION_HINT when gap is still wide', () => {
    const memory = makeMemory({ round: 3 });
    memory.boundaries = {
      my_target: 40000,
      my_floor: 50000,
      current_offer: 42000,
      opponent_offer: 48000,
      gap: 6000,
    };
    const prompt = adapter.buildUserPrompt(memory, []);
    expect(prompt).not.toContain('NEGOTIATION_HINT:');
  });

  it('should warn buyer not to undercut their own prior offer', () => {
    const prompt = adapter.buildSystemPrompt('skill context', 'buyer');
    expect(prompt).toContain('BUYER');
    // The persona must explicitly forbid backsliding to a lower-than-own number.
    expect(prompt.toLowerCase()).toMatch(/never counter lower|backing down/);
  });
});
