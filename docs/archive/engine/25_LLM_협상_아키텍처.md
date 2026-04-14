# 25. LLM 협상 아키텍처

**문서:** Haggle Engine Architecture v2.0.0 — LLM 협상 아키텍처
**범위:** 심판-선수 모델, Living Context, Skill 인식, Model-Agnostic 설계, 4원칙 프로토콜
**관련 문서:** [00_INDEX.md](./00_INDEX.md) | [08_LLM_정책.md](./08_LLM_정책.md) | [16_스킬_마켓플레이스.md](./16_스킬_마켓플레이스.md)
**상태:** 설계 승인 대기

---

## 0. 배경과 동기

### 0.1 패러다임 전환

v1.0.x에서 엔진은 "실행자"였다 — 규칙 기반으로 직접 의사결정을 수행하고, LLM은 예외적 에스컬레이션에만 개입했다 (세션당 평균 1.5회). v2.0.0에서 엔진은 **"심판(Referee)"**으로 전환한다. LLM이 협상을 수행하고, 엔진은 이를 검증하고 유도한다.

```
v1.x:  사용자 → LLM(전략수립) → 엔진(실행) → 결과
v2.0:  사용자 → Skill(전략+실행) → 심판(검증+유도) → 결과
```

### 0.2 전환 근거

1. **비용 무문제** — Grok Fast 100% LLM 사용해도 마진 97% ([10_LLM_비용.md](./13_LLM_비용.md) 참조)
2. **유연성** — 바이너리 하드코딩 변경은 코드+배포+테스트. LLM은 프롬프트 한 줄
3. **Skills Marketplace 준비** — "전략 = 외부 주입" 구조로 설계하면 마켓플레이스 전환 비용 0
4. **LLM 발전 흡수** — 6개월마다 성능 2x, 비용 0.5x인 LLM 발전을 자동 흡수하는 구조 필요

### 0.3 엔진이 심판이어야 하는 이유

LLM이 아무리 발전해도 **대체 불가능한 3가지**:

| 역할 | LLM | 엔진 (심판) |
|------|-----|------------|
| 수학적 결정론 | 온도 0이어도 100% 동일 답 보장 불가 | **보장** |
| 검증 가능한 상태 전이 | "이해"하지만 "보장"하지 않음 | **보장** |
| 양쪽 공정성 증명 | 편향 가능성 증명 불가 | **감사 가능** |

---

## 1. 4원칙 프로토콜

Haggle 협상 프로토콜의 모든 설계 결정은 4가지 원칙에 기반한다. 이 원칙은 LLM이 어떤 모델이든, Skill이 누가 만들었든, 프로토콜 참여자 모두가 합의할 수 있는 토대다.

### 1.1 투명성 (Transparency)

> 협상의 모든 과정은 기록되고, 참여자가 열람할 수 있다.

- 모든 라운드의 입력(코칭), 출력(응답), 검증 결과가 감사 로그에 기록
- 심판의 검증 규칙은 공개 — 어떤 기준으로 승인/거부했는지 추적 가능
- LLM에게 제공된 코칭 내용도 로그에 포함 — "심판이 편들었는지" 검증 가능

### 1.2 합리성 (Rationality)

> 모든 제안은 수학적으로 설명 가능해야 한다.

- Faratin 양보 곡선이 매 라운드 권장가를 계산 — 수학적 근거 제공
- 수렴 보장: `t → T`이면 `offer → p_limit` (Faratin 정리)
- 효용 함수(4차원)로 제안의 "합리성" 정량화

### 1.3 중립성 (Neutrality)

> 심판은 buyer와 seller에게 동일한 규칙과 코칭을 적용한다.

- 동일 코칭 로직 — buyer/seller 구분 없이 같은 `computeCoaching()` 함수
- 편향 감지 — 한쪽에만 연속 양보를 요구하면 SOFT violation
- 감사 가능 — 양쪽 로그를 비교하여 중립성 검증

### 1.4 표준성 (Standardization)

> 프로토콜의 입출력 형식은 표준화되어, 어떤 LLM/Skill이든 참여 가능하다.

- `NegotiationMove` 스키마: 어떤 모델이든 이 형식으로 응답
- `RefereeCoaching` 스키마: 어떤 Skill이든 이 형식으로 코칭 수신
- HNP 프로토콜 메시지 형식 준수 (wire format)

---

## 2. 5계층 프로토콜 스택

```
┌─────────────────────────────────────────────────────┐
│  Layer 5: Presentation                               │
│  사용자 인터페이스 (웹, MCP, API)                      │
├─────────────────────────────────────────────────────┤
│  Layer 4: Skill                                      │
│  협상 전략 실행 (DefaultEngine / LLM / 3rd-Party)     │
├─────────────────────────────────────────────────────┤
│  Layer 3: Referee                                    │
│  검증 + 코칭 + 유도 (engine-core 수학 기반)            │
├─────────────────────────────────────────────────────┤
│  Layer 2: Protocol (HNP)                             │
│  상태 전이, 메시지 형식, 세션 관리                      │
├─────────────────────────────────────────────────────┤
│  Layer 1: Settlement                                 │
│  스마트 컨트랙트, 에스크로, USDC 정산                   │
└─────────────────────────────────────────────────────┘
```

