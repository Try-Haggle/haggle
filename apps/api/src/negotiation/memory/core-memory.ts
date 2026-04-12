import type {
  CoreMemory,
  NegotiationPhase,
  HumanInterventionMode,
  RefereeCoaching,
  BuddyDNA,
} from '../types.js';

export class CoreMemoryStore {
  private store = new Map<string, CoreMemory>();

  get(sessionId: string): CoreMemory | null {
    const memory = this.store.get(sessionId);
    return memory ? structuredClone(memory) : null;
  }

  set(sessionId: string, memory: CoreMemory): void {
    this.store.set(sessionId, memory);
  }

  /** 세션 초기화 — 전체 CoreMemory 생성 */
  initialize(params: {
    sessionId: string;
    role: 'buyer' | 'seller';
    target: number;
    floor: number;
    maxRounds: number;
    interventionMode: HumanInterventionMode;
    buddyDna: BuddyDNA;
    skillSummary: string;
  }): CoreMemory {
    const memory: CoreMemory = {
      session: {
        session_id: params.sessionId,
        phase: 'DISCOVERY',
        round: 0,
        rounds_remaining: params.maxRounds,
        role: params.role,
        max_rounds: params.maxRounds,
        intervention_mode: params.interventionMode,
      },
      boundaries: {
        my_target: params.target,
        my_floor: params.floor,
        current_offer: 0,
        opponent_offer: 0,
        gap: 0,
      },
      terms: {
        active: [],
        resolved_summary: '',
      },
      coaching: {
        recommended_price: params.target,
        acceptable_range: { min: Math.min(params.target, params.floor), max: Math.max(params.target, params.floor) },
        suggested_tactic: 'anchoring',
        hint: '',
        opponent_pattern: 'UNKNOWN',
        convergence_rate: 0,
        time_pressure: 0,
        utility_snapshot: { u_price: 0, u_time: 0, u_risk: 0, u_quality: 0, u_total: 0 },
        strategic_hints: [],
        warnings: [],
      },
      buddy_dna: params.buddyDna,
      skill_summary: params.skillSummary,
    };

    this.store.set(params.sessionId, memory);
    return memory;
  }

  /** 라운드 결과 반영하여 Core Memory 갱신 */
  updateAfterRound(
    sessionId: string,
    roundResult: {
      price: number;
      opponentPrice: number;
      conditions: Record<string, string>;
      phase: NegotiationPhase;
    },
    newCoaching: RefereeCoaching,
  ): CoreMemory {
    const memory = this.store.get(sessionId);
    if (!memory) {
      throw new Error(`Session ${sessionId} not found in CoreMemoryStore`);
    }

    const role = memory.session.role;

    // Gap calculation: buyer wants lower price, seller wants higher
    const gap = role === 'buyer'
      ? roundResult.opponentPrice - roundResult.price   // buyer: opponent - my offer
      : roundResult.price - roundResult.opponentPrice;  // seller: my offer - opponent

    const updated: CoreMemory = {
      ...memory,
      session: {
        ...memory.session,
        round: memory.session.round + 1,
        rounds_remaining: memory.session.rounds_remaining - 1,
        phase: roundResult.phase,
      },
      boundaries: {
        ...memory.boundaries,
        current_offer: roundResult.price,
        opponent_offer: roundResult.opponentPrice,
        gap,
      },
      coaching: newCoaching,
    };

    this.store.set(sessionId, updated);
    return updated;
  }

  /** Phase 전환 시 phase 업데이트 */
  updatePhase(sessionId: string, newPhase: NegotiationPhase): CoreMemory {
    const memory = this.store.get(sessionId);
    if (!memory) {
      throw new Error(`Session ${sessionId} not found in CoreMemoryStore`);
    }

    const updated: CoreMemory = {
      ...memory,
      session: {
        ...memory.session,
        phase: newPhase,
      },
    };

    this.store.set(sessionId, updated);
    return updated;
  }

  /** Human Intervention Mode 변경 (라운드 중에도 가능) */
  updateInterventionMode(sessionId: string, mode: HumanInterventionMode): CoreMemory {
    const memory = this.store.get(sessionId);
    if (!memory) {
      throw new Error(`Session ${sessionId} not found in CoreMemoryStore`);
    }

    const updated: CoreMemory = {
      ...memory,
      session: {
        ...memory.session,
        intervention_mode: mode,
      },
    };

    this.store.set(sessionId, updated);
    return updated;
  }

  delete(sessionId: string): void {
    this.store.delete(sessionId);
  }
}
