# Dynamic Confirmation Period Architecture

**Author**: Platform Architect
**Date**: 2026-03-27
**Status**: Design Proposal
**Scope**: Settlement Release의 BUYER_REVIEW 기간을 데이터 기반으로 동적 산출

---

## 1. Executive Summary

현재 Haggle의 `BUYER_REVIEW_HOURS = 24` (고정)는 모든 거래에 동일하게 적용된다.
이는 $20 USB 케이블 구매에는 과보호이고, $5,000 빈티지 시계 구매에는 과소보호다.

본 아키텍처는 **오프체인에서 확정 기간을 산출하고, 온체인에 파라미터로 주입하는** 방식으로
Non-custodial 설계를 유지하면서 거래 특성에 맞는 확정 기간을 제공한다.

### 핵심 설계 원칙
1. **안전 > 편리**: 바운드 초과 시 항상 보수적(긴 기간) 방향으로 클램프
2. **Non-custodial 호환**: 릴리즈 후 회수 불가 → 확정 기간이 유일한 보호
3. **온체인 최소화**: 계산은 오프체인, 결과(uint16 hours)만 온체인 인코딩
4. **점진적 정교화**: Phase 0(고정) → Phase 1(공식) → Phase 2(ML) 진화 경로
5. **양측 균형**: 구매자 보호와 판매자 자금 유동성의 균형점 산출

---

## 2. 바운드 정의

```
CONFIRMATION_FLOOR_HOURS = 12    // 최소: 구매자 보호 최소 보장
CONFIRMATION_CEILING_HOURS = 168 // 최대: 7일 (판매자 이탈 방지)
DEFAULT_HOURS = 24               // Cold start 기본값
```

### 바운드 근거

| 바운드 | 값 | 근거 |
|--------|-----|------|
| Floor 12h | 12시간 | 구매자가 배송 수령 후 검수할 최소 시간. 시차 고려 |
| Ceiling 168h | 7일 | eBay 30일 대비 공격적. 판매자 자금 유동성 보장. 경쟁사 Mercari/Poshmark 3일 대비 보수적 |
| Default 24h | 24시간 | 현재 정책 유지. Cold start 시 안전한 기본값 |

---

## 3. 확정 기간 공식 (Confirmation Period Formula)

### 3.1 핵심 공식

```
confirmation_hours = clamp(
  base_hours(category)
    × price_multiplier(price_usd)
    × trust_modifier(buyer_trust, seller_trust)
    × dispute_rate_modifier(category_dispute_rate)
    × condition_modifier(item_condition, tags),
  FLOOR_HOURS,
  CEILING_HOURS
)
```

최종 결과는 **정수 시간(uint16)** 으로 반올림하여 온체인에 주입.

### 3.2 Base Hours (카테고리 기본값)

| 카테고리 | base_hours | 근거 |
|----------|-----------|------|
| electronics | 48 | 기능 테스트 필요, 초기 불량 확인 |
| fashion | 24 | 외관 확인 위주, 비교적 간단 |
| home | 24 | 외관 확인 + 기본 기능 확인 |
| sports | 24 | 외관 확인 위주 |
| vehicles | 120 | 고가, 검수 복잡, 전문가 확인 필요 가능 |
| other | 24 | 보수적 기본값 |

향후 카테고리 확장 시 추가:
- `luxury` → 72h (인증 확인 필요)
- `collectibles` → 72h (진품 확인, 컨디션 검수)
- `automotive` → 120h (부품 호환성, 기능 테스트)

### 3.3 Price Multiplier (가격 계수)

**로그 스케일 스텝 함수** — 가격 구간별 이산 배율을 적용하여 온체인 결정성 확보.

```typescript
function priceMultiplier(price_usd: number): number {
  if (price_usd <= 25)    return 0.50;  // 초저가: 대폭 축소
  if (price_usd <= 100)   return 0.75;  // 저가: 축소
  if (price_usd <= 500)   return 1.00;  // 중가: 기본값
  if (price_usd <= 2000)  return 1.25;  // 고가: 약간 증가
  if (price_usd <= 10000) return 1.50;  // 초고가: 증가
  return 1.75;                           // 프리미엄: 최대 증가
}
```

