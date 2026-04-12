# 29. 6-Stage 리팩토링 + 모듈화 구현 계획

> **작성일:** 2026-04-12
> **기준 문서:** Doc 26 (설계), Doc 27 (현황), Doc 28 (전략)
> **목적:** 13-step 모노리스 → 6-Stage 독립 모듈로 리팩토링. 외부 에이전트가 Stage별로 호출 가능한 구조.

---

## 1. 한 줄 요약

**"6개 Stage를 독립 함수로 분리하고, 외부에서 Stage 2·4·6만 골라 쓸 수 있는 프로토콜 인프라를 만든다."**

---

## 2. 현재 → 목표

### 현재: 13-Step 모노리스

```
llm-negotiation-executor.ts (1 파일, ~400줄)
├── Step 1: Idempotency check
├── Step 2: BEGIN TX + SELECT FOR UPDATE
├── Step 3: Terminal/expiry check
├── Step 4: Load rounds → memory reconstruction
├── Step 5: Screening (spam)
├── Step 6: Phase detection + transition
├── Step 7: Intervention check
├── Step 8: Decision (skill.evaluateOffer → optional LLM)
├── Step 9: RefereeService.process()
├── Step 10: Post-decision phase transition
├── Step 11: Persist round
├── Step 12: Update session
└── Step 13: Event dispatch

문제:
- context-assembly.ts 호출 안 함 (dead code)
- Stage 1 UNDERSTAND 없음
- Stage 5 RESPOND가 template 기반
- 외부 호출 불가 (DB TX로 전체가 묶여있음)
```

### 목표: 6-Stage 독립 모듈

```
negotiation/stages/
├── understand.ts    ← Stage 1: 텍스트/이미지 → StructuredInput
├── context.ts       ← Stage 2: L0~L5 컨텍스트 조립 (코드)
├── decide.ts        ← Stage 3: LLM/Skill → ProtocolDecision
├── validate.ts      ← Stage 4: Referee 검증 + auto-fix (코드)
├── respond.ts       ← Stage 5: Decision → 자연어 메시지 (LLM)
└── persist.ts       ← Stage 6: DB 저장 + Phase 전이 (코드)

negotiation/pipeline/
├── pipeline.ts      ← 6-Stage 순차 실행 오케스트레이터
├── types.ts         ← StageInput/Output 타입
└── executor.ts      ← DB TX 래퍼 (프로덕션 엔트리포인트)

특징:
- 각 Stage는 순수 함수 (DB 의존 없음, Stage 6 제외)
- 외부 에이전트: understand(local) → context(Haggle) → decide(local) → validate(Haggle) 가능
- 내부 사용: pipeline.ts가 6개를 순차 호출
```

---

## 3. Stage별 설계

### Stage 1: UNDERSTAND

```typescript
// negotiation/stages/understand.ts

interface UnderstandInput {
  raw_message: string;
  images?: ImageReference[];     // 미래: 멀티모달
  sender_role: 'buyer' | 'seller';
}

interface UnderstandOutput {
  price_offer?: number;
  action_intent: 'OFFER' | 'COUNTER' | 'ACCEPT' | 'REJECT' | 'QUESTION' | 'INFO';
  conditions: Record<string, unknown>;
  sentiment: 'positive' | 'neutral' | 'negative';
  raw_text: string;
}

export async function understand(
  input: UnderstandInput,
  adapter: ModelAdapter,
): Promise<UnderstandOutput>;
```

**현재 프로덕션에서:** `offerPriceMinor`를 직접 받으므로 이 Stage를 bypass. MCP/API 호출은 structured input → Stage 2부터 시작.

**외부 에이전트 사용 시:** 자체 LLM으로 Stage 1 실행 → 결과를 Haggle Stage 2에 전달.

### Stage 2: CONTEXT

```typescript
// negotiation/stages/context.ts

interface ContextInput {
  understood: UnderstandOutput;
  memory: CoreMemory;
  facts: RoundFact[];
  opponent: OpponentPattern;
  skill: NegotiationSkill;
  l5_signals?: L5Signals;        // Doc 28 P0
}

interface ContextOutput {
  layers: ContextLayers;          // L0~L5
  coaching: RefereeCoaching;      // Faratin 기반 추천
  memo_snapshot: string;          // Codec 또는 Raw
}

export function assembleContext(
  input: ContextInput,
  config: StageConfig,
): ContextOutput;
```

**핵심 변경:** 기존 `context-assembly.ts`를 여기로 통합. `coach.ts` 호출도 여기서. dead code를 살리는 것.

**L5Signals 주입 경로 확보:** 인터페이스만 정의, 초기엔 빈 객체. Swappa API 연동 시 데이터 투입.

