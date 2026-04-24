# A2 — Dispute Detail Page · Claude Design Prompt

> For Claude Design Tool. Single HTML page with multiple states.
> 가장 복잡한 페이지 — buyer/seller 역할 + 5가지 상태 조합으로 보이는 내용이 달라짐.
> 디자인 시스템: dispute-buyer.html, dispute-seller.html과 동일 톤.

---

## 이 페이지가 뭔가

**분쟁의 메인 페이지**. 분쟁 목록에서 카드를 클릭하면 여기로 온다. 구매자든 판매자든 같은 URL(`/disputes/[id]`)로 들어오지만, **역할에 따라 보이는 내용이 다르다.**

이 페이지에서 사용자는:
- 분쟁 진행 상황을 실시간으로 확인
- AI Advocate와 대화 (내 편을 들어주는 AI)
- 증거를 업로드하고 관리
- 비용과 정산 내역 확인
- T1 결과를 수락하거나 에스컬레이션
- T2/T3 패널 투표 진행 상황 확인

---

## 디자인 원칙

1. **역할 자동 감지**: URL 하나, 로그인한 사용자가 buyer면 buyer 뷰, seller면 seller 뷰
2. **상태 중심 UI**: 현재 분쟁 상태에 따라 보이는 섹션과 액션 버튼이 달라짐
3. **AI Advocate는 내 편**: buyer의 AI는 cyan, seller의 AI는 violet. 절대 중립이 아님.
4. **투명성 강조**: 비용, 타임라인, 상대방 상태 — 숨기는 것 없이 모두 보여줌
5. **모바일 우선**: 분쟁은 스트레스 상황. 스마트폰에서도 모든 액션이 가능해야 함.

---

## 레이아웃

**Desktop**: 좌측 메인 컬럼 (70%) + 우측 사이드바 (30%)
**Mobile**: 사이드바가 메인 컬럼 위로 접힘 (요약 카드로)

```
┌─────────────────────────────────────────────────────────────────────┐
│  [TopBar]                                                           │
├────────────────────────────────────────────┬────────────────────────┤
│                                            │                        │
│  [Case Header]                             │  [Case Summary]        │
│                                            │  [Next Actions]        │
│  [Timeline]                                │  [On-chain Badge]      │
│                                            │                        │
│  [AI Advocate Chat]                        │                        │
│                                            │                        │
│  [Evidence Grid]                           │                        │
│                                            │                        │
│  [Cost Breakdown]                          │                        │
│                                            │                        │
│  [T1 Decision] (상태별 표시)                │                        │
│                                            │                        │
│  [T2 Panel Status] (에스컬레이션 시)        │                        │
│                                            │                        │
│  [Activity Log]                            │                        │
│                                            │                        │
└────────────────────────────────────────────┴────────────────────────┘
```

---

## 섹션별 상세

### 1. Case Header

양쪽 공통이지만, 보이는 정보가 약간 다름.

**Buyer 뷰:**
```
[OPEN · T1 AI Review]                                Case · #DSP-2847

iPhone 14 Pro 128GB                                  $500.00

Seller: [avatar] @mike_deals · Trust 72
Reason: Item not as described

┌─────────┬─────────────┬──────────┬──────────────┐
│ Opened  │ Current tier│ Escrow   │ Decision ETA │
│Apr 19   │ T1 · AI     │ $500 held│ ~8 min       │
└─────────┴─────────────┴──────────┴──────────────┘
```

**Seller 뷰:**
```
[WAITING FOR YOU · T1 AI Review]                     Case · #DSP-2847
── violet top border ──

iPhone 14 Pro 128GB                                  $500.00

Dispute opened by: [avatar] @jenny_lee · Trust 88
Reason: Item not as described

┌─────────────┬─────────────┬──────────┬─────────────────┐
│ Buyer claim  │ Current tier│ Escrow   │ Deposit required│
│Bat 95%→82%  │ T1 · AI     │ $500 held│ None at T1      │
└─────────────┴─────────────┴──────────┴─────────────────┘
```

차이점:
- Seller는 **violet 상단 보더** (buyer는 보더 없음)
- Seller는 "WAITING FOR YOU" 상태 (행동 촉구)
- Seller는 "Buyer claim" 요약이 메타에 보임
- Seller는 "Deposit required" 필드가 보임 (T2/T3에서 중요)

### 2. Deadline Banner (Seller only, 조건부)

Seller가 응답해야 할 때만 표시:
```
┌─ ⏰ amber background ───────────────────────────────────────┐
│  Response required within 48 hours                          │
│  Failure to respond = automatic loss · deadline Apr 21      │
│                                               41:24:08      │
└─────────────────────────────────────────────────────────────┘
```
- 12시간 미만이면 red 배경으로 변경
- 카운트다운 실시간 (JS setInterval)

