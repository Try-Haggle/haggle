// =========================================
// Layer A: Protocol Contract (불변)
// =========================================

/** 5-Phase 협상 상태 */
export type NegotiationPhase =
  | 'DISCOVERY'
  | 'OPENING'
  | 'BARGAINING'
  | 'CLOSING'
  | 'SETTLEMENT';

/** Phase 전환 이벤트 */
export type PhaseTransitionEvent =
  | 'INITIAL_OFFER_MADE'
  | 'COUNTER_OFFER_MADE'
  | 'NEAR_DEAL_DETECTED'
  | 'BOTH_CONFIRMED'
  | 'REVERT_REQUESTED'
  | 'TIMEOUT'
  | 'ABORT';

/** Protocol Decision — LLM/Skill이 반환하는 순수 결정 (message 없음) */
export interface ProtocolDecision {
  action: 'COUNTER' | 'ACCEPT' | 'REJECT' | 'HOLD' | 'DISCOVER' | 'CONFIRM';
  price?: number;
  reasoning: string;
  non_price_terms?: Record<string, unknown>;
  tactic_used?: string;
}

/** 사용자에게 표시되는 최종 응답 (Protocol + Presentation) */
export interface NegotiationMove extends ProtocolDecision {
  message: string;
}

/** 4개 Human Intervention Mode */
export type HumanInterventionMode =
  | 'FULL_AUTO'
  | 'APPROVE_ONLY'
  | 'HYBRID'
  | 'MANUAL';

/** HYBRID 모드 설정: Phase별 자동/수동 */
export type HybridModeConfig = {
  [phase in NegotiationPhase]?: 'auto' | 'manual';
};

/** 심판이 매 라운드 제공하는 코칭 */
export interface RefereeCoaching {
  recommended_price: number;
  acceptable_range: { min: number; max: number };
  suggested_tactic: string;
  hint: string;
  opponent_pattern: OpponentPatternType;
  convergence_rate: number;
  time_pressure: number;
  utility_snapshot: {
    u_price: number;
    u_time: number;
    u_risk: number;
    u_quality: number;
    u_total: number;
  };
  strategic_hints: string[];
  warnings: string[];
}

export type OpponentPatternType = 'BOULWARE' | 'CONCEDER' | 'LINEAR' | 'UNKNOWN';

/** 검증 결과 */
export interface ValidationResult {
  passed: boolean;
  /** HARD violation이 없으면 true — referee-service가 진행 여부를 판단할 때 사용 */
  hardPassed: boolean;
  violations: ValidationViolation[];
}

export interface ValidationViolation {
  rule: string;
  severity: 'HARD' | 'SOFT';
  guidance: string;
  suggested_fix?: Partial<ProtocolDecision>;
}

// =========================================
// Term Taxonomy (Skill 제작자 표준)
// =========================================

/** 표준 Term 카테고리 */
export type TermCategory =
  | 'FINANCIAL'
  | 'LOGISTICS'
  | 'CONDITION'
  | 'WARRANTY'
  | 'BUNDLE'
  | 'TIMING'
  | 'VERIFICATION'
  | 'SERVICE'
  | 'CUSTOM';

/** 카테고리 특화 Term (Skill이 추가 정의) */
export interface CategoryTerm {
  id: string;
  parent_category: TermCategory;
  display_name: string;
  value_type: 'number' | 'enum' | 'boolean' | 'text';
  value_range?: { min?: number; max?: number } | string[];
  unit?: string;
  typical_impact: string;
  evaluate_hint: string;
}

/** Skill의 Term 선언 */
export interface SkillTermDeclaration {
  supported_terms: string[];
  category_terms: CategoryTerm[];
  custom_term_handling: 'full' | 'basic' | 'none';
}

/** 협상 중 활성화된 Term */
export interface ActiveTerm {
  term_id: string;
  category: TermCategory;
  display_name: string;
  status: 'agreed' | 'unresolved' | 'not_discussed' | 'proposed';
  value?: unknown;
  buyer_value_assessment?: number;
  seller_value_assessment?: number;
  proposed_by: 'buyer' | 'seller' | 'protocol';
  round_introduced: number;
}

// =========================================
// Core Memory (~300-800 tok, 토큰 바운딩)
// =========================================

