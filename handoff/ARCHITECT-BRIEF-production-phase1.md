# ARCHITECT-BRIEF — Production Phase 1: Commerce Infrastructure

*Written by Arch. 2026-04-20.*
*Branch: feature/payment-shipping-dispute*
*Ref: docs/wip/production-gap-analysis.md*

---

## Context

Payment/Shipping/Dispute의 API 라우트, DB 스키마, 도메인 패키지는 모두 구현 완료.
Step 70~73에서 DB 마이그레이션, EIP-712 서명, 배포 스크립트, Stripe 어댑터 완료.

이 브리프는 "직접 안 해도 되는" 코드 작업만 다룬다.
키 발급 (컨트랙트 배포 키, Stripe 프로덕션 모드 등)은 제외.

---

## Step 80 — 주소 수집 테이블 + API

**Goal**: 구매자/판매자 배송 주소를 저장하고 조회하는 인프라.

**현황**:
- 배송 라우트(`POST /shipments/rates`)가 주소를 인자로 받지만 DB에 저장하지 않음
- 주소 테이블이 전혀 없음
- `packages/db/src/schema/` 에 address 관련 스키마 없음

**작업**:

1. `packages/db/src/schema/addresses.ts` 생성
```typescript
// order_addresses 테이블
{
  id: uuid PK,
  order_id: uuid FK → commerce_orders(id),
  role: text ('buyer' | 'seller'),
  name: text NOT NULL,
  company: text,
  street1: text NOT NULL,
  street2: text,
  city: text NOT NULL,
  state: text NOT NULL,
  zip: text NOT NULL,
  country: text NOT NULL DEFAULT 'US',
  phone: text,
  email: text,
  verified: boolean DEFAULT false,
  created_at: timestamp DEFAULT now(),
  updated_at: timestamp DEFAULT now(),
  
  UNIQUE(order_id, role)  -- 한 주문당 buyer/seller 각 1개
}
```

2. `packages/db/src/schema/user-addresses.ts` 생성 (저장된 주소록)
```typescript
// user_saved_addresses 테이블
{
  id: uuid PK,
  user_id: uuid FK → users(id),
  label: text ('home' | 'work' | 'custom'),
  name: text NOT NULL,
  street1: text NOT NULL,
  street2: text,
  city: text NOT NULL,
  state: text NOT NULL,
  zip: text NOT NULL,
  country: text NOT NULL DEFAULT 'US',
  phone: text,
  is_default: boolean DEFAULT false,
  created_at: timestamp DEFAULT now(),
}
```

3. `packages/db/drizzle/0014_addresses.sql` 마이그레이션 작성

4. `apps/api/src/routes/addresses.ts` API 라우트:
   - `POST /orders/:orderId/addresses` — 주소 저장 (buyer 또는 seller)
   - `GET /orders/:orderId/addresses` — 주문의 buyer/seller 주소 조회
   - `GET /users/me/addresses` — 내 저장된 주소록
   - `POST /users/me/addresses` — 주소 저장
   - `PUT /users/me/addresses/:id` — 수정
   - `DELETE /users/me/addresses/:id` — 삭제

5. `apps/api/src/server.ts`에 라우트 등록

**Constraints**:
- Phase 0은 US only → country는 'US' 기본값, 하지만 필드는 범용으로
- 주소 validation: zip은 5자리, state는 2글자 약어 (서버에서 검증)
- 인증 필수: requireAuth 미들웨어
- 소유권 검증: order의 buyer_id 또는 seller_id === request.user.id

**Validation**:
- `pnpm --filter @haggle/db typecheck` 통과
- API 라우트 등록 후 `pnpm --filter @haggle/api typecheck` 통과
- 마이그레이션 SQL 문법 오류 없음

---

## Step 81 — 구매자 수령 확인 API Endpoint

**Goal**: 구매자가 "물건 받았고 이상 없음"을 확인하는 전용 엔드포인트.

**현황**:
- `packages/payment-core/src/settlement-release.ts` — `confirmDelivery()` 함수 존재
- `apps/api/src/routes/payments.ts` — 내부에서 호출하지만 독립 엔드포인트 없음
- 프론트엔드 checkout-flow.tsx에서 "Confirm & release" 버튼은 데모 용도

**작업**:

1. `apps/api/src/routes/orders.ts`에 엔드포인트 추가:
   - `POST /orders/:orderId/confirm-delivery`
   - Request body: `{ confirmed: true, notes?: string }`
   - 동작:
     a. 주문 조회 → buyer_id === request.user.id 검증
     b. 주문 상태가 DELIVERED인지 검증
     c. `confirmDelivery()` 호출 → settlement_release 상태 전이
     d. 주문 상태 → BUYER_CONFIRMED
     e. 응답: `{ order, settlement_release }`

2. 관련 상태 전이 검증:
   - DELIVERED → BUYER_CONFIRMED (정상)
   - 그 외 상태 → 400 에러