**설계 결정 — 왜 로그 스케일 스텝?**
- **연속 함수(log(price))** 는 온체인 검증이 어려움 (부동소수점 연산)
- **선형(linear)** 은 고가 구간에서 과도한 기간 산출
- **스텝 함수** 는 결정적이고, 온체인 검증 가능하며, 사용자에게 설명 가능
- 6개 구간은 대부분의 거래 분포를 커버

**효과 예시**:
| 상품 | 가격 | 카테고리 | base | × price | = |
|------|------|---------|------|---------|---|
| USB 케이블 | $15 | electronics | 48h | × 0.50 | 24h |
| 이어폰 | $80 | electronics | 48h | × 0.75 | 36h |
| 노트북 | $1,200 | electronics | 48h | × 1.25 | 60h |
| 빈티지 시계 | $5,000 | other | 24h | × 1.50 | 36h |
| 클래식 차량 | $25,000 | vehicles | 120h | × 1.75 | 210h→168h(cap) |

### 3.4 Trust Modifier (양측 신뢰도 보정)

양측의 Trust Score를 결합하여 기간을 조정. 신뢰도가 높으면 기간 단축, 낮으면 연장.

```typescript
function trustModifier(
  buyer_trust: TrustScoreResult | null,
  seller_trust: TrustScoreResult | null,
): number {
  const buyerFactor = trustFactor(buyer_trust, "buyer");
  const sellerFactor = trustFactor(seller_trust, "seller");

  // 양측 평균, 단 더 나쁜 쪽에 60% 가중
  const worse = Math.max(buyerFactor, sellerFactor);
  const better = Math.min(buyerFactor, sellerFactor);
  return worse * 0.6 + better * 0.4;
}

function trustFactor(
  trust: TrustScoreResult | null,
  role: "buyer" | "seller"
): number {
  // Cold start: 데이터 없으면 중립(1.0)
  if (!trust || trust.score === null || trust.cold_start === "NEW") {
    return 1.0;
  }

  const score = trust.score; // 0-100

  // SCORING 단계 (5-19 trades): 감쇠 적용 — 데이터 신뢰도가 낮으므로 효과 절반
  const dampening = trust.cold_start === "SCORING" ? 0.5 : 1.0;

  // 신뢰도 구간:
  // 90+: 우수 → 0.80 (20% 단축)
  // 70-89: 양호 → 0.90 (10% 단축)
  // 50-69: 중립 → 1.00
  // 30-49: 주의 → 1.15 (15% 연장)
  // 0-29: 위험 → 1.30 (30% 연장)
  let raw: number;
  if (score >= 90) raw = 0.80;
  else if (score >= 70) raw = 0.90;
  else if (score >= 50) raw = 1.00;
  else if (score >= 30) raw = 1.15;
  else raw = 1.30;

  // 감쇠 적용: (raw - 1.0) * dampening + 1.0
  return (raw - 1.0) * dampening + 1.0;
}
```

**설계 근거**:
- **비대칭 가중(60/40)**: 더 나쁜 쪽에 가중치를 둠 — 위험 관리 우선
- **SCORING 감쇠(0.5)**: 데이터가 5-19건일 때 점수 변동이 크므로 효과를 절반으로
- **비대칭 조정폭**: 단축(최대 20%)보다 연장(최대 30%)이 더 큼 — 안전 > 편리

### 3.5 Dispute Rate Modifier (카테고리별 분쟁률 보정)

카테고리별 역사적 분쟁률이 플랫폼 평균을 초과하면 기간 연장.

