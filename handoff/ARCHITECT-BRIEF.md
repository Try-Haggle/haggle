# Architect Brief — Step 65

*Written by Arch. 2026-04-12.*
*Overwrite this file each step — it is not a log, it is the current active brief.*

---

## Step 65 — 6-Stage Pipeline 리팩토링 + 모듈화

### Context

Doc 29 (`docs/engine/29_6Stage_리팩토링_구현계획.md`)에 따라 현재 13-step 모노리스 executor(`lib/llm-negotiation-executor.ts`)를 6-Stage 독립 모듈로 분리한다.

**왜 지금 하는가:**
1. Doc 28 P0 기능(SHA-256 해시, Explainability, L5 Signals)을 넣으려면 Stage별 경계가 있어야 함
2. 외부 에이전트가 Stage 2(Context), 4(Validate), 6(Persist)만 골라 쓸 수 있는 구조 필요
3. 현재 `context-assembly.ts`가 dead code (executor가 호출하지 않음)

**기준 문서:**
- `docs/engine/26_LLM_Native_협상_파이프라인.md` — 6-Stage 설계
- `docs/engine/29_6Stage_리팩토링_구현계획.md` — 구현 계획

**기존 코드 변경 금지:**
- `negotiation/referee/` — coach.ts, validator.ts, referee-service.ts 그대로 사용
- `negotiation/skills/` — default-engine-skill.ts 그대로 사용
- `negotiation/memory/` — core-memory.ts, session-memory.ts, checkpoint-store.ts 그대로 사용
- `negotiation/phase/` — phase-machine.ts 그대로 사용
- `negotiation/adapters/xai-client.ts` — 그대로 사용

---

### 설계 원칙

1. **각 Stage는 순수 함수** — DB 의존 없음 (Stage 6 persist 제외)
2. **외부 export** — 모든 Stage 함수를 named export하여 외부 에이전트 호출 가능
3. **기존 테스트 보존** — 기존 14개 시나리오 그룹(640 tests) 깨지지 않도록 legacy 래퍼 유지
4. **Feature flag 전환** — `NEGOTIATION_PIPELINE=legacy|staged` (default: legacy)

---

### 서브스텝 구조

| Step | 내용 | 의존성 | 예상 LOC |
|------|------|--------|----------|
| 65-A | 타입 + 인터페이스 확장 | 없음 | ~120 |
| 65-B | memo-codec.ts + memo-manager.ts | 65-A | ~180 |
| 65-C | 6 Stage 함수 + pipeline 오케스트레이터 | 65-A, 65-B | ~450 |
| 65-D | executor.ts (DB TX 래퍼 + feature flag) | 65-C | ~200 |
| 65-E | 테스트 | 65-C, 65-D | ~300 |

---

## Step 65-A — 타입 + 인터페이스 확장

### 수정: `negotiation/types.ts`

**1. L5Signals 인터페이스 추가**

