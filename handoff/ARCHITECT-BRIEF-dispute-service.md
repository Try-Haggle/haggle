# ARCHITECT-BRIEF — Real Dispute Service

*Written by Arch. 2026-04-21.*
*Branch: feature/payment-shipping-dispute*

---

## 현황 분석

### 이미 있는 것

**백엔드 (거의 완성):**
- `POST /disputes` — 분쟁 생성 (소유권 검증 + opened_by 서버 결정)
- `GET /disputes/:id` — 분쟁 상세 (requireDisputeParty)
- `GET /disputes/by-order/:orderId` — 주문별 분쟁 조회
- `POST /disputes/:id/evidence` — 증거 추가
- `POST /disputes/:id/evidence/upload-url` — presigned upload URL
- `POST /disputes/:id/evidence/commit` — 업로드 확인
- `GET /disputes/:id/evidence/:eid/view` — 증거 조회 URL
- `POST /disputes/:id/review` — 리뷰 시작
- `POST /disputes/:id/escalate` — T2/T3 에스컬레이션
- `POST /disputes/:id/deposit` — 보증금 결제
- `POST /disputes/:id/deposit/confirm-usdc` — USDC 보증금 확인
- `POST /disputes/:id/resolve` — 해결 (앵커링 + 환불 fire-and-forget)
- `POST /disputes/:id/close` — 종료
- 크론 잡: deposit-expiry, shipment-sla-check
- dispute-core: 상태머신, 비용 계산, 투표 집계, DS 점수 (전부 테스트됨)

**프론트엔드 (부분적):**
- `/(app)/disputes/[id]` — 상세 페이지 (다크 테마, 기본 기능)
- `/(app)/disputes/new` — 분쟁 제기 폼
- `/(app)/disputes/[id]/dispute-detail.tsx` — 클라이언트 컴포넌트 (증거 추가, 에스컬레이션, 해결)
- ❌ `/disputes` 목록 페이지 없음
- ❌ 리뷰어 실서비스 페이지 없음
- ❌ AI Advocate 채팅 없음

**없는 것 (이번 브리프 범위):**

| # | 항목 | 크기 | 설명 |
|---|------|------|------|
| 1 | `GET /disputes` 목록 API | S | 사용자 분쟁 목록 (buyer/seller 필터) |
| 2 | `/disputes` 목록 페이지 | M | API 연동, 탭 + 필터 + 상태 뱃지 |
| 3 | 분쟁 상세 업그레이드 | M | 타임라인, AI Advocate, 비용 카드 추가 |
| 4 | DS 패널 투표 API | L | 리뷰어 배정, 투표 제출, 결과 집계 |
| 5 | 리뷰어 실서비스 페이지 | L | 대시보드 + 투표 + 퀄리파이 (API 연동) |

---

## Step 92 — `GET /disputes` 목록 API

**Goal**: 인증된 사용자의 분쟁 목록 조회.

**작업**: `apps/api/src/routes/disputes.ts`에 추가

```
GET /disputes
  - requireAuth
  - query: role (buyer|seller|all), status (optional), limit (max 50), offset
  - WHERE: order의 buyer_id 또는 seller_id = user.id
  - JOIN: commerce_orders (아이템명, 금액 가져오기)
  - ORDER BY: 행동 필요한 건 먼저 (WAITING > OPEN > UNDER_REVIEW > RESOLVED > CLOSED), then created_at DESC
  - 응답: { disputes: [...], total, limit, offset }
```

각 dispute에 포함:
```typescript
{
  id, order_id, case_id_short, // "#DSP-XXXX"
  reason_code, status, tier,
  opened_by, opened_at,
  user_role: "buyer" | "seller", // 이 사용자의 역할
  counterparty: { name, trust_score },
  item: { title, amount_minor },
  needs_action: boolean, // 이 사용자가 행동해야 하는가
  action_deadline?: string, // 마감 시간 (있으면)
  resolution?: { outcome, refund_amount_minor },
  anchor_tx_hash?: string, // 온체인 앵커링 해시
}
```

