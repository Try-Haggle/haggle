# ARCHITECT-BRIEF — AI Advisor Chat System

*Written by Arch. 2026-04-22. Updated: bias → neutral.*
*Branch: feature/payment-shipping-dispute*

---

## 이건 뭔가

분쟁에서 **각 당사자에게 객관적 분석과 조언을 제공하는 AI 어시스턴트**. 법적 조언이 아닌 (법적 용어 사용 금지) "내 상황을 중립적으로 분석하고 옵션을 설명해주는 AI".

이름: **AI Advisor** (Advisor 아님 — 편을 들지 않음).

양쪽 AI가 같은 사실을 분석하되, **내 입장에서 설명**. 편향이 아니라 관점 전환.

---

## 설계 원칙 (CRITICAL)

### 1. 중립 분석, 관점 전환
- 양쪽 AI가 동일한 사실 기반으로 동일한 분석을 제공
- buyer AI: buyer의 상황에서 "당신의 증거는 이런 의미입니다"
- seller AI: seller의 상황에서 "상대방 주장에 대해 이렇게 대응할 수 있습니다"
- 약점을 숨기지 않음: "이 부분은 상대방에게 유리합니다"
- 원칙: "Honest analysis from your perspective, not advocacy"

### 2. 프롬프트 인젝션 5계층 방어
```
L0: 입력 길이 제한 (2000자)
L1: 패턴 스캔 (기존 prompt-guard.ts 재사용)
L2: 구조 검증 (기존 prompt-guard.ts 재사용)
L3: 캐너리 토큰 (기존 prompt-guard.ts 재사용)
L4: 출력 검증 (새로 추가) — AI 응답에서 시스템 정보 누출 체크
```

### 3. 톤 & 언어
- 전문적이지만 위압적이지 않음
- 법적 용어 절대 금지: "법적 조언", "소송", "변호사", "판사", "법원"
- 대신: "케이스 분석", "근거", "주장", "증거 검토"
- 정직함: "이 증거는 약합니다"도 말할 수 있어야 함 (AI가 틀리지 않는 것 > AI가 유리하게 보이는 것)
- 언어: 사용자 설정 언어 (기본 영어, 한국어 지원)

### 4. 컨텍스트 주입 구조
```
System Prompt
├── L0: Safety rules (절대 불변)
├── L1: Role definition (buyer/seller advisor)
├── L2: Case context (dispute facts, evidence, status)
├── L3: Behavioral guardrails (톤, 금지 용어, 정직성)
├── L4: Canary token
└── L5: Output format instructions
```

User input은 system prompt 밖에서, 별도 user message로만 전달.
절대로 user input을 system prompt에 interpolation하지 않음.

### 5. 비용 최적화
- 기본: grok-4-fast (협상 엔진과 동일)
- 분쟁 가치 $1K+: reasoning mode 허용
- 대화 히스토리: 최근 10턴만 전송 (sliding window)
- 토큰 예산: 응답당 ~500 토큰
- 세션당 비용 추적: dispute metadata에 기록

---

## 아키텍처

### 컴포넌트 구조
```
apps/api/src/advisor/
├── advisor-service.ts      ← 메인 서비스 (chat orchestration)
├── advisor-prompts.ts      ← 시스템 프롬프트 빌더
├── advisor-context.ts      ← 케이스 컨텍스트 조립
├── advisor-guard.ts        ← 입출력 보안 검증
└── advisor-types.ts        ← 타입 정의
```

### 데이터 흐름
```
User message
  → L0-L2: Input guard (apps/api/src/negotiation/guards/prompt-guard.ts 재사용)
  → Context assembly (dispute + evidence + history → system prompt)
  → LLM call (apps/api/src/negotiation/adapters/xai-client.ts 재사용)
  → L3: Canary check
  → L4: Output guard (새로 구현)
  → Store message in DB
  → Return to client
```

---

## Step 97 — DB: Advisor Messages Table

```sql
CREATE TABLE advisor_messages (
  id uuid PK DEFAULT gen_random_uuid(),
  dispute_id uuid NOT NULL REFERENCES dispute_cases(id),
  role text NOT NULL,           -- 'buyer_advisor' | 'seller_advisor' | 'buyer_user' | 'seller_user'
  content text NOT NULL,
  metadata jsonb,               -- { tokens_used, model, cost_usd, strength_assessment, ... }
  created_at timestamp DEFAULT now()
);

CREATE INDEX idx_advisor_messages_dispute ON advisor_messages(dispute_id, created_at);
```

