// Core types for the negotiation test lab.
// A ScenarioCase is one fully-specified negotiation; the runner turns each into
// a seeded listing + guest negotiation and captures a NegotiationResult.

export type AgentPreset = "hunter" | "closer" | "verifier" | "balancer";

export const AGENT_PRESETS: AgentPreset[] = ["hunter", "closer", "verifier", "balancer"];

/** The item being sold. Prices are in whole dollars. */
export interface ItemSpec {
  title: string;
  category: string; // MVP: "phone" — attributes land in negotiationAgentSnapshot.phoneAnswers
  condition: string; // e.g. "like-new" | "good" | "fair"
  askPrice: number; // seller ask (dollars)
  floorPrice: number; // seller walk-away floor (dollars)
  deadlineHours: number; // seller listing deadline
  // Category-specific facts surfaced to the LLM (phone: storage, batteryHealth, scratches, carrierLock…)
  attributes: Record<string, unknown>;
}

export interface SellerSpec {
  agent: AgentPreset;
}

export interface BuyerSpec {
  agent: AgentPreset;
  budgetMax: number; // hard ceiling / reservation (dollars)
  targetPrice: number; // desired price (dollars)
  deadlineHours?: number; // buyer-side deadline; defaults to 48
}

/** One fully-specified negotiation to run. */
export interface ScenarioCase {
  id: string; // unique per case, stable across runs (used to group repeats)
  group: string; // experiment group tag, e.g. "A".."F"
  label?: string; // human-readable, e.g. "hunter×closer" or "battery=85%"
  item: ItemSpec;
  seller: SellerSpec;
  buyer: BuyerSpec;
}

/** A single committed negotiation round, as read back from the DB. */
export interface RoundRecord {
  roundNo: number;
  senderRole: string;
  messageType: string;
  priceMinor: number | null;
  counterPriceMinor: number | null; // price the sender is offering the other side
  decision: string | null;
  llmTokensUsed: number | null; // DeepSeek tokens spent producing this round
  message: string | null;
}

/** The captured outcome of running one ScenarioCase. */
export interface NegotiationResult {
  caseId: string;
  group: string;
  label?: string;
  repeatIndex: number; // 0-based; >0 when a case is run multiple times
  // Echoed inputs (so the report is self-contained without re-joining scenarios)
  sellerAgent: AgentPreset;
  buyerAgent: AgentPreset;
  askPrice: number;
  floorPrice: number;
  budgetMax: number;
  targetPrice: number;
  attributes: Record<string, unknown>;
  // Results
  outcome: string; // terminal session_status: ACCEPTED | REJECTED | EXPIRED | STALLED | ...
  finalPriceMinor: number | null;
  finalPrice: number | null; // dollars
  rounds: number;
  transcript: RoundRecord[];
  startStatus: number; // HTTP status from /negotiations/start (202 = ok)
  sessionId?: string;
  publicId?: string;
  durationMs: number;
  error?: string;
}
