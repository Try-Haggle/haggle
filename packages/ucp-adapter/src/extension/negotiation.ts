// ============================================================
// ai.tryhaggle.negotiation — UCP Extension
// Extends dev.ucp.shopping.checkout with negotiation data
// ============================================================

import type { DecisionAction } from '@haggle/engine-core';

export type NegotiationExtensionStatus =
  | 'pending'
  | 'active'
  | 'agreed'
  | 'rejected'
  | 'expired';

export interface NegotiationConstraints {
  price_floor: number;   // minor units
  price_ceiling: number; // minor units
  deadline: string;      // ISO 8601
}

export interface HaggleNegotiationExtension {
  session_id: string;
  status: NegotiationExtensionStatus;
  original_price: number;       // minor units
  current_offer: number | null;
  counter_offer: number | null;
  round: number;
  role: 'BUYER' | 'SELLER';
  utility_score: number | null;
  decision: DecisionAction | null;
  constraints: NegotiationConstraints;
}

export const NEGOTIATION_EXTENSION_KEY = 'ai.tryhaggle.negotiation';

export function createNegotiationExtension(
  params: {
    sessionId: string;
    originalPrice: number;
    role: 'BUYER' | 'SELLER';
    priceFloor: number;
    priceCeiling: number;
    deadline: string;
  },
): HaggleNegotiationExtension {
  return {
    session_id: params.sessionId,
    status: 'pending',
    original_price: params.originalPrice,
    current_offer: null,
    counter_offer: null,
    round: 0,
    role: params.role,
    utility_score: null,
    decision: null,
    constraints: {
      price_floor: params.priceFloor,
      price_ceiling: params.priceCeiling,
      deadline: params.deadline,
    },
  };
}
