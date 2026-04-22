# ARCHITECT-BRIEF — AI Advocate Chat System

*Written by Arch. 2026-04-22.*
*Branch: feature/payment-shipping-dispute*

---

## 이건 뭔가

분쟁에서 **각 당사자의 편에 서는 AI 어시스턴트**. 변호사는 아니지만 (법적 용어 사용 금지) "내 편에서 케이스를 분석하고 조언해주는 AI".

핵심 차이점: 협상 엔진의 AI는 **중립**이었지만, AI Advocate는 **편향적** — 의도적으로 한쪽의 이익을 대변.

---

## 설계 원칙 (CRITICAL)

### 1. 편향은 허용, 거짓은 불허
- Buyer advocate: buyer에게 유리한 해석을 제시 OK
- Seller advocate: seller에게 유리한 해석을 제시 OK
- 하지만: 없는 증거를 만들거나, 상대방 증거를 왜곡하면 안 됨
- 원칙: "Best interpretation of available facts for your side"

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
├── L1: Role definition (buyer/seller advocate)
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
apps/api/src/advocate/
├── advocate-service.ts      ← 메인 서비스 (chat orchestration)
├── advocate-prompts.ts      ← 시스템 프롬프트 빌더
├── advocate-context.ts      ← 케이스 컨텍스트 조립
├── advocate-guard.ts        ← 입출력 보안 검증
└── advocate-types.ts        ← 타입 정의
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

## Step 97 — DB: Advocate Messages Table

```sql
CREATE TABLE advocate_messages (
  id uuid PK DEFAULT gen_random_uuid(),
  dispute_id uuid NOT NULL REFERENCES dispute_cases(id),
  role text NOT NULL,           -- 'buyer_advocate' | 'seller_advocate' | 'buyer_user' | 'seller_user'
  content text NOT NULL,
  metadata jsonb,               -- { tokens_used, model, cost_usd, strength_assessment, ... }
  created_at timestamp DEFAULT now()
);

CREATE INDEX idx_advocate_messages_dispute ON advocate_messages(dispute_id, created_at);
```

---

## Step 98 — Advocate Service Core

### `advocate-types.ts`
```typescript
type AdvocateRole = 'buyer' | 'seller';

interface AdvocateMessage {
  id: string;
  dispute_id: string;
  role: 'buyer_advocate' | 'seller_advocate' | 'buyer_user' | 'seller_user';
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

interface AdvocateChatRequest {
  dispute_id: string;
  user_role: AdvocateRole;  // caller is buyer or seller
  message: string;
}

interface AdvocateChatResponse {
  reply: AdvocateMessage;
  strength_assessment?: number;
  action_suggestions?: string[];  // "Upload EXIF evidence", "Escalate to T2"
}
```

### `advocate-context.ts`
케이스 컨텍스트를 조립하여 system prompt에 삽입:

```typescript
async function assembleAdvocateContext(db, disputeId, role): Promise<AdvocateContext> {
  // 1. Dispute 기본 정보 (reason, status, tier, amount)
  // 2. 양측 증거 목록 (type, summary — uri/text는 요약만)
  // 3. 내 편 증거 상세 (우리 증거는 자세히)
  // 4. 상대편 증거 요약 (상대 증거는 간략히 — 불공정하지 않게 핵심은 포함)
  // 5. T1 판결 결과 (있으면)
  // 6. 현재 단계와 다음 가능한 액션
  // 7. 비용 정보 (에스컬레이션 비용 등)
}
```

### `advocate-prompts.ts`
```typescript
function buildAdvocateSystemPrompt(role, context, canary): string {
  return `
${SAFETY_RULES}  // L0: 절대 불변 보안 규칙

${ROLE_DEFINITION[role]}  // L1: "You are the buyer's AI Advocate..."

${CASE_CONTEXT}  // L2: dispute facts, evidence

${BEHAVIORAL_RULES}  // L3: 톤, 금지 용어, 정직성

${canary}  // L4: Canary token

${OUTPUT_RULES}  // L5: 응답 형식
`;
}
```

**Role definitions:**

