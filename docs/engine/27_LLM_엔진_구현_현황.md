# 27. LLM-Native 협상 엔진 — 구현 현황 및 마이그레이션 가이드

> **작성일:** 2026-04-12
> **기준 설계:** Doc 25 (LLM 협상 아키텍처) + Doc 26 (LLM-Native 파이프라인) 확정
> **브랜치:** `feature/mvp-integration`

---

## 1. 한 줄 요약

**"엔진은 심판, LLM은 선수, Skill은 지식."**
기존 "BARGAINING COUNTER만 LLM" 설계를 폐기하고, **전 Phase에서 LLM이 판단**하는 6-Stage 파이프라인으로 전환.
현재 Demo 라우트에서 전 Stage가 검증 완료되었으며, 프로덕션 라우트로의 마이그레이션이 필요.

---

## 2. 아키텍처 개요

### 2.1 역할 분리 (3대 원칙)

| 역할 | 담당 | 설명 |
|------|------|------|
| **Brain** | LLM (Grok 4 Fast) | 모든 Phase에서 판단 — 의도 파싱, 결정, 메시지 생성 |
| **Knowledge** | Skill (`DefaultEngineSkill`) | 카테고리별 도메인 지식 제공 — 전술, 제약, Terms |
| **Safety** | Referee (`coach` + `validator`) | 수학적 안전망 — Faratin 코칭, 7개 규칙 검증, 자동 수정 |

### 2.2 6-Stage 파이프라인

```
판매자 메시지
  → ① UNDERSTAND (LLM)     — 자연어 → 구조화 의도
  → ② CONTEXT   (코드)     — Living Memo + Skill + Coach 조립
  → ③ DECIDE    (LLM)      — 전체 맥락 → ProtocolDecision
  → ④ VALIDATE  (코드)     — Referee 7개 규칙 검증
  → ⑤ RESPOND   (LLM)      — 결정 → 자연어 메시지
  → ⑥ PERSIST   (코드)     — Memo 갱신 + Phase 전이
```

- **LLM 단계** (①③⑤): xAI API 호출, JSON 구조화 출력
- **코드 단계** (②④⑥): 순수 함수, 결정론적, 감사 가능

---

## 3. 디렉토리 구조 & 모듈 맵

```
apps/api/src/negotiation/
├── types.ts                     ← 전체 타입 시스템 (390줄)
├── config.ts                    ← 엔진 모드, reasoning 트리거, 기본값
├── adapters/
│   ├── xai-client.ts            ← xAI HTTP 클라이언트 (retry, timeout, telemetry)
│   ├── grok-fast-adapter.ts     ← ModelAdapter 구현 (compact encoding, JSON 파싱)
│   └── context-assembly.ts      ← L0-L5 컨텍스트 레이어 조립
├── memory/
│   ├── core-memory.ts           ← CoreMemory CRUD (in-memory, DB-ready)
│   ├── session-memory.ts        ← RoundFact + OpponentPattern 저장소
│   ├── checkpoint-store.ts      ← Phase 체크포인트 + 되감기(Revert)
│   └── memory-reconstructor.ts  ← DB 행 → 엔진 타입 변환 (순수 함수)
├── phase/
│   ├── phase-machine.ts         ← 5-Phase 상태 기계 (순수 함수)
│   └── human-intervention.ts    ← 4가지 개입 모드 (FULL_AUTO~MANUAL)
├── prompts/
│   └── protocol-rules.ts        ← L0 불변 프로토콜 규칙
├── referee/
│   ├── coach.ts                 ← 코칭 계산 (Faratin + EMA, 순수 함수)
│   ├── validator.ts             ← 7개 검증 규칙 (V1-V3 HARD, V4-V7 SOFT)
│   └── referee-service.ts       ← Coach→Validate→AutoFix→Render 오케스트레이션
├── rendering/
│   └── message-renderer.ts      ← 템플릿 기반 메시지 생성 (Doc 26에서 LLM 대체 예정)
├── screening/
│   └── auto-screening.ts        ← 스팸/악용 탐지 (Doc 26에서 UNDERSTAND 흡수 예정)
├── skills/
│   └── default-engine-skill.ts  ← Electronics/iPhone Pro 스킬 (규칙 기반 Hot Path)
├── term/
│   ├── standard-terms.ts        ← 12개 Electronics 표준 Terms
│   └── term-registry.ts         ← 3계층 Term 레지스트리 (표준→Skill→커스텀)
├── orchestration/               ← (비어있음 — 향후 멀티 세션 오케스트레이션)
└── realtime/                    ← (비어있음 — 향후 WebSocket/SSE)
```