각 계층은 독립적으로 교체 가능하다:
- Skill을 바꿔도 Referee/Protocol은 그대로
- LLM 모델을 바꿔도 Skill 인터페이스는 그대로
- Settlement 체인을 바꿔도 협상 로직은 그대로

---

## 3. 심판 모델: Coach → Play → Validate → Guide

### 3.1 전체 플로우

```
┌───────────────────────────────────────────────────┐
│                  ROUND N 시작                      │
├───────────────────────────────────────────────────┤
│                                                   │
│  ① COACH: engine-core 수학 → RefereeCoaching 생성 │
│     • Faratin 곡선으로 권장가 계산                  │
│     • 상대 패턴 분석 (BOULWARE/CONCEDER/LINEAR)    │
│     • 수렴 속도 평가                               │
│     • 전략 힌트 생성 (자연어)                       │
│                                                   │
│  ② PLAY: Skill이 coaching + 맥락으로 응답 생성      │
│     • 코칭을 참고하되 자유롭게 전략 수립              │
│     • NegotiationMove 형식으로 출력                 │
│                                                   │
│  ③ VALIDATE: 심판 검증                             │
│     ├─ HARD violation → 차단, fallback 사용        │
│     ├─ SOFT violation → 교정 힌트 + 1회 재시도      │
│     └─ PASS → 상대에게 전달                        │
│                                                   │
│  ④ RECORD: 감사 로그 기록                          │
│     • coaching, 응답, 검증 결과, 교정 여부           │
│                                                   │
└───────────────────────────────────────────────────┘
```

### 3.2 RefereeCoaching (① COACH)

매 라운드 시작 전, engine-core가 수학적 분석을 코칭으로 제공한다.

```typescript
interface RefereeCoaching {
  /** Faratin 곡선에서 계산한 이번 라운드 권장가 */
  recommended_price: number;

  /** 허용 가격 범위 — 이 안에서는 자유 */
  acceptable_range: { min: number; max: number };

  /** 상대방 패턴 감지 결과 */
  opponent_pattern: 'BOULWARE' | 'CONCEDER' | 'LINEAR' | 'UNKNOWN';

  /** 수렴 속도 (0 = 정체, 1 = 빠르게 수렴 중) */
  convergence_rate: number;

  /** 시간 압박 (0 = 여유, 1 = 데드라인 임박) */
  time_pressure: number;

  /** 현재 라운드의 4차원 효용 스냅샷 */
  utility_snapshot: {
    u_price: number;
    u_time: number;
    u_risk: number;
    u_quality: number;
    u_total: number;
  };

  /** 자연어 전략 힌트 (Skill/LLM에게 제공) */
  strategic_hints: string[];
}
```

코칭 예시:
```
[REFEREE COACHING — Round 5]
recommended_price: $680
acceptable_range: $650 - $720
opponent_pattern: BOULWARE (느린 양보, 인내심 강함)
convergence_rate: 0.3 (느림)
time_pressure: 0.6 (중간)
utility: { price: 0.72, time: 0.55, risk: 0.80, quality: 0.90, total: 0.73 }
hints:
  - "상대가 3라운드째 $20 이하 양보. 비가격 조건 제안 고려"
  - "Faratin 기준 이번 라운드 $30 양보가 최적"
  - "현재 u_total 0.73 — u_aspiration(0.70) 근접, 합의 가능 구간"
```

### 3.3 NegotiationMove (② PLAY)

Skill이 반환하는 표준 응답 형식.

```typescript
interface NegotiationMove {
  /** 행동 유형 */
  action: 'COUNTER' | 'ACCEPT' | 'REJECT' | 'HOLD';

  /** 제안 가격 (COUNTER 시 필수) */
  price?: number;

  /** 상대에게 보낼 메시지 */
  message: string;

  /** 판단 근거 (감사 로그용) */
  reasoning: string;

  /** 비가격 조건 (배송비 포함, 번들 등) */
  non_price_terms?: Record<string, unknown>;
}
```

### 3.4 ValidationResult (③ VALIDATE)

```typescript
interface ValidationResult {
  passed: boolean;

  violations: Array<{
    /** 위반 규칙 이름 */
    rule: string;
    /** HARD = 즉시 차단, SOFT = 교정 후 재시도 허용 */
    severity: 'HARD' | 'SOFT';
    /** 어떻게 고치면 되는지 — LLM/Skill에게 전달 */
    guidance: string;
    /** 수정 제안 (SOFT violation 시) */
    suggested_fix?: Partial<NegotiationMove>;
  }>;
}
```

### 3.5 검증 규칙 (7개)

