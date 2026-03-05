import type {
  HnpRole,
  NegotiationSession,
  RoundResult,
  EscalationRequest,
} from '@haggle/engine-session';
import type { UtilityResult, DecisionAction } from '@haggle/engine-core';

// ── Input types ─────────────────────────────────────────────────

export interface ListingContext {
  listing_id: string;
  title: string;
  target_price: number;
  floor_price: number;
  condition: 'new' | 'like_new' | 'good' | 'fair' | 'poor';
  seller_id: string;
  seller_reputation?: number;   // 0-1, default 0.5
  info_completeness?: number;   // 0-1, default 0.7
}

export type PersonaPreset = 'balanced' | 'aggressive' | 'conservative';

export interface StartSessionInput {
  listing: ListingContext;
  role: HnpRole;
  user_id: string;
  counterparty_id: string;
  persona?: PersonaPreset;
}

export interface SubmitOfferInput {
  session_id: string;
  price: number;
  sender_role: HnpRole;
}

// ── Output types ────────────────────────────────────────────────

export enum BridgeErrorCode {
  SESSION_NOT_FOUND = 'SESSION_NOT_FOUND',
  STRATEGY_NOT_FOUND = 'STRATEGY_NOT_FOUND',
  INVALID_STRATEGY = 'INVALID_STRATEGY',
  INVALID_OFFER = 'INVALID_OFFER',
  SESSION_EXPIRED = 'SESSION_EXPIRED',
  SESSION_TERMINAL = 'SESSION_TERMINAL',
  ENGINE_ERROR = 'ENGINE_ERROR',
  INVALID_PRICE = 'INVALID_PRICE',
}

export type BridgeResult<T> =
  | { ok: true; data: T }
  | { ok: false; error: { code: BridgeErrorCode; message: string } };

export interface StartSessionResult {
  session: NegotiationSession;
  strategy_id: string;
}

export interface SubmitOfferResult {
  message: RoundResult['message'];
  decision: DecisionAction;
  utility: UtilityResult;
  session: NegotiationSession;
  escalation?: EscalationRequest;
}

export interface SessionStateResult {
  session: NegotiationSession;
  status: NegotiationSession['status'];
  round_count: number;
  is_terminal: boolean;
}