```typescript
function disputeRateModifier(
  category_dispute_rate: number | null,  // 해당 카테고리 분쟁률
  platform_avg_rate: number | null,      // 플랫폼 전체 평균 분쟁률
): number {
  // Cold start: 데이터 없으면 중립
  if (category_dispute_rate === null || platform_avg_rate === null) {
    return 1.0;
  }

  // 카테고리 분쟁률이 평균의 몇 배인지
  if (platform_avg_rate <= 0) return 1.0;
  const ratio = category_dispute_rate / platform_avg_rate;

  // ratio 1.0 이하: 중립 (보상 없음 — 기간 단축 인센티브 불필요)
  // ratio 1.0-1.5: 약간 연장
  // ratio 1.5-2.0: 연장
  // ratio 2.0+: 강하게 연장
  if (ratio <= 1.0) return 1.00;
  if (ratio <= 1.5) return 1.10;
  if (ratio <= 2.0) return 1.20;
  return 1.30;
}
```

### 3.6 Condition/Tag Modifier (상품 상태 보정)

```typescript
function conditionModifier(
  item_condition: ItemCondition,
  tags: string[],
): number {
  let modifier = 1.0;

  // 상품 상태에 따른 기본 보정
  const conditionMap: Record<ItemCondition, number> = {
    new: 0.90,       // 새상품: 불량률 낮음
    like_new: 0.95,
    good: 1.00,
    fair: 1.10,
    poor: 1.20,      // 상태 나쁨: 분쟁 가능성 높음
  };
  modifier *= conditionMap[item_condition] ?? 1.0;

  // 태그 기반 추가 보정
  const tagModifiers: Record<string, number> = {
    refurbished: 1.15,  // 리퍼: 기능 테스트 필요
    sealed: 0.90,       // 미개봉: 비교적 안전
    vintage: 1.20,      // 빈티지: 컨디션 주관적
    authenticated: 0.85, // 인증 완료: 신뢰도 높음
    "as-is": 1.25,      // 있는 그대로: 분쟁 가능성
    parts_only: 0.70,   // 부품용: 기능 기대 낮음
  };

  for (const tag of tags) {
    const tagMod = tagModifiers[tag.toLowerCase()];
    if (tagMod) modifier *= tagMod;
  }

  return modifier;
}
```

---

## 4. 전체 파이프라인 (End-to-End Flow)

```
┌─────────────────────────────────────────────────────────┐
│                  Off-Chain (API Server)                   │
│                                                          │
│  거래 생성 시:                                            │
│  1. category → base_hours 조회                           │
│  2. price_usd → price_multiplier 계산                    │
│  3. buyer/seller trust scores → trust_modifier           │
│  4. category dispute rate → dispute_rate_modifier        │
│  5. item condition + tags → condition_modifier           │
│  6. 모든 modifier 곱셈 → clamp(floor, ceiling)          │
│  7. Math.round() → uint16 confirmation_hours             │
│                                                          │
│  결과: confirmation_hours (정수)                          │
└────────────────────────┬────────────────────────────────┘
                         │ 파라미터로 전달
                         ▼
┌─────────────────────────────────────────────────────────┐
│                  On-Chain (Settlement Contract)           │
│                                                          │
│  createSettlement(                                        │
│    buyer, seller, amount,                                │
│    confirmation_hours,    ← 동적 값 주입                  │
│    ...                                                   │
│  )                                                       │
│                                                          │
│  - confirmation_hours는 거래 생성 시 1회 설정              │
│  - 이후 변경 불가 (immutable per transaction)             │
│  - 온체인에서 uint16으로 저장 (0-65535 hours)             │
│  - 바운드 검증: require(h >= 12 && h <= 168)             │
└─────────────────────────────────────────────────────────┘
```

### 4.1 스마트 컨트랙트 변경사항

```solidity
// 현재
uint256 constant BUYER_REVIEW_HOURS = 24;

// 변경 후
uint16 public constant MIN_CONFIRMATION_HOURS = 12;
uint16 public constant MAX_CONFIRMATION_HOURS = 168;

function createSettlement(
    address buyer,
    address seller,
    uint256 amount,
    uint16 confirmationHours  // 새 파라미터
) external {
    require(
        confirmationHours >= MIN_CONFIRMATION_HOURS
            && confirmationHours <= MAX_CONFIRMATION_HOURS,
        "Confirmation hours out of bounds"
    );
    // ... 기존 로직, BUYER_REVIEW_HOURS 대신 confirmationHours 사용
}
```