| # | 규칙 | 위반 시 | 심각도 |
|---|------|---------|--------|
| V1 | 가격이 `p_limit` 범위 초과 | 차단 | HARD |
| V2 | 프로토콜 상태 전이 위반 | 차단 | HARD |
| V3 | 타임아웃/데드라인 초과 | 차단 | HARD |
| V4 | 양보 방향 역전 (가격 올리기) | 교정 + 재시도 | SOFT |
| V5 | 수렴 정체 (4라운드+ 양보 없음) | 교정 + 재시도 | SOFT |
| V6 | 편향 감지 (한쪽만 양보 요구) | 교정 + 재시도 | SOFT |
| V7 | 과도한 양보 (Faratin 기준 2x 초과) | 교정 + 재시도 | SOFT |

### 3.6 SOFT Violation 유도 교정

SOFT violation 시, 심판은 단순 거부가 아닌 **교정 가이드**를 제공한다.

```
[REFEREE CORRECTION]
violation: V5 — 수렴 정체 (4라운드 연속 $5 이하 양보)
guidance: "gap을 줄이려면 $20+ 양보 또는 비가격 조건 추가 필요"
suggested_fix:
  price: $670 (Faratin 권장가)
  non_price_terms: { shipping_included: true }
retry: true (1회 재시도 허용)
```

재시도 후에도 SOFT violation이면 → **DefaultEngineSkill 폴백** 사용.

### 3.7 Fallback: DefaultEngineSkill

모든 HARD violation, 재시도 실패, LLM 장애 시 engine-core가 직접 계산한 값을 사용한다.

```typescript
class DefaultEngineSkill implements NegotiationSkill {
  /** engine-core의 순수 수학으로 응답 생성 */
  async generateOffer(
    context: NegotiationContext,
    coaching: RefereeCoaching
  ): Promise<NegotiationMove> {
    // computeCounterOffer() → Faratin 곡선 기반 가격
    // 템플릿 메시지 생성
    // 비가격 조건 없음 (수학만)
  }
}
```

이렇게 하면:
- **LLM이 잘할 때**: 창의적이고 맥락에 맞는 협상
- **LLM이 못할 때**: engine-core 수학이 보장하는 합리적 기본값
- **어떤 경우든**: 수렴 보장 + 공정성 보장

---

## 4. Living Context: LLM이 변화를 "느끼는" 방법

### 4.1 핵심 문제

LLM에는 영속적 메모리가 없다. 매 호출마다 **context window에 들어있는 것만** 안다. 따라서 "LLM이 변화를 느낀다" = **시스템이 LLM의 context를 동적으로 조립한다.**

### 4.2 Context Assembly Pipeline

LLM이 매 라운드 받는 context는 6개 레이어로 조립된다:

```
┌───────────────────────────────────────────────────────────┐
│                  LLM Context Window                        │
│                                                           │
│  ┌─────────────────────────────────────────────────────┐  │
│  │ L0: Protocol Rules (불변)                            │  │
│  │ "NegotiationMove 스키마를 준수하라"                    │  │
│  │ "acceptable_range 안에서만 가격 제안하라"              │  │
│  │ "수렴 규칙: 매 라운드 상대방 쪽으로 이동하라"          │  │
│  └─────────────────────────────────────────────────────┘  │
│                                                           │
│  ┌─────────────────────────────────────────────────────┐  │
│  │ L1: Model Instructions (모델 교체 시 변경)           │  │
│  │ "strict JSON 출력. reasoning은 100토큰 이내."        │  │
│  │ → 모델이 바뀌면 이 레이어만 교체                      │  │
│  └─────────────────────────────────────────────────────┘  │
│                                                           │
│  ┌─────────────────────────────────────────────────────┐  │
│  │ L2: Skill Context (세션 시작 시 로드)                 │  │
│  │ 활성 Skill의 manifest에서 주입:                       │  │
│  │ - Skill 전략 지침                                    │  │
│  │ - 사용 가능한 전술 목록                               │  │
│  │ - 카테고리 전문 지식                                  │  │
│  │ → Skill이 바뀌면 이 레이어가 변경                     │  │
│  └─────────────────────────────────────────────────────┘  │
│                                                           │
│  ┌─────────────────────────────────────────────────────┐  │
│  │ L3: Referee Coaching (매 라운드 갱신)                 │  │
│  │ engine-core가 계산한 수학적 가이드:                    │  │
│  │ - 권장가, 허용 범위, 상대 패턴                        │  │
│  │ - 수렴 속도, 시간 압박, 효용 스냅샷                    │  │
│  │ - 전략 힌트 (자연어)                                  │  │
│  │ → 매 라운드 새로 계산                                │  │
│  └─────────────────────────────────────────────────────┘  │
│                                                           │
│  ┌─────────────────────────────────────────────────────┐  │
│  │ L4: Session History (누적)                           │  │
│  │ 이전 라운드 요약:                                    │  │
│  │ - 가격 이력 (양쪽)                                   │  │
│  │ - 주요 발언 요약                                     │  │
│  │ - 합의/거부된 비가격 조건                             │  │
│  │ → 매 라운드 추가                                     │  │
│  └─────────────────────────────────────────────────────┘  │
│                                                           │
│  ┌─────────────────────────────────────────────────────┐  │
│  │ L5: Skill Signals (매 라운드, 선택적)                 │  │
│  │ 활성 Skill이 실시간 제공하는 데이터:                   │  │
│  │ - 외부 시세 변동                                     │  │
│  │ - 경쟁 세션 정보                                     │  │
│  │ - 카테고리 특화 인사이트                              │  │
│  │ → Skill이 push할 때만 포함                           │  │
│  └─────────────────────────────────────────────────────┘  │
│                                                           │
└───────────────────────────────────────────────────────────┘
```