### Stage 3: DECIDE

```typescript
// negotiation/stages/decide.ts

interface DecideInput {
  context: ContextOutput;
  adapter: ModelAdapter;
  skill: NegotiationSkill;
  phase: NegotiationPhase;
  config: StageConfig;
}

interface DecideOutput {
  decision: ProtocolDecision;
  source: 'llm' | 'skill';       // 누가 결정했는지
  reasoning_mode: boolean;
  llm_raw?: string;               // LLM 원본 응답
  tokens?: { prompt: number; completion: number };
  latency_ms?: number;
}

export async function decide(
  input: DecideInput,
): Promise<DecideOutput>;
```

**현재 로직 보존:** BARGAINING+COUNTER일 때만 LLM, 나머지는 skill rule-based. 이 분기를 그대로 유지.

### Stage 4: VALIDATE

```typescript
// negotiation/stages/validate.ts

interface ValidateInput {
  decision: DecideOutput;
  coaching: RefereeCoaching;
  memory: CoreMemory;
  phase: NegotiationPhase;
  config: StageConfig;
}

interface ValidateOutput {
  final_decision: ProtocolDecision;
  validation: ValidationResult;
  auto_fix_applied: boolean;
  retry_count: number;
  explainability: RoundExplainability;  // Doc 28 P0: 투명성
}

export function validate(
  input: ValidateInput,
): ValidateOutput;
```

**RoundExplainability 포함:** Referee가 무엇을 검증했고, 어떤 violation이 있었고, auto-fix가 적용됐는지 구조화된 로그.

### Stage 5: RESPOND

```typescript
// negotiation/stages/respond.ts

interface RespondInput {
  validated: ValidateOutput;
  memory: CoreMemory;
  adapter: ModelAdapter;
  skill: NegotiationSkill;
  config: StageConfig;
}

interface RespondOutput {
  message: string;
  tone: string;
  llm_raw?: string;
  tokens?: { prompt: number; completion: number };
}

export async function respond(
  input: RespondInput,
): Promise<RespondOutput>;
```

**현재:** `TemplateMessageRenderer` (template). 향후 LLM 전환. config로 `'template' | 'llm'` 모드 전환.

### Stage 6: PERSIST

```typescript
// negotiation/stages/persist.ts

interface PersistInput {
  session_id: string;
  round_number: number;
  understood: UnderstandOutput;
  decision: ValidateOutput;
  response: RespondOutput;
  memory: CoreMemory;
  facts: RoundFact[];
  memo_hash?: string;            // Doc 28 P0: SHA-256
  explainability: RoundExplainability;
}

interface PersistOutput {
  phase_transition?: { from: string; to: string; event: string };
  session_done: boolean;
  round_persisted: boolean;
}

export async function persist(
  input: PersistInput,
  db: Database,
  eventDispatcher: EventDispatcher,
): Promise<PersistOutput>;
```

**유일한 DB 의존 Stage.** 외부 에이전트는 이 Stage를 Haggle API를 통해 호출.

---

## 4. Pipeline 오케스트레이터

```typescript
// negotiation/pipeline/pipeline.ts

export interface PipelineResult {
  round: number;
  phase: string;
  stages: {
    understand: UnderstandOutput;
    context: ContextOutput;
    decide: DecideOutput;
    validate: ValidateOutput;
    respond: RespondOutput;
    persist: PersistOutput;
  };
  explainability: RoundExplainability;
  cost: { tokens: number; usd: number; latency_ms: number };
  done: boolean;
}

/**
 * 내부 사용: 6-Stage 전체 순차 실행
 */
export async function executePipeline(
  session: SessionState,
  message: string,
  deps: PipelineDeps,
): Promise<PipelineResult>;

/**
 * 외부 에이전트용: 개별 Stage 호출
 */
export {
  understand,
  assembleContext,
  decide,
  validate,
  respond,
  persist,
} from '../stages/index.js';
```

---

## 5. 외부 에이전트 사용 시나리오

```
Case 1: Haggle 대행 (현재 MCP)
  에이전트 → create_goal → Haggle Pipeline 전체 실행 → 결과

Case 2: 하이브리드 (목표)
  에이전트 자체 LLM:  Stage 1 understand()
  → Haggle API:       Stage 2 assembleContext()
  에이전트 자체 LLM:  Stage 3 decide()
  → Haggle API:       Stage 4 validate()
  에이전트 자체 LLM:  Stage 5 respond()
  → Haggle API:       Stage 6 persist()

  Haggle는 Referee(Stage 2,4) + Protocol(Stage 6)만 제공
  → API 호출 3회 → 비용 ~$0.0001/라운드 (LLM 비용 없음)
  → 에이전트 채택 장벽 극적 하락

Case 3: 프로토콜 모드 (미래)
  구매 에이전트 ↔ 판매 에이전트 직접 통신
  양쪽 모두 Haggle Stage 2,4,6만 호출
  → Haggle = 협상 규칙 인프라
```