**가스 비용 분석**:
- 추가 스토리지: uint16 = 2 bytes (기존 슬롯에 패킹 가능)
- 추가 가스: ~200 gas (SSTORE 패킹 시)
- Base L2 기준: ~$0.001 미만 추가 비용

### 4.2 오프체인 코드 변경 (payment-core)

```typescript
// 현재: settlement-release.ts
export const BUYER_REVIEW_HOURS = 24;

// 변경 후: confirmation-period.ts (새 모듈)
export interface ConfirmationPeriodInput {
  category: ListingCategory;
  price_usd: number;
  item_condition: ItemCondition;
  tags: string[];
  buyer_trust: TrustScoreResult | null;
  seller_trust: TrustScoreResult | null;
  category_dispute_rate: number | null;
  platform_avg_dispute_rate: number | null;
}

export interface ConfirmationPeriodResult {
  hours: number;                    // 최종 확정 기간 (정수)
  base_hours: number;               // 카테고리 기본값
  price_multiplier: number;         // 가격 계수
  trust_modifier: number;           // 신뢰도 보정
  dispute_rate_modifier: number;    // 분쟁률 보정
  condition_modifier: number;       // 상태 보정
  raw_hours: number;                // 클램프 전 값
  clamped: boolean;                 // 바운드에 의해 잘렸는지
  formula_version: string;          // 공식 버전 (A/B 테스트용)
}

export function computeConfirmationPeriod(
  input: ConfirmationPeriodInput,
  version: string = "v1",
): ConfirmationPeriodResult {
  const base = baseHours(input.category);
  const priceMult = priceMultiplier(input.price_usd);
  const trustMod = trustModifier(input.buyer_trust, input.seller_trust);
  const disputeMod = disputeRateModifier(
    input.category_dispute_rate,
    input.platform_avg_dispute_rate
  );
  const condMod = conditionModifier(input.item_condition, input.tags);

  const raw = base * priceMult * trustMod * disputeMod * condMod;
  const clamped = raw < FLOOR_HOURS || raw > CEILING_HOURS;
  const hours = Math.round(
    Math.max(FLOOR_HOURS, Math.min(CEILING_HOURS, raw))
  );

  return {
    hours,
    base_hours: base,
    price_multiplier: priceMult,
    trust_modifier: trustMod,
    dispute_rate_modifier: disputeMod,
    condition_modifier: condMod,
    raw_hours: raw,
    clamped,
    formula_version: version,
  };
}
```

`settlement-release.ts`의 `confirmDelivery` 함수는 상수 대신 동적 값을 사용:

```typescript
// 변경: confirmDelivery는 confirmation_hours를 파라미터로 받음
export function confirmDelivery(
  release: SettlementRelease,
  delivered_at: string,
  confirmation_hours: number,  // 기존: BUYER_REVIEW_HOURS 상수
): SettlementRelease {
  return {
    ...release,
    delivery_confirmed_at: delivered_at,
    buyer_review_deadline: addHours(delivered_at, confirmation_hours),
    buffer_release_deadline: addDays(delivered_at, BUFFER_RELEASE_DAYS),
    product_release_status: "BUYER_REVIEW",
    updated_at: delivered_at,
  };
}
```

---

## 5. 경쟁사 벤치마크 및 포지셔닝

| 플랫폼 | 확정/반품 기간 | 결제 방식 | 모델 |
|---------|---------------|-----------|------|
| eBay | 30일 반품 | 즉시 결제 (판매자 선지급) | 정적 |
| Mercari | 3일 확정 | 에스크로 | 정적 |
| Poshmark | 3일 확정 | 에스크로 | 정적 |
| StockX | 인증 후 즉시 | 에스크로 | 인증 기반 |
| **Haggle** | **12-168시간 동적** | **Non-custodial 스마트컨트랙트** | **데이터 기반 동적** |