**DB 조인**: dispute_cases → commerce_orders (order_id FK) → settlement_approvals (아이템/금액)

---

## Step 93 — `/disputes` 목록 페이지

**Goal**: `apps/web/src/app/(app)/disputes/page.tsx` — 실서비스 분쟁 목록.

**현황**: 데모 `/demo/dispute/disputes`에 정적 버전 있음 (701줄). 이걸 API 연동 버전으로 변환.

**작업**:
1. 기존 데모 `disputes/page.tsx`의 디자인을 그대로 사용하되 (app) 라우트 그룹에 배치
2. API `GET /disputes` 호출하여 실데이터 표시
3. 탭 (All/Buyer/Seller), 필터 (status, tier), 정렬, 페이지네이션 모두 동작
4. 각 행 클릭 → `/disputes/[id]`로 이동

**테마**: 기존 `(app)` 라우트는 **다크 테마** (Nav 컴포넌트 사용). 데모는 라이트였지만 실서비스는 다크에 맞춤.

---

## Step 94 — 분쟁 상세 업그레이드

**Goal**: 기존 `disputes/[id]/dispute-detail.tsx` (250줄)에 데모에서 본 섹션들 추가.

**추가할 섹션**:
1. **타임라인** — 5단계 진행 바 (현재 상태 기반 자동 계산)
2. **비용 카드** — T1/T2/T3 비용 표시 (computeDisputeCost 호출)
3. **Activity log** — 상태 변경 이력 (dispute metadata에서 추출 or 별도 조회)
4. **T2 패널 상태** — 에스컬레이션 시 리뷰어 수/투표 진행 표시
5. **역할별 뷰 분기** — buyer 뷰 / seller 뷰 자동 전환 (서버에서 user_role 내려줌)

**AI Advocate는 이번 범위에서 제외** — Step 94는 정적 정보 표시만. AI 채팅은 Phase 2.

---

## Step 95 — DS 패널 투표 API

**Goal**: T2/T3 에스컬레이션 시 리뷰어 배정 + 투표 + 결과 집계 API.

**DB 테이블 필요**:

```sql
-- reviewer_assignments: 분쟁별 리뷰어 배정
CREATE TABLE reviewer_assignments (
  id uuid PK DEFAULT gen_random_uuid(),
  dispute_id uuid NOT NULL REFERENCES dispute_cases(id),
  reviewer_id uuid NOT NULL REFERENCES auth.users(id),
  slot_cost integer NOT NULL DEFAULT 1,
  assigned_at timestamp with time zone DEFAULT now(),
  vote_value integer,           -- 0-100 (null = not yet voted)
  vote_weight numeric(4,2),     -- DS tier weight at time of assignment
  voted_at timestamp with time zone,
  reasoning text,               -- optional brief reasoning
  UNIQUE(dispute_id, reviewer_id)
);

-- reviewer_profiles: 리뷰어 DS 프로필 (캐시)
CREATE TABLE reviewer_profiles (
  user_id uuid PK REFERENCES auth.users(id),
  ds_score integer NOT NULL DEFAULT 0,
  ds_tier text NOT NULL DEFAULT 'BRONZE',
  vote_weight numeric(4,2) NOT NULL DEFAULT 0.63,
  cases_reviewed integer NOT NULL DEFAULT 0,
  zone_hit_rate numeric(4,3) DEFAULT 0,
  participation_rate numeric(4,3) DEFAULT 0,
  avg_response_hours numeric(6,1) DEFAULT 48,
  active_slots integer NOT NULL DEFAULT 0,
  qualified boolean NOT NULL DEFAULT false,
  qualified_at timestamp with time zone,
  total_earnings_cents integer NOT NULL DEFAULT 0,
  created_at timestamp with time zone DEFAULT now(),
  updated_at timestamp with time zone DEFAULT now()
);
```

