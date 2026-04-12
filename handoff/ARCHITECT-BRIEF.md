# Architect Brief — Step 67

*Written by Arch. 2026-04-12.*

---

## Step 67 — P2: 미래 대비 구조 (Validator Lite + Codec 동적 전환 + 파이프라인 분기)

### Context

Step 65-66으로 P0/P1 완료. P2는 LLM 발전에 대비하는 구조적 스위치를 미리 만드는 것.

**Doc 28 P2 항목:**
- #9: Codec/Raw 동적 전환 — `memo-codec.ts`가 이미 codec/raw 둘 다 지원. config에서 자동 전환 로직만 추가.
- #10: Validator Lite 모드 — HARD만 검증하는 경량 모드. HARD 히트율 모니터링.
- #11: 카테고리/금액별 파이프라인 분기 — 금액 구간에 따라 라운드 수, Phase 스킵, Reasoning 활성화 차등.
- #12: Skill Factory — 카테고리 확장 시 스킬 생성 편의. (이번 Step에서는 인터페이스만.)

**변경 금지:**
- `negotiation/referee/coach.ts`, `referee-service.ts` — 그대로
- `negotiation/skills/default-engine-skill.ts` — 그대로
- `negotiation/stages/` — 그대로 (config 참조만)
- `lib/llm-negotiation-executor.ts` — 삭제 금지
- 기존 789 tests 전부 통과

---

### 서브스텝

| Step | 내용 | 예상 LOC |
|------|------|----------|
| 67-A | Validator Lite 모드 + HARD 히트율 추적 | ~120 |
| 67-B | Codec/Raw 동적 전환 로직 | ~60 |
| 67-C | 카테고리/금액별 파이프라인 프리셋 | ~150 |
| 67-D | Skill Factory 인터페이스 | ~100 |
| 67-E | 테스트 | ~200 |

---

## Step 67-A — Validator Lite 모드

### 수정: `negotiation/config.ts`

```typescript
export type ValidationMode = 'full' | 'lite';

export function getValidationMode(): ValidationMode {
  return (process.env.VALIDATION_MODE as ValidationMode) ?? 'full';
}
```

### 신규: `negotiation/referee/violation-tracker.ts` (~80줄)

HARD violation 히트율을 추적하여 Lite 모드 전환 판단 근거를 제공하는 모듈.

```typescript
export interface ViolationStats {
  total_rounds: number;
  hard_violations: number;
  hard_hit_rate: number;         // hard_violations / total_rounds
  last_hard_violation?: {
    round: number;
    rule: string;
    timestamp: number;
  };
  recommended_mode: ValidationMode;  // rate < 0.01 → 'lite', else 'full'
}

export class ViolationTracker {
  /** 라운드 결과 기록 */
  record(validation: ValidationResult): void;

  /** 현재 통계 조회 */
  getStats(): ViolationStats;

  /** 추천 모드 (30일 기준 HARD 히트율 < 1% → lite) */
  getRecommendedMode(): ValidationMode;

  /** 리셋 (테스트용) */
  reset(): void;
}
```

**Lite 모드 동작:**
- `'full'`: V1~V7 전부 검증 (현재 동작)
- `'lite'`: V1~V3 HARD만 검증, V4~V7 SOFT 스킵
- Lite에서 HARD 히트 발생 → 자동으로 full 복귀 + 경고 로그

### 수정: `negotiation/referee/validator.ts`

기존 `validateMove()` 함수에 mode 파라미터 추가:

```typescript
export function validateMove(
  decision: ProtocolDecision,
  coaching: RefereeCoaching,
  memory: CoreMemory,
  phase: NegotiationPhase,
  previousMoves: NegotiationMove[],
  mode: ValidationMode = 'full',  // 기본값 full → 기존 동작 유지
): ValidationResult;
```

- Flag: `mode` 파라미터는 **optional이고 default 'full'**이므로 기존 호출부 변경 없이 동작. 기존 테스트 무변경.

---

## Step 67-B — Codec/Raw 동적 전환

### 수정: `negotiation/config.ts`

```typescript
export type MemoEncoding = 'auto' | 'codec' | 'raw';

export function getMemoEncoding(): MemoEncoding {
  return (process.env.MEMO_ENCODING as MemoEncoding) ?? 'auto';
}

/**
 * auto 모드: 모델 컨텍스트 윈도우와 토큰 단가 기준 자동 선택
 */
export function resolveMemoEncoding(config: {
  modelContextWindow?: number;
  tokenCostPerM?: number;
  encoding: MemoEncoding;
}): 'codec' | 'raw' {
  if (config.encoding !== 'auto') return config.encoding;

  // 컨텍스트 500K+ AND 토큰 $0.05/M 이하 → raw
  if ((config.modelContextWindow ?? 0) > 500_000 && (config.tokenCostPerM ?? 999) < 0.05) {
    return 'raw';
  }
  return 'codec';
}
```

### 수정: `negotiation/pipeline/pipeline.ts`

Stage 2 Context에서 `resolveMemoEncoding()`을 사용하여 인코딩 결정:

```typescript
const resolvedEncoding = resolveMemoEncoding({
  modelContextWindow: deps.config.adapters.DECIDE.contextWindow,
  tokenCostPerM: deps.config.tokenCostPerM,
  encoding: deps.config.memoEncoding,
});
```

- Flag: `StageConfig.memoEncoding` 타입을 `'codec' | 'raw'`에서 `'auto' | 'codec' | 'raw'`로 확장. 기존 테스트는 `'codec'`을 명시적으로 사용하므로 영향 없음.

---

## Step 67-C — 카테고리/금액별 파이프라인 프리셋

