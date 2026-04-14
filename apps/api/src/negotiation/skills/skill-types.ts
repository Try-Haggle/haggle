/**
 * skills/skill-types.ts
 *
 * Skill v2 Type System — modular, multi-stage, composable.
 *
 * A Skill is an autonomous module that can provide knowledge, coaching,
 * validation, or on-demand services. Skills register for pipeline hooks
 * and/or expose on-demand invocation endpoints.
 *
 * The pipeline defines hook points; skills register for them.
 * Skills are "what to provide", the pipeline is "how to process".
 */

import type {
  CoreMemory,
  RoundFact,
  OpponentPattern,
  NegotiationPhase,
  ProtocolDecision,
  CategoryTerm,
} from '../types.js';

// ─── Skill Manifest (declarative, JSON-serializable) ─────────────

export type SkillType = 'knowledge' | 'advisor' | 'validator' | 'service' | 'composite';

export type PipelineStage = 'understand' | 'context' | 'decide' | 'validate' | 'respond';

export interface SkillManifest {
  /** Unique skill identifier (e.g. "electronics-knowledge-v1") */
  id: string;
  version: string;
  type: SkillType;

  /** Human-readable name */
  name: string;
  description: string;

  /** Which category tags this skill applies to (e.g. ["electronics", "electronics/phones"]) */
  categoryTags: string[];

  /** Which pipeline stages this skill hooks into */
  hooks: PipelineStage[];

  /** Whether parties can invoke this skill on-demand during negotiation */
  onDemand?: {
    invocableBy: ('buyer' | 'seller' | 'referee')[];
    description: string;
  };

  /** Pricing model */
  pricing: {
    model: 'free' | 'per_call' | 'per_session' | 'subscription';
    costCents?: number;
  };

  /** Verification status — shown as badge to users (투명성 철학) */
  verification: {
    status: 'unverified' | 'self_tested' | 'community_reviewed' | 'haggle_verified';
    verifiedAt?: string;
    verifiedBy?: string;
    securityAudit?: boolean;
  };
}

/** Badge emoji for verification levels */
export const VERIFICATION_BADGES: Record<SkillManifest['verification']['status'], string> = {
  unverified: '⬜',
  self_tested: '🟡',
  community_reviewed: '🟢',
  haggle_verified: '✅',
};

/** Skill usage record included in round responses */
export interface SkillAppliedRecord {
  id: string;
  name: string;
  type: SkillType;
  badge: string;
  verification_status: SkillManifest['verification']['status'];
}

// ─── Hook Contexts & Results ─────────────────────────────────────

/** What the pipeline provides to a skill at each hook */
export interface HookContext {
  stage: PipelineStage;
  memory: CoreMemory;
  recentFacts: RoundFact[];
  opponentPattern: OpponentPattern | null;
  phase: NegotiationPhase;
  /** Additional stage-specific data */
  extra?: Record<string, unknown>;
}

/** What a skill returns from a hook */
export interface HookResult {
  /** Skill-provided content to inject into the pipeline stage */
  content: Record<string, unknown>;
}

/** Specific hook result types for type safety */

export interface UnderstandHookResult extends HookResult {
  content: {
    termHints?: Array<{
      id: string;
      parseAs: 'number' | 'enum' | 'boolean' | 'string';
      range?: unknown;
      unit?: string;
    }>;
    parsingContext?: string;
  };
}

export interface DecideHookResult extends HookResult {
  content: {
    /** Category knowledge for LLM context */
    categoryBrief?: string;
    /** Valuation rules the LLM should consider */
    valuationRules?: string[];
    /** Available tactics */
    tactics?: string[];
    /** Advisory: recommended price (LLM may ignore) */
    recommendedPrice?: number;
    /** Advisory: acceptable range (LLM may ignore) */
    acceptableRange?: { min: number; max: number };
    /** Advisory: suggested tactic (LLM may ignore) */
    suggestedTactic?: string;
    /** Market data */
    marketData?: { price: number; source: string; updatedAt?: string };
    /** Free-form observations */
    observations?: string[];
  };
}

export interface ValidateHookResult extends HookResult {
  content: {
    hardRules?: Array<{ rule: string; description: string }>;
    softRules?: Array<{ rule: string; description: string }>;
  };
}

export interface RespondHookResult extends HookResult {
  content: {
    toneGuidance?: string;
    terminology?: Record<string, string>;
  };
}

// ─── Skill Runtime (what a skill must implement) ─────────────────

export interface SkillRuntime {
  readonly manifest: SkillManifest;

  /** Called by pipeline at registered hook stages */
  onHook(context: HookContext): Promise<HookResult>;

  /** Called when a party invokes this skill on-demand (only if manifest.onDemand) */
  onRequest?(input: unknown): Promise<unknown>;

  /** Rule-based fallback move (no LLM). Optional — only for skills that can generate moves */
  generateMove?(
    memory: CoreMemory,
    recentFacts: RoundFact[],
    opponentPattern: OpponentPattern | null,
    phase: NegotiationPhase,
  ): Promise<ProtocolDecision>;
}

// ─── Skill Stack (session-level composition) ──────────────────────

export interface SkillStackConfig {
  /** Skills active for this session, in priority order */
  skills: SkillRuntime[];
}

// ─── Referee Briefing (facts only, no recommendations) ────────────

export interface RefereeBriefing {
  /** Opponent classification based on EMA of concession rates */
  opponentPattern: string;  // 'BOULWARE' | 'CONCEDER' | 'LINEAR' | 'UNKNOWN'
  /** Time pressure ratio (0 = just started, 1 = last round) */
  timePressure: number;
  /** Recent gap values (last N rounds) for trend visibility */
  gapTrend: number[];
  /** Recent opponent price moves (deltas, signed) */
  opponentMoves: number[];
  /** Whether negotiation is stagnating */
  stagnation: boolean;
  /** Utility snapshot (factual computation) */
  utilitySnapshot: {
    u_price: number;
    u_time: number;
    u_risk: number;
    u_total: number;
  };
  /** Factual warnings (observations, not recommendations) */
  warnings: string[];
}