### Haggle의 차별점
1. **동적**: 카테고리/가격/신뢰도에 따라 자동 조정 (경쟁사 전원 정적)
2. **투명**: 확정 기간 산출 근거를 거래 상세에 표시
3. **양측 균형**: 구매자 보호와 판매자 유동성을 양측 신뢰도로 조율
4. **Non-custodial**: 플랫폼 리스크 제거 + 스마트컨트랙트 보장

---

## 6. MVP 전략: Cold Start → 점진적 정교화

### Phase 0: 카테고리 고정값 (Day 1 — 데이터 없음)

```typescript
// 가장 단순한 시작: 카테고리별 고정값
const PHASE_0_HOURS: Record<ListingCategory, number> = {
  electronics: 48,
  fashion: 24,
  home: 24,
  sports: 24,
  vehicles: 120,
  other: 24,
};
```

- 데이터 수집 인프라 구축: 모든 거래의 `confirmation_hours`, 실제 확정 시간, 분쟁 발생 여부 기록
- Trust Score는 `NEW` → 모든 trust_modifier = 1.0
- 가격 multiplier도 미적용 (1.0 고정)
- **목표**: 데이터 수집 파이프라인 검증

### Phase 1: 공식 기반 동적 (거래 500건+ / ~2-3개월)

- 가격 multiplier 활성화
- 상품 상태 modifier 활성화
- Trust Score `SCORING` 이상 사용자에게 trust_modifier 적용
- 카테고리별 분쟁률 축적 시작 → dispute_rate_modifier 활성화 준비
- **전환 조건**: 카테고리별 최소 50건 이상 거래 데이터 축적

### Phase 2: 데이터 보정 (거래 5,000건+ / ~6-12개월)

- 실제 분쟁 데이터 기반 dispute_rate_modifier 활성화
- 카테고리별 base_hours 재조정 (실제 분쟁 패턴 기반)
- 가격 구간 경계값 최적화
- Trust modifier 감쇠 해제 (MATURE 사용자 증가)

### Phase 3: ML 최적화 (거래 50,000건+ / 12개월+)

- 기존 공식의 계수를 ML 모델로 학습
- 입력 변수 확장: 배송 거리, 시간대, 판매자 응답 속도
- 공식의 구조는 유지하되 계수를 데이터 기반으로 자동 조정
- Bandit 알고리즘으로 지속적 최적화

---

## 7. A/B 테스트 프레임워크

### 7.1 구조

```typescript
interface ConfirmationPeriodExperiment {
  experiment_id: string;
  name: string;
  variants: {
    control: { formula_version: string; weight: number };
    treatment: { formula_version: string; weight: number };
  };
  // 세분화: 카테고리, 가격 구간별로 다른 실험 가능
  segment?: {
    categories?: ListingCategory[];
    price_range?: { min_usd: number; max_usd: number };
  };
  start_date: string;
  end_date?: string;
}
```

### 7.2 핵심 메트릭

| 메트릭 | 정의 | 목표 방향 |
|--------|------|----------|
| dispute_rate | 기간 내 분쟁 발생률 | 동일하거나 감소 ↓ |
| auto_confirm_rate | 기간 만료 자동 확정률 | 감소 ↓ (구매자가 직접 확정) |
| seller_cash_flow_hours | 배송→정산 평균 시간 | 감소 ↓ |
| buyer_satisfaction | 구매자 NPS / 재구매율 | 증가 ↑ |
| manual_confirm_time | 수동 확정까지 평균 시간 | 관찰 (기간 대비 비율) |

### 7.3 실험 예시

**실험 1: 가격 계수 효과**
- Control: Phase 0 (카테고리 고정값)
- Treatment: Phase 1 (가격 multiplier 추가)
- 세그먼트: electronics 카테고리
- 관찰: $25 이하 거래의 auto_confirm 비율 변화

**실험 2: 신뢰도 보정 효과**
- Control: trust_modifier 비활성 (1.0 고정)
- Treatment: trust_modifier 활성
- 세그먼트: MATURE 사용자 (20+ trades) 간 거래
- 관찰: dispute_rate 변화 없이 seller_cash_flow_hours 감소 여부