### 3. Timeline

5단계 수평 타임라인. 진행 상황 시각화.

```
[Opened] ──── [Evidence] ──── [AI Review] ──── [Decision] ──── [Settlement]
   ✓              ✓               ●               ○               ○
Apr 19         Apr 19          ~8 min          Pending          Pending
```

- 완료 노드: 검정 배경 + 흰 체크마크
- 현재 노드: 검정 보더 + 펄스 애니메이션
- 미래 노드: 회색 보더
- 연결선: 완료 구간은 검정, 나머지는 회색

**에스컬레이션 시 타임라인 변형:**
```
[Opened] ── [Evidence] ── [T1 Decision] ── [Escalated] ── [T2 Panel] ── [Settlement]
   ✓             ✓             ✓               ✓              ●              ○
```
T1 → T2로 에스컬레이션되면 노드가 6개로 확장.

### 4. AI Advocate Chat

**이 페이지의 핵심 인터랙션.** 사용자와 AI가 실시간으로 대화.

**Buyer의 AI Advocate (cyan):**
```
┌─ 🛡 Your AI Advocate ─────────────────────────────────────────┐
│  Building your case · Analyzing evidence                      │
│  [Conversation] [Analysis]                                     │
│───────────────────────────────────────────────────────────────│
│                                                                │
│  ┌─ cyan left border ────────────────────────────────────┐    │
│  │ ADVOCATE · 14:34 UTC                                   │    │
│  │                                                        │    │
│  │ I've reviewed your submission. Here's your case:       │    │
│  │                                                        │    │
│  │ ┌──────────────┐ ┌──────────────┐                     │    │
│  │ │ Key claim    │ │ Market impact│                     │    │
│  │ │ Battery 95%  │ │ 13% = ~$65   │                     │    │
│  │ │ → 82%        │ │ value loss   │                     │    │
│  │ └──────────────┘ └──────────────┘                     │    │
│  │                                                        │    │
│  │ Strength: ████████░░ 85% · Strong                     │    │
│  │                                                        │    │
│  │ The 13% discrepancy exceeds the 5% tolerance.         │    │
│  │ Recommendation: proceed with T1 review.                │    │
│  └────────────────────────────────────────────────────────┘    │
│                                                                │
│  ┌─ dark bg, right aligned ──────────────┐                    │
│  │ What happens next?                     │                    │
│  └────────────────────────────────────────┘                    │
│                                                                │
│  ┌─ cyan left border ────────────────────────────────────┐    │
│  │ ADVOCATE · 14:36 UTC                                   │    │
│  │                                                        │    │
│  │ Your case is with the AI Arbiter. Decision in minutes. │    │
│  │                                                        │    │
│  │ ┌─ amber warn card ──────────────────────────────┐    │    │
│  │ │ ⚠️ Heads up. Escalation adds $12 dispute cost. │    │    │
│  │ │ You only pay if you lose.                       │    │    │
│  │ └────────────────────────────────────────────────┘    │    │
│  └────────────────────────────────────────────────────────┘    │
│                                                                │
│  [Ask your AI Advocate...]                          [↵] [Send] │
└────────────────────────────────────────────────────────────────┘
```

**Seller의 AI Advocate (violet):**
- 동일 구조, 모든 accent가 violet
- 내용이 seller 관점: "Defending your position", "EXIF data proves 95% at listing"
- Strength meter: 방어 강도 (72% → EXIF 증거 추가 후 88%)

**AI Advocate 메시지 컴포넌트 종류:**
1. **일반 텍스트** — 분석, 조언
2. **인라인 카드** — Key claim / Market impact 같은 구조화된 정보
3. **Strength meter** — 가로 바 + 퍼센트 (gradient cyan→emerald 또는 violet→cyan)
4. **경고 카드** — amber border, 비용/위험 안내
5. **타이핑 인디케이터** — 3개 점 애니메이션
6. **사용자 메시지** — 우측 정렬, dark 배경

### 5. Evidence Grid

증거 카드 그리드. 사진/동영상/텍스트.

```
┌─ Supporting materials · 3 items ──── All hashes anchored ────┐
│                                                               │
│  ┌──────────┐  ┌──────────┐  ┌──────────┐  ┌ - - - - ┐     │
│  │  📸      │  │  📸      │  │  📝      │  │         │     │
│  │ battery  │  │ listing  │  │ Statement│  │  ＋ Add  │     │
│  │ 82%      │  │ 95%      │  │          │  │  more   │     │
│  │          │  │          │  │ "Battery │  │         │     │
│  │Apr 19    │  │Apr 19    │  │ measured │  │ Photo   │     │
│  │⛓ Anchored│  │⛓ Anchored│  │ 82%..."  │  │ Video   │     │
│  └──────────┘  └──────────┘  └──────────┘  └ - - - - ┘     │
│                                                               │
│  📹 Remaining: 1 video (30s max) · 2 photos                  │
└───────────────────────────────────────────────────────────────┘
```