---

## Step 98 — Advisor Service Core

### `advisor-types.ts`
```typescript
type AdvisorRole = 'buyer' | 'seller';

interface AdvisorMessage {
  id: string;
  dispute_id: string;
  role: 'buyer_advisor' | 'seller_advisor' | 'buyer_user' | 'seller_user';
  content: string;
  metadata?: {
    tokens_used?: number;
    model?: string;
    cost_usd?: number;
    strength?: number;  // 0-100 case strength assessment
    blocked?: boolean;   // if input was blocked by guard
    block_reason?: string;
  };
  created_at: string;
}

interface AdvisorChatRequest {
  dispute_id: string;
  user_role: AdvisorRole;  // caller is buyer or seller
  message: string;
}

interface AdvisorChatResponse {
  reply: AdvisorMessage;
  strength_assessment?: number;
  action_suggestions?: string[];  // "Upload EXIF evidence", "Escalate to T2"
}
```

### `advisor-context.ts`
케이스 컨텍스트를 조립하여 system prompt에 삽입:

```typescript
async function assembleAdvisorContext(db, disputeId, role): Promise<AdvisorContext> {
  // 1. Dispute 기본 정보 (reason, status, tier, amount)
  // 2. 양측 증거 목록 (type, summary — uri/text는 요약만)
  // 3. 내 편 증거 상세 (우리 증거는 자세히)
  // 4. 상대편 증거 요약 (상대 증거는 간략히 — 불공정하지 않게 핵심은 포함)
  // 5. T1 판결 결과 (있으면)
  // 6. 현재 단계와 다음 가능한 액션
  // 7. 비용 정보 (에스컬레이션 비용 등)
}
```

### `advisor-prompts.ts`
```typescript
function buildAdvisorSystemPrompt(role, context, canary): string {
  return `
${SAFETY_RULES}  // L0: 절대 불변 보안 규칙

${ROLE_DEFINITION[role]}  // L1: "You are the buyer's AI Advisor..."

${CASE_CONTEXT}  // L2: dispute facts, evidence

${BEHAVIORAL_RULES}  // L3: 톤, 금지 용어, 정직성

${canary}  // L4: Canary token

${OUTPUT_RULES}  // L5: 응답 형식
`;
}
```

**Role definitions:**

Buyer advisor:
```
You are the buyer's AI Advisor in a Haggle dispute. You provide neutral, fact-based analysis of the dispute from the buyer's perspective. You explain what the evidence means, what the likely outcomes are, what options are available, and the costs/risks of each option.

You do NOT take sides. You present both sides' strengths and weaknesses honestly. If the buyer's case is weak, say so clearly — it is better to accept a fair ruling than to escalate and lose with a higher cost. If the case is strong, explain why with evidence.

Never fabricate evidence, misrepresent facts, or encourage unnecessary escalation. Your goal is to help the buyer make an informed decision, not to "win" the dispute.
```

Seller advisor:
```
You are the seller's AI Advisor in a Haggle dispute. You provide neutral, fact-based analysis of the dispute from the seller's perspective. You explain what the buyer's claims mean, what evidence supports or undermines them, what response options are available, and the costs/risks of each.

You do NOT take sides. You present both sides' strengths and weaknesses honestly. If the seller's defense is weak, say so clearly — it is better to accept the ruling than to escalate and lose. If the defense is strong, explain why with evidence.

Never fabricate evidence, misrepresent facts, or encourage unnecessary escalation. Your goal is to help the seller make an informed decision, not to "win" the dispute.
```

### `advisor-guard.ts`
입력/출력 보안:

```typescript
// Input guard: 기존 prompt-guard + dispute-specific 추가
function guardInput(message: string): GuardResult {
  // 1. 기존 runPromptGuard(message, "message") 호출
  // 2. 추가: 상대방 impersonation 시도 감지
  //    - "I'm the seller" (buyer가 보낸 메시지에서)
  //    - "The buyer's advisor says" (조작 시도)
  // 3. 추가: 법적 용어 사용 감지 + 경고 (블록은 안 함, 경고만)
}

// Output guard: LLM 응답 검증
function guardOutput(response: string, canary: string): OutputGuardResult {
  // 1. Canary leak check (기존)
  // 2. 법적 용어 사용 체크 ("법적 조언", "소송", "변호사")
  // 3. 상대방 개인정보 누출 체크 (wallet address, email 등)
  // 4. 시스템 정보 누출 체크 (prompt 내용, API 키, 내부 로직)
  // 5. 위반 시: 응답 교체 (generic fallback)
}
```

