# Architect Brief — Step 66

*Written by Arch. 2026-04-12.*
*Overwrite this file each step — it is not a log, it is the current active brief.*

---

## Step 66 — Phase B: P0 차별화 기능 (Explainability + L5 Signals + Checkpoint 영속화)

### Context

Step 65에서 6-Stage 파이프라인 + 타입 기반(L5Signals, RoundExplainability, MemoSnapshot)이 완성됐다. 이제 Doc 28 P0 기능을 실제 작동하게 만든다.

**이미 완료된 것 (Step 65):**
- `RoundExplainability` 타입 정의 + `validateStage()`에서 생성
- `L5Signals` 인터페이스 정의
- `memo-manager.ts` SHA-256 해시 + 스냅샷
- `memo-codec.ts` Compressed/Raw 인코딩

**이번 Step에서 할 것:**
1. Explainability를 프로덕션 API 응답에 노출
2. L5 Signals 서비스 (시장 데이터 주입 경로)
3. Checkpoint DB 영속화
4. 외부 에이전트용 Stage별 API 라우트

**기존 코드 변경 금지:**
- `negotiation/referee/` — 전부 그대로
- `negotiation/skills/` — 전부 그대로
- `negotiation/stages/` — Step 65에서 만든 것 그대로 (import만)
- `negotiation/memo/` — Step 65에서 만든 것 그대로 (import만)
- `lib/llm-negotiation-executor.ts` — 삭제 금지

---

### 서브스텝 구조

| Step | 내용 | 예상 LOC |
|------|------|----------|
| 66-A | Explainability API 노출 | ~80 |
| 66-B | L5 Signals 서비스 | ~120 |
| 66-C | Checkpoint DB 영속화 | ~150 |
| 66-D | 외부 에이전트용 Stage API 라우트 | ~200 |
| 66-E | 테스트 | ~250 |

---

## Step 66-A — Explainability API 노출

### 수정: `routes/negotiations.ts`

`POST /negotiations/:sessionId/rounds` 응답에 `explainability` 필드 추가.

현재 staged executor의 `executeStagedNegotiationRound()`가 반환하는 결과에 이미 `PipelineResult.explainability`가 포함되어 있다. 이걸 API 응답에 포함시키면 된다.

```typescript
// 응답 확장
{
  // 기존 필드 유지
  round_number: number,
  action: string,
  price: number,
  message: string,
  phase: string,
  // 신규
  explainability?: RoundExplainability,  // NEGOTIATION_PIPELINE=staged일 때만
}
```

**규칙:**
- `NEGOTIATION_PIPELINE=legacy`이면 `explainability` 필드 없음 (기존 동작 유지)
- `NEGOTIATION_PIPELINE=staged`이면 `explainability` 포함
- 클라이언트에게 선택권: `?include_explainability=true` 쿼리 파라미터

### 신규: `GET /negotiations/:sessionId/decisions`

세션의 전체 라운드별 의사결정 로그 조회 API.

```typescript
// Response
{
  session_id: string,
  decisions: RoundExplainability[],  // 라운드 순서대로
}
```

- Flag: 이 API는 DB에 저장된 explainability 데이터를 조회한다. Step 66-C에서 checkpoint에 explainability를 함께 저장한다.

---

## Step 66-B — L5 Signals 서비스

### 신규: `services/l5-signals.service.ts` (~120줄)

외부 시장 데이터를 L5Signals 형식으로 변환하는 서비스.

```typescript
export interface L5SignalsProvider {
  getMarketSignals(params: {
    category: string;
    item_model: string;
    condition?: string;
  }): Promise<L5Signals>;
}

/**
 * 초기 구현: 하드코딩된 Swappa 기준 데이터.
 * 향후: Swappa API, eBay API 등 실제 크롤링/API 연동.
 */
export class StaticL5SignalsProvider implements L5SignalsProvider {
  async getMarketSignals(params): Promise<L5Signals> {
    // Phase 0: iPhone Pro 카테고리 기준 정적 데이터
    return {
      market: {
        avg_sold_price_30d: getSwappaMedian(params.item_model),
        price_trend: 'stable',
        active_listings_count: 0,  // 미구현
        source_prices: [],          // 미구현
      },
      category: {
        avg_discount_rate: 0.12,    // 전자제품 평균 12% 할인
        avg_rounds_to_deal: 4.2,    // 평균 4.2 라운드
      },
    };
  }
}
```

**Swappa 기준 데이터 (하드코딩, Phase 0):**

```typescript
const SWAPPA_MEDIANS: Record<string, number> = {
  'iphone-15-pro-128': 85000,      // $850 (minor units)
  'iphone-15-pro-256': 92000,      // $920
  'iphone-15-pro-512': 105000,     // $1,050
  'iphone-14-pro-128': 62000,      // $620
  'iphone-14-pro-256': 68000,      // $680
  'iphone-13-pro-128': 45000,      // $450
  'iphone-13-pro-256': 50000,      // $500
};
```

- Flag: 실제 API 연동은 이 Step 범위 밖. 인터페이스와 정적 provider만 구현. 향후 `SwappaApiProvider`, `EbayApiProvider` 등으로 교체 가능한 구조.

