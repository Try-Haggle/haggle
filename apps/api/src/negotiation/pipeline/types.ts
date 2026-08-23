/**
 * pipeline/types.ts
 *
 * Stage Input/Output types for the 6-Stage negotiation pipeline.
 * Each stage has a well-defined interface for external agent interop.
 */

import type { ExtractedFeature } from "@haggle/engine-core";
import type { EvermemoBrief } from "../../services/evermemo-bridge.service.js";
import type { UserMemoryBrief } from "../../services/user-memory-card.service.js";
import type { MemoEncodingConfig } from "../config.js";
import type { SkillStack } from "../skills/skill-stack.js";
import type { RefereeBriefing, SkillAppliedRecord } from "../skills/skill-types.js";
import type {
  BuddyDNA,
  ContextLayers,
  ConversationContext,
  CoreMemory,
  EngineDecision,
  HarnessTrace,
  L5Signals,
  ModelAdapter,
  NegotiationPhase,
  NegotiationSkill,
  OpponentPattern,
  RoundExplainability,
  RoundFact,
  StageConfig,
  ValidationResult,
} from "../types.js";

// =========================================
// Stage 1: Understand
// =========================================

export interface UnderstandInput {
  raw_message: string;
  sender_role: "buyer" | "seller";
  /** Pre-negotiation fulfillment already locked the shipping term set. */
  known_shipping_terms?: boolean;
}

export type ConversationType =
  | "PRICE_NEGOTIATION"
  | "INFORMATION_REQUEST"
  | "INFORMATION_PROVIDED"
  | "CONDITION_NEGOTIATION"
  | "LOGISTICS_NEGOTIATION"
  | "TRUST_SAFETY"
  | "READINESS_DISCOVERY"
  | "CLOSING_CONFIRMATION"
  | "SMALL_TALK";

export interface InformationLink {
  signal_type: string;
  entity_type: string;
  key: string;
  value: string;
  confidence: number;
  connects_to:
    | "pricing"
    | "product"
    | "condition"
    | "terms"
    | "trust"
    | "demand"
    | "outcome"
    | "memory"
    | "market";
}

export interface MissingInformationNeed {
  slot:
    | "product_identity"
    | "price_anchor"
    | "budget_boundary"
    | "condition_summary"
    | "battery_health"
    | "carrier_lock"
    | "verification_status"
    | "warranty_status"
    | "shipping_terms"
    | "payment_safety"
    | "buyer_priority";
  priority: "high" | "medium" | "low";
  reason: string;
  question: string;
  question_source?: "tag_garden" | "fallback";
  tag_slot_id?: string;
  enforcement?: "hard" | "soft";
  answer_options?: string[];
}

export interface UnderstandOutput {
  price_offer?: number;
  action_intent: "OFFER" | "COUNTER" | "ACCEPT" | "REJECT" | "QUESTION" | "INFO";
  conditions: Record<string, unknown>;
  sentiment: "positive" | "neutral" | "negative";
  raw_text: string;
  conversation_type?: ConversationType;
  information_links?: InformationLink[];
  missing_information?: MissingInformationNeed[];
  /** L3/H5-a: schema-defined features mapped from conversation signals (sensor output). */
  extracted_features?: ExtractedFeature[];
}

// =========================================
// Stage 2: Context
// =========================================

export interface ContextInput {
  understood: UnderstandOutput;
  memory: CoreMemory;
  facts: RoundFact[];
  opponent: OpponentPattern;
  skill: NegotiationSkill;
  l5_signals?: L5Signals;
  memory_brief?: UserMemoryBrief | null;
  evermemo_brief?: EvermemoBrief | null;
}

export interface ContextOutput {
  layers: ContextLayers;
  briefing: RefereeBriefing;
  /** @deprecated Use briefing instead. Alias kept for transition. */
  coaching: RefereeBriefing;
  memo_snapshot: string;
  skills_applied: SkillAppliedRecord[];
}