---

## 6. ModelAdapter 확장

```typescript
// 현재
interface ModelAdapter {
  readonly modelId: string;
  readonly tier: 'basic' | 'standard' | 'advanced' | 'frontier';
  buildSystemPrompt(skillContext: string): string;
  buildUserPrompt(memory, recentFacts, signals?, prevMemory?): string;
  parseResponse(raw: string): ProtocolDecision;
  coachingLevel(): 'DETAILED' | 'STANDARD' | 'LIGHT';
}

// 확장
interface ModelAdapter {
  // 기존 유지
  readonly modelId: string;
  readonly tier: 'basic' | 'standard' | 'advanced' | 'frontier';
  buildSystemPrompt(skillContext: string): string;
  buildUserPrompt(memory, recentFacts, signals?, prevMemory?): string;
  parseResponse(raw: string): ProtocolDecision;
  coachingLevel(): 'DETAILED' | 'STANDARD' | 'LIGHT';

  // 신규
  readonly location: 'remote' | 'local';
  readonly capabilities: ('parse' | 'reason' | 'generate')[];
}
```

**`config.ts` Stage별 어댑터 매핑:**

```typescript
interface StageConfig {
  adapters: {
    UNDERSTAND: ModelAdapter;  // 파싱 → 소형 가능
    DECIDE: ModelAdapter;      // 판단 → 고성능 필요
    RESPOND: ModelAdapter;     // 생성 → 소형 가능
  };
  modes: {
    CONTEXT: 'code';           // 항상 코드
    VALIDATE: 'code' | 'llm';  // 기본 코드, 미래 LLM
    PERSIST: 'code';           // 항상 코드
    RESPOND: 'template' | 'llm'; // 현재 template, 미래 LLM
  };
  memoEncoding: 'auto' | 'codec' | 'raw';
  validationMode: 'full' | 'lite';
}
```

---

## 7. memo-codec.ts + memo-manager.ts

### memo-codec.ts (Living Memo 인코딩)

```typescript
// negotiation/memo/memo-codec.ts

type MemoEncoding = 'codec' | 'raw';

/** Compressed Codec (Doc 26) — ~390 tokens */
export function encodeCompressed(memory: CoreMemory): string;

/** Raw JSON — ~1000 tokens, 사람 읽기 가능 */
export function encodeRaw(memory: CoreMemory): string;

/** 자동 선택 */
export function encodeMemo(
  memory: CoreMemory,
  encoding: MemoEncoding,
): string;

/** 디코딩 (양쪽 다 지원) */
export function decodeMemo(encoded: string): CoreMemory;
```

### memo-manager.ts (CRUD + 해시)

```typescript
// negotiation/memo/memo-manager.ts

import { createHash } from 'crypto';

export interface MemoSnapshot {
  shared: string;     // Shared Layer (NS, PT, CL, RM)
  private: string;    // Private Layer (SS, OM, TA, TR)
  hash: string;       // SHA-256(shared)
  round: number;
  timestamp: number;
}

/** Shared Memo 해시 계산 */
export function computeMemoHash(sharedMemo: string): string {
  return createHash('sha256').update(sharedMemo).digest('hex');
}

/** 스냅샷 생성 */
export function createSnapshot(
  memory: CoreMemory,
  round: number,
  encoding: MemoEncoding,
): MemoSnapshot;

/** 해시 검증 (분쟁 시) */
export function verifyMemoIntegrity(
  snapshot: MemoSnapshot,
): boolean;
```

---

## 8. L5Signals 인터페이스

```typescript
// negotiation/types.ts에 추가

interface L5Signals {
  market?: {
    avg_sold_price_30d: number;
    price_trend: 'rising' | 'stable' | 'falling';
    active_listings_count: number;
    source_prices: { platform: string; price: number }[];
  };
  competition?: {
    concurrent_sessions: number;
    best_competing_offer?: number;
  };
  category?: {
    avg_discount_rate: number;
    avg_rounds_to_deal: number;
  };
}
```

**초기 구현:** `market.avg_sold_price_30d`만 Swappa API로 채움. 나머지는 optional로 점진적 추가.

---

## 9. RoundExplainability 타입