---

## 4. Stage별 구현 상태

### 4.1 Stage 0: 초기화 (전략 + Term 분석)

| 항목 | 상태 | 위치 |
|------|------|------|
| 0a 전략 생성 | ✅ Demo 검증 완료 | `negotiation-demo.ts` |
| 0b Term 분석 | ✅ Demo 검증 완료 | `negotiation-demo.ts` |
| 프로덕션 통합 | ❌ 미완 | 세션 생성 시 LLM 호출 필요 |

**검증 내용:**
- LLM이 아이템+시장 데이터를 입력받아 `target_price`, `floor_price`, `negotiation_style` 등 구매 전략 JSON 생성
- LLM이 전략+12개 표준 Terms를 입력받아 `priority_terms[]`, `deal_breakers[]` JSON 생성
- 한국어 프롬프트로 `approach`, `key_concerns`, `rationale` 한국어 출력 확인

### 4.2 Stage 1: UNDERSTAND (LLM)

| 항목 | 상태 | 위치 |
|------|------|------|
| 자연어 파싱 | ✅ Demo 검증 완료 | `negotiation-demo.ts` |
| 프로덕션 통합 | ❌ 미완 | 현재 프로덕션은 구조화된 가격만 수신 |

**검증 내용:**
- 판매자 한국어 메시지 → `price_offer`, `sentiment`, `tactic_detected`, `message_type` 파싱
- Agent-to-Agent 시나리오에서는 이 Stage 스킵 가능 (Doc 26 §2)

**출력 스키마:**
```json
{
  "price_offer": 90000,
  "conditions_proposed": [{"term": "shipping", "value": "무료배송"}],
  "sentiment": "cooperative",
  "tactic_detected": "reciprocal_concession",
  "message_type": "counter"
}
```

### 4.3 Stage 2: CONTEXT (코드)

| 항목 | 상태 | 위치 |
|------|------|------|
| 컨텍스트 조립 | ✅ 프로덕션 적용 | `context-assembly.ts` |
| Faratin 코칭 | ✅ 프로덕션 적용 | `coach.ts` |
| Living Memo | ✅ Demo 검증 완료 | `negotiation-demo.ts` (인라인 Codec) |
| Compressed Codec | ⚠️ 인라인 구현 | 별도 `memo-codec.ts` 분리 필요 |

**6계층 컨텍스트 (L0-L5):**

| 레이어 | 내용 | 갱신 주기 |
|--------|------|----------|
| L0 Protocol Rules | 불변 프로토콜 규칙 | 불변 |
| L1 Model Instructions | 모델별 출력 지시문 | 모델 교체 시 |
| L2 Skill Context | 도메인 지식, 전술, 제약 | 세션 시작 시 |
| L3 Coaching | Faratin 추천가, 상대 패턴 | 매 라운드 |
| L4 History | 가격 이력, 라운드 요약 | 누적 |
| L5 Signals | 외부 시세, 경쟁 세션 | 이벤트 기반 |

### 4.4 Stage 3: DECIDE (LLM)

| 항목 | 상태 | 위치 |
|------|------|------|
| BARGAINING 결정 | ✅ 프로덕션 적용 | `llm-negotiation-executor.ts` step 8b |
| 전 Phase 결정 | ✅ Demo 검증 완료 | `negotiation-demo.ts` |
| Reasoning 모드 | ✅ 프로덕션 적용 | `config.ts` `shouldUseReasoning()` |