### 신규: `negotiation/config/pipeline-presets.ts` (~100줄)

금액 구간에 따른 파이프라인 설정 프리셋.

```typescript
export interface PipelinePreset {
  name: string;
  min_amount: number;            // minor units (cents)
  max_amount: number;
  max_rounds: number;
  phases: NegotiationPhase[];    // 사용할 Phase 목록
  reasoning_enabled: boolean;    // Stage 3에서 reasoning mode 사용 여부
  respond_mode: 'template' | 'llm';
  description: string;
}

export const PIPELINE_PRESETS: PipelinePreset[] = [
  {
    name: 'quick',
    min_amount: 0,
    max_amount: 10000,           // < $100
    max_rounds: 3,
    phases: ['OPENING', 'BARGAINING', 'SETTLEMENT'],  // DISCOVERY, CLOSING 스킵
    reasoning_enabled: false,
    respond_mode: 'template',
    description: '저가 거래 간소화 모드 (1-3 라운드)',
  },
  {
    name: 'standard',
    min_amount: 10000,
    max_amount: 50000,           // $100~$500
    max_rounds: 10,
    phases: ['DISCOVERY', 'OPENING', 'BARGAINING', 'CLOSING', 'SETTLEMENT'],
    reasoning_enabled: false,
    respond_mode: 'template',
    description: '표준 5-Phase 모드',
  },
  {
    name: 'premium',
    min_amount: 50000,
    max_amount: 500000,          // $500~$5,000
    max_rounds: 15,
    phases: ['DISCOVERY', 'OPENING', 'BARGAINING', 'CLOSING', 'SETTLEMENT'],
    reasoning_enabled: true,
    respond_mode: 'llm',
    description: '고가 거래 전체 파이프라인 + Reasoning',
  },
  {
    name: 'enterprise',
    min_amount: 500000,
    max_amount: Infinity,        // > $5,000
    max_rounds: 20,
    phases: ['DISCOVERY', 'OPENING', 'BARGAINING', 'CLOSING', 'SETTLEMENT'],
    reasoning_enabled: true,
    respond_mode: 'llm',
    description: '초고가 거래 + 확장 라운드',
  },
];

/** 금액으로 프리셋 조회 */
export function getPresetForAmount(amountMinor: number): PipelinePreset;

/** 이름으로 프리셋 조회 */
export function getPresetByName(name: string): PipelinePreset | undefined;
```

### 연동: `negotiation/pipeline/executor.ts`

staged executor에서 세션의 `ask_price` (또는 `listing_price`)로 프리셋을 자동 선택:

```typescript
const preset = getPresetForAmount(dbSession.listingPriceMinor);
// preset.max_rounds → 세션 최대 라운드
// preset.reasoning_enabled → StageConfig에 반영
// preset.respond_mode → StageConfig에 반영
```

- Flag: 프리셋 선택은 **staged pipeline에서만 적용**. legacy는 기존 `DEFAULT_MAX_ROUNDS` 사용.

---

## Step 67-D — Skill Factory 인터페이스

### 신규: `negotiation/skills/skill-factory.ts` (~100줄)

새 카테고리 스킬 생성 시 사용할 팩토리 인터페이스와 기본 구현.

```typescript
export interface SkillTemplate {
  category: string;
  terms: CategoryTerm[];
  constraints: SkillConstraint[];
  tactics: string[];
  llm_context: string;
  market_reference?: {
    baseline_source: string;
    avg_discount_rate: number;
  };
}

export interface SkillFactory {
  /** 템플릿에서 NegotiationSkill 생성 */
  createFromTemplate(template: SkillTemplate): NegotiationSkill;

  /** 등록된 템플릿 목록 */
  listTemplates(): SkillTemplate[];

  /** 카테고리로 스킬 조회 */
  getSkillForCategory(category: string): NegotiationSkill | undefined;
}

/**
 * 기본 구현: 하드코딩된 electronics 템플릿만.
 * 향후: DB에서 템플릿 로드, 동적 스킬 생성.
 */
export class DefaultSkillFactory implements SkillFactory {
  private templates = new Map<string, SkillTemplate>();
  private skills = new Map<string, NegotiationSkill>();

  constructor() {
    // Phase 0: electronics 템플릿 등록
    this.registerElectronicsTemplate();
  }

  createFromTemplate(template: SkillTemplate): NegotiationSkill {
    // DefaultEngineSkill을 base로, template 값으로 오버라이드
  }

  getSkillForCategory(category: string): NegotiationSkill | undefined {
    return this.skills.get(category);
  }
}
```

- Flag: `DefaultEngineSkill`은 **수정하지 않는다.** Factory가 생성하는 스킬은 DefaultEngineSkill을 내부적으로 래핑하되, template의 terms/constraints/tactics를 주입한다.
- Flag: 이번 Step에서는 인터페이스 + electronics 기본 등록만. 실제 다른 카테고리 스킬은 Phase 1에서 추가.

---

## Step 67-E — 테스트

| 파일 | 내용 |
|------|------|
| `referee/__tests__/violation-tracker.test.ts` | 히트율 계산, 모드 추천, auto-revert |
| `referee/__tests__/validator-lite.test.ts` | lite 모드에서 SOFT 스킵, HARD 검증 |
| `config/__tests__/pipeline-presets.test.ts` | 금액별 프리셋 선택, 경계값 |
| `config/__tests__/memo-encoding.test.ts` | auto/codec/raw 전환 로직 |
| `skills/__tests__/skill-factory.test.ts` | 템플릿 등록, 스킬 생성, 카테고리 조회 |

---

## 빌드 순서

```
67-A → 67-B → 67-C → 67-D → 67-E
```

---

*끝. Bob은 67-A부터 시작.*