- 사진: 썸네일 (placeholder 패턴 배경) + 타입 + 날짜 + ⛓ Anchored 뱃지
- 동영상: 재생 아이콘 오버레이 + 길이 표시
- 텍스트: 첫 2줄 미리보기
- 업로드 카드: dashed border, + 아이콘, "Photo · Video · Text" 하위 텍스트
- 남은 업로드 수량 표시
- 클릭 → 증거 뷰어 (A3) 또는 모달

**Seller 뷰에서는** "Counter-evidence" 라벨로 표시. 업로드 영역이 좀 더 강조됨 (AI Advocate가 "EXIF 증거를 올리세요" 같은 가이드 제공).

### 6. Cost Breakdown

투명한 비용 안내 카드.

```
┌─ Dispute cost breakdown ─────────────────── [Loser pays] ────┐
│                                                               │
│  ▶ T1 · AI Review · current                          $3.00   │
│    ───────────────────────────────────────────────            │
│    T2 · Community Panel · if escalated               $12.00   │
│    T3 · Grand Panel · if escalated                   $30.00   │
│                                                               │
│    Escrow held in smart contract                    $500.00   │
│                                                               │
│  ┌─ info card ─────────────────────────────────────────┐     │
│  │ ℹ️ You only pay if you lose. Winner is not charged. │     │
│  │ 70% goes to community reviewers, 30% to platform.  │     │
│  └─────────────────────────────────────────────────────┘     │
└───────────────────────────────────────────────────────────────┘
```

- 현재 tier: cyan 하이라이트 배경 + 좌측 보더
- 미래 tier: dim color
- "Loser pays" pill: slate 색상
- 비용은 문서 기준: T1 max(0.5%, $3), T2 max(2%, $12), T3 max(5%, $30)

### 7. T1 Decision Section (상태별 조건부 표시)

AI Arbiter가 판결을 내리면 표시됨.

```
┌─ AI Arbiter Decision ────────────────────────────────────────┐
│                                                               │
│  ⚖️ Ruling: Partial refund 30% ($150.00)                      │
│                                                               │
│  "Battery health discrepancy of 13% exceeds the 5%           │
│  tolerance threshold. However, seller provided EXIF-dated     │
│  evidence showing 95% at listing time. Partial refund         │
│  recommended for the diminished value."                       │
│                                                               │
│  ┌──────────────────────┐ ┌──────────────────────┐           │
│  │ Buyer receives       │ │ Seller receives       │           │
│  │ $150.00 refund       │ │ $350.00 (of $500)     │           │
│  │ + keeps the item     │ │ T1 cost: $3 (if loses)│           │
│  └──────────────────────┘ └──────────────────────┘           │
│                                                               │
│  ┌─────────────────────┐ ┌─────────────────────────┐         │
│  │ ✅ Accept ruling     │ │ ⬆️ Escalate to T2 · $12 │         │
│  │ $150 refund · done  │ │ 5 community reviewers  │         │
│  └─────────────────────┘ └─────────────────────────┘         │
│                                                               │
│  ℹ️ Both parties can accept or escalate within 48 hours.      │
│  If neither escalates, the ruling is automatically applied.   │
└───────────────────────────────────────────────────────────────┘
```

- 양쪽 모두 Accept / Escalate 가능 (공정함)
- 에스컬레이션 비용 명시
- 48시간 자동 수락 안내

### 8. T2 Panel Status (에스컬레이션 후 조건부)

```
┌─ ⚡ Escalated to Tier 2 — Community Panel Review ────────────┐
│  5 reviewers assigned · voting closes Apr 22 · 14:32 UTC      │
│                                                                │
│  ┌─────┐ ┌─────┐ ┌─────┐                                     │
│  │  5  │ │  3  │ │  2  │                                     │
│  │Assgn│ │Voted│ │Left │                                     │
│  └─────┘ └─────┘ └─────┘                                     │
│                                                                │
│  ████████████░░░░░░░ 60%                                      │
│                                                                │
│  [01]● [02]● [03]● [04]○ [05]○                                │
│                                                                │
│  ℹ️ Individual votes are sealed until the panel closes.        │
│  You will be notified when the decision is posted.             │
└────────────────────────────────────────────────────────────────┘
```

- 양쪽(buyer/seller) 동일하게 보임
- 개별 투표 내용은 sealed (결과만 집계 후 공개)
- 리뷰어 dot: 투표 완료 = 검정, 미투표 = 회색

### 9. Activity Log

역시간순 이벤트 로그.