**Reasoning 모드 트리거 (자동):**
- Gap ratio < 10% (거의 합의)
- Coach 경고 2개 이상
- 상대가 BOULWARE 패턴
- SOFT violation 2개 이상

**출력 스키마:**
```json
{
  "action": "COUNTER",
  "price": 85000,
  "reasoning": "판매자가 초기 90000을 제시했으므로 Faratin 추천에 따라...",
  "tactic_used": "reciprocal_concession",
  "non_price_terms": {},
  "phase_assessment": "BARGAINING",
  "near_deal": false
}
```

### 4.5 Stage 4: VALIDATE (코드)

| 항목 | 상태 | 위치 |
|------|------|------|
| 7개 규칙 검증 | ✅ 프로덕션 적용 | `validator.ts` |
| 자동 수정 (HARD) | ✅ 프로덕션 적용 | `referee-service.ts` |
| Fallback | ✅ 프로덕션 적용 | `default-engine-skill.ts` |

**7개 검증 규칙:**

| # | 규칙 | 심각도 | 설명 |
|---|------|--------|------|
| V1 | 가격 범위 초과 | HARD | floor price 초과 시 차단 |
| V2 | 프로토콜 위반 | HARD | Phase에 맞지 않는 action |
| V3 | 라운드 소진 | HARD | 0 라운드 남았는데 COUNTER |
| V4 | 양보 역전 | SOFT | 이전보다 더 적게 양보 |
| V5 | 교착 상태 | SOFT | 4라운드+ 2% 미만 양보 |
| V6 | 일방 양보 | SOFT | 3라운드+ 한쪽만 양보 |
| V7 | 과도 양보 | SOFT | Faratin 기준 2배 초과 |

**처리 흐름:**
- HARD violation → `suggested_fix` 적용 후 재검증 (최대 2회)
- 재시도 실패 → `DefaultEngineSkill` fallback (규칙 기반)
- SOFT violation → 경고 기록, 진행 허용

### 4.6 Stage 5: RESPOND (LLM)

| 항목 | 상태 | 위치 |
|------|------|------|
| LLM 메시지 생성 | ✅ Demo 검증 완료 | `negotiation-demo.ts` |
| 프로덕션 (템플릿) | ✅ 적용 중 | `message-renderer.ts` |
| 프로덕션 LLM 전환 | ❌ 미완 | Doc 26: TemplateMessageRenderer 대체 |

**현재 프로덕션:** 6가지 action × 5가지 스타일 × 2가지 격식의 템플릿 기반 생성
**Demo:** LLM이 한국어 자연어 메시지를 직접 생성 (검증 완료)

### 4.7 Stage 6: PERSIST + TRANSITION (코드)

| 항목 | 상태 | 위치 |
|------|------|------|
| Phase 전이 | ✅ 프로덕션 적용 | `phase-machine.ts` |
| DB 저장 | ✅ 프로덕션 적용 | `llm-negotiation-executor.ts` step 11-12 |
| 이벤트 발행 | ✅ 프로덕션 적용 | `event-dispatcher.ts` |
| 체크포인트/되감기 | ✅ 구현 완료 | `checkpoint-store.ts` (in-memory) |

**Phase 전이 규칙:**
```
DISCOVERY → OPENING     (첫 제안 시)
OPENING   → BARGAINING  (역제안 시)
BARGAINING → CLOSING    (거의 합의 감지)
CLOSING   → SETTLEMENT  (양쪽 CONFIRM)
```

---

## 5. 프로덕션 vs Demo 차이점

