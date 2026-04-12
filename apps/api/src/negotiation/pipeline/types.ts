/**
 * pipeline/types.ts
 *
 * Stage Input/Output types for the 6-Stage negotiation pipeline.
 * Each stage has a well-defined interface for external agent interop.
 */

import type {
  CoreMemory,
  RoundFact,
  OpponentPattern,
  NegotiationSkill,
  ModelAdapter,
  NegotiationPhase,
  ProtocolDecision,
  RefereeCoaching,
  ValidationResult,
  ContextLayers,
  L5Signals,
  RoundExplainability,
  StageConfig,
  BuddyDNA,
} from '../types.js';
import type { MemoEncoding } from '../memo/memo-codec.js';

// =========================================
// Stage 1: Understand
// =========================================

export interface UnderstandInput {
  raw_message: string;
  sender_role: 'buyer' | 'seller';
}

export interface UnderstandOutput {
  price_offer?: number;
  action_intent: 'OFFER' | 'COUNTER' | 'ACCEPT' | 'REJECT' | 'QUESTION' | 'INFO';
  conditions: Record<string, unknown>;
  sentiment: 'positive' | 'neutral' | 'negative';
  raw_text: string;
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
}

export interface ContextOutput {
  layers: ContextLayers;
  coaching: RefereeCoaching;
  memo_snapshot: string;
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
}

export interface DecideOutput {
  decision: ProtocolDecision;
  source: 'llm' | 'skill';
  reasoning_mode: boolean;
  llm_raw?: string;
  tokens?: { prompt: number; completion: number };
  latency_ms?: number;
}

// =========================================
// Stage 4: Validate
// =========================================

export interface ValidateInput {
  decision: DecideOutput;
  coaching: RefereeCoaching;
  memory: CoreMemory;
  phase: NegotiationPhase;
}

export interface ValidateOutput {
  final_decision: ProtocolDecision;
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
  config: StageConfig;
  memory: CoreMemory;
  facts: RoundFact[];
  opponent: OpponentPattern;
  phase: NegotiationPhase;
  buddyDna: BuddyDNA;
  previousMoves: ProtocolDecision[];
  round: number;
  l5_signals?: L5Signals;
  memoEncoding: MemoEncoding;
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