// =========================================
// Stage 3: Decide
// =========================================

export interface DecideInput {
  context: ContextOutput;
  adapter: ModelAdapter;
  skill: NegotiationSkill;
  phase: NegotiationPhase;
  config: StageConfig;
  memory: CoreMemory;
  facts: RoundFact[];
  opponent: OpponentPattern;
  /**
   * Recent chat thread + opponent's latest message — gives the LLM the actual
   * argument to respond to, not just price positions. When omitted, the LLM
   * still negotiates but only sees the compact memo line.
   */
  conversation?: ConversationContext;
}

export interface DecideOutput {
  decision: EngineDecision;
  source: "llm" | "skill";
  reasoning_mode: boolean;
  llm_raw?: string;
  tokens?: { prompt: number; completion: number };
  latency_ms?: number;
  /**
   * Harness trace (intelligence layer) — box the engine allowed, what the AI
   * chose, and whether it was clamped. Present only when a usable box existed
   * for a priced COUNTER. Flows into RoundExplainability.harness at validate.
   */
  harness?: HarnessTrace;
}

// =========================================
// Stage 4: Validate
// =========================================

export interface ValidateInput {
  decision: DecideOutput;
  briefing: RefereeBriefing;
  memory: CoreMemory;
  phase: NegotiationPhase;
}

export interface ValidateOutput {
  final_decision: EngineDecision;
  validation: ValidationResult;
  auto_fix_applied: boolean;
  retry_count: number;
  explainability: RoundExplainability;
}

// =========================================
// Stage 5: Respond
// =========================================

export interface RespondInput {
  validated: ValidateOutput;
  memory: CoreMemory;
  adapter: ModelAdapter;
  skill: NegotiationSkill;
  config: StageConfig;
}

export interface RespondOutput {
  message: string;
  /** Localized message for the OTHER party (if different locale) */
  message_counterparty?: string;
  /** Detected locale used for this response */
  locale: string;
  /** Counterparty locale (if different) */
  locale_counterparty?: string;
  tone: string;
  llm_raw?: string;
  tokens?: { prompt: number; completion: number };
}

// =========================================
// Stage 6: Persist
// =========================================

export interface PersistInput {
  session_id: string;
  round_number: number;
  decision: ValidateOutput;
  response: RespondOutput;
  memory: CoreMemory;
  memo_hash: string;
  explainability: RoundExplainability;
}

export interface PersistOutput {
  phase_transition?: { from: string; to: string; event: string };
  session_done: boolean;
}

// =========================================
// Pipeline Dependencies (injected)
// =========================================

export interface PipelineDeps {
  skill: NegotiationSkill;
  skillStack?: SkillStack;
  config: StageConfig;
  memory: CoreMemory;
  facts: RoundFact[];
  opponent: OpponentPattern;
  phase: NegotiationPhase;
  buddyDna: BuddyDNA;
  previousMoves: EngineDecision[];
  round: number;
  briefing: RefereeBriefing;
  l5_signals?: L5Signals;
  memory_brief?: UserMemoryBrief | null;
  evermemo_brief?: EvermemoBrief | null;
  memoEncoding: MemoEncodingConfig;
  /** Recent chat thread for the LLM (opponent message + prior turns). */
  conversation?: ConversationContext;
  /** DB persist callback — only Stage 6 uses this */
  persistFn?: (input: PersistInput) => Promise<PersistOutput>;
}

// =========================================
// Pipeline Result
// =========================================

export interface PipelineResult {
  round: number;
  phase: string;
  stages: {
    understand: UnderstandOutput;
    context: ContextOutput;
    decide: DecideOutput;
    validate: ValidateOutput;
    respond: RespondOutput;
    persist: PersistOutput;
  };
  explainability: RoundExplainability;
  cost: { tokens: number; usd: number; latency_ms: number };
  done: boolean;
}