```typescript
// negotiation/types.ts에 추가

interface RoundExplainability {
  round: number;
  coach_recommendation: {
    price: number;
    basis: string;              // "Faratin β=1.5, t/T=0.33"
    acceptable_range: { min: number; max: number };
  };
  decision: {
    source: 'llm' | 'skill';
    price?: number;
    action: string;
    tactic_used?: string;
    reasoning_summary: string;
  };
  referee_result: {
    violations: Array<{
      rule: string;
      severity: 'HARD' | 'SOFT';
      detail: string;
    }>;
    action: 'PASS' | 'WARN_AND_PASS' | 'AUTO_FIX' | 'BLOCK';
    auto_fix_applied: boolean;
  };
  final_output: {
    price?: number;
    action: string;
  };
}
```

---

## 10. 파일 인벤토리

### Phase A: 6-Stage 리팩토링 + 모듈화

| 파일 | 작업 | 의존성 |
|------|------|--------|
| `negotiation/stages/understand.ts` | 신규 | ModelAdapter |
| `negotiation/stages/context.ts` | 신규 (context-assembly.ts 흡수) | coach.ts, memo-codec.ts |
| `negotiation/stages/decide.ts` | 신규 | ModelAdapter, NegotiationSkill |
| `negotiation/stages/validate.ts` | 신규 (referee-service.ts 활용) | validator.ts |
| `negotiation/stages/respond.ts` | 신규 | ModelAdapter 또는 TemplateRenderer |
| `negotiation/stages/persist.ts` | 신규 | DB, EventDispatcher |
| `negotiation/stages/index.ts` | 신규 — re-export | 전체 Stage |
| `negotiation/pipeline/pipeline.ts` | 신규 — 오케스트레이터 | 6 stages |
| `negotiation/pipeline/types.ts` | 신규 — StageInput/Output | types.ts |
| `negotiation/pipeline/executor.ts` | 신규 — DB TX 래퍼 | pipeline.ts |
| `negotiation/memo/memo-codec.ts` | 신규 | CoreMemory |
| `negotiation/memo/memo-manager.ts` | 신규 — SHA-256 | memo-codec.ts |
| `negotiation/types.ts` | 수정 — L5Signals, RoundExplainability, ModelAdapter 확장 | — |
| `negotiation/config.ts` | 수정 — StageConfig | — |
| `negotiation/adapters/grok-fast-adapter.ts` | 수정 — location, capabilities 추가 | — |

### Phase B: P0 차별화 기능

| 파일 | 작업 |
|------|------|
| `routes/negotiations.ts` | 수정 — explainability 응답 필드 추가 |
| `routes/negotiation-stages.ts` | 신규 — 외부 에이전트용 Stage별 API |
| `services/l5-signals.service.ts` | 신규 — Swappa 데이터 주입 |
| `negotiation/memory/checkpoint-store.ts` | 수정 — DB 영속화 |

---

## 11. 기존 코드 처리

| 기존 파일 | 처리 |
|-----------|------|
| `lib/llm-negotiation-executor.ts` | Phase A 완료 후 `pipeline/executor.ts`로 교체. 기존 파일은 deprecated 래퍼로 유지 후 삭제 |
| `adapters/context-assembly.ts` | `stages/context.ts`로 흡수. 기존 파일 삭제 |
| `rendering/message-renderer.ts` | `stages/respond.ts`의 template 모드로 흡수 |
| `screening/auto-screening.ts` | `pipeline/executor.ts`의 전처리로 이동 |

---

## 12. 테스트 전략

```
각 Stage 독립 단위 테스트:
  understand.test.ts  — 텍스트 파싱 정확도
  context.test.ts     — L0~L5 조립 + coaching 정합성
  decide.test.ts      — LLM/Skill 분기 + 결정 유효성
  validate.test.ts    — V1~V7 + auto-fix + explainability
  respond.test.ts     — template/LLM 모드 전환
  persist.test.ts     — DB 저장 + phase 전이

Pipeline 통합 테스트:
  pipeline.test.ts    — 6-Stage 순차 실행 E2E
  hybrid.test.ts      — 외부 에이전트 Stage 혼합 호출

기존 테스트 보존:
  14개 시나리오 그룹 → executor.ts 래퍼로 계속 통과
```

---

## 13. 마이그레이션 안전 장치

```
1. 기존 executor를 건드리지 않고 새 pipeline 모듈을 병행 구축
2. 새 pipeline이 기존 14개 통합 테스트 통과 확인
3. Feature flag로 전환: NEGOTIATION_PIPELINE=legacy|staged (default: legacy)
4. staged 모드에서 프로덕션 검증 후 legacy 제거
```

---

*Last Updated: 2026-04-12*
*Version: 1.0*
*기준 문서: Doc 26 (설계), Doc 27 (현황), Doc 28 (전략)*
