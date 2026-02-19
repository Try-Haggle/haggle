/** HNP message types as defined in the architecture spec. */
export type HnpMessageType = 'OFFER' | 'COUNTER' | 'ACCEPT' | 'REJECT' | 'ESCALATE';

/** Negotiation role. */
export type HnpRole = 'BUYER' | 'SELLER';

/** A single HNP protocol message. */
export interface HnpMessage {
  session_id: string;
  round: number;
  type: HnpMessageType;
  price: number;
  sender_role: HnpRole;
  timestamp: number;
  metadata?: Record<string, unknown>;
}