**Constraints**:
- 인증 필수 (requireAuth)
- buyer만 호출 가능 (order.buyer_id === user.id)
- 이미 확인된 주문에 재호출 시 200 (멱등)
- 확인 후 settlement auto-release가 트리거됨 (Step 82 선행 필요하지만, 호출은 가능)

**Validation**:
- 타입체크 통과
- 존재하지 않는 주문 → 404
- 남의 주문 → 403
- 이미 확인됨 → 200 (멱등)

---

## Step 82 — 백그라운드 잡 인프라 + Settlement Auto-Release

**Goal**: 시간 기반 자동화를 위한 크론 잡 프레임워크 구축 + 첫 번째 잡 구현.

**현황**:
- `apps/api/src/jobs/hfmi-ingest.ts`, `hfmi-fit.ts` — 기존 잡 2개 존재 (참고용)
- API 서버: Hono on Node.js
- 배포: Railway (cron job 지원)

**작업**:

1. `apps/api/src/jobs/index.ts` — 잡 레지스트리 생성
```typescript
interface CronJob {
  name: string;
  schedule: string;  // cron expression
  handler: () => Promise<void>;
  enabled: boolean;
}

export const CRON_JOBS: CronJob[] = [...]
```

2. `apps/api/src/jobs/runner.ts` — 잡 실행기
   - `node-cron` 사용 (이미 node 환경)
   - 각 잡에 try-catch + 에러 로깅
   - 잡 실행 시작/완료 로그
   - 환경변수 `ENABLE_CRON=true`일 때만 활성화

3. `apps/api/src/jobs/settlement-auto-release.ts` — 첫 번째 잡
   - 스케줄: `*/5 * * * *` (5분마다)
   - 로직:
     a. `settlement_releases WHERE product_release_status = 'BUYER_REVIEW' AND buyer_review_deadline < NOW()` 조회
     b. 각각에 대해 `BUYER_REVIEW → RELEASED` 전이
     c. 연관 commerce_order 상태를 `COMPLETED`로 업데이트
   - 로그: `[auto-release] Released N settlement(s)`

4. `apps/api/src/jobs/payment-intent-expiry.ts`
   - 스케줄: `*/15 * * * *` (15분마다)
   - 로직: `payment_intents WHERE status IN ('CREATED','QUOTED') AND created_at < NOW() - INTERVAL '1 hour'` → CANCELED

5. `apps/api/src/jobs/shipment-sla-check.ts`
   - 스케줄: `*/15 * * * *`
   - 로직: `shipments WHERE status = 'LABEL_PENDING' AND shipment_input_due_at < NOW()` → 자동 분쟁 생성

6. `apps/api/src/jobs/dispute-deposit-expiry.ts`
   - 스케줄: `0 * * * *` (매 정시)
   - 로직: 기존 `POST /disputes/deposits/expire` 엔드포인트의 로직을 잡으로 호출

7. `apps/api/src/server.ts`에서 서버 시작 시 `initCronJobs()` 호출

**Constraints**:
- 각 잡은 독립적 (하나 실패해도 다른 잡 영향 없음)
- 잡 내에서 대량 처리 시 batch size 제한 (한번에 100건)
- 잡 실행 중복 방지: 간단한 in-memory lock (단일 인스턴스 전제)
- 테스트: 잡 로직은 별도 함수로 분리 → 유닛 테스트 가능

**Validation**:
- 타입체크 통과
- `ENABLE_CRON=false`일 때 잡이 등록되지 않음
- 각 잡 함수가 독립 호출 가능 (레지스트리 없이도 직접 실행 가능)

---

## Step 83 — 리소스 소유권 미들웨어

**Goal**: 인증된 사용자가 자기 주문/결제/배송에만 접근 가능하도록 보장.

**현황**:
- `requireAuth` 미들웨어 존재 (JWT 검증)
- `requireAdmin` 미들웨어 존재
- 리소스 소유권 검증 없음 — 아무 유저나 다른 사람의 orderId로 API 호출 가능

**작업**:

1. `apps/api/src/middleware/ownership.ts` 생성
```typescript
/**
 * 주문 기반 소유권 검증 미들웨어.
 * URL param에서 orderId를 추출, DB에서 order 조회,
 * request.user.id가 buyer_id 또는 seller_id인지 확인.
 */
export function requireOrderOwner(opts?: { role?: 'buyer' | 'seller' }) { ... }

/**
 * 분쟁 기반 소유권 — dispute의 order를 통해 확인.
 */
export function requireDisputeParty() { ... }

/**
 * 결제 기반 소유권 — payment_intent의 order를 통해 확인.
 */
export function requirePaymentOwner() { ... }
```