| 영역 | 프로덕션 (`negotiations.ts`) | Demo (`negotiation-demo.ts`) |
|------|------------------------------|------------------------------|
| **인증** | `requireAuth` | 없음 (zero-auth) |
| **DB** | PostgreSQL (트랜잭션) | In-memory Map |
| **LLM 사용 범위** | BARGAINING COUNTER만 | 전 Phase (Doc 26 설계) |
| **Stage 1 UNDERSTAND** | 구조화 가격 직접 수신 | LLM 자연어 파싱 |
| **Stage 5 RESPOND** | TemplateMessageRenderer | LLM 한국어 생성 |
| **Stage 0 전략 생성** | 없음 | LLM 전략+Term 분석 |
| **비용 추적** | `withLLMTelemetry` | 라운드/세션별 토큰+비용 집계 |
| **언어** | 영어 | 한국어 |

---

## 6. 비용 분석

### 6.1 모델: Grok 4 Fast

| 항목 | 가격 |
|------|------|
| Input | $0.20/M tokens |
| Output | $0.50/M tokens |
| JSON 구조화 출력 | 추가 비용 없음 |
| Reasoning 모드 | 동일 가격, 긴 타임아웃 |

### 6.2 라운드당 비용 (6-Stage, Demo 실측)

| Stage | Input 토큰 | Output 토큰 | 비용 |
|-------|-----------|------------|------|
| ① UNDERSTAND | ~330 | ~35 | $0.000083 |
| ③ DECIDE | ~680 | ~85 | $0.000179 |
| ⑤ RESPOND | ~310 | ~30 | $0.000077 |
| **라운드 합계** | **~1,320** | **~150** | **~$0.00034** |

### 6.3 세션당 비용

| 항목 | 비용 |
|------|------|
| Init (0a+0b) | ~$0.0004 |
| 15라운드 | ~$0.0051 |
| **세션 합계** | **~$0.0055** |

### 6.4 마진 분석

| 규모 | 월 비용 | HC $4.99 기준 마진 |
|------|--------|-------------------|
| 1만 세션/월 | $55 | 99.9% |
| 10만 세션/월 | $550 | 99.6% |

---

## 7. 핵심 타입 정의

### 7.1 ProtocolDecision

```typescript
interface ProtocolDecision {
  action: 'COUNTER' | 'ACCEPT' | 'REJECT' | 'HOLD' | 'DISCOVER' | 'CONFIRM';
  price: number;           // minor units (cents)
  reasoning: string;       // 내부용, 상대방에게 비공개
  tactic_used?: string;
  non_price_terms?: Record<string, unknown>;
}
```

### 7.2 CoreMemory (~500 토큰 bound)

```typescript
interface CoreMemory {
  session: {
    session_id: string;
    phase: NegotiationPhase;
    round: number;
    rounds_remaining: number;
    role: 'buyer' | 'seller';
    max_rounds: number;
    intervention_mode: HumanInterventionMode;
  };
  boundaries: {
    my_target: number;
    my_floor: number;
    current_offer: number;
    opponent_offer: number;
    gap: number;
  };
  terms: { active: ActiveTerm[]; resolved_summary: string };
  coaching: { recommended_price: number; acceptable_range: { min: number; max: number } };
  buddy_dna: BuddyDNA;
}
```

### 7.3 RefereeCoaching

```typescript
interface RefereeCoaching {
  recommended_price: number;      // Faratin 양보 곡선 기반
  acceptable_range: { min: number; max: number };
  suggested_tactic: string;
  opponent_pattern: OpponentPatternType;
  convergence_rate: number;       // 0~1, 수렴 속도
  time_pressure: number;          // 0~1, 시간 압박
  utility_snapshot: { ... };
  strategic_hints: string[];
  warnings: string[];
}
```

### 7.4 NegotiationSkill (Doc 26 최종)

```typescript
interface NegotiationSkill {
  getDomainContext(): string;         // LLM L2 컨텍스트
  getTerms(): CategoryTerm[];         // 카테고리별 Terms
  getConstraints(): SkillConstraint[];// 불변 제약 (IMEI 필수 등)
  getMarketReference(): MarketRef;    // 시장 기준가
  getTactics(): string[];             // 사용 가능 전술
  getVerifiableTerms(): VerifiableTerm[];  // 검증 가능 조건
  verify(term, input): VerificationResult; // 조건 검증 (신규)
  getValidationRules(): CategoryValidationRule[];
}
```

