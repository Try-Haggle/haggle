/**
 * TypeScript types for the negotiation demo API.
 * Maps to: apps/api/src/routes/negotiation-demo.ts
 */

// ─── Stage Trace (common pipeline element) ───

export interface StageTrace {
  stage: string;
  is_llm: boolean;
  // LLM stages
  system_prompt?: string;
  user_prompt?: string;
  raw_response?: unknown;
  // Code stages
  input?: unknown;
  output?: unknown;
  // Both
  parsed: unknown;
  tokens: { prompt: number; completion: number } | null;
  latency_ms: number;
}

// ─── Preset Types ───

export type PresetName = 'lowest_price' | 'balanced' | 'safe_first' | 'custom';

export interface DemoInitRequest {
  user_id?: string;
  item?: { title?: string; condition?: string; swappa_median_minor?: number };
  seller?: { ask_price_minor?: number; floor_price_minor?: number };
  buyer_budget?: { max_budget_minor?: number };
  language?: string;
  preset?: PresetName;
  custom_skills?: { advisor: string; advisor_config?: Record<string, unknown> };
  buyer_agent_id?: string;
  seller_agent_id?: string;
  preset_tuning_draft?: Record<string, unknown>;
}

// ─── Init Response ───

export interface DemoStrategy {
  target_price: number;
  floor_price: number;
  opening_tactic: string;
  approach: string;
  key_concerns: string[];
  negotiation_style: 'aggressive' | 'balanced' | 'defensive';
}

export interface TermAnalysis {
  priority_terms: Array<{
    id: string;
    importance: 'critical' | 'important' | 'nice_to_have';
    target_value: string;
    rationale: string;
  }>;
  deal_breakers: Array<{
    id: string;
    condition: string;
    rationale: string;
  }>;
}

export interface SkillManifestInfo {
  id: string;
  version: string;
  type: string;
  name: string;
  description: string;
  categoryTags: string[];
  hooks: string[];
}

export interface HilMemorySummary {
  applied: boolean;
  user_id: string | null;
  signals: string[];
  cards: Array<{
    card_type: string;
    memory_key: string;
    summary: string;
    strength: number;
    memory: Record<string, unknown>;
  }>;
}

export interface DemoInitResponse {
  demo_id: string;
  language: string;
  preset?: string;
  active_skills?: string[];
  stages_tested: string[];
  strategy: DemoStrategy;
  terms: TermAnalysis;
  hil_memory?: HilMemorySummary;
  preset_tuning_draft?: Record<string, unknown> | null;
  lumen_profiles?: {
    buyer_agent: LumenVoiceProfile;
    seller_agent: LumenVoiceProfile;
  };
  skills?: SkillManifestInfo[];
  initial_memory: Record<string, unknown>;
  pipeline: StageTrace[];
  cost: {
    total_usd: number;
    total_tokens: { prompt: number; completion: number };
  };
}

export interface LumenVoiceProfile {
  id: string;
  name: string;
  role: string;
  voiceStyle: string[];
  speaksLike: string;
  avoid: string[];
  prompt: string;
}

// ─── Round Response ───

export interface ProtocolDecision {
  action: 'COUNTER' | 'ACCEPT' | 'REJECT' | 'HOLD' | 'DISCOVER' | 'CONFIRM';
  price: number;
  reasoning: string;
  tactic_used: string;
  non_price_terms: Record<string, unknown>;
}

export interface ValidationInfo {
  passed: boolean;
  hard_passed: boolean;
  violations: Array<{
    rule: string;
    severity: 'HARD' | 'SOFT';
    description: string;
    suggested_fix?: Record<string, unknown>;
  }>;
  auto_fix_applied: boolean;
}

export interface PhaseTransition {
  from: string;
  to: string;
  event: string;
  transitioned: boolean;
}

export interface DemoRoundResponse {
  round: number;
  phase: string;
  stages_tested: string[];
  pipeline: StageTrace[];
  final: {
    decision: ProtocolDecision;
    rendered_message: string;
    hil_memory?: HilMemorySummary;
    validation: ValidationInfo;
    phase_transition: PhaseTransition | null;
  };
  state: {
    buyer_price: number;
    seller_price: number;
    gap: number;
    gap_pct: string;
    reasoning_mode: boolean;
    done: boolean;
  };
  cost: {
    round_usd: number;
    total_usd: number;
    round_tokens: { prompt: number; completion: number };
    total_tokens: { prompt: number; completion: number };
  };
}

// ─── DB Mockup Types (frontend simulation) ───

export interface MockSessionRow {
  id: string;
  status: string;
  current_round: number;
  last_offer_price_minor: number;
  phase: string;
  updated_at: string;
}

export interface MockRoundRow {
  round_no: number;
  sender_role: string;
  message_type: string;
  price_minor: number;
  counter_price_minor: number;
  decision: string;
  utility_total: number;
}

export interface MockFactRow {
  round: number;
  fact_hash: string;
  prev_hash: string;
  buyer_offer: number;
  seller_offer: number;
  gap: number;
}

export interface MockTelemetryRow {
  stage: string;
  prompt_tokens: number;
  completion_tokens: number;
  latency_ms: number;
  model: string;
}

// ─── Chat message (User Demo) ───

export interface ChatMessage {
  id: string;
  role: 'buyer' | 'seller' | 'system';
  content: string;
  price?: number;
  timestamp: number;
}
