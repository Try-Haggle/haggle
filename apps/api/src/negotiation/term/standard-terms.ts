import type { CategoryTerm } from "../types.js";

/** Phase 0 Electronics 표준 Term — iPhone Pro 카테고리 */
export const ELECTRONICS_TERMS: CategoryTerm[] = [
  {
    id: "battery_health",
    parent_category: "CONDITION",
    display_name: "배터리 잔여 수명",
    value_type: "number",
    value_range: { min: 0, max: 100 },
    unit: "%",
    typical_impact: "80% 미만이면 곧 교체가 필요하고 가격이 내려간다",
    evaluate_hint:
      "Battery below 80% usually needs replacement soon and should move price. Weaker than STRATEGY.preferences → buyer COUNTER lower. Do not use a fixed dollar per 10%.",
  },
  {
    id: "carrier_lock",
    parent_category: "VERIFICATION",
    display_name: "통신사 잠금",
    value_type: "enum",
    value_range: ["unlocked", "locked"],
    typical_impact: "잠금은 사용처를 줄여 감가, 해제는 더 넓게 쓸 수 있다",
    evaluate_hint:
      "A locked phone only works on one carrier. Treat lock as leverage, not a safety fail unless STRATEGY requires unlocked. Do not use a fixed unlock premium.",
  },
  {
    id: "screen_condition",
    parent_category: "CONDITION",
    display_name: "화면 상태",
    value_type: "enum",
    value_range: ["flawless", "minor_scratches", "cracks", "replaced"],
    typical_impact: "크랙·비정품 교체는 크게 감가, 잔기스는 작다",
    evaluate_hint:
      "Cracked or non-OEM replaced screens usually move price more than light scratches. Name the fault. Do not use a fixed dollar deduction.",
  },
  {
    id: "storage_capacity",
    parent_category: "CONDITION",
    display_name: "저장 용량",
    value_type: "enum",
    value_range: ["128GB", "256GB", "512GB", "1TB"],
    typical_impact: "용량이 클수록 보통 더 비싸다. 단계당 고정 금액은 없다",
    evaluate_hint:
      "More storage is usually worth more. Compare LISTING's exact size to STRATEGY.preferences and this listing's ask. Do not invent a dollar-per-tier table.",
  },
  {
    id: "original_accessories",
    parent_category: "CONDITION",
    display_name: "정품 액세서리 포함",
    value_type: "boolean",
    typical_impact: "정품 박스·충전기는 체감 가치를 올린다",
    evaluate_hint:
      "Original box and accessories can raise perceived value. Judge from this listing, not a fixed add-on.",
  },
  {
    id: "find_my_status",
    parent_category: "VERIFICATION",
    display_name: "Find My 비활성화",
    value_type: "boolean",
    typical_impact: "미비활성화 시 거래 불가",
    evaluate_hint: "Find My must be disabled before sale. This is a deal-breaker if not confirmed.",
  },
  {
    id: "shipping_method",
    parent_category: "LOGISTICS",
    display_name: "배송 방법",
    value_type: "enum",
    value_range: [
      "carrier",
      "local_pickup",
      "porch_drop",
      "meetup",
      "standard_shipping",
      "express_shipping",
      "insured_shipping",
    ],
    typical_impact: "보험 배송은 비용이 늘고, 직거래는 배송비가 없다",
    evaluate_hint:
      "Stay inside the intersection of seller-offered and buyer-accepted methods. Carrier shipping stays inside the all-in total. Local pickup, porch drop, and meetup add no shipping unless both sides add a carrier.",
  },
  {
    id: "shipping_cost_split",
    parent_category: "FINANCIAL",
    display_name: "배송비 부담",
    value_type: "enum",
    value_range: ["buyer_pays", "seller_pays", "split_50_50"],
    typical_impact: "누가 내느냐가 협상 항이다",
    evaluate_hint:
      "Who pays shipping is a common term. Stay inside the all-in total. Do not assume a fixed shipping dollar amount.",
  },
  {
    id: "warranty_period",
    parent_category: "WARRANTY",
    display_name: "보증 기간",
    value_type: "enum",
    value_range: ["none", "7_days", "14_days", "30_days"],
    typical_impact: "구매자 보증이 길면 체감 가치가 오른다",
    evaluate_hint:
      "Longer buyer-side warranty can support a higher price. Do not use a fixed warranty premium.",
  },
  {
    id: "return_policy",
    parent_category: "WARRANTY",
    display_name: "반품 정책",
    value_type: "enum",
    value_range: ["no_returns", "defect_only", "full_refund_7d"],
    typical_impact: "전액 환불은 구매자 신뢰를 올린다",
    evaluate_hint: "A fuller refund policy can raise buyer confidence. Do not use a fixed premium.",
  },
  {
    id: "imei_verification",
    parent_category: "VERIFICATION",
    display_name: "IMEI 인증",
    value_type: "boolean",
    typical_impact: "미인증 시 거래 불가",
    evaluate_hint:
      "IMEI must be verified clean (not blacklisted/stolen). Required for all transactions.",
  },
  {
    id: "cosmetic_grade",
    parent_category: "CONDITION",
    display_name: "외관 등급",
    value_type: "enum",
    value_range: ["mint", "excellent", "good", "fair", "poor"],
    typical_impact: "등급이 낮을수록 감가. 단계당 고정 금액은 없다",
    evaluate_hint:
      "Mint vs fair changes value. Each grade step should change COUNTER or the line. Do not use a fixed dollar per grade.",
  },
];