> **변경점 (Doc 26):** `evaluateOffer()`, `generateMove()` 제거 → LLM이 대체.
> `verify()` 추가 → IMEI, carrier lock 등 외부 API 검증.

---

## 8. Living Memo Compressed Codec

### 8.1 설계 원칙

LLM 컨텍스트 비용을 최소화하기 위해 JSON 대신 **압축 코덱** 사용.
시스템 프롬프트에 코덱 범례를 1회 주입 (~200 토큰), 이후 매 라운드 메모는 최대 압축.

### 8.2 Shared Layer (양쪽 동일, 분쟁 시 DS 패널 제출)

| Prefix | 의미 | 예시 |
|--------|------|------|
| `NS` | NegotiationState | `NS:BARGAINING\|R5\|rem10` |
| `PT` | PriceTrajectory | `PT:B79200,82000,85000\|S92000,90000,88000\|g3000` |
| `CL` | ConditionsLedger | `CL:battery_health=92%[agreed]\|imei=clean[verified]` |
| `RM` | RecentMessages | `RM:S"88000에 가능합니다"\|B"조금 더 낮춰주시면..."` |

### 8.3 Private Layer (비공개, 전략)

| Prefix | 의미 | 예시 |
|--------|------|------|
| `SS` | StrategyState | `SS:buyer\|t88000\|f95000\|c85000\|o88000\|g3000` |
| `OM` | OpponentModel | `OM:CONCEDER\|agg0.3\|conc2.1%\|est_floor85000` |
| `TA` | TacticalAssess | `TA:leverage=medium\|momentum=gaining` |
| `TR` | TacticalRec | `TR:reciprocal_concession\|reason=상대 양보 중` |

### 8.4 토큰 절감 효과

| 구간 | JSON (비압축) | Codec (압축) | 절감률 |
|------|-------------|-------------|--------|
| Shared | ~450 tok | ~120 tok | 73% |
| Private | ~400 tok | ~150 tok | 63% |
| **합계** | **~1,000 tok** | **~390 tok** | **61%** |

### 8.5 구현 상태

| 항목 | 상태 |
|------|------|
| `encodeSharedMemo()` | ✅ Demo 인라인 구현 |
| `encodePrivateMemo()` | ✅ Demo 인라인 구현 |
| `memo-codec.ts` (별도 모듈) | ❌ 미분리 |
| `memo-manager.ts` (CRUD+hash) | ❌ 미구현 |

---

## 9. 프로덕션 마이그레이션 계획

Doc 26 §9 구현 순서 기반. 현재 Demo에서 검증된 것을 프로덕션으로 이식.

### Phase A: Codec + Memo 모듈화 (의존성 없음)

| 작업 | 파일 | 설명 |
|------|------|------|
| A-1 | `negotiation/memo/memo-codec.ts` (신규) | Demo 인라인 코덱 → 독립 모듈로 분리 |
| A-2 | `negotiation/memo/memo-manager.ts` (신규) | Living Memo CRUD + SHA-256 hash 계산 |
| A-3 | 테스트 | Codec 인코딩↔디코딩 왕복, hash 일치 검증 |

### Phase B: Skill 재설계 (A와 병렬 가능)

| 작업 | 파일 | 설명 |
|------|------|------|
| B-1 | `types.ts` | `NegotiationSkill`에서 `evaluateOffer`, `generateMove` 제거, `verify()` 추가 |
| B-2 | `skills/default-engine-skill.ts` | 인터페이스 변경 적용 |
| B-3 | `referee/referee-service.ts` | Skill fallback 경로 조정 |

### Phase C: 파이프라인 이식 (A + B 완료 후)