### 7.4 안전 장치

```typescript
// A/B 테스트 변형이라도 바운드는 절대 초과 불가
const finalHours = clamp(variantResult, FLOOR_HOURS, CEILING_HOURS);

// 어떤 변형이든 결과와 근거를 모두 기록
interface ConfirmationPeriodAuditLog {
  order_id: string;
  experiment_id: string | null;
  variant: string;
  input: ConfirmationPeriodInput;
  result: ConfirmationPeriodResult;
  created_at: string;
}
```

---

## 8. 데이터 수집 전략

### 8.1 수집 대상

모든 거래에서 다음을 기록 (Phase 0부터):

```typescript
interface ConfirmationPeriodTelemetry {
  order_id: string;
  // 입력
  category: ListingCategory;
  price_usd: number;
  item_condition: ItemCondition;
  tags: string[];
  buyer_trust_score: number | null;
  seller_trust_score: number | null;
  // 산출
  formula_version: string;
  computed_hours: number;
  // 결과 (거래 완료 후)
  actual_confirm_hours: number | null;    // 실제 확정까지 걸린 시간
  confirm_type: "manual" | "auto";        // 수동/자동 확정
  dispute_filed: boolean;                 // 분쟁 발생 여부
  dispute_filed_within_period: boolean;   // 확정 기간 내 분쟁
  dispute_outcome: "buyer_win" | "seller_win" | null;
}
```

### 8.2 분석 대시보드

- 카테고리별 실제 확정 시간 분포
- 확정 기간 대비 실제 확정 시간 비율 (기간이 과도한지 부족한지)
- 분쟁률과 확정 기간의 상관관계
- 신뢰도 구간별 분쟁률 변화

---

## 9. 저가 제품 과보호 방지

### 9.1 문제 정의

$20 USB 케이블에 48시간(electronics 기본)은 과보호:
- 검수 복잡도가 낮음 (연결 → 작동 확인 → 끝)
- 분쟁 비용이 제품 가격 대비 비율 높음
- 판매자 자금 불필요하게 묶임

### 9.2 해결: Price Multiplier의 하한 구간

| 가격 | multiplier | electronics 결과 | 효과 |
|------|-----------|------------------|------|
| $15 | 0.50 | 48 × 0.50 = 24h | 절반으로 축소 |
| $50 | 0.75 | 48 × 0.75 = 36h | 25% 축소 |
| $200 | 1.00 | 48 × 1.00 = 48h | 기본값 유지 |
| $1,500 | 1.25 | 48 × 1.25 = 60h | 25% 연장 |

**핵심**: $25 이하 제품은 price_multiplier 0.50으로 기간을 최대 절반 축소.
단, `FLOOR_HOURS = 12` 이하로는 절대 내려가지 않음.

### 9.3 극단 케이스 시뮬레이션

| 시나리오 | 계산 | 최종 |
|----------|------|------|
| $10 USB, new, 양측 MATURE 90+ | 24×0.50×0.90×1.0×0.90 = 9.72h | **12h** (floor) |
| $10 USB, fair, 양측 NEW | 24×0.50×1.0×1.0×1.10 = 13.2h | **13h** |
| $50K 차량, poor, 양측 low trust | 120×1.75×1.15×1.30×1.20 = 375h | **168h** (ceiling) |
| $500 노트북, good, 양측 MATURE 80 | 48×1.00×0.90×1.0×1.0 = 43.2h | **43h** |
| $3K 핸드백(fashion), sealed, 양측 MATURE 95 | 24×1.25×0.80×1.0×0.90 = 21.6h | **22h** |

---

## 10. 사용자 경험 (UX) 설계

### 10.1 거래 생성 시 표시

```
Payment Protection Period: 43 hours
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
After delivery, you'll have 43 hours to inspect
the item before payment is released to the seller.

Why 43 hours?
├── Category (electronics): 48h base
├── Price ($500): standard range
├── Your trust score: 82 (-10%)
└── Seller trust score: 91 (-10%)
```