export interface CoreMemory {
  session: {
    session_id: string;
    phase: NegotiationPhase;
    round: number;
    rounds_remaining: number;
    role: 'buyer' | 'seller';
    max_rounds: number;
    intervention_mode: HumanInterventionMode;
    /** Session creation timestamp in epoch ms — used for real-time t_elapsed */
    created_at_ms?: number;
    /** Session max duration in ms — category-dependent (default 24h for electronics) */
    max_duration_ms?: number;
    /** Urgency signal: higher = faster concession + more time pressure */
    urgency?: 'low' | 'normal' | 'high' | 'urgent';
  };
  boundaries: {
    my_target: number;
    my_floor: number;
    current_offer: number;
    opponent_offer: number;
    gap: number;
  };
  terms: {
    active: ActiveTerm[];
    resolved_summary: string;
  };
  coaching: RefereeCoaching;
  buddy_dna: BuddyDNA;
  skill_summary: string;
  competition?: CrossPressureContext;
}

/** 버디 DNA — 경험 패턴 */
export interface BuddyDNA {
  style: 'aggressive' | 'defensive' | 'balanced';
  preferred_tactic: string;
  category_experience: string;
  condition_trade_success_rate: number;
  best_timing: string;
  tone: BuddyTone;
}

/** 버디 말투 — 같은 ProtocolDecision을 다르게 표현 */
export interface BuddyTone {
  style: 'professional' | 'friendly' | 'analytical' | 'assertive' | 'casual';
  formality: 'formal' | 'neutral' | 'informal';
  emoji_use: boolean;
  signature_phrases?: string[];
}

// =========================================
// Session Memory (PostgreSQL + Redis)
// =========================================

export interface RoundFact {
  round: number;
  phase: NegotiationPhase;
  buyer_offer: number;
  seller_offer: number;
  gap: number;
  buyer_tactic?: string;
  seller_tactic?: string;
  conditions_changed: Record<string, string>;
  coaching_given: { recommended: number; tactic: string };
  coaching_followed: boolean;
  human_intervened: boolean;
  timestamp: number;
}

export interface OpponentPattern {
  aggression: number;
  concession_rate: number;
  preferred_tactics: string[];
  condition_flexibility: number;
  pattern_shift_round?: number;
  estimated_floor: number;
}

// =========================================
// Checkpoint 시스템
// =========================================

export interface Checkpoint {
  id: string;
  session_id: string;
  phase: NegotiationPhase;
  version: number;
  core_memory_snapshot: CoreMemory;
  conditions_state: Record<string, string>;
  total_rounds_at_checkpoint: number;
  both_agreed: boolean;
  created_at: number;
  /** Round explainability snapshot (staged pipeline only) */
  explainability?: RoundExplainability;
  /** SHA-256 hash of memo snapshot at checkpoint time */
  memo_hash?: string;
}

/** 되감기 규칙 */
export interface RevertPolicy {
  allowed_transitions: Array<{ from: NegotiationPhase; to: NegotiationPhase }>;
  blocked_from: NegotiationPhase[];
  first_free: boolean;
  revert_cost_hc: number;
}

export const DEFAULT_REVERT_POLICY: RevertPolicy = {
  allowed_transitions: [
    { from: 'BARGAINING', to: 'OPENING' },
    { from: 'CLOSING', to: 'BARGAINING' },
  ],
  blocked_from: ['SETTLEMENT'],
  first_free: true,
  revert_cost_hc: 10,
};

// =========================================
// Skill Interface (Layer B)
// =========================================

export interface NegotiationSkill {
  readonly id: string;
  readonly version: string;

  getLLMContext(): string;
  getTactics(): string[];
  getConstraints(): SkillConstraint[];
  getTermDeclaration(): SkillTermDeclaration;

  generateMove(
    memory: CoreMemory,
    recentFacts: RoundFact[],
    opponentPattern: OpponentPattern | null,
    phase: NegotiationPhase,
  ): Promise<ProtocolDecision>;

  evaluateOffer(
    memory: CoreMemory,
    incomingOffer: { price: number; non_price_terms?: Record<string, unknown> },
    recentFacts: RoundFact[],
    phase: NegotiationPhase,
  ): Promise<ProtocolDecision>;
}

export interface SkillConstraint {
  rule: string;
  description: string;
}

// =========================================
// L5 Signals (Market + Competition + Category)
// =========================================