### 4.3 변화 인식 매트릭스

| 변화 유형 | 어떤 레이어가 변하나 | LLM이 느끼는 방식 |
|-----------|---------------------|-----------------|
| **모델 교체** (Grok → GPT-5) | L1 (Model Instructions) | 지시 스타일이 바뀜 — 더 자유롭거나 더 구체적 |
| **Skill 교체** (Default → Sneaker) | L2 (Skill Context) | 전략 지침, 전술 목록, 도메인 지식이 바뀜 |
| **라운드 진행** | L3 (Coaching) + L4 (History) | 매 라운드 새로운 수학적 가이드 + 대화 이력 |
| **외부 시세 변동** | L5 (Skill Signals) | "StockX 가격 $20 하락" 같은 실시간 신호 |
| **심판 규칙 변경** | L0 (Protocol Rules) | 검증 기준 자체가 변경 (매우 드문 경우) |
| **Skill 업데이트** (v1 → v2) | L2 (Skill Context) | 새 전술 추가, 기존 전술 제거/변경 |
| **코칭 레벨 변경** | L3 (Coaching) | 모델 능력에 따라 상세/간략 코칭 |

### 4.4 LLM이 변화를 느끼는 구체적 사례

#### 사례 1: 모델 교체 (Grok 4.1 Fast → GPT-5)

```
=== Grok 4.1 Fast 사용 시 (L1) ===
[MODEL INSTRUCTIONS]
Output strict JSON only. No markdown.
Keep reasoning under 100 tokens.
Follow referee coaching closely — use recommended_price as anchor.

=== GPT-5 사용 시 (L1) ===
[MODEL INSTRUCTIONS]
Use structured output mode.
You may use extended chain-of-thought in reasoning.
Referee coaching is advisory — you may deviate with justification.
```

LLM의 행동이 달라짐: GPT-5는 더 자유롭게 추론하고, 코칭에서 벗어나는 것도 허용됨.
**심판의 검증 기준은 동일** — 결과의 유효성만 판단.

#### 사례 2: Skill 교체 (DefaultEngine → SneakerHawk)

```
=== DefaultEngineSkill (L2) ===
[SKILL CONTEXT]
skill: default-engine
strategy: Faratin 양보 곡선 기반 가격 협상
tactics: [CONCEDE, HOLD, ACCEPT, REJECT]
domain_knowledge: none

=== SneakerHawkSkill v2 (L2) ===
[SKILL CONTEXT]
skill: sneaker-hawk-v2
strategy: 한정판 스니커즈 리셀 특화. 희소성 활용 + StockX 앵커링
tactics: [ANCHORING_LOW, SCARCITY_COUNTER, BUNDLE_PRESSURE, PATIENCE_PLAY]
domain_knowledge:
  - "Jordan 1 Chicago는 StockX 프리미엄 20-30%가 정상"
  - "DS(Deadstock) 조건은 가격 프리미엄 15-25% 정당화"
  - "사이즈 8-10은 demand peak — 양보 폭 줄여도 됨"
constraints:
  - "첫 제안에서 StockX 최저가 이하로 시작하지 말 것"
  - "condition grade 없이 ACCEPT하지 말 것"
```

LLM이 "스니커즈 전문가"처럼 행동하게 됨 — Skill이 도메인 지식과 전술을 주입했기 때문.

#### 사례 3: 세션 도중 외부 시세 변동 (L5)

```
=== Round 3 시점 ===
[SKILL SIGNALS]
(없음)

=== Round 5 시점 ===
[SKILL SIGNALS]
⚡ MARKET UPDATE: StockX lowest ask dropped $30 (was $350 → now $320)
   Source: SneakerHawkSkill real-time feed
   Implication: your acceptable_range may be too high
```

LLM이 시세 하락을 "느끼고" 양보 전략을 조정할 수 있음.

#### 사례 4: Skill 버전 업데이트 (v1 → v2)

```
=== SneakerHawk v1 (L2) ===
tactics: [ANCHORING_LOW, SCARCITY_COUNTER]

=== SneakerHawk v2 (L2) — 새 전술 추가 ===
tactics: [ANCHORING_LOW, SCARCITY_COUNTER, BUNDLE_PRESSURE, PATIENCE_PLAY]
changelog:
  - "v2에서 BUNDLE_PRESSURE 추가: 여러 아이템 같이 사면 할인 요청 가능"
  - "v2에서 PATIENCE_PLAY 추가: BOULWARE 상대에 장기전 전술"
```

LLM이 새 전술의 존재를 알고 활용할 수 있음.

---

## 5. 3계층 추상화: Model-Agnostic 설계

### 5.1 계층 구조