| 작업 | 파일 | 설명 |
|------|------|------|
| C-1 | `negotiation/stages/understand.ts` (신규) | Stage 1 — Demo 프롬프트 + 파서 분리 |
| C-2 | `negotiation/stages/responder.ts` (신규) | Stage 5 — Demo 프롬프트 + 한국어 생성 분리 |
| C-3 | `lib/llm-negotiation-executor.ts` | 13-step → 6-stage 재작성 |
| C-4 | 세션 생성 시 Stage 0 통합 | `negotiations.ts` POST 세션 생성 → LLM 전략 생성 |

### Phase D: 통합 테스트

| 작업 | 설명 |
|------|------|
| D-1 | Phase별 E2E (OPENING→BARGAINING→CLOSING→SETTLEMENT 전이) |
| D-2 | Codec 왕복 (encode→LLM응답→decode→재encode 일치) |
| D-3 | Fallback 경로 (LLM 타임아웃 → DefaultEngineSkill) |
| D-4 | Reasoning 모드 트리거 (gap < 10%, BOULWARE 상대) |

### Phase E: 정리

| 작업 | 파일 | 설명 |
|------|------|------|
| E-1 | `screening/auto-screening.ts` | 삭제 — UNDERSTAND가 흡수 |
| E-2 | `rendering/message-renderer.ts` | 삭제 — RESPOND가 대체 |
| E-3 | `config.ts` | `NEGOTIATION_ENGINE` 분기 제거 (항상 LLM) |

---

## 10. 프로덕션 라우트 현황

### 10.1 `/negotiations/sessions` (프로덕션)

| 엔드포인트 | 메서드 | 상태 |
|-----------|--------|------|
| `/negotiations/sessions` | POST | ✅ 세션 생성 |
| `/negotiations/sessions` | GET | ✅ 목록 조회 |
| `/negotiations/sessions/:id` | GET | ✅ 세션+라운드 조회 |
| `/negotiations/sessions/:id/offers` | POST | ✅ 라운드 실행 (rule/LLM 분기) |
| `/negotiations/sessions/:id/accept` | PATCH | ✅ 수동 수락 |
| `/negotiations/sessions/:id/reject` | PATCH | ✅ 수동 거절 |
| `/negotiations/sessions/:id/state` | GET | ✅ 폴링용 상태 |
| `/negotiations/sessions/expire-stale` | POST | ✅ 크론 만료 처리 |

**라우팅:** `NEGOTIATION_ENGINE=llm` → `executeLLMNegotiationRound`, 아니면 규칙 기반.

### 10.2 `/negotiations/demo` (검증용)

| 엔드포인트 | 메서드 | Stage |
|-----------|--------|-------|
| `/negotiations/demo/init` | POST | 0a (전략) + 0b (Term) |
| `/negotiations/demo/:id/round` | POST | ①~⑥ 전체 |
| `/negotiations/demo/:id` | GET | 세션 상태 조회 |

**특징:** 인증 없음, DB 없음, 한국어 프롬프트, 전 Stage 투명 출력.

### 10.3 `/negotiations/simulate` (규칙 엔진)

| 엔드포인트 | 메서드 | 설명 |
|-----------|--------|------|
| `/negotiations/simulate` | POST | engine-core 기반 rule vs rule 핑퐁 |

---

## 11. 테스트 현황

### 11.1 단위 테스트 (기존, 통과)

| 모듈 | 테스트 파일 | 상태 |
|------|-----------|------|
| `coach.ts` | `referee/__tests__/coach.test.ts` | ✅ |
| `validator.ts` | `referee/__tests__/validator.test.ts` | ✅ |
| `phase-machine.ts` | `phase/__tests__/phase-machine.test.ts` | ✅ |
| `human-intervention.ts` | `phase/__tests__/human-intervention.test.ts` | ✅ |
| `core-memory.ts` | `memory/__tests__/core-memory.test.ts` | ✅ |
| `session-memory.ts` | `memory/__tests__/session-memory.test.ts` | ✅ |
| `checkpoint-store.ts` | `memory/__tests__/checkpoint-store.test.ts` | ✅ |
| `default-engine-skill.ts` | `skills/__tests__/default-engine-skill.test.ts` | ✅ |
| `grok-fast-adapter.ts` | `adapters/__tests__/grok-fast-adapter.test.ts` | ✅ |
| `message-renderer.ts` | `rendering/__tests__/message-renderer.test.ts` | ✅ |
| `auto-screening.ts` | `screening/__tests__/auto-screening.test.ts` | ✅ |
| `term-registry.ts` | `term/__tests__/term-registry.test.ts` | ✅ |