### 연동: Pipeline에서 L5 Signals 주입

`negotiation/pipeline/executor.ts` 수정:
- `executeStagedNegotiationRound()` 에서 L5SignalsProvider를 호출
- 결과를 Stage 2 Context의 `l5_signals` 파라미터로 전달

---

## Step 66-C — Checkpoint DB 영속화

### 수정: `negotiation/memory/checkpoint-store.ts`

현재 in-memory `Map` 기반 → DB 저장 옵션 추가.

**접근 방식:** 기존 in-memory 인터페이스는 유지하고, DB 저장 콜백을 optional로 받는다.

```typescript
export interface CheckpointPersistence {
  save(sessionId: string, checkpoint: Checkpoint): Promise<void>;
  load(sessionId: string): Promise<Checkpoint[]>;
}

// 기존 CheckpointStore에 persistence 옵션 추가
export class CheckpointStore {
  constructor(private persistence?: CheckpointPersistence) {}

  async save(sessionId: string, checkpoint: Checkpoint): Promise<void> {
    // 기존 in-memory 저장
    this.store.set(...);
    // DB 저장 (있으면)
    await this.persistence?.save(sessionId, checkpoint);
  }
}
```

**Checkpoint에 explainability 포함:**

```typescript
// Checkpoint 타입 확장 (types.ts)
interface Checkpoint {
  // 기존 필드 유지
  phase: NegotiationPhase;
  round: number;
  memory: CoreMemory;
  timestamp: number;
  version: number;
  // 신규
  explainability?: RoundExplainability;
  memo_hash?: string;
}
```

- Flag: 실제 DB 테이블 생성(migration)은 이 Step에서 하지 않는다. `CheckpointPersistence` 인터페이스만 정의하고, in-memory 기본 동작은 유지. 향후 `PostgresCheckpointPersistence` 구현 시 migration 추가.
- Flag: `checkpoint-store.ts`는 "변경 금지" 목록에 없다 (negotiation/memory/의 core-memory, session-memory, checkpoint-store 중 checkpoint-store만 수정 대상). **단, 기존 테스트가 깨지면 안 된다.** `persistence` 파라미터가 optional이므로 기존 코드는 무변경 동작.

---

## Step 66-D — 외부 에이전트용 Stage API 라우트

### 신규: `routes/negotiation-stages.ts` (~200줄)

외부 에이전트가 개별 Stage를 호출할 수 있는 API.

```
POST /negotiations/stages/context    ← Stage 2
POST /negotiations/stages/validate   ← Stage 4
POST /negotiations/stages/respond    ← Stage 5
```

**Stage 2 — Context:**
```typescript
// Request
{
  understood: UnderstandOutput,
  memory: CoreMemory,
  facts: RoundFact[],
  opponent: OpponentPattern,
  skill_id: string,              // → TermRegistry에서 skill 조회
  l5_signals?: L5Signals,
}
// Response
{
  layers: ContextLayers,
  coaching: RefereeCoaching,
  memo_snapshot: string,
}
```

**Stage 4 — Validate:**
```typescript
// Request
{
  decision: ProtocolDecision,
  coaching: RefereeCoaching,
  memory: CoreMemory,
  phase: NegotiationPhase,
}
// Response
{
  final_decision: ProtocolDecision,
  validation: ValidationResult,
  auto_fix_applied: boolean,
  explainability: RoundExplainability,
}
```

**Stage 5 — Respond:**
```typescript
// Request
{
  validated: ValidateOutput,
  memory: CoreMemory,
  skill_id: string,
}
// Response
{
  message: string,
  tone: string,
}
```

**인증:**
- 이 라우트들은 API 키 인증 필요 (기존 auth middleware 사용)
- `x-haggle-actor-id` 헤더 필수

### 서버 등록

`server.ts` 수정:
```typescript
import { registerStageRoutes } from './routes/negotiation-stages.js';
// ...
registerStageRoutes(app, db);
```

---

## Step 66-E — 테스트

| 파일 | 내용 |
|------|------|
| `__tests__/explainability-api.test.ts` | decisions 조회 API, include_explainability 파라미터 |
| `__tests__/l5-signals.test.ts` | StaticL5SignalsProvider, Swappa median 조회 |
| `__tests__/checkpoint-persistence.test.ts` | in-memory 기본 동작 유지, persistence 콜백 호출 검증 |
| `__tests__/stage-routes.test.ts` | Stage 2/4/5 API 호출, 입력 검증, 응답 구조 |

---

## 빌드 순서

```
66-A → 66-B → 66-C → 66-D → 66-E
```

66-A와 66-B는 독립적이라 병행 가능하지만, Bob은 순차 진행.

---

## 변경하면 안 되는 것

1. `negotiation/referee/` — 전부 그대로
2. `negotiation/skills/` — 전부 그대로
3. `negotiation/stages/` — Step 65 그대로 (import만)
4. `negotiation/memo/` — Step 65 그대로 (import만)
5. `negotiation/phase/` — 전부 그대로
6. `negotiation/adapters/xai-client.ts` — 그대로
7. `lib/llm-negotiation-executor.ts` — 삭제 금지
8. 기존 752 tests — 전부 통과

---

*끝. Bob은 66-A부터 시작.*