```
┌───────────────────────────────────────────────┐
│  Layer A: Protocol Contract (불변)              │
│  NegotiationMove 스키마                         │
│  RefereeCoaching 스키마                         │
│  검증 규칙 7개                                  │
│  수렴 보장 조건                                  │
├───────────────────────────────────────────────┤
│  Layer B: Skill Interface (안정적)              │
│  NegotiationSkill 인터페이스                     │
│  assessContext()                               │
│  generateOffer()                               │
│  evaluateOffer()                               │
├───────────────────────────────────────────────┤
│  Layer C: Model Adapter (교체 가능)             │
│  프롬프트 템플릿                                │
│  토큰 전략                                      │
│  출력 파싱                                      │
│  코칭 레벨 조정                                  │
└───────────────────────────────────────────────┘
```

**새 모델 도입 = Layer C에 어댑터 파일 1개 추가.**
Protocol, Skill Interface, Referee, 테스트 — 전부 그대로.

### 5.2 NegotiationSkill 인터페이스

```typescript
interface NegotiationSkill {
  /** 고유 식별자 */
  readonly id: string;
  /** 버전 (시맨틱 버저닝) */
  readonly version: string;
  /** Skill manifest — LLM context L2에 주입될 내용 포함 */
  readonly manifest: SkillManifest;

  /** 세션 시작 시 맥락 평가 */
  assessContext(session: SessionSnapshot): Promise<ContextAssessment>;

  /** 코칭 기반 응답 생성 */
  generateOffer(
    context: NegotiationContext,
    coaching: RefereeCoaching
  ): Promise<NegotiationMove>;

  /** 상대 제안 평가 */
  evaluateOffer(
    offer: IncomingOffer,
    coaching: RefereeCoaching
  ): Promise<NegotiationMove>;
}
```

### 5.3 SkillManifest: LLM 인식의 핵심

```typescript
interface SkillManifest {
  skill_id: string;
  name: string;
  version: string;
  author: string;
  type: 'STRATEGY' | 'DATA' | 'INTERPRETATION' | 'NEGOTIATION';

  /** 이 필드가 LLM context L2에 직접 주입된다 */
  llm_context: {
    /** Skill의 전략 지침 (자연어) */
    system_instructions: string;
    /** 사용 가능한 전술 목록 */
    tactics: string[];
    /** 제약 조건 — LLM이 하면 안 되는 것 */
    constraints: string[];
    /** 카테고리 특화 도메인 지식 */
    domain_knowledge: string[];
    /** 협상 톤/성격 */
    personality?: string;
    /** 버전 변경 사항 (LLM이 새 기능을 인식하도록) */
    changelog?: string[];
  };

  /** 이 Skill이 요구하는 최소 모델 능력 */
  required_model_caps: {
    json_reliability: 'LOW' | 'MEDIUM' | 'HIGH';
    reasoning_depth: 'BASIC' | 'ADVANCED';
    min_context_window: number;
  };

  supported_categories: string[];
  max_latency_ms: number;
  pricing: PricingModel;
}
```

**핵심:** `llm_context` 필드가 LLM의 "인식"을 결정한다. Skill 개발자가 이 필드를 잘 작성하면, LLM이 그 Skill의 전략을 정확히 수행한다.

### 5.4 ModelAdapter 인터페이스

```typescript
interface ModelAdapter {
  /** 모델 식별자 (예: "grok-4.1-fast", "gpt-5") */
  readonly modelId: string;
  /** 모델 능력 선언 */
  readonly capabilities: ModelCaps;

  /** Context Assembly Pipeline의 L1 생성 */
  buildModelInstructions(): string;

  /** Coaching 상세도 결정 — 모델 능력에 따라 조절 */
  coachingLevel(): 'DETAILED' | 'STANDARD' | 'LIGHT';

  /** 모델별 최적화된 프롬프트 조립 */
  assemblePrompt(layers: ContextLayers): ChatMessage[];

  /** 모델별 응답 파싱 */
  parseResponse(raw: string): NegotiationMove;

  /** 토큰 예산 */
  tokenBudget(): { maxInput: number; maxOutput: number };
}

interface ModelCaps {
  json_reliability: 'LOW' | 'MEDIUM' | 'HIGH';
  reasoning_depth: 'BASIC' | 'ADVANCED';
  context_window: number;
  structured_output: boolean;
  function_calling: boolean;
}
```

### 5.5 코칭 레벨 자동 조정

모델이 똑똑할수록 코칭을 줄이고 자유도를 높인다:

```typescript
function adjustCoachingLevel(caps: ModelCaps): 'DETAILED' | 'STANDARD' | 'LIGHT' {
  if (caps.reasoning_depth === 'ADVANCED' && caps.json_reliability === 'HIGH') {
    return 'LIGHT';    // 힌트만, 구체적 지시 없이
  }
  if (caps.json_reliability === 'HIGH') {
    return 'STANDARD'; // 권장가 + 범위 + 패턴
  }
  return 'DETAILED';   // 구체적 권장가 + 단계별 가이드 + 예시
}
```

**DETAILED 코칭 (현재 Grok Fast):**
```
recommended_price: $680
acceptable_range: $650-720
opponent_pattern: BOULWARE → 인내심 유지, 소폭 양보
hint: "배송비 포함 제안으로 실질가 낮추기"
example: {"action":"COUNTER","price":690,"message":"배송비 포함 $690 어떠신가요?"}
```

