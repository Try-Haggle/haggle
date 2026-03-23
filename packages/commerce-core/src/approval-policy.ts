export type SellerApprovalMode =
  | "AUTO_WITHIN_POLICY"
  | "MANUAL_CONFIRMATION";

export interface FulfillmentSlaPolicy {
  /**
   * 배송 정보 입력 마감 시간.
   * purchase approval 이 완료된 시점으로부터 계산한다.
   */
  shipment_input_due_days: number;
}

export interface SellerResponsivenessProfile {
  /**
   * 수동 확인 seller 라도 과거 응답 속도가 빠르면 negotiation 단계에서
   * 과도한 패널티를 주지 않기 위한 지표.
   */
  median_response_minutes: number;
  p95_response_minutes: number;
  reliable_fast_responder: boolean;
}

export interface SellerApprovalPolicy {
  mode: SellerApprovalMode;
  auto_approval_price_guard_minor?: number;
  fulfillment_sla: FulfillmentSlaPolicy;
  responsiveness: SellerResponsivenessProfile;
}

export type ApprovalState =
  | "NEGOTIATING"
  | "MUTUALLY_ACCEPTABLE"
  | "AWAITING_BUYER_APPROVAL"
  | "HELD_BY_BUYER"
  | "RESERVED_PENDING_APPROVAL"
  | "AWAITING_SELLER_APPROVAL"
  | "APPROVED"
  | "DECLINED"
  | "EXPIRED";

export type HoldStateKind = "SOFT_HOLD" | "SELLER_RESERVED";

export interface HoldSnapshot {
  kind: HoldStateKind;
  held_snapshot_price_minor: number;
  held_snapshot_utility?: number;
  held_at: string;
  hold_reason?: string;
  /**
   * SOFT_HOLD는 재개 시 현재 효용으로 다시 계산해야 하므로 기본적으로 true다.
   * SELLER_RESERVED도 만료 후에는 재계산이 필요하다.
   */
  resume_reprice_required: boolean;
  /**
   * seller가 가격을 일정 시간 묶어준 경우에만 설정된다.
   * soft hold에는 없다.
   */
  expires_at?: string;
}

export interface SettlementTermsSnapshot {
  listing_id: string;
  seller_id: string;
  buyer_id: string;
  final_amount_minor: number;
  currency: string;
  selected_payment_rail: "x402" | "stripe";
  shipment_input_due_at?: string;
}

export interface SettlementApproval {
  id: string;
  approval_state: ApprovalState;
  seller_policy: SellerApprovalPolicy;
  terms: SettlementTermsSnapshot;
  hold_snapshot?: HoldSnapshot;
  buyer_approved_at?: string;
  seller_approved_at?: string;
  created_at: string;
  updated_at: string;
}
