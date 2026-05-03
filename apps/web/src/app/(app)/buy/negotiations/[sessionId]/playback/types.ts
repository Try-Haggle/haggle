/* ─── Negotiation Playback Types ──────────────────────────── */
/**
 * Frontend-only contract for the negotiation playback view.
 * Backend will produce data in this shape (currently mocked).
 */

export type AgentRole = "BUYER" | "SELLER";

export type DecisionAction =
  | "OPENING"
  | "COUNTER"
  | "NEAR_DEAL"
  | "ACCEPT"
  | "REJECT";

export type FinalStatus =
  | "ACCEPTED"
  | "REJECTED"
  | "NEAR_DEAL"
  | "ESCALATED";

export interface AgentCard {
  presetId: string;
  name: string;
  tagline: string;
  accentColor: string;
  iconKey: "price-hunter" | "smart-trader" | "fast-closer" | "spec-analyst" | "gatekeeper" | "diplomat" | "storyteller" | "dealmaker";
  stats?: {
    priceAggression: number;
    patienceLevel: number;
    riskTolerance: number;
    speedBias: number;
    detailFocus: number;
  };
}

export interface ListingSummary {
  id: string;
  title: string;
  imageUrl: string | null;
  askingPrice: number;
  currency: string;
  category: string | null;
}

/**
 * Utility breakdown — maps directly to engine-core's `computeUtility` output:
 *   v_p (Price), v_t (Time), v_r (Risk), v_s (Relationship).
 * Names mirror the engine fields so backend swap is a 1:1 mapping.
 */
export interface UtilityBreakdown {
  price: number;        // v_p — 0-1
  time: number;         // v_t — 0-1
  risk: number;         // v_r — 0-1
  relationship: number; // v_s — 0-1
}

export interface RoundFactors {
  utilityScore?: number;          // u_total (0-1) from computeUtility
  utilityBreakdown?: UtilityBreakdown;
  tactic?: string;                // DB `tacticUsed` — free-form label, single per round
  phase?: string;                 // DB `phaseAtRound` (e.g. "OPENING", "MID", "CLOSING")
  batnaDelta?: number;            // derived via compareSessions: (best - batna) / batna
  concessionPct?: number;         // DB `concessionRate` — 0-1 (price move vs prior round)
  reasoning?: string;             // DB `message`/`reasoning` — natural language note
}

export interface PlaybackRound {
  roundIndex: number;             // 1-based
  sender: AgentRole;
  decision: DecisionAction;
  offerPrice: number;
  message: string;                // 자연어 메시지
  factors: RoundFactors;
  thinkingMs?: number;            // 권장 thinking 지속시간 (없으면 default)
}

export interface PlaybackResponse {
  session: {
    id: string;
    listing: ListingSummary;
    buyerAgent: AgentCard;
    sellerAgent: AgentCard;
    finalStatus: FinalStatus;
    finalPrice: number | null;
    roundsTotal: number;
  };
  rounds: PlaybackRound[];
}