**LIGHT 코칭 (미래 GPT-5):**
```
recommended_price: $680, range: $650-720
opponent: BOULWARE
(자유롭게 전략 수립)
```

심판의 **검증 기준은 동일** — 코칭 상세도만 달라짐.

---

## 6. Skill이 LLM에 "연속적으로" 인식되는 메커니즘

### 6.1 문제 정의

서드파티가 SneakerHawkSkill v2를 만들었다. 이 Skill은:
- 새 전술 2개 추가 (BUNDLE_PRESSURE, PATIENCE_PLAY)
- 도메인 지식 업데이트 (2026 Q2 스니커즈 시세 트렌드)
- StockX 실시간 피드 연동

LLM은 이 Skill의 존재와 능력을 어떻게 아는가?

### 6.2 해결: Skill → SkillManifest → Context Injection

```
┌──────────────────────────────────────────────────────┐
│  Skill 개발자가 작성                                   │
│                                                      │
│  manifest.llm_context = {                            │
│    system_instructions: "스니커즈 리셀 전문 협상...",   │
│    tactics: ["ANCHORING_LOW", "BUNDLE_PRESSURE", ...],│
│    domain_knowledge: ["Jordan 1 프리미엄 20-30%", ...],│
│    constraints: ["DS 확인 없이 ACCEPT 금지", ...],    │
│    changelog: ["v2: BUNDLE_PRESSURE 전술 추가", ...], │
│  }                                                   │
│                                                      │
└──────────────┬───────────────────────────────────────┘
               │
               ▼  세션 시작 시 로드
┌──────────────────────────────────────────────────────┐
│  Context Assembly Pipeline                            │
│                                                      │
│  L2 (Skill Context) = manifest.llm_context를         │
│  자연어 블록으로 변환하여 주입                          │
│                                                      │
│  [ACTIVE SKILL: sneaker-hawk-v2]                     │
│  Strategy: 한정판 스니커즈 리셀 특화...                │
│  Available Tactics:                                   │
│    - ANCHORING_LOW: StockX 최저가로 앵커링             │
│    - BUNDLE_PRESSURE: 복수 구매 시 할인 요청 (v2 신규) │
│    - PATIENCE_PLAY: BOULWARE 상대에 장기전 (v2 신규)  │
│  Domain Knowledge:                                    │
│    - Jordan 1 Chicago: StockX 프리미엄 20-30%         │
│    - DS(Deadstock) = 가격 프리미엄 15-25%             │
│  Constraints:                                         │
│    - 첫 제안에서 StockX 최저가 이하 금지               │
│    - condition grade 없이 ACCEPT 금지                 │
│                                                      │
└──────────────────────────────────────────────────────┘
```

### 6.3 실시간 신호: SkillSignal

Skill이 세션 도중 실시간 데이터를 LLM에게 전달하는 메커니즘.

```typescript
interface SkillSignal {
  /** 신호 유형 */
  type: 'MARKET_UPDATE' | 'COMPETITOR_INFO' | 'INSIGHT' | 'WARNING';
  /** 자연어 메시지 — L5에 직접 주입 */
  message: string;
  /** 데이터 페이로드 (구조화) */
  data?: Record<string, unknown>;
  /** 이 신호의 신뢰도 (0-1) */
  confidence: number;
  /** 출처 */
  source: string;
}
```

Skill이 push하면 다음 라운드의 L5에 포함:

```
[SKILL SIGNALS — Round 5]
⚡ MARKET_UPDATE (confidence: 0.95, source: StockX API)
   "Jordan 1 Chicago DS size 10: StockX lowest ask $320 → $290 (-$30, -9.4%)"
   Implication: buyer 유리 — 양보 폭 줄이거나 더 낮은 가격 요구 가능

💡 INSIGHT (confidence: 0.80, source: SneakerHawk analytics)
   "이 seller의 최근 3건: 평균 StockX 대비 -12% 성사. 추가 할인 가능성 높음"
```

### 6.4 Skill 진화와 LLM 인식

```
┌─────────────────────────────────────────────────────────┐
│  Skill 생태계 진화                                       │
│                                                         │
│  SneakerHawk v1 (2026 Q2)                               │
│    tactics: [ANCHORING_LOW, SCARCITY_COUNTER]            │
│    → LLM은 2개 전술만 인식                               │
│                                                         │
│  SneakerHawk v2 (2026 Q3) — Skill 개발자가 업데이트      │
│    tactics: [ANCHORING_LOW, SCARCITY_COUNTER,            │
│              BUNDLE_PRESSURE, PATIENCE_PLAY]             │
│    changelog: ["BUNDLE_PRESSURE 추가", "PATIENCE 추가"]  │
│    → LLM은 4개 전술 + 변경 사항을 인식                    │
│                                                         │
│  SneakerShield v1 (2026 Q4) — 다른 개발자가 판매 전략    │
│    tactics: [SCARCITY_HOLD, CONDITION_LEVERAGE, ...]     │
│    → 판매자 측 LLM은 이 Skill의 전술을 인식              │
│                                                         │
│  전략 진화 = LLM의 인식 진화                              │
│  Skill manifest가 바뀌면 → L2가 바뀌면 → LLM이 느낌     │
└─────────────────────────────────────────────────────────┘
```