2. 라우트에 적용:
   - `POST /orders/:orderId/confirm-delivery` — requireOrderOwner({ role: 'buyer' })
   - `POST /orders/:orderId/addresses` — requireOrderOwner()
   - `POST /disputes/:id/escalate` — requireDisputeParty() (이미 부분 구현됨, 통합)
   - `POST /shipments/:id/label` — requireOrderOwner({ role: 'seller' }) (shipment → order 조회)
   - `POST /payments/:id/settle` — requirePaymentOwner()

3. 실패 시 응답: `403 Forbidden` with `{ error: "not_authorized", message: "You do not own this resource" }`

**Constraints**:
- Admin은 항상 통과 (requireAdmin이 먼저 통과한 경우)
- DB 조회는 캐시하지 않음 (실시간 일관성 우선)
- 미들웨어가 order를 조회하면 `request.order`에 attach (이후 핸들러에서 재조회 방지)

**Validation**:
- 타입체크 통과
- 남의 리소스 접근 시 403
- 본인 리소스 접근 시 정상 통과
- Admin은 모든 리소스 접근 가능

---

## Step 84 — 판매자 배송 입력 + 라벨 구매 흐름

**Goal**: 결제 완료 후 판매자가 패키지 정보 입력 → 배송 라벨 구매까지의 흐름.

**현황**:
- `POST /shipments/:id/label` 존재 — EasyPost createLabel 호출
- `POST /shipments/rates` 존재 — rate shopping
- 누락: 판매자가 from_address + parcel 정보 입력 → rate 선택 → label 구매의 통합 흐름
- 누락: 주소 저장 (Step 80 선행)

**작업**:

1. `POST /shipments/:id/prepare` 엔드포인트 추가
   - Request body:
     ```json
     {
       "from_address_id": "uuid",  // user_saved_addresses에서 선택하거나
       "from_address": { ... },    // 직접 입력
       "parcel": {
         "length_in": number,
         "width_in": number,
         "height_in": number,
         "weight_oz": number
       }
     }
     ```
   - 동작:
     a. 소유권 검증 (seller of this order)
     b. from_address를 order_addresses에 저장 (role: 'seller')
     c. to_address는 order_addresses에서 buyer 조회
     d. shipment 레코드에 parcel 정보 업데이트
     e. EasyPost rate shopping 실행 (`POST /shipments/rates` 로직 재사용)
     f. 결과: `{ shipment, rates: Rate[] }`

2. `POST /shipments/:id/purchase-label` 엔드포인트 추가
   - Request body: `{ rate_id: string }`
   - 동작:
     a. 소유권 검증 (seller)
     b. 선택된 rate로 EasyPost buy label
     c. shipment 상태: `LABEL_PENDING → LABEL_CREATED`
     d. label_url, tracking_number 저장
     e. 결과: `{ shipment, label_url, tracking_number }`

3. shipments 테이블에 parcel 컬럼 추가 (이미 있으면 확인):
   - `parcel_length_in`, `parcel_width_in`, `parcel_height_in`, `parcel_weight_oz`
   - 마이그레이션: `0015_shipment_parcel_columns.sql` (ALTER TABLE ADD COLUMN)

**Constraints**:
- from_address 미입력 시 user의 default 주소 사용
- to_address(buyer)가 없으면 400 에러 ("Buyer has not provided shipping address")
- Rate 선택 후 24시간 내 구매해야 함 (EasyPost rate 유효기간)
- 라벨 구매 후 shipment_input_due_at 체크 불필요 (이미 충족)

**Validation**:
- Step 80 (주소 테이블) 선행 완료 필요
- Step 83 (소유권 미들웨어) 적용
- 타입체크 통과

---

## Build Order

```
Step 80 (주소 DB + API)
  ↓
Step 81 (수령 확인 API) ←── 독립 가능, 80과 병렬 OK
  ↓
Step 82 (크론 잡 인프라) ←── 독립, 바로 시작 가능
  ↓
Step 83 (소유권 미들웨어) ←── 독립, 바로 시작 가능
  ↓
Step 84 (배송 입력 흐름) ←── Step 80 + 83 선행 필요
```

**병렬 가능:**
- 80 + 81 + 82 + 83 동시 시작 가능
- 84는 80 + 83 완료 후

**Bob 시작: Step 80부터.**
Step 80 완료 확인 후 → Step 81~83 병렬 → Step 84.

---

## Richard Checklist (코드 리뷰 시)

- [ ] 주소 테이블에 SQL injection 방지 (parameterized queries → Drizzle ORM이므로 자동)
- [ ] 소유권 미들웨어가 모든 mutation 라우트에 적용됐는지
- [ ] 크론 잡이 실패해도 서버 크래시 안 하는지
- [ ] 크론 잡의 batch size 제한 (OOM 방지)
- [ ] 배송 라벨 구매 시 중복 구매 방지 (idempotency)
- [ ] buyer_review_deadline이 UTC로 일관되게 처리되는지
- [ ] 마이그레이션에 `IF NOT EXISTS` 적용

---

*Arch out. Bob 스핀업 대기.*