```typescript
export interface L5Signals {
  market?: {
    avg_sold_price_30d: number;
    price_trend: 'rising' | 'stable' | 'falling';
    active_listings_count: number;
    source_prices: Array<{ platform: string; price: number }>;
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

**2. RoundExplainability 인터페이스 추가**

```typescript
export interface RoundExplainability {
  round: number;
  coach_recommendation: {
    price: number;
    basis: string;
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

**3. ModelAdapter 확장** — 기존 필드 유지, 2개 추가

```typescript
export interface ModelAdapter {
  // 기존 유지
  readonly modelId: string;
  readonly tier: 'basic' | 'standard' | 'advanced' | 'frontier';
  buildSystemPrompt(skillContext: string): string;
  buildUserPrompt(
    memory: CoreMemory,
    recentFacts: RoundFact[],
    signals?: string[],
    prevMemory?: CoreMemory,
  ): string;
  parseResponse(raw: string): ProtocolDecision;
  coachingLevel(): 'DETAILED' | 'STANDARD' | 'LIGHT';

  // 신규
  readonly location: 'remote' | 'local';
  readonly capabilities: readonly ('parse' | 'reason' | 'generate')[];
}
```

**4. StageConfig 인터페이스 추가**

```typescript
export interface StageConfig {
  adapters: {
    UNDERSTAND: ModelAdapter;
    DECIDE: ModelAdapter;
    RESPOND: ModelAdapter;
  };
  modes: {
    RESPOND: 'template' | 'llm';
    VALIDATE: 'full' | 'lite';
  };
  memoEncoding: 'codec' | 'raw';
  reasoningEnabled: boolean;
}
```

**5. Stage Input/Output 타입들** — `negotiation/pipeline/types.ts`에 신규 파일로

```typescript
// Stage 1
export interface UnderstandInput {
  raw_message: string;
  sender_role: 'buyer' | 'seller';
}
export interface UnderstandOutput {
  price_offer?: number;
  action_intent: 'OFFER' | 'COUNTER' | 'ACCEPT' | 'REJECT' | 'QUESTION' | 'INFO';
  conditions: Record<string, unknown>;
  sentiment: 'positive' | 'neutral' | 'negative';
  raw_text: string;
}

// Stage 2
export interface ContextInput {
  understood: UnderstandOutput;
  memory: CoreMemory;
  facts: RoundFact[];
  opponent: OpponentPattern;
  skill: NegotiationSkill;
  l5_signals?: L5Signals;
}
export interface ContextOutput {
  layers: ContextLayers;
  coaching: RefereeCoaching;
  memo_snapshot: string;
}

// Stage 3
export interface DecideInput {
  context: ContextOutput;
  adapter: ModelAdapter;
  skill: NegotiationSkill;
  phase: NegotiationPhase;
  config: StageConfig;
  memory: CoreMemory;
  facts: RoundFact[];
  opponent: OpponentPattern;
}
export interface DecideOutput {
  decision: ProtocolDecision;
  source: 'llm' | 'skill';
  reasoning_mode: boolean;
  llm_raw?: string;
  tokens?: { prompt: number; completion: number };
  latency_ms?: number;
}

// Stage 4
export interface ValidateInput {
  decision: DecideOutput;
  coaching: RefereeCoaching;
  memory: CoreMemory;
  phase: NegotiationPhase;
}
export interface ValidateOutput {
  final_decision: ProtocolDecision;
  validation: ValidationResult;
  auto_fix_applied: boolean;
  retry_count: number;
  explainability: RoundExplainability;
}

// Stage 5
export interface RespondInput {
  validated: ValidateOutput;
  memory: CoreMemory;
  adapter: ModelAdapter;
  skill: NegotiationSkill;
  config: StageConfig;
}
export interface RespondOutput {
  message: string;
  tone: string;
  llm_raw?: string;
  tokens?: { prompt: number; completion: number };
}

// Stage 6
export interface PersistInput {
  session_id: string;
  round_number: number;
  decision: ValidateOutput;
  response: RespondOutput;
  memory: CoreMemory;
  memo_hash: string;
  explainability: RoundExplainability;
}
export interface PersistOutput {
  phase_transition?: { from: string; to: string; event: string };
  session_done: boolean;
}

// Pipeline 전체
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
```

### 수정: `negotiation/adapters/grok-fast-adapter.ts`

기존 코드에 `location`과 `capabilities` 필드 2개만 추가:

```typescript
readonly location = 'remote' as const;
readonly capabilities = ['parse', 'reason', 'generate'] as const;
```

- Flag: 기존 메서드는 건드리지 않는다. 필드 추가만.

---

## Step 65-B — memo-codec.ts + memo-manager.ts

### 신규: `negotiation/memo/memo-codec.ts` (~100줄)

Living Memo Compressed Codec (Doc 26 §3 규격).

```typescript
export type MemoEncoding = 'codec' | 'raw';

/** Compressed Codec — ~390 tokens */
export function encodeCompressed(memory: CoreMemory): string;

/** Raw JSON — ~1000 tokens */
export function encodeRaw(memory: CoreMemory): string;

/** 자동 선택 */
export function encodeMemo(memory: CoreMemory, encoding: MemoEncoding): string;
```

**Compressed 형식 (Shared Layer):**
```
NS:BARGAINING|R3/10|buyer|FULL_AUTO
PT:85000→90000|gap:5000(5.6%)
CL:rec:87000|tactic:reciprocal|opp:CONCEDER|conv:0.72
RM:R1:COUNTER@88000→92000|R2:COUNTER@86000→91000|R3:COUNTER@85000→90000
```

**Compressed 형식 (Private Layer):**
```
SS:t:83000|f:95000|β:1.5
OM:CONCEDER(0.78)|ema:0.65|shifts:0
TA:warranty_period=important|battery_health=critical
TR:V7:SOFT@R2(양보과다)|auto_fix:0
```

- Flag: `GrokFastAdapter.buildUserPrompt()`이 이미 `S:|B:|C:` 인코딩을 한다. 그것과 **별개**로 `memo-codec.ts`는 6-Stage pipeline의 Stage 2에서 사용하는 독립 모듈이다. 기존 adapter 인코딩을 건드리지 않는다.

### 신규: `negotiation/memo/memo-manager.ts` (~80줄)

```typescript
import { createHash } from 'crypto';

export interface MemoSnapshot {
  shared: string;
  private: string;
  hash: string;         // SHA-256(shared)
  round: number;
  timestamp: number;
}

export function computeMemoHash(sharedMemo: string): string {
  return createHash('sha256').update(sharedMemo).digest('hex');
}

export function createSnapshot(
  memory: CoreMemory,
  round: number,
  encoding: MemoEncoding,
): MemoSnapshot;

export function verifyMemoIntegrity(snapshot: MemoSnapshot): boolean;
```

---

## Step 65-C — 6 Stage 함수 + pipeline

### 신규 디렉토리: `negotiation/stages/`

| 파일 | 함수 | 내용 |
|------|------|------|
| `understand.ts` | `understand()` | LLM 파싱 (structured input bypass 지원) |
| `context.ts` | `assembleStageContext()` | 기존 `context-assembly.ts` 로직 흡수 + coach 호출 + memo-codec |
| `decide.ts` | `decide()` | Skill rule-based → optional LLM. 기존 executor Step 8 로직 추출 |
| `validate.ts` | `validateStage()` | referee-service.process() 래핑 + RoundExplainability 생성 |
| `respond.ts` | `respond()` | template 모드(기존 renderer) / LLM 모드 분기 |
| `persist.ts` | `persist()` | DB 저장 + phase 전이 + memo hash 기록 |
| `index.ts` | re-export | 6개 함수 전부 named export |

### 핵심 규칙

1. **understand.ts** — 현재 프로덕션은 `offerPriceMinor`를 직접 받으므로, structured input이 이미 있으면 LLM 호출 없이 바로 `UnderstandOutput`을 만드는 bypass 경로 필수.

2. **context.ts** — 기존 `adapters/context-assembly.ts`의 `assembleContextLayers()` 로직을 가져온다. 추가로 `computeCoaching()`도 여기서 호출하여 `ContextOutput.coaching`에 포함. L5Signals 파라미터는 optional (현재는 빈 객체).

3. **decide.ts** — 기존 executor의 핵심 분기 로직 추출:
   - BARGAINING + COUNTER일 때 → `callLLM()` + `adapter.parseResponse()`
   - 그 외 → `skill.evaluateOffer()` 또는 `skill.generateMove()`
   - `DecideOutput.source`로 누가 결정했는지 기록

4. **validate.ts** — `RefereeService.process()`를 호출하되, `RoundExplainability` 구조체를 만들어 반환. HARD violation auto-fix 루프는 referee-service에 이미 있으므로 그대로 위임.

5. **respond.ts** — config.modes.RESPOND에 따라 분기:
   - `'template'`: 기존 `TemplateMessageRenderer.render()` 사용
   - `'llm'`: 미래용 LLM 메시지 생성 (현재는 template fallback)

6. **persist.ts** — 이 Stage만 DB 의존. 기존 executor의 Step 11~13 로직(persist round + update session + event dispatch) 추출.

### 신규: `negotiation/pipeline/pipeline.ts` (~100줄)

```typescript
export async function executePipeline(
  session: SessionState,
  message: string | UnderstandOutput,  // raw text 또는 이미 파싱된 입력
  deps: PipelineDeps,
): Promise<PipelineResult>;
```

6개 Stage를 순차 호출하는 오케스트레이터. 각 Stage 결과를 `PipelineResult.stages`에 누적.

- Flag: `context-assembly.ts`는 **삭제하지 않는다.** `context.ts`가 그 로직을 import하여 사용해도 되고, 복사해도 된다. 기존 import 경로가 깨지면 안 됨.

---

## Step 65-D — executor.ts (DB TX 래퍼)

### 신규: `negotiation/pipeline/executor.ts` (~200줄)

기존 `lib/llm-negotiation-executor.ts`를 대체하는 새 진입점.

```typescript
export async function executeNegotiationRound(
  sessionId: string,
  offerPriceMinor: number,
  actorId: string,
  db: Database,
  eventDispatcher: EventDispatcher,
): Promise<RoundResult>;
```

내부 흐름:
1. BEGIN TX + SELECT FOR UPDATE
2. Terminal/expiry check
3. Memory reconstruction (기존 `memory-reconstructor.ts` 사용)
4. Screening (기존 `auto-screening.ts` 사용)
5. **`executePipeline()` 호출** ← 여기서 6-Stage 실행
6. COMMIT

### Feature Flag 전환

`lib/executor-factory.ts` 수정:

```typescript
// NEGOTIATION_PIPELINE=legacy → 기존 llm-negotiation-executor
// NEGOTIATION_PIPELINE=staged → 새 pipeline/executor
```

- Flag: 기존 `llm-negotiation-executor.ts`는 **삭제하지 않는다.** Feature flag로 전환 가능하게 두고, 새 executor가 기존 14개 시나리오 테스트를 전부 통과한 후 legacy 제거.

---

## Step 65-E — 테스트

### 단위 테스트 (각 Stage)

| 파일 | 내용 |
|------|------|
| `stages/__tests__/understand.test.ts` | structured input bypass, 텍스트 파싱 |
| `stages/__tests__/context.test.ts` | L0~L5 조립, coaching 포함, codec 인코딩 |
| `stages/__tests__/decide.test.ts` | LLM/Skill 분기, reasoning 모드 |
| `stages/__tests__/validate.test.ts` | V1~V7, auto-fix, explainability 구조 |
| `stages/__tests__/respond.test.ts` | template/LLM 모드 전환 |
| `memo/__tests__/memo-codec.test.ts` | compressed/raw 인코딩·디코딩 |
| `memo/__tests__/memo-manager.test.ts` | SHA-256 해시, 스냅샷 생성·검증 |

### 통합 테스트

| 파일 | 내용 |
|------|------|
| `pipeline/__tests__/pipeline.test.ts` | 6-Stage 순차 실행 E2E |
| `pipeline/__tests__/hybrid.test.ts` | 외부 에이전트 Stage 혼합 호출 시뮬레이션 |

### 기존 테스트 보존

- 기존 640 tests 전부 통과해야 함
- Feature flag `NEGOTIATION_PIPELINE=legacy`에서 기존 경로 테스트
- Feature flag `NEGOTIATION_PIPELINE=staged`에서 새 경로 테스트

---

## 빌드 순서

```
65-A → 65-B → 65-C → 65-D → 65-E
```

65-A가 끝나면 65-B와 65-C의 타입 의존성이 해결되므로, Bob이 순차 진행.

---

## 변경하면 안 되는 것

1. `negotiation/referee/` — 전부 그대로
2. `negotiation/skills/` — 전부 그대로
3. `negotiation/memory/` — core-memory, session-memory, checkpoint-store 그대로
4. `negotiation/phase/` — 전부 그대로
5. `negotiation/adapters/xai-client.ts` — 그대로
6. `lib/llm-negotiation-executor.ts` — 삭제 금지, feature flag로 병행
7. 기존 640 tests — 전부 통과

---

*끝. Bob은 65-A부터 시작.*