### 6.5 "느낌"의 연속성 보장

LLM은 stateless지만, 세션 내에서 **연속적 인식**이 유지되는 이유:

```
Round 1: L0 + L1 + L2 + L3(round1) + L4(empty)
Round 2: L0 + L1 + L2 + L3(round2) + L4(round1 요약)
Round 3: L0 + L1 + L2 + L3(round3) + L4(round1-2 요약)  + L5(시세 변동!)
Round 4: L0 + L1 + L2 + L3(round4) + L4(round1-3 요약) + L5(경쟁 정보)
```

- **L2 (Skill Context)**: 세션 내 불변 → Skill의 "성격"이 유지됨
- **L3 (Coaching)**: 매 라운드 갱신 → 수학적 현실이 반영됨
- **L4 (History)**: 누적 → 대화 맥락이 유지됨
- **L5 (Signals)**: 이벤트 기반 → 외부 변화가 실시간 반영됨

결과적으로 LLM은 마치 **"기억하는 것처럼"** 행동한다 — 실제로는 매번 새로 조립된 context를 읽고 있을 뿐.

---

## 7. 프롬프트 구조

### 7.1 프롬프트 = Protocol Rules + Skill Context + Coaching + History + Signals

프롬프트를 통째로 하나의 문자열로 만들면 모델 교체 시 전부 다시 써야 한다. 대신 레이어별로 분리한다:

```typescript
// L0: 불변 — 어떤 모델이든 동일
const PROTOCOL_RULES = `
You are a negotiation agent within the Haggle protocol.
RULES:
1. Respond with valid JSON matching NegotiationMove schema.
2. Your price MUST be within acceptable_range.
3. Convergence rule: each offer must move toward opponent.
4. Never reveal your p_limit or internal strategy to opponent.
5. proposed non_price_terms must be concrete and verifiable.

OUTPUT SCHEMA:
{
  "action": "COUNTER" | "ACCEPT" | "REJECT" | "HOLD",
  "price": number (required for COUNTER),
  "message": string (to opponent, natural language),
  "reasoning": string (internal, for audit log only),
  "non_price_terms": { ... } (optional)
}
`;

// L1: 모델별 — ModelAdapter가 제공
// (예: GrokFastAdapter)
const MODEL_INSTRUCTIONS = `
Output strict JSON. No markdown wrapping.
Keep reasoning under 100 tokens.
Follow referee coaching closely.
`;

// L2: Skill별 — SkillManifest.llm_context에서 변환
function buildSkillContext(manifest: SkillManifest): string { ... }

// L3: 라운드별 — engine-core가 계산
function buildCoachingBlock(coaching: RefereeCoaching): string { ... }

// L4: 세션별 — 이력 누적
function buildHistoryBlock(rounds: RoundSummary[]): string { ... }

// L5: 이벤트별 — Skill이 push
function buildSignalsBlock(signals: SkillSignal[]): string { ... }
```

### 7.2 최종 조립

```typescript
function assembleContext(layers: ContextLayers): ChatMessage[] {
  return [
    { role: 'system', content: layers.L0_protocol + '\n\n' + layers.L1_model },
    { role: 'system', content: layers.L2_skill },    // Skill 인식
    ...layers.L4_history,                             // 대화 이력
    { role: 'user', content:
        layers.L3_coaching + '\n\n' +                 // 이번 라운드 코칭
        (layers.L5_signals || '') + '\n\n' +          // 실시간 신호
        'Generate your negotiation move.'
    },
  ];
}
```

---

## 8. 3-Tier 아키텍처

### 8.1 Tier 1: MCP Agent (사용자 자체 AI)

```
사용자의 AI (ChatGPT, Claude, etc.)
    │
    ▼ MCP Protocol
┌──────────────────────┐
│  Haggle MCP Server   │
│  ─────────────────── │
│  Tools:              │
│  - start_negotiation │
│  - submit_offer      │
│  - get_coaching      │ ← 심판 코칭을 MCP 도구로 노출
│  - get_history       │
│  - accept_deal       │
└──────────────────────┘
```

- **Haggle LLM 비용: $0** — 사용자가 자기 AI 사용
- 심판 코칭이 `get_coaching` 도구로 노출됨 → 어떤 AI든 활용 가능
- **Skill도 MCP 도구로 노출** → 사용자 AI가 Skill 전술을 호출

### 8.2 Tier 2: Built-in Agent (Haggle 내장 LLM)

```
사용자 "자동으로 해줘"
    │
    ▼
┌────────────────────────────┐
│  Haggle Built-in Agent     │
│  ModelAdapter + Skill      │
│  ─────────────────────────│
│  Context Assembly Pipeline │
│  L0 + L1 + L2 + L3 + L4  │
│  → LLM 호출               │
│  → Referee 검증            │
│  → 자동 협상 진행          │
└────────────────────────────┘
```

