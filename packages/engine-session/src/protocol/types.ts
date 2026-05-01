/**
 * @deprecated Use HnpEnvelope and HnpCoreMessageType from `protocol/core`.
 * This legacy shape is kept for compatibility adapters and older tests.
 */
export type HnpMessageType = 'OFFER' | 'COUNTER' | 'ACCEPT' | 'REJECT' | 'ESCALATE';

/** @deprecated Use HnpActorRole from `protocol/core`. */
export type HnpRole = 'BUYER' | 'SELLER';

/** @deprecated Use HnpEnvelope from `protocol/core`. */
export interface HnpMessage {
  session_id: string;
  round: number;
  type: HnpMessageType;
  price: number;
  sender_role: HnpRole;
  timestamp: number;
  metadata?: Record<string, unknown>;
}