Buyer advocate:
```
You are the buyer's AI Advocate in a Haggle dispute. Your job is to help the buyer build the strongest possible case based on available evidence. You analyze evidence, identify weaknesses in the seller's position, suggest what additional evidence would strengthen the case, and advise on whether to accept decisions or escalate.

You are on the buyer's side, but you must be honest. If the buyer's case is weak, say so — it's better to accept a fair partial refund than to escalate and lose with a higher cost. Never fabricate evidence or misrepresent facts.
```

Seller advocate:
```
You are the seller's AI Advocate in a Haggle dispute. Your job is to help the seller defend their position with the strongest available evidence. You analyze the buyer's claims, identify weaknesses in their argument, suggest counter-evidence to upload, and advise on response strategy.

You are on the seller's side, but you must be honest. If the seller's defense is weak, recommend accepting the ruling rather than escalating. Never fabricate evidence or misrepresent facts.
```

### `advocate-guard.ts`
입력/출력 보안:

```typescript
// Input guard: 기존 prompt-guard + dispute-specific 추가
function guardInput(message: string): GuardResult {
  // 1. 기존 runPromptGuard(message, "message") 호출
  // 2. 추가: 상대방 impersonation 시도 감지
  //    - "I'm the seller" (buyer가 보낸 메시지에서)
  //    - "The buyer's advocate says" (조작 시도)
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

### `advocate-service.ts`
```typescript
async function chat(db, request: AdvocateChatRequest): Promise<AdvocateChatResponse> {
  // 1. Guard input
  // 2. Load dispute + verify user is buyer/seller
  // 3. Load conversation history (last 10 messages)
  // 4. Assemble context
  // 5. Build system prompt
  // 6. Call LLM
  // 7. Guard output
  // 8. Extract strength assessment (if present in response)
  // 9. Extract action suggestions (if present)
  // 10. Save both messages (user + advocate) to DB
  // 11. Track cost in dispute metadata
  // 12. Return response
}
```

---

## Step 99 — API Endpoints

`apps/api/src/routes/advocate.ts`:

```
POST /disputes/:id/advocate/chat
  - requireAuth + requireDisputeParty()
  - body: { message: string }
  - role은 서버에서 결정 (buyer_id match = buyer, seller_id match = seller)
  - 응답: { reply, strength_assessment?, action_suggestions? }

GET /disputes/:id/advocate/history
  - requireAuth + requireDisputeParty()
  - buyer는 buyer_advocate + buyer_user 메시지만 볼 수 있음
  - seller는 seller_advocate + seller_user 메시지만 볼 수 있음
  - 절대 상대편 advocate 대화를 보여주지 않음
  - query: limit (default 50), before (cursor)
  - 응답: { messages: AdvocateMessage[] }

POST /disputes/:id/advocate/analyze
  - requireAuth + requireDisputeParty()
  - body 없음 (자동 분석)
  - LLM에게 "현재 케이스를 분석해주세요"라고 요청
  - 초기 메시지 — 분쟁 열릴 때 자동 호출
  - 응답: { analysis: AdvocateMessage, strength: number }
```

**보안 핵심**: `/advocate/history`에서 buyer는 buyer_* 메시지만, seller는 seller_* 메시지만. 교차 접근 불가.

---

## Step 100 — Frontend Chat Component

`apps/web/src/app/(app)/disputes/[id]/_components/advocate-chat.tsx`

기존 dispute-detail.tsx에 통합되는 채팅 컴포넌트:

- 메시지 로드: `GET /disputes/:id/advocate/history`
- 메시지 전송: `POST /disputes/:id/advocate/chat`
- 역할별 색상: buyer=cyan, seller=violet
- AI 메시지: 좌측, accent left border, ADVOCATE 라벨
- User 메시지: 우측, dark bg
- Strength meter: 바 + 퍼센트
- Warning cards: amber border (에스컬레이션 비용 등)
- Action suggestions: 버튼으로 표시
- Typing indicator: 3-dot animation
- Input: 하단 고정, "Ask your AI Advocate..."
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
- [ ] Buyer는 seller advocate 대화를 볼 수 없고, 그 반대도 마찬가지
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