```
┌─ Case status updates ──────────────────── [Export log] ──────┐
│                                                               │
│  Apr 19 · 15:01  ● AI Arbiter reviewing case · ~8 min        │
│  Apr 19 · 14:58  ✓ Seller submitted response with evidence   │
│  Apr 19 · 14:40  · Seller @mike_deals acknowledged dispute   │
│  Apr 19 · 14:36  ✓ Evidence uploaded · 3 items · hash 0x7f.. │
│  Apr 19 · 14:32  ✓ Dispute opened · ITEM_NOT_AS_DESCRIBED    │
│                                                               │
└───────────────────────────────────────────────────────────────┘
```

- 각 행: 타임스탬프 (mono) + 아이콘 (●=active, ✓=done, ·=info) + 텍스트
- "Export log" 버튼: 전체 로그 다운로드

### 10. Sidebar

**Case Summary:**
```
┌─ Case summary ────────────────┐
│  Case ID      #DSP-2847       │
│  Status       [OPEN]          │
│  Tier         T1 · AI Review  │
│  Item         iPhone 14 Pro   │
│  Amount       $500.00         │
│  Escrow       $500.00 held    │
│  Advocate     Active          │
│  Decision in  ~8 min          │
└───────────────────────────────┘
```

**Next Actions (역할별):**

Buyer 사이드바:
```
┌─ Next actions ─────────────────┐
│  [Escalate to T2 · $12]       │
│  [Accept T1 decision]          │
│  [Withdraw dispute]  (danger)  │
│───────────────────────────────│
│  Escalation available after    │
│  T1 decision is posted.        │
└────────────────────────────────┘
```

Seller 사이드바:
```
┌─ Next actions ─────────────────┐
│  ⏰ 41:24:08                   │
│  [Submit response]             │
│  [Accept buyer's claim]        │
│───────────────────────────────│
│  Failure to respond results    │
│  in automatic loss.            │
└────────────────────────────────┘
```

**On-chain badge:**
```
┌────────────────────────────────┐
│  ⛓ On-chain anchored.         │
│  Every evidence hash and state │
│  change is committed to the    │
│  Haggle ledger.                │
└────────────────────────────────┘
```

---

## 상태별 표시 매트릭스

어떤 섹션이 어떤 상태에서 보이는지:

| 섹션 | OPEN | UNDER_REVIEW | WAITING | RESOLVED | CLOSED |
|------|------|-------------|---------|----------|--------|
| Case Header | ✅ | ✅ | ✅ | ✅ | ✅ |
| Deadline Banner (seller) | ✅ | ❌ | ✅ | ❌ | ❌ |
| Timeline | ✅ | ✅ | ✅ | ✅ | ✅ |
| AI Advocate Chat | ✅ | ✅ | ✅ | ✅ (read-only) | ✅ (read-only) |
| Evidence Grid | ✅ (editable) | ✅ (editable) | ✅ (editable) | ✅ (read-only) | ✅ (read-only) |
| Cost Breakdown | ✅ | ✅ | ✅ | ✅ | ✅ |
| T1 Decision | ❌ | ❌ | ❌ | ✅ | ✅ |
| T2 Panel Status | ❌ | ❌ | ❌ | if T2 | if T2 |
| Activity Log | ✅ | ✅ | ✅ | ✅ | ✅ |

---

## 반응형

- **Desktop (>1024px)**: 2-column (main + sidebar)
- **Tablet (768-1024px)**: sidebar → 상단 요약 카드로 접힘, 1-column
- **Mobile (<768px)**: 전체 1-column, chat input은 하단 fixed, 증거 그리드 2열→1열

---

## 샘플 데이터

데모와 동일한 케이스 #DSP-2847 사용:
- Item: iPhone 14 Pro 128GB · $500
- Buyer: @jenny_lee (Trust 88) — 분쟁 제기
- Seller: @mike_deals (Trust 72) — 응답 필요
- Reason: ITEM_NOT_AS_DESCRIBED (배터리 95% → 82%)
- 증거 3건: 배터리 스크린샷, 리스팅 스크린샷, 텍스트 설명
- T1 판결: 부분 환불 30% ($150)

**두 가지 버전으로 디자인:**
1. **Buyer 뷰** (분쟁 제기자 시점)
2. **Seller 뷰** (응답자 시점)

같은 페이지지만 역할에 따라 header accent, AI Advocate 색상, 액션 버튼이 달라짐.

---

## 기술 참고

- 경로: `apps/web/src/app/(app)/disputes/[id]/page.tsx`
- API에서 사용자 역할(buyer/seller) 판단 → UI 자동 전환
- AI Advocate 채팅: WebSocket 또는 SSE 연결 (초기에는 REST polling)
- 증거 업로드: presigned URL → Supabase Storage
- 실시간 카운트다운: JS setInterval
- 상태 변경: API polling (30초) 또는 WebSocket push
