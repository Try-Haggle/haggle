import type { NegotiationStatus } from "@haggle/shared";

/**
 * HNP (Haggle Negotiation Protocol) state representation.
 * Defines the current state of a negotiation session.
 */
export interface HnpState {
  sessionId: string;
  status: NegotiationStatus;
  currentOffer: number | null;
  round: number;
  maxRounds: number;
  // TODO(post-mvp): Add payment escrow state
  // TODO(post-mvp): Add multi-party negotiation support
}

/** State machine transition definition. */
export interface HnpTransition {
  from: NegotiationStatus;
  to: NegotiationStatus;
  event: HnpEvent;
}

/** Events that can trigger state transitions. */
export type HnpEvent =
  | "BUYER_OFFER"
  | "SELLER_COUNTER"
  | "ACCEPT"
  | "REJECT"
  | "EXPIRE"
  | "CANCEL";

// TODO(slice-4): Define full state machine transition table
// TODO(post-mvp): Add protocol version field for forwards compatibility
