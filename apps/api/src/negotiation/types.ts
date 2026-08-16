import type { ExtractedFeature } from "@haggle/engine-core";

// =========================================
// Layer A: Engine Contract
// =========================================

/** 5-Phase 협상 상태 */
export type NegotiationPhase = "DISCOVERY" | "OPENING" | "BARGAINING" | "CLOSING" | "SETTLEMENT";

/** Phase 전환 이벤트 */
export type PhaseTransitionEvent =
  | "INITIAL_OFFER_MADE"
  | "COUNTER_OFFER_MADE"
  | "NEAR_DEAL_DETECTED"
  | "BOTH_CONFIRMED"
  | "REVERT_REQUESTED"
  | "TIMEOUT"
  | "ABORT";

/**
 * Actions that close the deal at the offer currently on the table.
 *
 * ACCEPT and CONFIRM are the same event downstream — both map to a DB `ACCEPT`
 * decision and an `ACCEPTED` session — but the CLOSING-phase skills emit CONFIRM,
 * so any `action === "ACCEPT"` check silently misses every real closing round.
 * That gap let the chat text state one price while the session settled at another.
 * Use this predicate wherever closing behaviour is being decided so the checks
 * cannot drift apart again.
 */
export function isDealClosingAction(action: EngineDecision["action"]): boolean {
  return action === "ACCEPT" || action === "CONFIRM";
}

/** Engine Decision — LLM/Skill이 반환하는 내부 순수 결정 (wire message 아님, message 없음) */
export interface EngineDecision {
  action: "COUNTER" | "ACCEPT" | "REJECT" | "HOLD" | "DISCOVER" | "CONFIRM";
  price?: number;
  reasoning: string;
  non_price_terms?: Record<string, unknown>;
  tactic_used?: string;
  /**
   * Natural-language message the LLM wrote for the counterparty. When present
   * the respond stage should prefer this over the template renderer so the
   * negotiation actually sounds like a negotiation (references the item,
   * advisor strategy, etc) instead of "How about $X?".
   */
  message?: string;
  /**
   * The AI's read of the opponent, produced alongside the decision (opponent
   * modeling — backlog #4). Used to compute the opponent-adjusted aim and logged
   * in the harness trace. Instrumental only: it never overrides the agent's
   * configured goal (target/floor); it only helps reach it within the box.
   */
  opponent_estimate?: OpponentEstimate;
}

/**
 * @deprecated Use EngineDecision for internal engine output.
 * ProtocolDecision is kept as a compatibility alias while legacy demo and tests migrate.
 */
export type ProtocolDecision = EngineDecision;

/** 사용자에게 표시되는 최종 응답 (Engine Decision + Presentation) */
export interface NegotiationMove extends EngineDecision {
  message: string;
}

/** 4개 Human Intervention Mode */
export type HumanInterventionMode = "FULL_AUTO" | "APPROVE_ONLY" | "HYBRID" | "MANUAL";