export interface L5Signals {
  market?: {
    avg_sold_price_30d: number;
    price_trend: 'rising' | 'stable' | 'falling';
    active_listings_count: number;
    source_prices: Array<{ platform: string; price: number }>;
  };
  competition?: {
    concurrent_sessions: number;
    best_competing_offer?: number;
  };
  category?: {
    avg_discount_rate: number;
    avg_rounds_to_deal: number;
  };
}

// =========================================
// Round Explainability
// =========================================

export interface RoundExplainability {
  round: number;
  coach_recommendation: {
    price: number;
    basis: string;
    acceptable_range: { min: number; max: number };
  };
  decision: {
    source: 'llm' | 'skill';
    price?: number;
    action: string;
    tactic_used?: string;
    reasoning_summary: string;
  };
  referee_result: {
    violations: Array<{
      rule: string;
      severity: 'HARD' | 'SOFT';
      detail: string;
    }>;
    action: 'PASS' | 'WARN_AND_PASS' | 'AUTO_FIX' | 'BLOCK';
    auto_fix_applied: boolean;
  };
  final_output: {
    price?: number;
    action: string;
  };
}

// =========================================
// Stage Config
// =========================================

export interface StageConfig {
  adapters: {
    UNDERSTAND: ModelAdapter;
    DECIDE: ModelAdapter;
    RESPOND: ModelAdapter;
  };
  modes: {
    RESPOND: 'template' | 'llm';
    VALIDATE: 'full' | 'lite';
  };
  memoEncoding: 'auto' | 'codec' | 'raw';
  reasoningEnabled: boolean;
}

// =========================================
// Model Adapter (Layer C)
// =========================================

export interface ModelAdapter {
  readonly modelId: string;
  readonly tier: 'basic' | 'standard' | 'advanced' | 'frontier';
  readonly location: 'remote' | 'local';
  readonly capabilities: readonly ('parse' | 'reason' | 'generate')[];

  buildSystemPrompt(skillContext: string): string;
  buildUserPrompt(
    memory: CoreMemory,
    recentFacts: RoundFact[],
    signals?: string[],
    prevMemory?: CoreMemory,
  ): string;
  parseResponse(raw: string): ProtocolDecision;
  coachingLevel(): 'DETAILED' | 'STANDARD' | 'LIGHT';
}

// =========================================
// Message Renderer (Presentation Layer)
// =========================================

export interface MessageRenderer {
  render(
    decision: ProtocolDecision,
    context: {
      phase: NegotiationPhase;
      role: 'buyer' | 'seller';
      locale: string;
      activeTerms?: ActiveTerm[];
      tone: BuddyTone;
    },
  ): string;
}

// =========================================
// Round Limits by Category
// =========================================

export interface CategoryRoundLimits {
  category: string;
  ai_rounds: number;
  human_bonus: number;
}

export const ROUND_LIMITS: CategoryRoundLimits[] = [
  { category: 'local_trade', ai_rounds: 15, human_bonus: 5 },
  { category: 'shipped_trade', ai_rounds: 20, human_bonus: 5 },
  { category: 'high_value', ai_rounds: 25, human_bonus: 5 },
  { category: 'vehicle_realestate', ai_rounds: 30, human_bonus: 5 },
];

// =========================================
// Auto-Mode Screening
// =========================================

export interface ScreeningResult {
  is_spam: boolean;
  confidence: number;
  reason?: string;
  should_upgrade_model: boolean;
}

// =========================================
// Context Assembly Layers
// =========================================

export interface ContextLayers {
  L0_protocol: string;
  L1_model: string;
  L2_skill: string;
  L3_coaching: string;
  L4_history: string;
  L5_signals: string;
}

/** Phase별 컨텍스트 토큰 예산 */
export const PHASE_TOKEN_BUDGET: Record<NegotiationPhase, number> = {
  DISCOVERY: 800,
  OPENING: 1200,
  BARGAINING: 1500,
  CLOSING: 2000,
  SETTLEMENT: 500,
};

// =========================================
// Cross-Pressure (Phase 2)
// =========================================

export interface CrossPressureContext {
  batna_price: number;
  n_active_sessions: number;
  my_rank: number;
  injection_count: number;
  last_injected_round: number;
  sensitivity: number;
}

export interface InjectionDecision {
  should_inject: boolean;
  reason: string;
  pressure_signal?: string;
}

export interface CompetitionCoaching {
  has_competition: boolean;
  batna_price?: number;
  rank?: number;
  pressure_hint?: string;
  urgency_boost: number;
}
