export type TrustPenaltyReason =
  | "BUYER_APPROVED_BUT_NOT_PAID"
  | "SELLER_APPROVED_BUT_NOT_FULFILLED"
  | "SHIPMENT_INFO_SLA_MISSED"
  | "DISPUTE_LOSS";

export interface TrustPenaltyRecord {
  id: string;
  order_id: string;
  actor_id: string;
  actor_role: "buyer" | "seller";
  reason: TrustPenaltyReason;
  penalty_score: number;
  created_at: string;
  /**
   * 온체인 또는 외부 신뢰 레이어에 앵커링된 참조.
   * 아직 없는 경우에는 비워둘 수 있다.
   */
  onchain_reference?: string;
}

export interface SettlementReliabilitySnapshot {
  actor_id: string;
  actor_role: "buyer" | "seller";
  successful_settlements: number;
  approval_defaults: number;
  shipment_sla_misses: number;
  dispute_wins: number;
  dispute_losses: number;
  /**
   * 승인 후 실제 결제/이행까지 이어질 확률을 정규화한 값 [0, 1].
   */
  settlement_reliability: number;
}

export type ExpertiseDomain =
  | "electronics"
  | "luxury"
  | "fashion"
  | "collectibles"
  | "automotive"
  | "general";

export interface ExpertiseBadge {
  domain: ExpertiseDomain;
  score: number;
  successful_orders: number;
  dispute_wins: number;
  dispute_losses: number;
}

export interface OnchainTrustProfile {
  actor_id: string;
  wallet_address?: string;
  anchored_at?: string;
  reputation_score: number;
  settlement_reliability: number;
  successful_settlements: number;
  approval_defaults: number;
  shipment_sla_misses: number;
  dispute_wins: number;
  dispute_losses: number;
  expertise: ExpertiseBadge[];
  onchain_reference?: string;
}