/** HYBRID 모드 설정: Phase별 자동/수동 */
export type HybridModeConfig = {
  [phase in NegotiationPhase]?: "auto" | "manual";
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

export type OpponentPatternType = "BOULWARE" | "CONCEDER" | "LINEAR" | "UNKNOWN";

/** 검증 결과 */
export interface ValidationResult {
  passed: boolean;
  /** HARD violation이 없으면 true — referee-service가 진행 여부를 판단할 때 사용 */
  hardPassed: boolean;
  violations: ValidationViolation[];
}

export interface ValidationViolation {
  rule: string;
  severity: "HARD" | "SOFT";
  guidance: string;
  suggested_fix?: Partial<EngineDecision>;
}

// =========================================
// Term Taxonomy (Skill 제작자 표준)
// =========================================

/** 표준 Term 카테고리 */
export type TermCategory =
  | "FINANCIAL"
  | "LOGISTICS"
  | "CONDITION"
  | "WARRANTY"
  | "BUNDLE"
  | "TIMING"
  | "VERIFICATION"
  | "SERVICE"
  | "CUSTOM";

/** 카테고리 특화 Term (Skill이 추가 정의) */
export interface CategoryTerm {
  id: string;
  parent_category: TermCategory;
  display_name: string;
  value_type: "number" | "enum" | "boolean" | "text";
  value_range?: { min?: number; max?: number } | string[];
  unit?: string;
  typical_impact: string;
  evaluate_hint: string;
}

/** Skill의 Term 선언 */
export interface SkillTermDeclaration {
  supported_terms: string[];
  category_terms: CategoryTerm[];
  custom_term_handling: "full" | "basic" | "none";
}

/** 협상 중 활성화된 Term */
export interface ActiveTerm {
  term_id: string;
  category: TermCategory;
  display_name: string;
  status: "agreed" | "unresolved" | "not_discussed" | "proposed";
  value?: unknown;
  buyer_value_assessment?: number;
  seller_value_assessment?: number;
  proposed_by: "buyer" | "seller" | "protocol";
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
    role: "buyer" | "seller";
    max_rounds: number;
    intervention_mode: HumanInterventionMode;
    /** Session creation timestamp in epoch ms — used for real-time t_elapsed */
    created_at_ms?: number;
    /** Listing/session deadline in epoch ms — used for continuous time value curves. */
    deadline_at_ms?: number;
    /** Session max duration in ms — category-dependent fallback when no deadline is known. */
    max_duration_ms?: number;
    /** @deprecated Use created_at_ms/deadline_at_ms plus concession beta instead of urgency labels. */
    urgency?: "low" | "normal" | "high" | "urgent";
  };
  boundaries: {
    my_target: number;
    my_floor: number;
    current_offer: number;
    opponent_offer: number;
    gap: number;
    /**
     * The most recent price THIS side put on the table, or undefined before they have
     * offered anything. Kept separate from `current_offer`, which carries a fallback and
     * so cannot distinguish "my offer happens to equal my target" from "I have not
     * offered yet" — a distinction the no-moving-backwards rule depends on.
     */
    my_last_offer?: number;
  };
  terms: {
    active: ActiveTerm[];
    resolved_summary: string;
  };
  coaching: RefereeCoaching;
  buddy_dna: BuddyDNA;
  skill_summary: string;
  competition?: CrossPressureContext;
  /**
   * Item-level context captured at listing time (title, description, condition,
   * tags, photo, and category-specific facts like phone storage/battery). Used
   * by the LLM to reason about the actual thing being negotiated rather than
   * just price boundaries.
   */
  listing_context?: ListingContextMemory;
  /**
   * Strategy/persona context for THIS side of the negotiation: which agent
   * preset is driving us, the advisor memory captured from the strategy chat,
   * tone/dealbreakers/mustEmphasize, etc.
   */
  strategy_context?: StrategyContextMemory;
  /**
   * @deprecated LEGACY LLM/coach path only. This is a LOSSY 7-field subset of the
   * compiled snapshot (see `StrategyParams` / `extractStrategyParams`) that drops
   * w_rep / v_s_base / n_threshold / gamma — the reason those parameters were dead
   * in production. The engine decision path (H1/H2) reads the snapshot directly
   * via `readEngineKnobs` (context/assemble-context.ts) and must NOT consume this.
   * Retire together with the coach path in H2.
   */
  strategy_params?: StrategyParams;
  /**
   * Structured features extracted from the counterparty message by the sensor (H5).
   * Consumed by assembleNegotiationContext → applyFeatures (H6). Empty/undefined until
   * the sensor lands.
   */
  extracted_features?: ExtractedFeature[];
}

/**
 * @deprecated LOSSY subset of the compiled snapshot, kept for the legacy LLM/coach
 * path. The engine decision path reads all knobs losslessly from the snapshot via
 * `readEngineKnobs` (context/assemble-context.ts). Do not add new consumers.
 */