### 10.2 투명성 원칙

- 확정 기간과 산출 근거를 항상 표시
- "왜 이 기간인가?"에 대한 설명 제공
- 기간이 Floor/Ceiling에 도달한 경우 명시

---

## 11. 구현 로드맵

### Sprint 1 (Week 1-2): 인프라 + Phase 0
- [ ] `confirmation-period.ts` 모듈 생성 (engine-core 패턴 따름)
- [ ] `ConfirmationPeriodInput/Result` 타입 정의
- [ ] Phase 0: 카테고리별 고정값 반환 함수
- [ ] `settlement-release.ts`의 `confirmDelivery` 시그니처 변경
- [ ] 텔레메트리 테이블 스키마 추가
- [ ] 단위 테스트 (100% 커버리지)

### Sprint 2 (Week 3-4): Phase 1 + 온체인
- [ ] `priceMultiplier`, `conditionModifier` 구현
- [ ] `trustModifier` 구현 (trust-core 연동)
- [ ] `computeConfirmationPeriod` 전체 파이프라인
- [ ] Settlement Contract 수정: `confirmationHours` 파라미터 추가
- [ ] 온체인 바운드 검증 로직
- [ ] 통합 테스트

### Sprint 3 (Week 5-6): A/B 테스트 + 모니터링
- [ ] A/B 테스트 프레임워크
- [ ] 텔레메트리 수집 파이프라인
- [ ] 분석 대시보드
- [ ] Phase 0 → Phase 1 전환 플래그

### Sprint 4+ (Month 3+): 데이터 기반 최적화
- [ ] Phase 1 데이터 분석
- [ ] 계수 조정
- [ ] `disputeRateModifier` 활성화
- [ ] Phase 2 계획 수립

---

## 12. 리스크 및 완화

| 리스크 | 확률 | 영향 | 완화 |
|--------|------|------|------|
| 공식이 분쟁을 예방하지 못함 | 중 | 높 | Floor 12h 보장 + 분쟁 시스템은 별도 존재 |
| 판매자가 긴 기간에 이탈 | 중 | 중 | Ceiling 168h + 신뢰도 높으면 단축 인센티브 |
| 온체인 가스 비용 증가 | 낮 | 낮 | uint16 패킹으로 최소 추가 비용 |
| A/B 테스트 중 일관성 문제 | 중 | 낮 | 한번 설정된 기간은 해당 거래에서 불변 |
| Cold start 데이터 부족 | 높 | 중 | Phase 0 고정값으로 시작, 점진적 전환 |

---

## 13. 아키텍처 결정 기록 (ADR)

### ADR-1: 오프체인 계산, 온체인 주입
- **결정**: 확정 기간은 오프체인에서 계산하고 온체인에 uint16으로 주입
- **대안**: 온체인에서 모든 계수를 저장하고 계산
- **근거**: 가스 비용 절감, 공식 업데이트 유연성, 온체인 복잡도 최소화

### ADR-2: 스텝 함수 (연속 함수 대신)
- **결정**: 가격 multiplier를 6단계 스텝 함수로 구현
- **대안**: log(price) 연속 함수
- **근거**: 결정적, 온체인 검증 가능, 사용자 설명 용이

### ADR-3: 비대칭 신뢰도 영향
- **결정**: 기간 단축(최대 20%) < 기간 연장(최대 30%)
- **근거**: Non-custodial = 릴리즈 후 회수 불가 → 안전 방향 편향 필수

### ADR-4: 거래별 불변성
- **결정**: 확정 기간은 거래 생성 시 1회 설정, 이후 변경 불가
- **근거**: 예측 가능성, 양측 사전 동의, 스마트컨트랙트 결정성

### ADR-5: "Payment Protection" 용어 사용
- **결정**: escrow 대신 "Payment Protection Period" 사용
- **근거**: 법적 제약 — escrow 용어는 규제 대상

---

*Last Updated: 2026-03-27*
*Formula Version: v1*
