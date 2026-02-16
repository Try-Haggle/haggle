/**
 * Configuration for the negotiation engine.
 */
export interface EngineConfig {
  strategy: NegotiationStrategy;
  floorPrice: number;
  targetPrice: number;
  maxRounds: number;
  // TODO(post-mvp): Add LLM model selection (GPT-4, Claude, etc.)
  // TODO(post-mvp): Add reinforcement learning parameters
}

/**
 * The engine's decision after evaluating an offer.
 */
export interface EngineDecision {
  action: "accept" | "reject" | "counter";
  counterAmount?: number;
  message: string;
  confidence: number; // 0-1, always 1.0 for rule-based
}

/**
 * Negotiation strategy configuration.
 * MVP: Simple rule-based (floor/target comparison).
 */
export interface NegotiationStrategy {
  type: "rule_based";
  // TODO(post-mvp): Add "llm_based" | "hybrid" strategy types
  aggressiveness: number; // 0-1 scale, affects counter-offer calculation
}