export interface StrategyParams {
  beta?: number;
  alpha?: number;
  anchor_ratio?: number;
  v_t_floor?: number;
  u_threshold?: number;
  u_aspiration?: number;
  weights?: { w_p: number; w_t: number; w_r: number; w_s: number };
}

/** Mirror of services/listing-strategy.service.ts:ListingContext, kept local
 *  to avoid the engine taking a dependency on the API service layer. */
export interface ListingContextMemory {
  title?: string;
  description?: string;
  category?: string;
  condition?: string;
  tags?: string[];
  photoUrl?: string;
  subtype?: string;
  attributes?: Record<string, unknown>;
  /**
   * Item facts the seller stated when answering this item's category checks
   * (battery %, storage, scratches, …). Deliberately SHARED with both sides so
   * the buyer's agent can use them as price leverage — the seller's strategy
   * fields never travel here, only per-check answers. Absent on pre-Phase-G
   * sessions.
   */
  seller_facts?: Array<{ checkId: string; question?: string; stance: string }>;
}

/** Per-side negotiator profile. Captures persona + advisor memory + agent
 *  weight overrides. Populated symmetrically for buyer and seller. */
export interface StrategyContextMemory {
  negotiation_agent_preset_id?: string;
  agent_weights?: Record<string, unknown>;
  agent_overrides?: Record<string, unknown>;
  negotiation_agent_builder_memory?: Record<string, unknown>;
}

/** 버디 DNA — 경험 패턴 */
export interface BuddyDNA {
  style: "aggressive" | "defensive" | "balanced";
  preferred_tactic: string;
  category_experience: string;
  condition_trade_success_rate: number;
  best_timing: string;
  tone: BuddyTone;
}

/** 버디 말투 — 같은 EngineDecision을 다르게 표현 */
export interface BuddyTone {
  style: "professional" | "friendly" | "analytical" | "assertive" | "casual";
  formality: "formal" | "neutral" | "informal";
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

/**
 * AI-estimated opponent negotiation params (opponent modeling — backlog #4).
 * Produced by the sensor from the conversation; consumed by the engine to shift
 * the aim point WITHIN the safe box — never the box edges (those come only from
 * MY params). A wrong estimate → suboptimal but still safe. See
 * referee/opponent-adjust.ts and SOT §11 (하네스 / opponent modeling).
 */
export interface OpponentEstimate {
  /** [0,1] how time-pressured the opponent looks (higher → they'll concede → push harder). */
  time_pressure: number;
  /** [0,1] how tough/Boulware the opponent looks (higher → concedes slowly). Feeds dynamic β (#5). */
  toughness: number;
  /** Estimated opponent reservation price (their walk-away), minor units. Caps the aim. */
  est_reservation_price?: number;
  /** [0,1] confidence in this estimate; gates how far it moves the aim (blend vs my baseline). */
  confidence: number;
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
    { from: "BARGAINING", to: "OPENING" },
    { from: "CLOSING", to: "BARGAINING" },
  ],
  blocked_from: ["SETTLEMENT"],
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
  ): Promise<EngineDecision>;

  evaluateOffer(
    memory: CoreMemory,
    incomingOffer: { price: number; non_price_terms?: Record<string, unknown> },
    recentFacts: RoundFact[],
    phase: NegotiationPhase,
  ): Promise<EngineDecision>;
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
    price_trend: "rising" | "stable" | "falling";
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
    source: "llm" | "skill";
    price?: number;
    action: string;
    tactic_used?: string;
    reasoning_summary: string;
  };
  referee_result: {
    violations: Array<{
      rule: string;
      severity: "HARD" | "SOFT";
      detail: string;
    }>;
    action: "PASS" | "WARN_AND_PASS" | "AUTO_FIX" | "BLOCK";
    auto_fix_applied: boolean;
  };
  final_output: {
    price?: number;
    action: string;
  };
  /**
   * Harness decision trace (intelligence layer). Optional until the box model
   * lands (backlog #13/#14). Lets us learn — per model/skill/autonomy — whether
   * the AI beats the deterministic baseline and how wide the box can safely be.
   * Persisted inside negotiation_rounds.metadata.explainability (jsonb) — no
   * migration needed.
   */
  harness?: HarnessTrace;
}

