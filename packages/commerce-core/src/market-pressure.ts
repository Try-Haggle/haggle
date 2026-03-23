export type MarketPressureDirection = "UPWARD" | "DOWNWARD" | "NEUTRAL";

export interface VerifiedMarketPressure {
  listing_id: string;
  generated_at: string;
  /**
   * 현재 활성 구매자 관심/협상 수.
   * seller 관점에서 수요 압력 계산의 기초값으로 사용한다.
   */
  active_buyer_interest_count: number;
  /**
   * 현재 활성 대안 seller/리스팅 수.
   * buyer 관점에서 공급 압력 계산의 기초값으로 사용한다.
   */
  active_seller_alternatives: number;
  /**
   * 더 낮은 가격의 비교 가능 리스팅 수.
   * 조작된 개별 counter offer 가 아니라 플랫폼이 검증한 공급 신호다.
   */
  cheaper_comparable_listing_count: number;
  /**
   * 더 높은 가격에도 성사 가능해지는 seller 측 상승 압력 [0, 1].
   */
  demand_pressure: number;
  /**
   * 더 낮은 가격이 유리해지는 buyer 측 하락 압력 [0, 1].
   */
  supply_pressure: number;
  /**
   * 엔진에 전달하는 최종 경쟁 강도 [0, 1].
   */
  competitive_pressure: number;
  direction: MarketPressureDirection;
}

export interface MarketPressurePolicy {
  demand_pressure_weight: number;
  supply_pressure_weight: number;
  cheaper_listing_weight: number;
  /**
   * manual approval seller 는 가격을 더 끌어올릴 여지가 있지만,
   * 응답 이력이 빠른 seller 는 과도한 friction penalty 를 받지 않는다.
   */
  manual_seller_friction_weight: number;
}