### `advisor-service.ts`
```typescript
async function chat(db, request: AdvisorChatRequest): Promise<AdvisorChatResponse> {
  // 1. Guard input
  // 2. Load dispute + verify user is buyer/seller
  // 3. Load conversation history (last 10 messages)
  // 4. Assemble context
  // 5. Build system prompt
  // 6. Call LLM
  // 7. Guard output
  // 8. Extract strength assessment (if present in response)
  // 9. Extract action suggestions (if present)
  // 10. Save both messages (user + advisor) to DB
  // 11. Track cost in dispute metadata
  // 12. Return response
}
```

---

## Step 99 — API Endpoints

`apps/api/src/routes/advisor.ts`:

```
POST /disputes/:id/advisor/chat
  - requireAuth + requireDisputeParty()
  - body: { message: string }
  - role은 서버에서 결정 (buyer_id match = buyer, seller_id match = seller)
  - 응답: { reply, strength_assessment?, action_suggestions? }

GET /disputes/:id/advisor/history
  - requireAuth + requireDisputeParty()
  - buyer는 buyer_advisor + buyer_user 메시지만 볼 수 있음
  - seller는 seller_advisor + seller_user 메시지만 볼 수 있음
  - 절대 상대편 advisor 대화를 보여주지 않음
  - query: limit (default 50), before (cursor)
  - 응답: { messages: AdvisorMessage[] }

POST /disputes/:id/advisor/analyze
  - requireAuth + requireDisputeParty()
  - body 없음 (자동 분석)
  - LLM에게 "현재 케이스를 분석해주세요"라고 요청
  - 초기 메시지 — 분쟁 열릴 때 자동 호출
  - 응답: { analysis: AdvisorMessage, strength: number }
```

**보안 핵심**: `/advisor/history`에서 buyer는 buyer_* 메시지만, seller는 seller_* 메시지만. 교차 접근 불가.

---

## Step 100 — Frontend Chat Component

`apps/web/src/app/(app)/disputes/[id]/_components/advisor-chat.tsx`

기존 dispute-detail.tsx에 통합되는 채팅 컴포넌트:

- 메시지 로드: `GET /disputes/:id/advisor/history`
- 메시지 전송: `POST /disputes/:id/advisor/chat`
- 역할별 색상: buyer=cyan, seller=violet
- AI 메시지: 좌측, accent left border, ADVOCATE 라벨
- User 메시지: 우측, dark bg
- Strength meter: 바 + 퍼센트
- Warning cards: amber border (에스컬레이션 비용 등)
- Action suggestions: 버튼으로 표시
- Typing indicator: 3-dot animation
- Input: 하단 고정, "Ask your AI Advisor..."
- 블록된 메시지: "Message could not be processed" 표시

---

## Build Order

```
Step 97 (DB table) → Step 98 (Service core) → Step 99 (API) → Step 100 (Frontend)
```

순차. 각 단계가 이전 단계에 의존.

---

## Richard Checklist (보안 집중)

- [ ] User input이 system prompt에 절대 interpolation되지 않음
- [ ] Buyer는 seller advisor 대화를 볼 수 없고, 그 반대도 마찬가지
- [ ] 프롬프트 인젝션 5계층 모두 동작
- [ ] 출력에 법적 용어 ("법적 조언", "소송") 없음
- [ ] 출력에 시스템 정보 (API 키, prompt 내용) 없음
- [ ] 출력에 상대방 개인정보 (지갑 주소, 이메일) 없음
- [ ] Canary token이 응답에 노출되지 않음
- [ ] 대화 히스토리 10턴 제한 (토큰 폭발 방지)
- [ ] 메시지 2000자 제한
- [ ] LLM 호출 실패 시 graceful fallback (generic 응답)
- [ ] 비용 추적: 분쟁별 총 LLM 비용 기록
- [ ] role은 서버에서 결정, 클라이언트가 보낸 role 무시

---

*Arch out. Bob 스핀업 — Step 97부터 순차.*
