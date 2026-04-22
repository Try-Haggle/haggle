# A1 — Dispute List Page · Claude Design Prompt

> For Claude Design Tool. Single HTML page.
> Shares the Haggle dispute design system (Inter + JetBrains Mono, warm cream #faf9f6 background).
> 참고: 이전에 만든 dispute-buyer.html, dispute-seller.html의 디자인 톤과 동일.

---

## 이 페이지가 뭔가

사용자의 **내 분쟁 목록**. 주문에서 문제가 생기면 분쟁을 열 수 있고, 이 페이지에서 내 모든 분쟁을 한눈에 관리한다. 분쟁을 제기한 것(buyer)과 받은 것(seller) 모두 여기에 보인다.

**진입점**: 앱 네비게이션 "Disputes" 메뉴, 또는 주문 상세에서 "View dispute" 링크.

---

## 디자인 방향

- **톤**: 법률 사무소 + 핀테크. 진지하지만 위압적이지 않음.
- **핵심**: 스캔 가능성. 10개 분쟁이 있어도 3초 안에 "어떤 게 내 행동이 필요한 건지" 파악 가능해야 함.
- **컬러 시맨틱**: 상태별 색상이 핵심 정보 전달 수단.
  - Amber #b45309 → OPEN, 대기 중
  - Cyan #0891b2 → UNDER_REVIEW, AI 검토 중
  - Violet #7c3aed → WAITING (내 응답 필요)
  - Emerald #059669 → RESOLVED (해결됨)
  - Slate #475569 → CLOSED
  - Red #dc2626 → 긴급 (마감 임박)

---

## 페이지 구조

### Top Bar (기존 앱 네비게이션 재사용)
```
[H] Haggle     Orders  Disputes(active)  Settings     [avatar]
```
"Disputes"가 active 상태.

### Page Header
```
┌─────────────────────────────────────────────────────────────┐
│  Resolution Center                                          │
│                                                              │
│  ⚖️  My Disputes                                             │
│  Track and manage your open and resolved cases.              │
│                                                              │
│  ┌──────────────────────────────┐                           │
│  │ [All · 7] [Buyer · 4] [Seller · 3] │    [🔍 Search]     │
│  └──────────────────────────────┘                           │
└─────────────────────────────────────────────────────────────┘
```
- 제목: "My Disputes" (큰 텍스트, font-semibold)
- 서브텍스트: 간단한 설명
- 탭: All / Buyer (내가 제기한) / Seller (내가 받은) — 각 탭에 건수 뱃지
- 검색: 케이스 ID나 아이템명으로 필터

### Filter Bar
```
Status: [All ▾]  Tier: [All ▾]  Sort: [Newest first ▾]
```
- 상태 필터: Open, Under review, Waiting, Resolved, Closed
- Tier 필터: T1, T2, T3
- 정렬: Newest / Oldest / Amount high→low

### Dispute Cards (핵심)

각 분쟁은 카드로 표시. **두 가지 상태에 따라 다르게 보임:**

#### 카드 A: 내 행동 필요 (urgent)
```
┌─ amber border-left ──────────────────────────────────────────┐
│                                                               │
│  ⚠️ Response required                         #DSP-2847      │
│  ─────────────────────────────────────────────────────        │
│  iPhone 14 Pro 128GB                          $500.00         │
│                                                               │
│  [WAITING · T1]  Reason: Item not as described                │
│                                                               │
│  Your role: Seller · Buyer: @jenny_lee (Trust 88)             │
│  Opened: Apr 19, 2026                                         │
│                                                               │
│  ⏰ Respond by Apr 21 · 14:32 UTC (36h remaining)             │
│                                                               │
│  [Respond →]                                                  │
└───────────────────────────────────────────────────────────────┘
```
- 왼쪽 보더: amber (응답 필요) 또는 red (마감 12시간 이내)
- 상단: "Response required" 또는 "Escalation available" 같은 행동 알림
- 케이스 ID: JetBrains Mono, 우측 상단
- 아이템 + 금액: 큰 텍스트
- 상태 pill + 사유
- 역할 정보: 내가 buyer인지 seller인지, 상대방 이름 + Trust 점수
- 마감 카운트다운: 남은 시간 (amber 텍스트, 12시간 이내면 red)
- CTA 버튼: "Respond →" 또는 "View decision →"

#### 카드 B: 대기 중 (no action needed)
```
┌─ cyan border-left ───────────────────────────────────────────┐
│                                                               │
│  iPhone 14 Pro 128GB                 #DSP-2847    $500.00     │
│                                                               │
│  [UNDER REVIEW · T1]  Reason: Item not as described           │
│                                                               │
│  Your role: Buyer · Seller: @mike_deals (Trust 72)            │
│  Opened: Apr 19, 2026 · Decision expected in ~8 min           │
│                                                               │
└───────────────────────────────────────────────────────────────┘
```
- 왼쪽 보더: 상태별 색상 (cyan=review, emerald=resolved)
- 더 컴팩트: 행동 알림 없음, 마감 카운트다운 없음
- "Decision expected in ~8 min" 같은 ETA 표시

#### 카드 C: 해결됨
```
┌─ emerald border-left ────────────────────────────────────────┐
│                                                               │
│  iPhone 14 Pro 128GB                 #DSP-2847    $500.00     │
│                                                               │
│  [RESOLVED · Buyer favor]  Refund: $500.00                    │
│                                                               │
│  Your role: Buyer · Resolved Apr 22, 2026                     │
│  ⛓ Anchored on-chain · tx 0x8f2a...b7c1                      │
│                                                               │
└───────────────────────────────────────────────────────────────┘
```
- emerald 보더
- 결과 표시: "Buyer favor" / "Seller favor" / "Partial refund $150"
- 온체인 앵커링 표시 (있으면)

### Empty State
```
┌─────────────────────────────────────────────────────────────┐
│                                                              │
│  ⚖️                                                          │
│  No disputes yet                                             │
│  When you open or receive a dispute, it will appear here.    │
│                                                              │
└─────────────────────────────────────────────────────────────┘
```

### Summary Stats (상단 또는 사이드)
```
┌────────┐ ┌────────┐ ┌────────┐ ┌────────┐
│   2    │ │   1    │ │   1    │ │   3    │
│ Open   │ │ Review │ │ Waiting│ │Resolved│
└────────┘ └────────┘ └────────┘ └────────┘
```
- 4개 stat 카드: Open / Under Review / Waiting / Resolved 건수
- 숫자는 JetBrains Mono, 큰 사이즈
- 각각 상태별 색상 적용

### Pagination
```
Showing 1-10 of 23 disputes     [← Previous]  [Next →]
```

---

## 인터랙션

- 카드 전체가 클릭 가능 → `/disputes/[id]` (분쟁 상세)로 이동
- 카드 hover: 약간 lift (translateY -1px + shadow 증가)
- 탭 전환: 즉시 필터 (클라이언트 사이드 or 쿼리 파라미터)
- 필터 변경: URL 쿼리 파라미터 업데이트 (브라우저 뒤로가기 지원)

---

## 반응형

- **Desktop (>1024px)**: stat 카드 4열 + 분쟁 카드 리스트
- **Tablet (768-1024px)**: stat 카드 2열
- **Mobile (<768px)**: stat 카드 2열, 카드 내 메타정보 축소, 필터 드롭다운으로 변환

---

## 샘플 데이터 (7건)

1. **#DSP-2847** · iPhone 14 Pro · $500 · WAITING_FOR_SELLER · T1 · Seller role · 36h remaining
2. **#DSP-2851** · AirPods Pro · $180 · UNDER_REVIEW · T1 · Buyer role · ~5 min ETA
3. **#DSP-2839** · Galaxy S23 Ultra · $720 · OPEN · T2 · Buyer role · 패널 투표 중 (3/5)
4. **#DSP-2815** · MacBook Air M2 · $950 · RESOLVED_BUYER_FAVOR · T1 · Buyer role · 환불 $950
5. **#DSP-2802** · Nike Dunk Low · $130 · RESOLVED_SELLER_FAVOR · T2 · Seller role
6. **#DSP-2798** · iPad Mini 6 · $340 · PARTIAL_REFUND · T1 · Buyer role · 부분환불 $85
7. **#DSP-2790** · iPhone 13 · $350 · CLOSED · T1 · Seller role

---

## 디자인 시스템 참고

**이전 파일 참고**: `dispute-buyer.html`의 topbar, card, pill 컴포넌트를 동일하게 사용.

**색상 토큰 (dispute-specific):**
```
--bg: #faf9f6          (warm cream background)
--card: #ffffff         (card background)
--ink: #111113          (primary text)
--muted: #6b6b75        (secondary text)
--line: #eae7df         (borders)

--status-open: #b45309   (amber)
--status-review: #0891b2 (cyan)
--status-waiting: #7c3aed (violet)
--status-resolved: #059669 (emerald)
--status-closed: #475569  (slate)
--status-urgent: #dc2626  (red)
```

**Status Pill 컴포넌트:**
```html
<span class="pill status-open"><span class="pill-dot"></span>Open</span>
<span class="pill status-review">T1 · AI Review</span>
<span class="pill status-resolved">Resolved · Buyer favor</span>
```

**Typography:**
- 제목: Inter 600, 24px
- 아이템명: Inter 600, 16px
- 금액: JetBrains Mono 500, 16px
- 케이스 ID: JetBrains Mono 500, 12px, muted color
- 타임스탬프: JetBrains Mono 400, 12px, muted color

---

## 이 페이지가 3초 안에 전달해야 하는 것

1. **몇 건의 분쟁이 열려있는가** (stat 카드)
2. **어떤 분쟁에 내 행동이 필요한가** (amber/red 보더 카드가 맨 위)
3. **각 분쟁의 상태와 금액** (pill + 가격)

---

## 기술 참고

- Next.js App Router: `apps/web/src/app/(app)/disputes/page.tsx`
- API: `GET /orders` → 분쟁 포함 or `GET /disputes` 별도 엔드포인트
- Auth 필요 (logged-in 사용자만)
- 정렬: 행동 필요한 건이 맨 위 → 시간 순