### 11.2 통합 테스트 (Demo로 수동 검증)

| 시나리오 | 상태 |
|---------|------|
| Init → Strategy + Terms (LLM) | ✅ 한국어 출력 확인 |
| Round 1-N: 6-Stage 전체 | ✅ COUNTER/ACCEPT/REJECT 확인 |
| Phase 전이 (OPENING→BARGAINING) | ✅ |
| Referee 자동 수정 | ✅ (Demo에서 auto_fix_applied 플래그 확인) |
| 거래 성사 (ACCEPT) | ✅ done=true 확인 |
| 비용 추적 | ✅ ~$0.0003/라운드 확인 |

### 11.3 필요한 테스트 (미구현)

| 테스트 | 우선순위 |
|--------|---------|
| Codec 왕복 (encode→decode→encode 동일성) | P0 |
| LLM 타임아웃 → Fallback 경로 | P0 |
| Reasoning 모드 트리거 정확도 | P1 |
| 15라운드 전체 세션 비용 검증 | P1 |
| Phase 되감기(Revert) E2E | P2 |
| HYBRID 개입 모드 시나리오 | P2 |

---

## 12. 환경 설정

### 12.1 필수 환경 변수

| 변수 | 설명 | 기본값 |
|------|------|--------|
| `XAI_API_KEY` | xAI API 키 | (필수) |
| `XAI_MODEL` | 사용 모델 | `grok-4-fast` |
| `NEGOTIATION_ENGINE` | 엔진 모드 | `rule` (LLM: `llm`) |
| `DATABASE_URL` | PostgreSQL 연결 | (프로덕션 필수) |

### 12.2 타임아웃 설정 (`xai-client.ts`)

| 모드 | 타임아웃 | 재시도 |
|------|---------|--------|
| General | 30초 | 2회 (1s, 3s 간격) |
| Reasoning | 45초 | 2회 (1s, 3s 간격) |

---

## 13. 대시보드 (overview.html)

`docs/meetings/overview.html`의 **6-Stage LLM-Native 파이프라인 검증** 섹션에서
인터랙티브 데모를 실행할 수 있음.

**기능:**
- 아이템 정보 편집 + "전략 생성 시작" → Stage 0a/0b 실행
- 판매자 가격 자동 계산 (Faratin 곡선) + 수동 오버라이드
- 라운드별 6-Stage 파이프라인 투명 표시 (각 Stage 클릭하여 prompt/response 확인)
- 가격 수렴 차트
- 비용/토큰 실시간 추적
- 자동 진행 모드

**접속:** `http://localhost:3001`에서 API 서버 실행 후, 브라우저에서 `overview.html` 열기.

---

## 14. 참조 문서

| 문서 | 내용 |
|------|------|
| [25_LLM_협상_아키텍처.md](./25_LLM_협상_아키텍처.md) | 심판-선수 모델, 4원칙, Living Context, 3-Tier 아키텍처 |
| [26_LLM_Native_협상_파이프라인.md](./26_LLM_Native_협상_파이프라인.md) | 6-Stage 파이프라인 확정 설계, Codec 스펙, 구현 순서 |
| [02_효용_함수.md](./02_효용_함수.md) | 4차원 효용 계산 (V_p, V_t, V_r, V_s) |
| [03_양보_곡선_역산.md](./03_양보_곡선_역산.md) | Faratin 양보 곡선, 동적 베타 |
| [04_상대방_모델.md](./04_상대방_모델.md) | EMA 기반 상대방 패턴 분류 |

---

*Last Updated: 2026-04-12*
*Version: 1.0*
