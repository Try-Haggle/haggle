# ARCHITECT-BRIEF — Production Phase 3: UX & Operational Completeness

*Written by Arch. 2026-04-21.*
*Branch: feature/payment-shipping-dispute*

---

## Context

Phase 1 (인프라) + Phase 2 (온체인) + Richard 리뷰 수정 완료.
Phase 3은 사용자 경험 + 운영 완전성. 직접 필요한 건 제외.

---

## Step 88 — 주문 목록 페이지

**Goal**: 사용자가 자기 주문을 목록으로 볼 수 있는 페이지.

**현황**: `apps/web/src/app/(app)/orders/[id]/page.tsx` (상세만 있음)

**작업**:
1. `apps/api/src/routes/orders.ts`에 `GET /orders` 추가
   - requireAuth
   - query params: `role` (buyer|seller|all, default all), `status` (optional filter)
   - buyer_id 또는 seller_id === user.id인 주문 반환
   - 페이지네이션: `limit` (default 20, max 50), `offset`
   - 정렬: created_at DESC
   - 응답: `{ orders: [...], total, limit, offset }`

2. `apps/web/src/app/(app)/orders/page.tsx` 생성
   - 탭: "구매" / "판매" / "전체"
   - 각 주문 카드: 아이템명, 가격, 상태 뱃지, 상대방 이름, 날짜
   - 상태별 필터 드롭다운
   - 빈 상태 처리 ("아직 주문이 없습니다")
   - 클릭 → `/orders/[id]` 상세로 이동

---

## Step 89 — Buyer/Seller 역할별 라우트 제한

**Goal**: 이미 Step 83에서 소유권 미들웨어 구축. 여기서는 남은 엔드포인트에 역할 제한 추가.

**현황**: Step 83 + Richard 리뷰에서 대부분 완료됨.

**작업**: 남은 엔드포인트 점검 + 추가 제한:
1. `POST /shipments/:id/prepare` — seller only (이미 적용 확인)
2. `POST /shipments/:id/purchase-label` — seller only (확인)
3. `POST /orders/:orderId/confirm-delivery` — buyer only (확인)
4. `POST /disputes` — opened_by 서버 결정 (Richard 수정으로 완료)
5. `GET /shipments/by-order/:orderId` — 양측 허용, 인증 필수

주로 검증 + 누락 보완.

---

## Step 90 — 실제 환불 실행

**Goal**: 분쟁 해결로 buyer_favor일 때 실제 USDC를 구매자에게 반환.

**현황**: 
- `apps/api/src/routes/disputes.ts` resolve에서 `refundIntent()` 호출
- mock 모드에서는 DB 기록만
- gas-relayer.ts, deposit-refunder.ts 패턴 존재

**작업**:
1. `apps/api/src/payments/refund-executor.ts` 생성
   - `executeRefund(params)` — 환불 rail 결정 (USDC or Stripe)
   - USDC: escrow에서 buyer 지갑으로 transfer (gas-relayer 사용)
   - Stripe: Stripe Refund API 호출
   - `REFUND_MODE` env var: 'usdc' | 'stripe' | 'mock' (default 'mock')

2. `apps/api/src/routes/disputes.ts` resolve에서 환불 실행 연동
   - buyer_favor → executeRefund() fire-and-forget
   - partial_refund → executeRefund(partial amount) fire-and-forget
   - refund 결과를 refunds 테이블에 기록

**보안**: 
- 환불 금액은 서버 계산 (escrow amount or partial amount)
- USDC balance 확인 후 전송
- 이중 환불 방지: refund status check

---

## Step 91 — 반품 라벨 흐름

**Goal**: 분쟁으로 buyer_favor 결과 시 buyer가 물건을 seller에게 반환하는 배송.

**현황**: shipping-core 상태머신에 RETURN_IN_TRANSIT, RETURNED 상태 존재.

**작업**:
1. `POST /shipments/:id/return-label` 엔드포인트 추가
   - requireAuth + buyer only
   - 선행: 분쟁 결과가 buyer_favor
   - from_address = buyer (order_addresses), to_address = seller (order_addresses)
   - EasyPost로 return label 생성
   - 새 shipment 레코드 (type: 'return') 또는 기존 shipment에 return 필드 추가

2. shipments 테이블에 `shipment_type` 컬럼 추가 ('outbound' | 'return', default 'outbound')
   - 마이그레이션 `0017_shipment_type.sql`

3. 반품 배송 완료 시 → 정산 최종 완료 트리거

---

## Build Order

```
Step 88 (주문 목록) ←── 독립, 바로 시작
  ↓
Step 89 (역할 제한 점검) ←── 빠르게 확인만, 독립
  ↓
Step 90 (환불 실행) ←── 독립
  ↓
Step 91 (반품 라벨) ←── Step 90 이후 (환불 흐름과 연결)
```

88~90 병렬 가능. 91만 90 이후.

**Bob 시작: Step 88부터 순차.**

---

## Richard Checklist

- [ ] 주문 목록 API: 본인 주문만 반환 (buyer_id/seller_id 필터)
- [ ] 페이지네이션: limit max 50 (DoS 방지)
- [ ] 환불 금액 서버 계산, 이중 환불 방지
- [ ] 반품 라벨: buyer_favor 분쟁 결과 확인 후에만 생성 가능
- [ ] 반품 주소: order_addresses에서 가져옴 (사용자 입력 아님)

---

*Arch out. Bob 스핀업.*
