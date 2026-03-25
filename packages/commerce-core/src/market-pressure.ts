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

export const DEFAULT_MARKET_PRESSURE_POLICY: MarketPressurePolicy = {
  demand_pressure_weight: 1.0,
  supply_pressure_weight: 1.0,
  cheaper_listing_weight: 1.0,
  manual_seller_friction_weight: 0.0,
};

/**
 * 원시 수요/공급 카운트를 [0, 1] 로 정규화한다.
 * 시그모이드 유사 함수로 10 이상이면 거의 1 에 수렴한다.
 */
function normalize(count: number): number {
  if (count <= 0) return 0;
  return count / (count + 5);
}

/**
 * 경쟁 강도를 [0, 1] 로 계산한다.
 * demand 가 높으면 seller 에게 유리, supply/cheaper 가 높으면 buyer 에게 유리.
 * 양쪽 모두 높으면 경쟁 강도도 높다.
 */
export function computeCompetitivePressure(
  active_buyer_interest_count: number,
  active_seller_alternatives: number,
  cheaper_comparable_listing_count: number,
  policy: MarketPressurePolicy = DEFAULT_MARKET_PRESSURE_POLICY,
): number {
  const demand = normalize(active_buyer_interest_count) * policy.demand_pressure_weight;
  const supply = normalize(active_seller_alternatives) * policy.supply_pressure_weight;
  const cheaper = normalize(cheaper_comparable_listing_count) * policy.cheaper_listing_weight;

  const totalWeight = policy.demand_pressure_weight + policy.supply_pressure_weight + policy.cheaper_listing_weight;
  if (totalWeight <= 0) return 0;

  const raw = (demand + supply + cheaper) / totalWeight;
  return Math.max(0, Math.min(1, raw));
}

/**
 * demand pressure 와 supply pressure 를 비교하여 방향을 추론한다.
 * 차이가 0.1 미만이면 NEUTRAL.
 */
export function inferPressureDirection(
  demand_pressure: number,
  supply_pressure: number,
): MarketPressureDirection {
  const diff = demand_pressure - supply_pressure;
  if (Math.abs(diff) < 0.1) return "NEUTRAL";
  return diff > 0 ? "UPWARD" : "DOWNWARD";
}