/**
 * One round's harness trace: the engine-produced box + baseline, what the AI
 * chose within it, and whether the Referee had to pull it back. See
 * negotiation/referee/harness.ts for the pure builder, and SOT §11 (하네스).
 */
export interface HarnessTrace {
  /** Engine-computed feasible counter range for this round. */
  box: { min: number; max: number; width: number };
  /** Deterministic engine recommendation — the quality floor. */
  baseline: number;
  /** Opponent-adjusted aim within the box (baseline shifted by the estimate). Absent = no estimate. */
  aim?: number;
  /** The opponent estimate used to shift the aim this round (for "was the read right?" analysis). */
  opponent_estimate?: OpponentEstimate;
  /** What the AI actually chose inside the box. */
  ai_choice: { price?: number; tactic?: string; source: "llm" | "skill" };
  /**
   * (ai_choice.price − baseline) normalized by box width, signed.
   * > 0 means the AI moved past the deterministic baseline (potential upside);
   * 0 means it matched the baseline (bad model → engine floor).
   */
  delta_vs_baseline: number;
  /** Whether the Referee had to clamp the AI value back into the box. */
  box_clamp: { clamped: boolean; original?: number; reason?: string };
  /** Box-width dial used this round [0,1]. 0 = pure engine, 1 = floor-only. */
  autonomy: number;
  /** Model + skills that produced the decision (for per-model/skill analysis). */
  model_id?: string;
  skill_ids?: string[];
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
    RESPOND: "template" | "llm";
    VALIDATE: "full" | "lite";
  };
  memoEncoding: "auto" | "codec" | "raw";
  reasoningEnabled: boolean;
}

// =========================================
// Model Adapter (Layer C)
// =========================================

/**
 * Conversation thread context — actual messages exchanged so far, plus the
 * opponent's most recent message highlighted separately. Lets the LLM react
 * to arguments and tone, not just price positions.
 */
export interface ConversationTurn {
  round: number;
  sender: "BUYER" | "SELLER";
  /** Trimmed message body (caller may truncate to keep tokens bounded). */
  text: string;
  /** Offer price in minor units, if the turn carried one. */
  price_minor?: number;
}

export interface ConversationContext {
  /** The opponent's most recent message — what they just said this round. */
  opponent_message?: string;
  /** Recent conversation turns in order (oldest first). */
  recent_turns?: ConversationTurn[];
}

export interface ModelAdapter {
  readonly modelId: string;
  readonly tier: "basic" | "standard" | "advanced" | "frontier";
  readonly location: "remote" | "local";
  readonly capabilities: readonly ("parse" | "reason" | "generate")[];

  buildSystemPrompt(skillContext: string, role?: "buyer" | "seller"): string;
  buildUserPrompt(
    memory: CoreMemory,
    recentFacts: RoundFact[],
    signals?: string[],
    prevMemory?: CoreMemory,
    conversation?: ConversationContext,
  ): string;
  parseResponse(raw: string): EngineDecision;
  coachingLevel(): "DETAILED" | "STANDARD" | "LIGHT";
}

// =========================================
// Message Renderer (Presentation Layer)
// =========================================

export interface MessageRenderer {
  render(
    decision: EngineDecision,
    context: {
      phase: NegotiationPhase;
      role: "buyer" | "seller";
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
  { category: "local_trade", ai_rounds: 15, human_bonus: 5 },
  { category: "shipped_trade", ai_rounds: 20, human_bonus: 5 },
  { category: "high_value", ai_rounds: 25, human_bonus: 5 },
  { category: "vehicle_realestate", ai_rounds: 30, human_bonus: 5 },
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