**API 엔드포인트**:

```
POST /disputes/:id/assign-reviewers
  - admin/system only (에스컬레이션 시 자동 호출)
  - dispute-core의 reviewer count 계산
  - reviewer_profiles에서 자격 있는 리뷰어 선택 (ES 알고리즘)
  - reviewer_assignments 레코드 생성

GET /reviewer/assignments
  - requireAuth (리뷰어 본인)
  - 배정된 케이스 목록 (active/voted/decided 탭)

GET /reviewer/assignments/:disputeId
  - requireAuth (배정된 리뷰어만)
  - 케이스 상세 (중립 브리핑, 양측 증거, 투표 UI 데이터)

POST /reviewer/assignments/:disputeId/vote
  - requireAuth (배정된 리뷰어만)
  - body: { vote: 0-100, reasoning?: string }
  - 투표 저장 + 전원 투표 완료 시 자동 집계 트리거

POST /disputes/:id/tally
  - admin/system only (전원 투표 완료 or 데드라인 도달)
  - dispute-core의 aggregateVotes() 호출
  - 결과에 따라 dispute resolve 호출
  - 보상 분배 계산

GET /reviewer/profile
  - requireAuth (리뷰어 본인)
  - DS 점수, 등급, 수입, 전문성 등

POST /reviewer/qualify
  - requireAuth
  - body: { votes: [{ case_id, vote }] }
  - 퀄리파이 테스트 결과 계산 + 자격 부여
```

**에스컬레이션 → 배정 → 투표 → 집계 흐름**:
```
POST /disputes/:id/escalate
  → 보증금 확인
  → POST /disputes/:id/assign-reviewers (자동)
  → 리뷰어에게 알림
  → 리뷰어가 GET /reviewer/assignments → POST vote
  → 전원 투표 or 데드라인
  → POST /disputes/:id/tally (자동)
  → POST /disputes/:id/resolve (자동)
```

---

## Step 96 — 리뷰어 실서비스 페이지

**Goal**: `(app)/reviewer/` 라우트에 실서비스 리뷰어 페이지.

**페이지 3개**:
1. `/(app)/reviewer/page.tsx` — 대시보드 (GET /reviewer/profile + GET /reviewer/assignments)
2. `/(app)/reviewer/cases/[id]/page.tsx` — 투표 페이지 (GET /reviewer/assignments/:id + POST vote)
3. `/(app)/reviewer/qualify/page.tsx` — 퀄리파이 테스트 (POST /reviewer/qualify)

데모 페이지 디자인 재사용하되 API 연동으로 전환. (app) 라우트 = 다크 테마.

---

## Build Order

```
Step 92 (목록 API) → Step 93 (목록 페이지)
       ↓
Step 94 (상세 업그레이드) ←── 독립
       ↓
Step 95 (패널 투표 API) → Step 96 (리뷰어 페이지)
```

**Phase 1 (이번):** Step 92 + 93 + 94 — 분쟁 당사자 경험 완성
**Phase 2 (다음):** Step 95 + 96 — 리뷰어 시스템 (더 큰 범위)

**Bob 시작: Step 92부터.**

---

## Richard Checklist

- [ ] GET /disputes: 본인 분쟁만 반환 (buyer_id/seller_id 필터)
- [ ] 페이지네이션 limit max 50
- [ ] reviewer_assignments: 배정된 리뷰어만 투표 가능
- [ ] 투표: 0-100 범위 검증, 중복 투표 방지
- [ ] 집계: 전원 투표 or 데드라인 조건 검증
- [ ] 보상 분배: 다수파만, 금액 서버 계산
- [ ] 리뷰어 자격: 거래 5건 + Trust 50 + 퀄리파이 70%

---

*Arch out. Bob 스핀업 — Step 92부터.*
