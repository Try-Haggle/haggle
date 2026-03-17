/**
 * HNP (Haggle Negotiation Protocol) Unified Model Types
 *
 * Defines the complete protocol layer: agents, sessions, messages,
 * offers, contingent clauses, settlement hooks, and entry modes.
 *
 * HNP = WHAT to negotiate, in WHAT order, in WHAT format
 * Engine = HOW to judge and move
 */

import type { IssueValues, IssueSchema } from '@haggle/engine-core';

// ---------------------------------------------------------------------------
// 5.1.1 Agent
// ---------------------------------------------------------------------------

/** Capabilities an agent can declare. */
export type AgentCapability =
  | 'multi_issue'
  | 'conditional_clause'
  | 'batna_support'
  | 'parallel_negotiation'
  | 'intent_discovery';

/** A negotiation participant. */
export interface HnpAgent {
  agent_id: string;
  role: HnpAgentRole;
  engine_id: string;
  capabilities: AgentCapability[];
  /** Optional DID or external identity reference. */
  identity_ref?: string;
}

export type HnpAgentRole = 'buyer' | 'seller';

// ---------------------------------------------------------------------------
// 5.2 Entry Modes
// ---------------------------------------------------------------------------

/** How a negotiation session was initiated. */
export type SessionOrigin = 'listing' | 'intent' | 'hybrid';

/** Reference to the listing that initiated the session. */
export interface ListingRef {
  listing_id: string;
  platform?: string;
}

/** A buyer/seller intent for intent-based or hybrid entry. */
export interface NegotiationIntent {
  intent_id: string;
  role: HnpAgentRole;
  /** What the agent is looking for (free-form or structured). */
  criteria: Record<string, unknown>;
  /** Max sessions to open from this intent. */
  max_sessions?: number;
  created_at: string;
  expires_at?: string;
}

// ---------------------------------------------------------------------------
// 5.3 Negotiation Lifecycle
// ---------------------------------------------------------------------------

/** Full HNP session lifecycle states (Section 5.3). */
export type HnpSessionState =
  | 'INIT'
  | 'OPEN'
  | 'PENDING_RESPONSE'
  | 'AGREED'
  | 'REJECTED'
  | 'EXPIRED'
  | 'CANCELLED'
  | 'SETTLEMENT_PENDING'
  | 'SETTLED'
  | 'DISPUTED'
  | 'CLOSED';

// ---------------------------------------------------------------------------
// 5.1.1 Negotiation Session (HNP-level)
// ---------------------------------------------------------------------------

/** An HNP negotiation session. */
export interface HnpSession {
  session_id: string;
  session_origin: SessionOrigin;
  created_at: string;
  expires_at: string;
  participants: [HnpAgent, HnpAgent];
  issue_schema_ref: string;
  state: HnpSessionState;
  /** Reference to the listing (if listing or hybrid origin). */
  listing_ref?: ListingRef;
  /** Reference to the intent (if intent or hybrid origin). */
  intent_ref?: string;
}

// ---------------------------------------------------------------------------
// 5.4 Message Types
// ---------------------------------------------------------------------------

/** Session-level messages. */
export type SessionMessageType =
  | 'SESSION_CREATE'
  | 'SESSION_ACCEPT'
  | 'SESSION_DECLINE'
  | 'SESSION_CANCEL';

/** Negotiation-level messages. */
export type NegotiationMessageType =
  | 'OFFER'
  | 'COUNTER_OFFER'
  | 'ACCEPT'
  | 'REJECT'
  | 'WITHDRAW'
  | 'REQUEST_CLARIFICATION';

/** Discovery-level messages. */
export type DiscoveryMessageType =
  | 'INTENT_CREATE'
  | 'DISCOVERY_QUERY'
  | 'DISCOVERY_RESULT'
  | 'MATCH_PROPOSE'
  | 'MATCH_ACCEPT';

/** Settlement-level messages. */
export type SettlementMessageType =
  | 'SETTLEMENT_PROPOSE'
  | 'SETTLEMENT_READY'
  | 'SETTLEMENT_CONFIRMED'
  | 'SETTLEMENT_FAILED';

/** All HNP message types. */
export type HnpV2MessageType =
  | SessionMessageType
  | NegotiationMessageType
  | DiscoveryMessageType
  | SettlementMessageType;

// ---------------------------------------------------------------------------
// 7.1 Canonical Offer Model
// ---------------------------------------------------------------------------

/** Sender identification in an offer. */
export interface OfferSender {
  agent_id: string;
  role: HnpAgentRole;
}

/** The offer payload containing issues, info, clauses. */
export interface OfferPayload {
  /** Negotiable issue values being proposed. */
  issues: IssueValues;
  /** Informational snapshot (non-negotiable context). */
  info_snapshot?: IssueValues;
  /** Contingent clauses attached to this offer. */
  clauses?: ContingentClause[];
  /** Currency for monetary issues. */
  currency: string;
  /** ISO 8601 expiry for this specific offer. */
  valid_until: string;
}

