# Architect Brief — Haggle Internal Price Feedback Loop

*Written by Arch. 2026-04-14.*

---

## Objective

협상 완료 시 합의 가격을 `hfmi_price_observations`에 자동 적재.
Haggle 내부 거래 데이터가 쌓일수록 HFMI가 자체 데이터 기반으로 전환.

**원칙:**
- 데이터는 수집하되 협상을 강제하지 않음 (HFMI = 참고용)
- `source: 'haggle_internal'`로 외부 데이터와 구분
- 향후 Intelligence API 판매용 데이터 자산

---

## 흐름

```
negotiation.agreed 이벤트 발생
  ↓
PriceObservationSink (이벤트 핸들러)
  ↓
세션에서 추출: model, storage, condition, final_price, tag garden
  ↓
hfmi_price_observations INSERT
  source: 'haggle_internal'
  model: tag garden에서 추출
  observed_price_usd: final_price / 100
  ↓
다음 HFMI 조회 시 내부 데이터 포함
  ↓
source별 가중치: haggle_internal > ebay_sold (시간 가중 decay)
```

---

## Task A — PriceObservationSink (이벤트 핸들러)

### 신규: `apps/api/src/services/price-observation-sink.ts`

```typescript
/**
 * 협상 완료 시 합의 가격을 HFMI에 적재.
 * EventDispatcher의 'negotiation.agreed' 이벤트에 등록.
 */
export async function recordAgreedPrice(
  db: Database,
  event: {
    sessionId: string;
    finalPriceMinor: number;
    buyerId: string;
    sellerId: string;
    listingId: string;
  },
): Promise<void>
```

1. 세션 ID로 negotiation_sessions 조회 → listing_id
2. listing_id로 listings_published 조회 → 태그 가든, 카테고리
3. 태그 가든에서 model, storage_gb, cosmetic_grade 추출
4. `hfmi_price_observations` INSERT:
   - source: `'haggle_internal'`
   - model: 추출된 모델
   - storage_gb, cosmetic_grade: 추출된 값
   - observed_price_usd: `event.finalPriceMinor / 100`
   - observed_at: `new Date()`
   - external_id: `haggle_${event.sessionId}` (멱등성)
5. 실패해도 non-fatal (거래 자체는 영향 없음)

---

## Task B — EventDispatcher 등록

### 수정: `apps/api/src/lib/action-handlers.ts`

`negotiation.agreed` 이벤트에 `recordAgreedPrice` 핸들러 등록.

---

## Task C — Source 가중치 (HFMI 쿼리)

### 수정: `apps/api/src/services/hfmi.service.ts`

`getMedianPrice()` 수정:
- `haggle_internal` 소스에 가중치 2x (내부 거래 더 신뢰)
- `ebay_sold` 소스에 가중치 1x
- 시간 decay: 30일 이상 된 데이터는 가중치 50% 감소

**주의**: 가중치는 중간값 계산에만 영향. 절대 협상 제약으로 사용 안 함.

---

## Task D — 테스트

1. `price-observation-sink.test.ts` — 이벤트 → INSERT 검증
2. `hfmi.service.test.ts` — source 가중치 검증

---

## 변경하지 않는 것

- 협상 파이프라인 로직 (가격 강제 없음)
- hfmi-tag-resolver.ts (기존 계단식 쿼리 유지)
- DB 스키마 (hfmi_price_observations 이미 haggle_internal source 지원)

---

## Quality Gates

- [ ] 협상 완료 → hfmi_price_observations에 행 추가 확인
- [ ] external_id로 멱등성 보장 (중복 INSERT 방지)
- [ ] HFMI 쿼리에서 haggle_internal 데이터 포함 확인
- [ ] 실패 시 거래에 영향 없음 (non-fatal)

---

*끝. Bob은 Task A부터 시작.*