- **Haggle LLM 비용: ~$0.005/세션** (Grok Fast 기준)
- 사용자는 Skill만 선택하면 나머지는 자동
- 마진: 97%+

### 8.3 Tier 3: Skills Marketplace (Phase 2+)

- 서드파티가 NegotiationSkill 구현
- SkillManifest의 `llm_context`로 LLM 인식 주입
- SkillSignal로 실시간 데이터 제공
- [16_스킬_마켓플레이스.md](./16_스킬_마켓플레이스.md) 참조

---

## 9. 4원칙 → 계층 매핑

| 원칙 | L0 Protocol | L2 Skill | L3 Coaching | Referee |
|------|------------|----------|-------------|---------|
| **투명성** | 출력 스키마 공개 | Skill manifest 공개 | 코칭 내용 감사 로그 | 검증 사유 기록 |
| **합리성** | 수렴 규칙 강제 | Skill이 수학적 근거 제공 | Faratin 권장가 | 효용 함수 검증 |
| **중립성** | 양쪽 동일 규칙 | buyer/seller Skill 분리 | 동일 코칭 로직 | 편향 감지 V6 |
| **표준성** | NegotiationMove 스키마 | SkillManifest 표준 | RefereeCoaching 스키마 | 검증 규칙 통일 |

---

## 10. 08_LLM_정책.md와의 관계

### 10.1 상위 호환

v1.x의 `08_LLM_정책.md`에서 정의한 3가지 LLM 호출 지점은 v2.0에서 다음과 같이 매핑된다:

| v1.x 호출 지점 | v2.0 매핑 |
|----------------|-----------|
| ① Cold Path (전략 수립) | NegotiationSkill.assessContext() |
| ② Reactive (UNKNOWN_PROPOSAL) | NegotiationSkill.evaluateOffer() + Referee guidance |
| ③ Strategy Review (교착) | Referee coaching hints + 자동 코칭 레벨 조정 |

### 10.2 폐기되는 개념

- **세션당 LLM 호출 8회 제한** → v2.0에서는 매 라운드 LLM 호출이 기본. 제한은 비용이 아닌 latency SLA로 관리
- **Hot Path (LLM 없이 처리) 비율 목표** → v2.0에서는 LLM이 기본 경로. DefaultEngineSkill이 fallback
- **에스컬레이션 제어 장치** → Referee의 Coach-Validate-Guide 메커니즘으로 대체

### 10.3 유지되는 개념

- **해석 결과 캐싱** → v2.0에서도 유지 (동일 유형 반복 시 LLM 재호출 방지)
- **전략 변경 보호 장치** → p_limit 변경 시 사용자 확인 필수 (동일)
- **감사 로그** → v2.0에서 확장 (coaching + 응답 + 검증 + 교정 전체 기록)

---

## 11. 구현 로드맵

### Phase 1: Foundation (MVP)

| 항목 | 내용 |
|------|------|
| NegotiationSkill 인터페이스 | `assessContext`, `generateOffer`, `evaluateOffer` |
| DefaultEngineSkill | engine-core를 Skill 인터페이스로 래핑 |
| LLMNegotiationSkill | Grok Fast + Context Assembly Pipeline |
| Referee Service | 7개 검증 규칙 + Coach + Validate + Guide |
| Context Assembly | L0-L4 구현 (L5는 Phase 2) |
| ModelAdapter | GrokFastAdapter (1개) |
| 감사 로그 | coaching + response + validation 기록 |

### Phase 2: Multi-Model + Skills (Growth)

| 항목 | 내용 |
|------|------|
| 추가 ModelAdapter | GPT-4.1-mini, Claude Haiku |
| SkillManifest.llm_context | 서드파티 Skill → LLM 인식 주입 |
| SkillSignal | L5 실시간 신호 |
| MCP 도구 노출 | Tier 1 (사용자 자체 AI) 지원 |

### Phase 3: Marketplace (Scale)

| 항목 | 내용 |
|------|------|
| Skills Marketplace | Skill 등록, 심사, 수익 분배 |
| 코칭 레벨 자동 조정 | ModelCaps 기반 DETAILED/STANDARD/LIGHT |
| EvoEngine | 전략 진화 (Skill v1 → v2 자동 학습) |

---

## 12. 한 줄 요약

> **엔진은 심판으로, LLM은 선수로, Skill은 코치로.**
> 심판은 차단만 하지 않는다 — 코칭하고, 유도하고, 교정한다.
> LLM은 변화를 "느낀다" — 매 라운드 동적으로 조립되는 Living Context를 통해.
> 모델이 발전하면 코칭을 줄이고, Skill이 진화하면 인식이 확장된다.
> 프로토콜(스키마+규칙)은 불변, 나머지는 전부 교체 가능.

---

*이전 문서: [24_남용_탐지_정책.md](./24_남용_탐지_정책.md) | [00_INDEX.md로 돌아가기](./00_INDEX.md)*
*작성일: 2026-04-10*
*기반: CEO Jeonghaeng과의 아키텍처 설계 세션*