/** Offer metadata. */
export interface OfferMeta {
  round: number;
  session_origin: SessionOrigin;
}

/** A canonical HNP offer message (Section 7.1). */
export interface HnpOfferMessage {
  message_type: 'OFFER' | 'COUNTER_OFFER';
  session_id: string;
  sender: OfferSender;
  offer: OfferPayload;
  meta: OfferMeta;
}

// ---------------------------------------------------------------------------
// 8. Contingent Clause Model
// ---------------------------------------------------------------------------

/** Remedy types for clause violations. */
export type RemedyType =
  | 'price_rebate'
  | 'cancel_right'
  | 'extension'
  | 'replacement_right';

/** What happens when a clause trigger fires. */
export interface ClauseRemedy {
  type: RemedyType;
  /** Type-specific parameters (e.g. amount_per_24h, cap for price_rebate). */
  params: Record<string, unknown>;
}

/**
 * A contingent clause: "if trigger fires past threshold, apply remedy."
 * Example: carrier_acceptance > 24h → $15/day rebate capped at $45.
 */
export interface ContingentClause {
  /** Event name that activates this clause. */
  trigger: string;
  /** Numeric threshold for the trigger event. */
  threshold: number;
  /** Optional expression for complex conditions. */
  condition?: string;
  remedy: ClauseRemedy;
}

// ---------------------------------------------------------------------------
// 9. Shipping Verification Model (Electronics v1)
// ---------------------------------------------------------------------------

/** Shipping terms negotiable between buyer and seller. */
export interface ShippingTerms {
  /** Agreed base price (needed for rebate/cancel calculations). */
  base_price: number;
  tracking_upload_deadline_hours: number;
  carrier_acceptance_deadline_hours: number;
  shipping_method: string;
  late_acceptance_rebate_per_24h: number;
  late_acceptance_rebate_cap: number;
  cancel_if_no_acceptance_after_hours: number;
  inspection_window_hours: number;
  condition_proof_bundle_required: boolean;
}

/** Result of verifying shipping obligation. */
export interface ShippingVerificationResult {
  obligation: 'fulfilled' | 'late' | 'unverified';
  /** Rebate amount if late (0 if fulfilled). */
  rebate_amount: number;
  /** Whether buyer has earned cancel right. */
  cancel_right_activated: boolean;
  /** Hours of delay (0 if on time). */
  delay_hours: number;
}

// ---------------------------------------------------------------------------
// 10. BATNA & Preferences
// ---------------------------------------------------------------------------

/** BATNA (Best Alternative to Negotiated Agreement) reference. */
export interface BatnaRef {
  /** Reference to the alternative offer/session. */
  batna_ref: string;
  /** Confidence in BATNA being achievable [0, 1]. */
  batna_confidence: number;
  /** ISO 8601 expiry of the BATNA option. */
  batna_expiry?: string;
}

/** Agent preferences: hard constraints + soft weights. */
export interface AgentPreferences {
  /** Constraints that must be satisfied (deal-breakers). */
  hard_constraints: Record<string, unknown>;
  /** Soft preference weights for utility computation. */
  soft_preferences: Record<string, number>;
}

// ---------------------------------------------------------------------------
// 12. Opponent Model (protocol-level signals)
// ---------------------------------------------------------------------------

/** Opponent behavior signals observable through the protocol. */
export interface OpponentSignals {
  /** Per-issue concession rate estimates. */
  concession_rates: Record<string, number>;
  /** Estimated issue priorities [0, 1] per issue. */
  issue_priorities: Record<string, number>;
  /** Response speed classification. */
  response_speed: 'fast' | 'medium' | 'slow';
  /** Concession style classification. */
  concession_style: 'aggressive' | 'moderate' | 'slow';
  /** Estimated reservation values per issue. */
  estimated_reservations?: Record<string, number>;
}

// ---------------------------------------------------------------------------
// 14. Settlement Hook
// ---------------------------------------------------------------------------

/** Settlement method types. */
export type SettlementMethod = 'smart_contract' | 'escrow' | 'direct' | 'fiat_bridge';

/** Settlement hook connecting HNP agreement to external execution. */
export interface SettlementHook {
  settlement_method: SettlementMethod;
  /** Blockchain network (e.g. "base", "ethereum"). */
  chain?: string;
  /** Payment token (e.g. "USDC"). */
  payment_token: string;
  /** Hash of the agreed terms for on-chain verification. */
  agreement_hash?: string;
  /** Reference to settlement conditions. */
  settlement_conditions_ref?: string;
}

// ---------------------------------------------------------------------------
// Generic HNP v2 Message Envelope
// ---------------------------------------------------------------------------

/** A generic HNP v2 protocol message. */
export interface HnpV2Message {
  message_type: HnpV2MessageType;
  session_id: string;
  sender: OfferSender;
  timestamp: string;
  /** Offer payload — present for OFFER and COUNTER_OFFER. */
  offer?: OfferPayload;
  /** Settlement hook — present for settlement messages. */
  settlement?: SettlementHook;
  /** Free-form metadata. */
  meta?: Record<string, unknown>;
}
