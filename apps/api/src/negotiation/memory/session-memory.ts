import type {
  RoundFact,
  OpponentPattern,
  NegotiationPhase,
} from '../types.js';

/**
 * Session Memory Store — in-memory implementation (PostgreSQL-ready interface).
 * Stores round facts and opponent patterns per session.
 */
export class SessionMemoryStore {
  private facts = new Map<string, RoundFact[]>();
  private patterns = new Map<string, OpponentPattern>();

  async saveRoundFact(sessionId: string, fact: RoundFact): Promise<void> {
    const existing = this.facts.get(sessionId) ?? [];
    existing.push(fact);
    this.facts.set(sessionId, existing);
  }

  async getRecentFacts(sessionId: string, limit: number): Promise<RoundFact[]> {
    const all = this.facts.get(sessionId) ?? [];
    return all.slice(-limit);
  }

  /** 특정 조건 관련 라운드 검색 */
  async searchByCondition(sessionId: string, condition: string): Promise<RoundFact[]> {
    const all = this.facts.get(sessionId) ?? [];
    return all.filter((fact) => {
      // Search in conditions_changed keys and values
      for (const [key, value] of Object.entries(fact.conditions_changed)) {
        if (key.includes(condition) || value.includes(condition)) {
          return true;
        }
      }
      return false;
    });
  }

  /** 특정 Phase의 라운드만 검색 */
  async getFactsByPhase(sessionId: string, phase: NegotiationPhase): Promise<RoundFact[]> {
    const all = this.facts.get(sessionId) ?? [];
    return all.filter((fact) => fact.phase === phase);
  }

  /** 상대 패턴 프로필 갱신 — 라운드 사실로부터 패턴 계산 */
  async updateOpponentPattern(sessionId: string, facts: RoundFact[]): Promise<OpponentPattern> {
    if (facts.length === 0) {
      const defaultPattern: OpponentPattern = {
        aggression: 0.5,
        concession_rate: 0,
        preferred_tactics: [],
        condition_flexibility: 0.5,
        estimated_floor: 0,
      };
      this.patterns.set(sessionId, defaultPattern);
      return defaultPattern;
    }

    // Calculate concession rate from price movements
    let totalConcession = 0;
    let concessionCount = 0;
    const tactics: string[] = [];
    let conditionChanges = 0;

    // Collect tactic from first fact
    if (facts[0]!.seller_tactic && !tactics.includes(facts[0]!.seller_tactic)) {
      tactics.push(facts[0]!.seller_tactic);
    }

    for (let i = 1; i < facts.length; i++) {
      const prev = facts[i - 1]!;
      const curr = facts[i]!;
      const sellerMove = Math.abs(curr.seller_offer - prev.seller_offer);
      const buyerMove = Math.abs(curr.buyer_offer - prev.buyer_offer);
      const avgMove = (sellerMove + buyerMove) / 2;
      if (avgMove > 0) {
        totalConcession += avgMove;
        concessionCount++;
      }
      if (curr.seller_tactic && !tactics.includes(curr.seller_tactic)) {
        tactics.push(curr.seller_tactic);
      }
      conditionChanges += Object.keys(curr.conditions_changed).length;
    }

    const concessionRate = concessionCount > 0 ? totalConcession / concessionCount : 0;

    // Estimate aggression: high gap maintenance = aggressive
    const latestFact = facts[facts.length - 1]!;
    const aggression = Math.min(1, latestFact.gap / (latestFact.buyer_offer || 1));

    // Estimate floor from trend
    const estimatedFloor = latestFact.seller_offer - (concessionRate * (facts.length - facts.indexOf(latestFact)));

    const pattern: OpponentPattern = {
      aggression: Math.max(0, Math.min(1, aggression)),
      concession_rate: concessionRate,
      preferred_tactics: tactics,
      condition_flexibility: facts.length > 1
        ? Math.min(1, conditionChanges / (facts.length - 1))
        : 0.5,
      estimated_floor: Math.max(0, estimatedFloor),
    };

    // Detect pattern shift
    if (facts.length >= 4) {
      const midpoint = Math.floor(facts.length / 2);
      const firstHalf = facts.slice(0, midpoint);
      const secondHalf = facts.slice(midpoint);

      let firstRate = 0;
      let secondRate = 0;

      for (let i = 1; i < firstHalf.length; i++) {
        firstRate += Math.abs(firstHalf[i]!.gap - firstHalf[i - 1]!.gap);
      }
      for (let i = 1; i < secondHalf.length; i++) {
        secondRate += Math.abs(secondHalf[i]!.gap - secondHalf[i - 1]!.gap);
      }

      if (firstHalf.length > 1) firstRate /= (firstHalf.length - 1);
      if (secondHalf.length > 1) secondRate /= (secondHalf.length - 1);

      if (Math.abs(firstRate - secondRate) > 10) {
        pattern.pattern_shift_round = facts[midpoint]!.round;
      }
    }

    this.patterns.set(sessionId, pattern);
    return pattern;
  }

  async getOpponentPattern(sessionId: string): Promise<OpponentPattern | null> {
    return this.patterns.get(sessionId) ?? null;
  }

  /** 관련 Context 검색 — stall count와 미해결 조건 기반으로 관련 사실 선택 */
  async getRelevantContext(
    sessionId: string,
    currentRound: number,
    unresolvedConditions: string[],
    stallCount: number,
  ): Promise<{ facts: RoundFact[]; patternSummary?: string }> {
    const allFacts = this.facts.get(sessionId) ?? [];

    // Base: recent facts (more if stalled)
    const recentLimit = stallCount > 2 ? 5 : 3;
    let relevantFacts = allFacts.slice(-recentLimit);

    // If there are unresolved conditions, include facts where those conditions changed
    if (unresolvedConditions.length > 0) {
      const conditionFacts = allFacts.filter((fact) => {
        return unresolvedConditions.some((cond) =>
          Object.keys(fact.conditions_changed).some((key) => key.includes(cond)),
        );
      });
      // Merge without duplicates
      const factRounds = new Set(relevantFacts.map((f) => f.round));
      for (const cf of conditionFacts) {
        if (!factRounds.has(cf.round)) {
          relevantFacts.push(cf);
          factRounds.add(cf.round);
        }
      }
      // Sort by round
      relevantFacts.sort((a, b) => a.round - b.round);
    }

    // Build pattern summary if we have a pattern
    const pattern = this.patterns.get(sessionId);
    let patternSummary: string | undefined;
    if (pattern) {
      const parts: string[] = [];
      parts.push(`aggression:${pattern.aggression.toFixed(2)}`);
      parts.push(`concession:${pattern.concession_rate.toFixed(1)}`);
      if (pattern.preferred_tactics.length > 0) {
        parts.push(`tactics:${pattern.preferred_tactics.join(',')}`);
      }
      parts.push(`floor~${pattern.estimated_floor.toFixed(0)}`);
      if (pattern.pattern_shift_round !== undefined) {
        parts.push(`shift@R${pattern.pattern_shift_round}`);
      }
      patternSummary = parts.join(' ');
    }

    return { facts: relevantFacts, patternSummary };
  }
}
