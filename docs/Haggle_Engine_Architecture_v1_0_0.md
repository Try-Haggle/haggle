# Haggle Engine Architecture v1.0.0
## 적대적 AI-to-AI 협상을 위한 통합 엔진 사양서

**버전:** 1.0.0  
**작성일:** 2026-02-17  
**상태:** 외부 검토용 초안 (Draft for External Review)  
**아키텍처:** 4-Layer Skills 기반 (L0 Gateway → L1 Skill Layer → L2 Engine Core → L3 Wire+Data)  
**범위:** Engine Core 수학, Session Orchestration, LLM 에스컬레이션, 이벤트 드리븐 매칭, 비용 모델

---

## 0. 아키텍처 개요

### 0.1 시스템 위치

```
┌──────────────────────────────────────────────────────────────┐
│  L0: Gateway                                                  │
│  외부 프로토콜(UCP, MCP, HNP) → 내부 변환                     │
└────────────────────────────┬─────────────────────────────────┘
                             │
┌────────────────────────────▼─────────────────────────────────┐
│  L1: Skill Layer                                              │
│  ┌──────────┐ ┌──────────┐ ┌──────────┐ ┌─────────────────┐ │
│  │ Strategy │ │ Shipping │ │Reputation│ │Session          │ │
│  │  Skill   │ │  Skill   │ │  Skill   │ │ Orchestrator    │ │
│  └────┬─────┘ └────┬─────┘ └────┬─────┘ └────┬────────────┘ │
│       │ weights     │ p_eff     │ r_score    │ topology     │
│       │ α, β        │           │ i_comp     │ sessions     │
│       └──────┬──────┴──────┬────┴────────────┘              │
│              │  Skill Coordinator                            │
│              │  (NegotiationContext 조립)                     │
│              │  + LLM 에스컬레이션 판단                       │
└──────────────┼───────────────────────────────────────────────┘
               │
┌──────────────▼───────────────────────────────────────────────┐
│  L2: Engine Core  ← 본 문서의 핵심                            │
│  ┌──────────────────────────────────────────────────────────┐│
│  │  Utility Calculator (순수 수학, 200μs)                   ││
│  │  V_p · V_t · V_r · V_s → U_total                        ││
│  ├──────────────────────────────────────────────────────────┤│
│  │  Decision Maker (규칙 기반)                               ││
│  │  U_total vs 임계값 → ACCEPT / COUNTER / REJECT / ESCALATE││
│  ├──────────────────────────────────────────────────────────┤│
│  │  Faratin 양보 곡선 (순수 수학)                            ││
│  │  P(t) = P_start + (P_limit - P_start) × (t/T)^(1/β)    ││
│  ├──────────────────────────────────────────────────────────┤│
│  │  Batch Evaluator (순수 반복)                              ││
│  │  같은 전략 × N개 리스팅 → N개 U_total → 정렬             ││
│  ├──────────────────────────────────────────────────────────┤│
│  │  Multi-Session Comparator (순수 비교)                     ││
│  │  N개 세션 UtilityResult → 순위 + 추천 행동               ││
│  └──────────────────────────────────────────────────────────┘│
└──────────────────────────────────────────────────────────────┘
               │
┌──────────────▼───────────────────────────────────────────────┐
│  L3: Wire + Data                                              │
│  HNP 프로토콜 | Redis (Hot) | PostgreSQL (Cold)               │
└──────────────────────────────────────────────────────────────┘
```

### 0.2 설계 원칙

1. **결정론(Determinism)** — 동일 입력 → 동일 출력. 암묵적 상태나 외부 의존성 없음.
2. **제한된 출력(Bounded Output)** — 모든 V_i ∈ [0, 1]. 예외 없음.
3. **차원 독립성(Dimensional Independence)** — 각 V_i는 서로소인 입력 집합에 의존.
4. **역할 대칭(Role Symmetry)** — 구매자/판매자 수식은 구조적으로 동일. 파라미터 방향만 다름.
5. **스킬 경계 명확성(Skill Boundary Clarity)** — Engine Core는 DB 조회, API 호출, LLM 호출을 수행하지 않음(MUST NOT).
6. **엔진이 곧 깔때기(Engine as Funnel)** — 별도 필터링 레이어 없이, Engine Core 일괄 평가가 리스팅 선별을 수행.

### 0.3 Engine-First, 리액티브 에스컬레이션 원칙

**기본은 규칙 엔진. 모르면 LLM에 물어본다.**

전체 협상 라운드의 95%+는 Engine Core(200μs)가 처리한다. LLM은 **엔진이 처리할 수 없는 상황을 만났을 때** 호출된다. 초기 전략 수립뿐 아니라, 협상 도중 상대 엔진이 보낸 제안 중 현재 Engine Core가 이해하지 못하는 요소가 있으면 그때마다 LLM에 물어본다.

```
Hot Path (매 라운드, 95%+ 트래픽):
  상대 역제안 → Skill Coordinator → Engine Core (200μs) → Decision Maker → 응답
  LLM 호출: 0회

Cold Path (초기 전략 수립):
  사용자 목표 → Strategy Skill → LLM (Grok 4.1 Fast) → Master Strategy
  빈도: 제품당 1회 이상 (복잡도에 따라 다수 호출 가능)

Reactive Escalation (협상 중 "모르면 물어보기"):
  상대 제안 수신 → Engine Core가 처리 불가 판단 → ESCALATE
  → LLM이 상황 해석 + 전략 갱신 → Engine Core에 재입력
  빈도: 상대 엔진의 복잡도에 따라 다름
```

**핵심 비유: Engine Core는 계산기, LLM은 컨설턴트.**

계산기(Engine Core)가 4차원 효용을 계산하는 것은 매우 빠르고 저렴하다(200μs). 하지만 상대가 "아이패드에 케이스 끼워서 $50 깎아줄게"라고 번들 제안을 하면, 계산기는 이걸 어떻게 4차원에 넣어야 하는지 모른다. 이때 컨설턴트(LLM)에게 물어본다: "이 번들을 어떻게 해석해야 해?" LLM이 "p_effective를 $50 낮추고, i_completeness를 0.95로 올려" 하고 답하면, 계산기가 다시 계산한다.

```
상대 엔진: "번들 제안 — iPad $750 + Case $30 = $780, 단독이면 $810"
    │
    ▼
Engine Core: "번들?" → ESCALATE (처리 불가 요소 감지)
    │
    ▼
LLM (Grok 4.1 Fast, reasoning=ON):
  "번들 가치 분석:
   - 케이스 시장가 ~$40 → $30은 $10 할인
   - 실질 가격: $780 (번들) vs $810 (단독)
   - p_effective = $780으로 재계산 추천
   - 케이스 품질 불확실 → i_completeness 0.85 유지"
    │
    ▼
Engine Core: 갱신된 파라미터로 U_total 재계산 (200μs)
    → U_total = 0.78 → NEAR_DEAL
```

**하나의 제품 = 하나의 Master Strategy. 에스컬레이션은 전략을 갱신하는 것.**

LLM을 몇 회 호출하든, Master Strategy는 하나이며, 200개 리스팅에 동일하게 적용된다. 에스컬레이션은 이 전략을 **부분 갱신**하거나 **상대 제안을 재해석**하는 것이지, 새 전략을 만드는 것이 아니다.

---

## 1. 총 효용 함수

### 1.1 기본 공식

$$U_{total} = \sum_{i \in \{p, t, r, s\}} w_i \cdot V_i$$

**제약조건:**
- 모든 $i$에 대해 $w_i \geq 0$
- $\sum w_i = 1.0$
- 모든 $i$에 대해 $V_i \in [0, 1]$ (각 차원 수식에 의해 보장)
- 따라서 $U_{total} \in [0, 1]$

### 1.2 가중치 입력원

가중치는 입력으로 제공된다. Engine Core는 가중치를 수정하지 않는다.

```
입력: UtilityWeights {
  w_p: float  // 경제적 가중치
  w_t: float  // 시간 가중치
  w_r: float  // 리스크 가중치
  w_s: float  // 관계 가중치
}

공급자: Strategy Skill
  - 사용자 목표 + 페르소나 + 시장 데이터 기반
  - LLM이 초기 생성, 이후 Skill이 규칙 기반 미세 조정
```

### 1.3 Protobuf 인터페이스

```protobuf
message NegotiationContext {
  UtilityWeights weights = 1;
  PriceContext price = 2;
  TimeContext time = 3;
  RiskContext risk = 4;
  RelationshipContext relationship = 5;
  CompetitionContext competition = 6;  // 선택적. 없으면 1:1 단독 협상.
}

message UtilityWeights {
  float w_p = 1;
  float w_t = 2;
  float w_r = 3;
  float w_s = 4;
}

message UtilityResult {
  float u_total = 1;
  float v_p = 2;
  float v_t = 3;
  float v_r = 4;
  float v_s = 5;
  string error = 6;        // 비어있으면 성공
  string error_detail = 7;
}
```

---

## 2. V_p: 경제적 효용 (Economic Utility)

### 2.1 공식

**구매자 (P_target < P_limit):**

$$V_p = \begin{cases} 0 & \text{if } P_{effective} \geq P_{limit} \\ \text{clamp}\left(\dfrac{\ln(P_{limit} - P_{effective} + 1)}{\ln(P_{limit} - P_{target} + 1)}, \; 0, \; 1\right) & \text{otherwise} \end{cases}$$

**판매자 (P_target > P_limit):**

$$V_p = \begin{cases} 0 & \text{if } P_{effective} \leq P_{limit} \\ \text{clamp}\left(\dfrac{\ln(P_{effective} - P_{limit} + 1)}{\ln(P_{target} - P_{limit} + 1)}, \; 0, \; 1\right) & \text{otherwise} \end{cases}$$

**일반화:** P_effective가 마지노선을 초과(구매자) 또는 미달(판매자)하면 V_p = 0.

### 2.2 변수 정의

| 변수 | 정의 | 공급자 |
|------|------|--------|
| P_effective | 실질 가격 (리스팅 가격 + 배송비) | Shipping Skill |
| P_target | 목표 가격 (이상적 가격) | Strategy Skill (LLM이 생성) |
| P_limit | 마지노선 (이 이상/이하 수락 불가) | Strategy Skill (사용자 설정) |

### 2.3 해석

- **V_p = 1:** 목표가 이상. 매우 좋은 거래.
- **V_p ≈ 0.5:** 목표가와 마지노선의 중간.
- **V_p = 0:** 마지노선 도달 또는 초과. 수락 불가.
- **V_p 계산 불능 (P_target = P_limit):** 오류 반환 `ZERO_PRICE_RANGE`.

### 2.4 역할 대칭

| | 구매자 | 판매자 |
|---|---|---|
| 좋은 거래 | P_effective < P_target | P_effective > P_target |
| 마지노선 | P_effective ≥ P_limit → V_p = 0 | P_effective ≤ P_limit → V_p = 0 |
| P_limit 방향 | P_limit > P_target | P_limit < P_target |

이전 v1.0.0에서는 abs()로 방향을 무시했으나, 마지노선 초과 시 V_p가 다시 올라가는 버그가 있었다. 구매자/판매자를 구분하여 가드를 추가했다. Engine Core는 P_target과 P_limit의 대소 관계로 역할을 판별한다.

### 2.5 ln() 함수 선택 이유

| 속성 | 설명 |
|------|------|
| 오목성 | 목표가 근처에서 민감, 마지노선 근처에서 둔감 |
| 마이너스 방지 | `ln(x + 1)` 은 x ≥ 0에서 항상 ≥ 0 |
| 비율 정규화 | 분자/분모 구조로 자연스럽게 [0, 1] 매핑 |

### 2.6 Protobuf

```protobuf
message PriceContext {
  float p_effective = 1;
  float p_target = 2;
  float p_limit = 3;
}
```

---

## 3. V_t: 시간 효용 (Time Utility)

### 3.1 공식

$$V_t = \max\left(V_{t,floor}, \; \left(\max\left(0, \; 1 - \frac{t_{elapsed}}{t_{deadline}}\right)\right)^{\alpha}\right)$$

### 3.2 변수 정의

| 변수 | 정의 | 공급자 |
|------|------|--------|
| t_elapsed | 경과 시간 (초) | Session Manager Skill |
| t_deadline | 최대 허용 시간 (초) | Strategy Skill |
| α | 시간 민감도 | Strategy Skill (LLM이 생성) |
| V_t_floor | 시간 효용 바닥값 [0, 1] | Strategy Skill |

### 3.3 α의 의미

| α 값 | 곡선 형태 | 의미 | 사용 사례 |
|------|----------|------|----------|
| 0.5 | 볼록 | 초반 급락, 후반 둔감 | "빨리 끝내고 싶어" |
| 1.0 | 선형 | 균등 감소 | 기본값 |
| 3.0 | 오목 | 초반 여유, 후반 급락 | "여유 있지만 마감은 지켜야 해" |

### 3.4 V_t_floor의 의미

V_t_floor는 **시간이 아무리 지나도 V_t가 이 값 밑으로 내려가지 않게** 보장한다.

기존 문제: α = 3.0 ("천천히")이라도 마감 근처에서 V_t가 0으로 급락한다. 사용자가 진짜 원하는 건 "시간에 쫓기지 않는 것"인데, 어떤 α를 써도 t → T이면 V_t → 0이 되어 시간 압박이 결국 발생한다.

해결: V_t_floor로 바닥을 설정하면, 시간이 협상 결과에 미치는 영향 자체를 제한할 수 있다.

| 모드 | α | V_t_floor | T (마감) | 효과 |
|------|---|-----------|---------|------|
| 급함 | 0.5 | 0.0 | 24시간 | 시간 → 강한 압박 |
| 보통 | 1.0 | 0.0 | 72시간 | 시간 → 일반적 압박 |
| 여유 | 1.5 | 0.5 | 168시간 | 시간 → 약한 압박, 최소 50% 유지 |
| 천천히 | 1.0 | 0.8 | 720시간 | 시간 → 거의 영향 없음, 최소 80% 유지 |
| 무기한 | 1.0 | 0.95 | 2160시간 | 시간 → 사실상 무시 |

```
"천천히" 모드 (V_t_floor = 0.8):

V_t
1.0 ┤──────────────────────────────
    │                               ╲
0.8 ┤─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ── ── ── ── ──  ← 바닥
    │                                 (여기서 멈춤)
0.0 ┤
    └──────────────────────────────────────────────→ 시간
    0                                              T

"보통" 모드 (V_t_floor = 0.0):

V_t
1.0 ┤──────╲
    │        ╲
0.5 ┤         ╲
    │           ╲
0.0 ┤─────────────╲─────── ← 0까지 떨어짐
    └──────────────────────→ 시간
    0                      T
```

**핵심: "천천히"를 선택한 사용자는 시간 때문에 불리한 결정을 하지 않는다.**

V_t_floor = 0.8이면, w_t × V_t의 최소값이 w_t × 0.8이 된다. 시간 차원이 전체 효용에서 차지하는 비중이 w_t = 0.20이라면, 시간으로 인한 효용 손실이 최대 0.20 × 0.2 = 0.04에 불과하다. 사실상 시간이 결과에 거의 영향을 주지 않는 것이다.

### 3.5 Protobuf

```protobuf
message TimeContext {
  float t_elapsed = 1;
  float t_deadline = 2;
  float alpha = 3;
  float v_t_floor = 4;    // 시간 효용 바닥값 [0, 1]. 기본 0.0.
}
```

---

## 4. V_r: 리스크 효용 (Risk Utility)

### 4.1 공식

$$V_r = w_{rep} \times r_{score} + w_{info} \times i_{completeness}$$

$$w_{rep} + w_{info} = 1.0$$

### 4.2 변수 정의

| 변수 | 정의 | 범위 | 공급자 |
|------|------|------|--------|
| r_score | 상대방 평판 점수 | [0, 1] | Reputation Skill |
| i_completeness | 리스팅 정보 완성도 | [0, 1] | Reputation Skill |
| w_rep | 평판 가중치 | [0, 1] | Strategy Skill |
| w_info | 정보 완성도 가중치 | [0, 1] | Strategy Skill |

### 4.3 보장

r_score ∈ [0, 1] ∧ i_completeness ∈ [0, 1] ∧ w_rep + w_info = 1.0 → V_r ∈ [0, 1]

### 4.4 w_rep / w_info의 의미

이전 v1.0.0에서는 V_r = r_score × i_completeness (곱셈)이었다. 문제: Gold 판매자(r=0.95)가 리스팅을 대충 작성하면(i=0.30), V_r = 0.285 → 신규 판매자(r=0.50, i=0.95)의 V_r = 0.475보다 낮았다. 50건 무사고 거래를 한 사람이 신규보다 리스크가 높다는 건 직관에 반한다.

가중 평균으로 전환하면, 같은 상황에서 V_r = 0.95×0.6 + 0.30×0.4 = 0.69. 평판의 가치가 보존된다.

| 카테고리 | w_rep | w_info | 이유 |
|---------|-------|--------|------|
| 전자기기 | 0.50 | 0.50 | 사진/스펙 중요, 평판도 중요 |
| 차량 | 0.40 | 0.60 | 차량 상태 정보가 핵심 |
| 의류/패션 | 0.70 | 0.30 | 상태 주관적, 판매자 신뢰가 핵심 |
| 명품 | 0.50 | 0.50 | 진위 확인 + 판매자 신뢰 모두 중요 |
| 기본값 | 0.60 | 0.40 | 대부분의 거래에서 평판이 약간 더 중요 |

Strategy Skill이 카테고리와 상황에 따라 w_rep / w_info를 조절한다. Engine Core는 이 값을 그대로 사용한다.

### 4.5 Protobuf

```protobuf
message RiskContext {
  float r_score = 1;
  float i_completeness = 2;
  float w_rep = 3;       // 평판 가중치. 기본 0.6.
  float w_info = 4;      // 정보 완성도 가중치. 기본 0.4.
}
```

---

## 5. V_s: 관계 효용 (Relationship Utility)

### 5.1 공식

$$V_s = \text{clamp}\left(V_{s,base} + \frac{N_{success}}{N_{threshold}} + P_{dispute}, \; 0, \; 1\right)$$

$$P_{dispute} = N_{dispute\_losses} \times (-0.3)$$

### 5.2 변수 정의

| 변수 | 정의 | 공급자 |
|------|------|--------|
| V_s_base | 초면 기본값 [0, 1] | Strategy Skill. 기본 0.5. |
| N_success | 이 상대와의 성공 거래 수 | Reputation Skill |
| N_threshold | 최대 신뢰 도달 기준 거래 수 | Strategy Skill |
| N_dispute_losses | 분쟁 패소 횟수 | Reputation Skill |

### 5.3 V_s_base의 의미

P2P 거래의 90% 이상이 초면이다. 이전 공식(V_s_base = 0)에서는 초면이 V_s = 0.0 → 효용의 20%(w_s=0.20 가정)가 자동 상실되어, 모든 첫 거래가 구조적으로 불이익을 받았다.

V_s_base = 0.5로 설정하면 초면이 "중립"이 된다. 거래를 쌓으면 보너스, 분쟁이 있으면 페널티.

### 5.4 해석

| 상황 | V_s | 해석 |
|------|-----|------|
| 초면 | 0.5 | 중립 (보너스도 페널티도 없음) |
| 1회 성공 (기준 10회) | 0.6 | 약간 신뢰 |
| 3회 성공 | 0.8 | 상당한 신뢰 |
| 5회 이상 성공 | 1.0 | 최대 신뢰 (clamp) |
| 초면 + 1회 분쟁 패소 | 0.2 | 위험 신호 |
| 3회 성공 + 2회 분쟁 패소 | 0.2 | 분쟁이 신뢰를 상쇄 |

### 5.5 Protobuf

```protobuf
message RelationshipContext {
  int32 n_success = 1;
  int32 n_dispute_losses = 2;
  int32 n_threshold = 3;
  float v_s_base = 4;        // 초면 기본값. 기본 0.5.
}
```

---

## 6. Engine Core 확장: 경쟁 컨텍스트

### 6.1 CompetitionContext (선택적 입력)

1:N 또는 N:1 토폴로지에서 경쟁 상황을 V_p에 반영한다.

```protobuf
message CompetitionContext {
  int32 n_competitors = 1;          // 활성 경쟁 세션 수
  float best_alternative = 2;       // BATNA: 현재 최선의 대안 가격
  float market_position = 3;        // 이 제안의 시장 내 위치 [0, 1]
}
```

### 6.2 V_p 경쟁 조정

CompetitionContext가 있으면:

$$V_p^{adjusted} = \text{clamp}(V_p \times (1 + \gamma \cdot \ln(N_{competitors} + 1) \cdot M_{position}), \; 0, \; 1)$$

- $\gamma$ = 경쟁 민감도 (Strategy Skill 제공, 기본 0.1)
- CompetitionContext 없으면: V_p는 기본 공식 그대로. 하위 호환 100%.

---

## 7. Faratin 양보 곡선

### 7.1 공식

$$P(t) = P_{start} + (P_{limit} - P_{start}) \times \left(\frac{t}{T}\right)^{1/\beta}$$

### 7.2 변수 정의

| 변수 | 정의 |
|------|------|
| P_start | 초기 제안가 |
| P_limit | 마지노선 |
| t | 현재 시간 (0~T) |
| T | 총 협상 시간 |
| β | 양보 속도 |

### 7.3 β의 의미

| β | 곡선 | 스타일 | 페르소나 |
|---|------|--------|---------|
| 0.5 | 볼록 (급양보) | 초반 많이, 후반 적게 | Rabbit (소심한) |
| 1.0 | 선형 | 균등 양보 | Fox (균형잡힌) |
| 3.0 | 오목 (고집) | 초반 적게, 후반 많이 | Tiger (공격적) |

### 7.4 역할

Engine Core의 Decision Maker가 COUNTER 결정을 내리면, 이 곡선으로 역제안 가격을 산출한다.

---

## 8. Batch Evaluator

### 8.1 목적

하나의 Master Strategy로 N개 리스팅을 한 번에 평가한다. **엔진이 곧 깔때기**—별도 필터링 레이어가 필요 없다.

### 8.2 Protobuf

```protobuf
message BatchEvaluateRequest {
  UtilityWeights weights = 1;           // Master Strategy에서 (공통)
  TimeContext time = 2;                 // 공통
  float alpha = 3;                      // 공통
  
  repeated ListingData listings = 4;    // 리스팅별 데이터
}

message ListingData {
  string listing_id = 1;
  float p_effective = 2;
  float p_target = 3;
  float p_limit = 4;
  float r_score = 5;
  float i_completeness = 6;
  int32 n_success = 7;
  int32 n_dispute_losses = 8;
}

message BatchEvaluateResult {
  repeated RankedListing rankings = 1;
  int32 total_evaluated = 2;
  float evaluation_time_ms = 3;
}

message RankedListing {
  string listing_id = 1;
  int32 rank = 2;
  UtilityResult utility = 3;
}
```

### 8.3 구현

내부적으로 각 리스팅에 대해 compute_utility를 호출하고 정렬할 뿐이다. 새로운 수학 없음.

```python
def batch_evaluate(request: BatchEvaluateRequest) -> BatchEvaluateResult:
    results = []
    for listing in request.listings:
        ctx = NegotiationContext(
            weights=request.weights,
            price=PriceContext(
                p_effective=listing.p_effective,
                p_target=listing.p_target,
                p_limit=listing.p_limit
            ),
            time=request.time,
            risk=RiskContext(
                r_score=listing.r_score,
                i_completeness=listing.i_completeness
            ),
            relationship=RelationshipContext(
                n_success=listing.n_success,
                n_dispute_losses=listing.n_dispute_losses,
                n_threshold=request.n_threshold
            )
        )
        result = compute_utility(ctx)
        results.append((listing.listing_id, result))
    
    results.sort(key=lambda x: x[1]['u_total'], reverse=True)
    return BatchEvaluateResult(
        rankings=[
            RankedListing(listing_id=lid, rank=i+1, utility=util)
            for i, (lid, util) in enumerate(results)
        ],
        total_evaluated=len(results)
    )
```

**성능:** 200개 리스팅 × 200μs = 40ms. 1,000개도 200ms.

---

## 9. Multi-Session Comparator

### 9.1 목적

동일 제품에 대한 N개 활성 세션의 현재 상태를 비교하여 순위를 매기고, 세션 간 전략 권고를 생성한다.

### 9.2 Protobuf

```protobuf
message SessionCompareRequest {
  repeated SessionSnapshot sessions = 1;
}

message SessionSnapshot {
  string session_id = 1;
  UtilityResult current_utility = 2;
  float last_offer_price = 3;
  int32 round_number = 4;
  string state = 5;         // "ACTIVE" | "NEAR_DEAL" | "STALLED"
}

message SessionCompareResult {
  repeated SessionRanking rankings = 1;
  string best_session_id = 2;
  float batna_price = 3;             // 현재 최선 대안 가격
  string recommended_action = 4;     // "CONTINUE" | "ACCEPT_BEST" | "ESCALATE"
}

message SessionRanking {
  string session_id = 1;
  int32 rank = 2;
  float u_total = 3;
  string suggestion = 4;
}
```

---

## 10. Decision Maker

### 10.1 결정 규칙

```
입력: UtilityResult + 임계값 파라미터 + 제안 파싱 결과

U_threshold:  수락 가능 최저 효용 (Strategy Skill이 설정)
U_aspiration: 목표 효용 (Strategy Skill이 설정)

규칙 (우선순위 순):

  === 파싱 실패 (최우선) ===
  0. 상대 제안에 처리 불가 요소 포함 → ESCALATE (LLM에 해석 요청)
     예: 번들, 조건부, 트레이드인, 비표준 결제 조건 등

  === 정상 처리 ===
  1. u_total ≥ U_aspiration → ACCEPT
  2. u_total ≥ U_threshold AND 마감 임박(V_t < 0.1) → ACCEPT
  3. u_total ≥ U_threshold → NEAR_DEAL (사용자에게 수락 추천)
  4. u_total > 0 → COUNTER (Faratin 곡선으로 역제안)
  5. u_total ≤ 0 → REJECT (마지노선 초과)

  === 진행 중 에스컬레이션 ===
  6. 4라운드 이상 교착 → ESCALATE (전략 재검토)
  7. V_t ≤ V_t_floor + 0.05 AND u_total < U_threshold → ESCALATE (마감 임박 + 합의 불가)
     (V_t_floor가 높으면 이 조건이 거의 발동하지 않음 = "천천히" 모드의 의도)
```

### 10.2 ESCALATE의 두 가지 유형

**유형 1: UNKNOWN_PROPOSAL (리액티브)**

상대 엔진이 보낸 제안에 Engine Core가 이해할 수 없는 요소가 있을 때. 이것이 가장 흔한 에스컬레이션이다.

```
상대 제안 수신 → Proposal Parser → 파싱 결과
  │
  ├─ 완전 파싱 성공 → Engine Core에 입력 → 정상 처리
  │
  └─ 미인식 요소 발견 → ESCALATE(UNKNOWN_PROPOSAL)
      │
      ▼
  LLM (Grok 4.1 Fast, reasoning=ON):
    "이 제안을 해석해줘. 어떻게 4차원 효용으로 변환하면 돼?"
      │
      ▼
  LLM 응답: 파라미터 재매핑 지시
    {p_effective: $780, r_score_adjustment: +0.05, ...}
      │
      ▼
  Engine Core: 갱신된 입력으로 U_total 재계산 (200μs)
```

**Engine Core가 처리 못하는 제안 유형 예시:**

| 상대 제안 | Engine Core가 모르는 것 | LLM이 해석하는 것 |
|----------|----------------------|------------------|
| "iPad + 케이스 번들 $780" | 번들 가치 분해 | p_effective 재계산 |
| "24시간 내 결제 시 $50 할인" | 조건부 가격 | 시간 조건 → V_t 반영 방법 |
| "구형 아이패드 트레이드인" | 트레이드인 가치 | 실질 순비용 계산 |
| "배송비 포함 vs 별도" | 비용 구조 변경 | p_effective 재계산 |
| "2개 구매 시 할인" | 수량 할인 | 단위당 가격으로 정규화 |
| "암호화폐 결제 시 5% 할인" | 결제 수단별 가치 | 리스크 조정 후 p_effective |

**유형 2: STRATEGY_REVIEW (선제적)**

Engine Core가 정상 처리했지만 결과가 비정상적일 때. 전략 자체를 재검토해야 한다.

```
  4라운드 이상 교착 → "전략이 맞는지 확인해줘"
  마감 임박 + 합의 불가 → "마지막으로 할 수 있는 게 뭐야?"
  시장 급변 감지 → "파라미터 전면 재조정 필요?"
```

### 10.3 Proposal Parser

Engine Core 앞단에서 상대 제안을 파싱하는 컴포넌트:

```python
class ProposalParseResult:
    fully_parsed: bool          # 모든 요소가 4D로 변환 가능?
    negotiation_context: dict   # 파싱 성공한 부분
    unknown_elements: list      # 미인식 요소들
    escalation_reason: str      # ESCALATE 시 이유

def parse_opponent_proposal(proposal: dict) -> ProposalParseResult:
    """
    상대 제안을 NegotiationContext 형태로 변환 시도.
    변환 불가 요소가 있으면 unknown_elements에 적재.
    """
    known_fields = extract_known_fields(proposal)     # 가격, 수량 등
    unknown_fields = extract_unknown_fields(proposal)  # 번들, 조건부 등
    
    if not unknown_fields:
        return ProposalParseResult(
            fully_parsed=True,
            negotiation_context=build_context(known_fields),
            unknown_elements=[],
            escalation_reason=None
        )
    else:
        return ProposalParseResult(
            fully_parsed=False,
            negotiation_context=build_context(known_fields),  # 아는 부분은 유지
            unknown_elements=unknown_fields,
            escalation_reason=f"UNKNOWN_PROPOSAL: {[f['type'] for f in unknown_fields]}"
        )
```

---

## 11. LLM 사용 정책

### 11.1 호출 지점 3가지

```
┌─────────────────────────────────────────────────────────────┐
│  LLM 호출이 발생하는 3가지 경로                               │
│                                                              │
│  ① Cold Path: 초기 전략 수립                                 │
│     사용자 자연어 → LLM → Master Strategy                    │
│     빈도: 제품당 1회 (복잡하면 2-3회)                         │
│                                                              │
│  ② Reactive Escalation: 상대 제안 해석 불가                  │
│     상대가 보낸 번들/조건부/트레이드인 → LLM이 해석           │
│     빈도: 상대 엔진의 복잡도에 따라 0~수회                    │
│                                                              │
│  ③ Strategy Review: 진행 중 전략 재검토                      │
│     교착/시장급변/마감임박 → LLM이 전략 갱신                  │
│     빈도: 대부분 0회, 복잡한 협상에서 1-2회                   │
└─────────────────────────────────────────────────────────────┘
```

#### ① Cold Path: 초기 전략 수립

```
사용자: "아이패드 프로 M4 256GB 사고 싶어, AppleCare 남은 것, 예산 $700-850"
    │
    ▼
Strategy Skill → LLM (Grok 4.1 Fast, reasoning=ON)
    │
    ├─ 1차 호출: 사용자 의도 파싱 + 카테고리 식별
    │   → "electronics/tablet/ipad-pro-m4-256gb"
    │   → 시장가 범위: $720-$950
    │
    ├─ 2차 호출 (필요 시): 전략 파라미터 생성
    │   → weights, p_target, p_limit, α, β, 페르소나
    │   → 조건 분석: AppleCare 필수, 상태 A급
    │
    └─ 결과: Master Strategy 생성
       {w_p:0.40, w_t:0.15, w_r:0.25, w_s:0.20,
        p_target:$720, p_limit:$850, β:1.5, α:1.0}
```

단순한 요청("아이패드 사고 싶어, $800")은 LLM 1회면 충분하다. 복잡한 조건이 많을 때만 2-3회.

#### ② Reactive Escalation: "모르면 물어보기"

협상 도중 상대 엔진이 보낸 제안 중 Engine Core가 처리할 수 없는 요소가 있으면, 그 즉시 LLM에 물어본다.

```
라운드 4: 상대 엔진이 번들 제안 발송
    │
    ▼
Proposal Parser: "번들 요소 감지 — Engine Core가 처리 불가"
    │
    ▼
ESCALATE(UNKNOWN_PROPOSAL) → LLM (Grok 4.1 Fast, reasoning=ON)
    │
    ├─ LLM 입력:
    │   "상대가 iPad $750 + ApplePencil $80 = $780 번들 제안.
    │    단독 iPad $810. 내 전략: p_target=$720, p_limit=$850.
    │    이 번들을 4차원 효용으로 어떻게 변환해?"
    │
    └─ LLM 응답:
       "번들 분석:
        - ApplePencil 시장가 ~$95 → $80은 $15 할인
        - iPad 실질 가격: $780 - $80(펜슬) = $700 (목표가 이하!)
        - 하지만 펜슬이 필요 없다면 실질 가격 $780
        - 추천: p_effective=$780, 펜슬 필요 여부 사용자에게 확인"
    │
    ▼
Engine Core: p_effective=$780으로 U_total 재계산 (200μs)
    → U_total = 0.78 → NEAR_DEAL
```

**이 모델의 핵심: Engine Core는 자기가 모르는 걸 안다.**

Proposal Parser가 미인식 요소를 감지하면 무리하게 처리하지 않고 즉시 LLM에 해석을 요청한다. LLM은 미인식 요소를 4차원 효용으로 변환하는 "통역사" 역할을 한다.

#### ③ Strategy Review: 진행 중 전략 재검토

```
4라운드 이상 교착:
    │
    ▼
ESCALATE(STRATEGY_REVIEW) → LLM
    "4라운드째 양보 없음. 상대 최근 3개 제안: $810, $805, $803.
     내 전략: p_target=$720. 현실적 재조정 필요?"
    │
    ▼
LLM: "상대 마지노선 추정 $790-800.
      p_target을 $760으로 상향, β를 1.2로 완화 추천."
```

### 11.2 에스컬레이션 트리거 전체 목록

| 트리거 | 유형 | LLM 필요? | 설명 |
|--------|------|----------|------|
| **상대 제안에 미인식 요소** | UNKNOWN_PROPOSAL | **항상** | 번들, 조건부, 트레이드인 등 |
| **비표준 결제 조건** | UNKNOWN_PROPOSAL | **항상** | 암호화폐 할인, 할부 등 |
| **수량 할인 제안** | UNKNOWN_PROPOSAL | **항상** | "2개 사면 15% 할인" |
| 4라운드+ 교착 | STRATEGY_REVIEW | 가능 | 규칙 기반 먼저 시도 |
| 시장가 10%+ 급변 | STRATEGY_REVIEW | 가능 | 전면 재전략화 판단 |
| V_t < 0.05 AND 합의 불가 | STRATEGY_REVIEW | 예 | 마지막 시도 |
| 사용자 전략 변경 요청 | STRATEGY_REVIEW | 가능 | "더 공격적으로" |

### 11.3 에스컬레이션 제어 장치

```
세션당 최대 LLM 호출: 8회
  → UNKNOWN_PROPOSAL: 최대 5회 (상대가 매번 새 유형 보낼 때)
  → STRATEGY_REVIEW: 최대 3회
  → 초과 시: 사용자에게 수동 개입 요청

UNKNOWN_PROPOSAL은 쿨다운 없음:
  → 상대가 새 유형을 보낼 때마다 즉시 LLM 호출 가능
  → 같은 유형 반복 시에는 첫 해석 결과 캐싱 사용

STRATEGY_REVIEW 간 최소 간격: 3라운드

전략 변경 폭 제한:
  → LLM이 제안한 w_i 변경이 ±0.15 초과 시 사용자 확인 필요
  → p_limit 변경은 항상 사용자 확인 필요 (마지노선은 사용자 권한)
```

### 11.4 해석 결과 캐싱

같은 유형의 제안이 반복되면 LLM을 다시 호출하지 않는다:

```python
class ProposalInterpretationCache:
    """
    LLM이 해석한 결과를 캐싱. 동일 유형 재사용.
    """
    def get_interpretation(self, proposal_type: str, 
                           proposal_params: dict) -> Optional[dict]:
        cache_key = f"{proposal_type}:{hash(frozenset(proposal_params.items()))}"
        return self.cache.get(cache_key)
    
    def cache_interpretation(self, proposal_type: str,
                             proposal_params: dict, 
                             interpretation: dict):
        cache_key = f"{proposal_type}:{hash(frozenset(proposal_params.items()))}"
        self.cache.set(cache_key, interpretation, ttl=3600)  # 1시간

# 사용 예:
# 라운드 4: "번들: iPad + 케이스" → LLM 호출 → 해석 캐싱
# 라운드 6: "번들: iPad + 케이스 (가격만 다름)" → 캐시 히트 → LLM 호출 없음
# 라운드 8: "트레이드인 제안" → 새 유형 → LLM 호출
```

### 11.5 LLM 호출 빈도 예측

| 시나리오 | Cold | Reactive | Review | 합계 |
|----------|------|----------|--------|------|
| 단순 거래 (가격만 협상) | 1 | 0 | 0 | **1** |
| 일반 거래 (10라운드) | 1 | 0 | 0 | **1** |
| 번들 제안 1회 수신 | 1 | 1 | 0 | **2** |
| 복잡한 상대 (번들+조건부+교착) | 1 | 2 | 1 | **4** |
| 장기 + 시장 급변 + 트레이드인 | 2 | 2 | 2 | **6** |
| **일반 평균** | **1** | **0.3** | **0.2** | **1.5** |

---

## 12. Master Strategy와 세션 오케스트레이션

### 12.1 Master Strategy

하나의 제품에 대한 전략은 하나다.

```
┌─────────────────────────────────────────────┐
│  Master Strategy (LLM으로 생성)              │
│  사용자의 목표 + 페르소나 = 전략 파라미터      │
│  - weights, p_target, p_limit, α, β          │
│  - U_threshold, U_aspiration                 │
│  - n_threshold, persona                      │
└───────────────────┬─────────────────────────┘
                    │ 동일 전략
        ┌───────────┼───────────┐
        ▼           ▼           ▼
┌──────────┐ ┌──────────┐ ┌──────────┐
│ Session A │ │ Session B │ │ Session C │
│ 같은 전략 │ │ 같은 전략 │ │ 같은 전략 │
│ 다른 데이터│ │ 다른 데이터│ │ 다른 데이터│
│           │ │           │ │           │
│ 판매자 A: │ │ 판매자 B: │ │ 판매자 C: │
│ r=0.92    │ │ r=0.65    │ │ r=0.98    │
│ p=$850    │ │ p=$780    │ │ p=$900    │
│ 거래이력3 │ │ 거래이력0 │ │ 거래이력1 │
└──────────┘ └──────────┘ └──────────┘
```

### 12.2 MasterStrategy Protobuf

```protobuf
message MasterStrategy {
  string id = 1;
  string user_id = 2;
  
  UtilityWeights weights = 3;
  float p_target = 4;
  float p_limit = 5;
  float alpha = 6;
  float beta = 7;
  float t_deadline = 8;
  float v_t_floor = 9;       // 시간 효용 바닥값. "천천히" = 0.8, 기본 = 0.0
  int32 n_threshold = 10;
  string persona = 11;
  
  // Decision Maker 임계값
  float u_threshold = 12;
  float u_aspiration = 13;
  
  // 메타
  int32 llm_calls_used = 14;
  google.protobuf.Timestamp created_at = 15;
  google.protobuf.Timestamp expires_at = 16;
}
```

### 12.3 전략이 변경되는 경우

| 상황 | 변경 방식 | LLM 필요? |
|------|----------|----------|
| 시장가 소폭 변동 (<10%) | P_target/P_limit 규칙 기반 조정 | 아니오 |
| 시장가 대폭 변동 (>10%) | Strategy Skill 재계산 | 가능 |
| 사용자 수동 변경 | 사용자 입력 직접 반영 | 아니오 |
| 세션 교착 (STALLED, 규칙 실패) | LLM 재전략화 | 예 |
| 페르소나 전환 | 프리셋 교체 | 아니오 |
| 번들/조건부 제안 수신 | 새 조건 분석 | 예 |

---

## 13. 이벤트 드리븐 매칭 시스템

### 13.1 대기 의도 (Waiting Intent)

사용자가 제품을 찾고 있지만 아직 적절한 상대가 없을 때 등록하는 의도:

```protobuf
message WaitingIntent {
  string intent_id = 1;
  string user_id = 2;
  string role = 3;                       // "BUYER" 또는 "SELLER"
  
  // 제품 매칭 조건
  string category = 4;
  repeated string keywords = 5;
  
  // Master Strategy (LLM으로 생성, 저장됨)
  MasterStrategy strategy = 6;
  
  // 매칭 조건
  float min_u_total = 7;                 // 이 이상이어야 세션 시작 (기본 0.3)
  int32 max_active_sessions = 8;         // 동시 활성 세션 상한 (기본 5)
  
  // 수명
  google.protobuf.Timestamp created_at = 9;
  google.protobuf.Timestamp expires_at = 10;
  
  enum Status {
    ACTIVE = 0;
    MATCHED = 1;
    FULFILLED = 2;
    EXPIRED = 3;
    CANCELLED = 4;
  }
  Status status = 11;
}
```

### 13.2 이벤트 흐름

#### 시나리오 1: 구매자 먼저, 판매자 나중

```
Day 1: 구매자 등록
  사용자: "아이패드 프로 M4 사고 싶어, 예산 $800"
  → LLM → Master Strategy 생성
  → WaitingIntent 저장 (ACTIVE)

      ...시간 경과...

Day 3: 판매자가 리스팅 등록
  이벤트: new_listing (category: electronics/tablet/ipad-pro)
    │
    ▼
  Matching Engine:
    1. 이 카테고리의 ACTIVE 구매자 WaitingIntent 조회 → 발견
    2. Engine Core 1회 호출 (200μs): 구매자 전략 + 리스팅 데이터
    3. U_total = 0.72 > min_u_total(0.3) → 매칭 성공
    4. 세션 자동 생성 → 협상 시작
    5. LLM 호출: 0회 (전략 이미 존재)
```

#### 시나리오 2: 판매자 먼저, 구매자 나중

```
판매자: "맥북 프로 팝니다, 최소 $1,800"
  → LLM → Master Strategy (판매자 관점) → WaitingIntent 저장

구매자: "맥북 프로 사고 싶어, 예산 $2,000"
  → LLM → Master Strategy (구매자 관점)
  → Matching Engine:
    1. 이 카테고리의 ACTIVE 판매자 WaitingIntent 조회 → 발견
    2. 구매자 Strategy로 판매자 리스팅 평가 → U_total (구매자 관점)
    3. 판매자 Strategy로 구매자 조건 평가 → U_total (판매자 관점)
    4. 양쪽 모두 min_u_total 초과 → 양방향 매칭 성공
    5. 세션 생성 → 즉시 협상 시작
```

#### 시나리오 3: 한 리스팅에 대기 구매자 여러 명

```
구매자 A: 대기 중 (예산 $800, Fox)
구매자 B: 대기 중 (예산 $850, Tiger)
구매자 C: 대기 중 (예산 $750, Rabbit)

새 리스팅 등록: $780

Matching Engine:
  Engine Core × 3 (600μs):
    구매자 A: U_total = 0.72 → 매칭
    구매자 B: U_total = 0.85 → 매칭
    구매자 C: U_total = 0.35 → 매칭

  3명 모두 min_u_total 초과 → 3개 세션 동시 생성
  판매자 관점: N:1 토폴로지 자동 감지
```

### 13.3 매칭 트리거

| 이벤트 | 방향 | 처리 |
|--------|------|------|
| 새 리스팅 등록 | 리스팅 → 대기 구매자들 | 해당 카테고리 ACTIVE Intent 조회 → 일괄 평가 |
| 새 구매 의도 등록 | 구매 의도 → 기존 리스팅들 | 해당 카테고리 리스팅 조회 → 일괄 평가 |
| 리스팅 가격 변경 | 가격 변경 → 대기 구매자 재평가 | 변경된 가격으로 재평가 |
| 리스팅 삭제/판매완료 | → 관련 세션 SUPERSEDED | 활성 세션 정리 |
| 전략 변경 | → 기존 리스팅 재평가 | 새 전략으로 일괄 재평가 |

---

## 14. Session Orchestrator

### 14.1 책임

| 책임 | 설명 |
|------|------|
| 이벤트 매칭 | 새 리스팅/구매 의도 → 대기 Intent와 매칭 |
| 일괄 평가 | Engine Core Batch Evaluate로 리스팅 순위 산출 |
| 세션 생명주기 | 생성, 활성, 일시정지, SUPERSEDED, 종료 |
| 토폴로지 감지 | 1:1, 1:N, N:1, N:M 자동 식별 |
| Top N 관리 | 상위 세션에 집중, 하위 세션 대기 |
| 크로스 프레셔 | 경쟁 정보 수집 및 주입 |
| 재평가 트리거 | 시장 변동, 새 리스팅 등 이벤트 시 재평가 |

### 14.2 토폴로지 자동 감지

```python
def detect_topology(user_sessions: list) -> Topology:
    unique_items = set(s.item_category for s in user_sessions)
    unique_counterparties = set(s.counterparty_id for s in user_sessions)
    
    if len(user_sessions) == 1:
        return Topology.ONE_TO_ONE
    elif len(unique_items) == 1 and len(unique_counterparties) > 1:
        return Topology.ONE_TO_N   # 구매자 or 판매자 관점에서 1:N
    elif len(unique_items) > 1 and len(unique_counterparties) > 1:
        return Topology.N_TO_M
    else:
        return Topology.INDEPENDENT
```

### 14.3 세션 상태 머신

```
  ┌───────────┐    ┌──────────┐    ┌─────────────┐
  │  CREATED  │───▶│  ACTIVE  │───▶│  NEAR_DEAL  │──┐
  └───────────┘    └────┬─────┘    └──────┬──────┘  │
                        │                  │         │
                   ┌────▼─────┐     ┌─────▼──────┐  │
                   │ STALLED  │     │  ACCEPTED  │  │
                   └────┬─────┘     └────────────┘  │
                        │                            │
                   ┌────▼─────┐    ┌─────────────┐  │
                   │ RESUMED  │───▶│  EXPIRED    │◀─┘
                   └──────────┘    └─────────────┘
                                   ┌─────────────┐
                                   │ SUPERSEDED  │ ← 다른 세션에서 거래 성사
                                   └─────────────┘
                                   ┌─────────────┐
                                   │  WAITING    │ ← Top N 밖, 승격 대기
                                   └─────────────┘
```

**상태 전이 규칙:**

| 현재 | 트리거 | 다음 | 조건 |
|------|--------|------|------|
| CREATED | 첫 제안 발송 | ACTIVE | - |
| ACTIVE | U_total ≥ U_threshold | NEAR_DEAL | 수락 가능 제안 |
| ACTIVE | 2라운드 양보 없음 | STALLED | 교착 |
| ACTIVE | t_elapsed > t_deadline | EXPIRED | 마감 초과 |
| STALLED | 재전략화 (규칙 or LLM) | RESUMED | 에스컬레이션 |
| STALLED | 사용자 개입 | RESUMED | 마지노선 변경 등 |
| NEAR_DEAL | 사용자 승인 | ACCEPTED | 최종 수락 |
| ACTIVE/STALLED | 다른 세션 ACCEPTED | SUPERSEDED | 동일 제품 경쟁 |
| WAITING | Top 세션 탈락 | CREATED → ACTIVE | 자동 승격 |

---

## 15. 1:N 흐름 (구매자 1, 판매자 N)

### 15.1 전체 흐름

```
사용자: "아이패드 프로 M4 사고 싶어, 예산 $800"
    │
    ▼
LLM → Master Strategy 생성
    │
    ▼
리스팅 조회: 해당 카테고리 200개 발견
    │
    ▼
Engine Core Batch Evaluate (40ms):
  같은 Master Strategy × 200개 리스팅 → 200개 U_total → 정렬
    │
    ▼
Top 5 세션 생성 → 병렬 협상 시작
나머지 195개 → WAITING (세션 미생성)
    │
    ▼ (라운드 진행... Hot Path만, LLM 0회)
    │
재평가 트리거 (새 리스팅 등록 or 4시간)
    │
    ▼
Engine Core 일괄 재평가 → Top 5 재선정
    │
    ▼ (수렴...)
    │
Session D: NEAR_DEAL → 사용자 수락 → ACCEPTED
나머지 활성 세션 → SUPERSEDED
WAITING 풀 → 전부 정리
```

### 15.2 세션별 컨텍스트 적용

Master Strategy는 하나지만, 각 세션에서 상대방 데이터가 다르므로 결과가 달라진다:

```python
def apply_master_to_listing(master: MasterStrategy, 
                            listing: ListingData) -> NegotiationContext:
    """
    같은 전략, 다른 데이터 → 다른 NegotiationContext.
    Strategy Skill에 위치. LLM 호출 없음.
    """
    return NegotiationContext(
        weights=master.weights,
        price=PriceContext(
            p_effective=listing.price + listing.shipping_cost,
            p_target=master.p_target,
            p_limit=master.p_limit
        ),
        time=TimeContext(
            t_elapsed=session.elapsed,
            t_deadline=master.t_deadline,
            alpha=master.alpha
        ),
        risk=RiskContext(
            r_score=listing.seller_reputation,
            i_completeness=listing.completeness
        ),
        relationship=RelationshipContext(
            n_success=get_history(user, listing.seller_id),
            n_dispute_losses=get_disputes(user, listing.seller_id),
            n_threshold=master.n_threshold
        )
    )
```

---

## 16. N:1, N:M 흐름

### 16.1 N:1 (구매자 N, 판매자 1)

인기 매물 경쟁. 판매자가 유리한 포지션.

| 항목 | 1:N (구매자가 오케스트레이션) | N:1 (판매자가 오케스트레이션) |
|------|---------------------------|---------------------------|
| 일괄 평가 주체 | 구매자 측 | 판매자 측 |
| 크로스 프레셔 방향 | 구매자 → 판매자들에게 | 판매자 → 구매자들에게 |
| 경쟁 효과 | 판매자 가격 하락 | 구매자 가격 상승 |
| Anti-Sniping | 불필요 | 필요 |

**Anti-Sniping:**
```
IF 마감 5분 이내에 새 제안 도착:
  → 마감 3분 연장 (최대 2회, 총 6분 추가 가능)
  → 모든 참가자에게 통지
```

### 16.2 N:M 분해

N:M을 직접 처리하지 않고, **여러 개의 1:N과 N:1로 분해**한다.

```
시장:
  판매자 A: 에어팟 $200 | 판매자 B: 에어팟 $180 | 판매자 C: 에어팟 $220
  구매자 X: 예산 $190   | 구매자 Y: 예산 $210   | 구매자 Z: 예산 $170

분해:
  구매자 X → 1:N (A, B 가능)
  구매자 Y → 1:N (A, B, C 모두 가능)
  구매자 Z → 1:N (B만 가능)

  판매자 B 관점: N:1 (X, Y, Z 모두 접근)
  판매자 A 관점: N:1 (X, Y 접근)
  판매자 C 관점: 1:1 (Y만)
```

**설계 결정:** Haggle은 옥션이 아니라 협상 플랫폼이다. 각 거래는 양 당사자의 자율적 합의여야 한다.

---

## 17. 크로스 프레셔

### 17.1 정보 흐름

```
Session Orchestrator:
  Session A: $780 | Session B: $740 | Session C: $810
  
  BATNA = $740 (Session B가 최선)

  → A에 주입: "다른 판매자가 $740 제안 중"
  → C에 주입: "다른 판매자가 $740 제안 중"
  → B에는 미주입 (이미 최선)
```

### 17.2 규칙

| 규칙 | 설명 |
|------|------|
| 최선에는 미주입 | 이미 최선인 상대에 불필요 |
| BATNA만 공개 | 구체적 상대 정보 비공개 |
| 허위 정보 금지 | 존재하지 않는 경쟁자 언급 금지 |
| 세션당 최대 2회 | 과도한 압박 방지 |
| 차이 5% 미만이면 미주입 | 미미한 차이는 역효과 |

### 17.3 Engine Core 반영

**경로 1: CompetitionContext로 자동 반영**
```
Orchestrator → CompetitionContext {n_competitors:4, batna:$740, position:0.43}
  → Engine Core: V_p^adjusted 계산 → 더 강경한 역제안
```

**경로 2: HNP 메시지로 상대에게 전달**
```
Orchestrator → HNP CompetitivePressure 메시지
  → 상대 에이전트 수신 → 상대의 Strategy Skill이 반응
```

---

## 18. 장기 협상 지원

### 18.1 V_t의 역할과 한계

V_t는 시간 압박을 정확히 반영한다:

```
Day 1: V_t = 0.97 → "여유 있어"
Day 3: V_t = 0.82 → "아직 괜찮아"
Day 6: V_t = 0.24 → "급해지는데"
Day 7: V_t = 0.00 → "끝"
```

V_t가 모르는 것: **세상이 변했는지.** Day 3에 시장가가 급락해도 V_t는 여전히 0.82다. 변한 세상은 Skill Layer가 입력을 갱신해서 반영한다.

| | V_t (Engine Core) | 재평가 (Skill Layer) |
|---|---|---|
| 역할 | "지금 얼마나 급한가" | "지금 파라미터가 맞는가" |
| 주기 | 매 라운드 | 이벤트 or 4시간 |
| 변경 대상 | 없음 (계산만) | P_target, P_limit, w_i, α, β |

### 18.2 재평가 트리거

```python
class ReEvaluationPolicy:
    PERIODIC_INTERVAL = 4 * 3600  # 4시간
    
    EVENT_TRIGGERS = [
        "new_listing_in_category",
        "listing_removed",
        "listing_price_changed",
        "competitor_deal_closed",
        "competitor_expired",
        "market_shift_detected",
        "user_strategy_changed",
    ]
    
    def should_reevaluate(self, last_eval_time, events) -> bool:
        if now() - last_eval_time > self.PERIODIC_INTERVAL:
            return True
        new_events = [e for e in events if e.time > last_eval_time]
        return any(e.type in self.EVENT_TRIGGERS for e in new_events)
```

### 18.3 재평가 시 수행 작업

```
재평가 트리거
  │
  ├─ Market Research Skill: 시장가 재조사
  │    → P_market 변동 시 Strategy Skill에 통지
  │
  ├─ Strategy Skill: 파라미터 재조정 (규칙 기반, 보통 LLM 불필요)
  │    → P_target, P_limit 갱신
  │    → 대폭 변동(>10%) 시에만 LLM 재전략화 검토
  │
  ├─ Engine Core Batch Evaluate:
  │    전체 리스팅 재평가 → Top N 재선정 → 탈락 세션 교체
  │
  └─ 사용자 알림 (중요 변동만):
       "시장 평균이 $820→$790으로 하락. 마지노선 조정을 추천합니다."
```

### 18.4 HNP 세션 페이스

```protobuf
message SessionMeta {
  string topology = 1;
  int32 round_number = 2;
  float session_age_hours = 3;
  
  enum SessionPace {
    REALTIME = 0;       // 분 단위 응답
    ASYNC_HOURS = 1;    // 시간 단위 응답
    ASYNC_DAYS = 2;     // 일 단위 응답
  }
  SessionPace pace = 4;
}
```

**타임아웃:**

| Pace | 무응답 → STALLED | STALLED → EXPIRED |
|------|-----------------|-------------------|
| REALTIME | 30분 | +24시간 |
| ASYNC_HOURS | 8시간 | +24시간 |
| ASYNC_DAYS | 72시간 | +48시간 |

---

## 19. HNP v1.1 확장

### 19.1 새 필드

```protobuf
message NegotiationPacket {
  // ... 기존 v1.0 필드 유지 ...
  
  // v1.1 확장
  CompetitivePressure pressure = 10;
  SessionMeta session_meta = 11;
}

message CompetitivePressure {
  int32 active_alternatives = 1;
  float best_alternative_price = 2;
  bytes batna_proof = 3;
  
  enum PressureType {
    NONE = 0;
    INFORMATIONAL = 1;
    DEADLINE_WARNING = 2;
    FINAL_OFFER = 3;
  }
  PressureType type = 4;
}
```

### 19.2 BATNA 증명

```
에이전트 A → B: {best_alternative: $740, proof: 0x...}
에이전트 B → 플랫폼: "이 proof 검증해줘"
플랫폼 → B: "유효함" (해당 가격대 제안 존재 확인, 상대방 비공개)
```

---

## 20. LLM 모델 선택

### 20.1 선정 모델: Grok 4.1 Fast

| 항목 | 사양 |
|------|------|
| 모델 | Grok 4.1 Fast (xAI) |
| API 모델 ID | grok-4.1-fast |
| Input | $0.20 / 1M tokens |
| Output | $0.50 / 1M tokens |
| 컨텍스트 | 2M tokens |
| 추론 모드 | reasoning=ON/OFF 전환 가능 (API `reasoning_enabled` 파라미터) |
| 벤치마크 | LMArena Thinking #1 (1483 Elo), Non-thinking #2 (1465 Elo) |
| Tool calling | τ²-bench Telecom #1 |
| 출시 | 2025년 11월 (Grok 4 Fast 후속) |

### 20.2 선정 이유

1. **추론 on/off 전환.** Strategy Compilation은 `reasoning=ON`으로 깊은 분석. 단순 파라미터 조정은 `reasoning=OFF`로 빠르고 저렴하게. 하나의 모델로 두 가지 사용 패턴 지원.
2. **가격 대비 성능 최고.** $0.20/$0.50으로 LMArena 1-2위. 경쟁 모델(Gemini 2.5 Flash $0.30/$2.50, GPT-5 $1.25/$10.00) 대비 3-60배 저렴하면서 성능 동등 이상.
3. **2M 컨텍스트.** 장기 협상 히스토리 전체를 넣고 재전략화할 때 유리. 경쟁 모델(GPT-5 Nano 400K, DeepSeek R1 128K) 대비 5-16배.
4. **Tool calling 1위.** 에이전트 아키텍처에 최적. 에스컬레이션 시 외부 API 호출이 필요한 상황에서 유리.
5. **Unified architecture.** 추론/비추론이 같은 모델 가중치. 모드 전환 시 지연 시간 최소.

### 20.3 모델 비교 (2026년 2월 기준)

| 모델 | Input/1M | Output/1M | 전략 1회 비용 | LMArena | 비고 |
|------|---------|----------|-------------|---------|------|
| **Grok 4.1 Fast** | **$0.20** | **$0.50** | **$0.00055** | **#1-2** | **선정** |
| GPT-5 Nano | $0.05 | $0.40 | $0.00028 | 중상 | 컨텍스트 400K 제한 |
| Gemini 2.5 Flash | $0.30 | $2.50 | $0.00170 | 하위 | output 비용 5배 |
| Gemini 2.5 Flash Lite | $0.10 | $0.40 | $0.00035 | 중 | 추론 모드 없음 |
| DeepSeek R1 | $0.55 | $2.19 | $0.00192 | 상 | 128K, 중국 서비스 리스크 |
| GPT-5 | $1.25 | $10.00 | $0.00688 | 최상 | 12배 비쌈, 불필요 |

### 20.4 사용 패턴

```
Strategy Compilation (reasoning=ON):
  입력 ~1,500 tokens × $0.20/1M = $0.0003
  출력 ~500 tokens × $0.50/1M   = $0.00025
  합계: ~$0.00055 / 회

Escalation 분석 (reasoning=ON):
  입력 ~800 tokens
  출력 ~300 tokens
  합계: ~$0.00031 / 회

단순 재조정 (reasoning=OFF):
  입력 ~500 tokens
  출력 ~200 tokens
  합계: ~$0.00020 / 회
```

### 20.5 LLM 라우팅 로직

```python
def select_llm_mode(task_type: str, complexity: str) -> dict:
    """
    모델은 Grok 4.1 Fast 단일. 추론 모드만 전환.
    """
    if task_type == "STRATEGY_COMPILATION":
        return {"model": "grok-4.1-fast", "reasoning": True}
    
    elif task_type == "ESCALATION_ANALYSIS":
        return {"model": "grok-4.1-fast", "reasoning": True}
    
    elif task_type == "SIMPLE_RESTRATEGIZE":
        # β 미세 조정, 단순 파라미터 변경
        return {"model": "grok-4.1-fast", "reasoning": False}
    
    elif task_type == "USER_STRATEGY_CHANGE":
        # "더 공격적으로" 같은 단순 요청
        return {"model": "grok-4.1-fast", "reasoning": False}
    
    else:
        return {"model": "grok-4.1-fast", "reasoning": False}
```

---

## 21. 비용 분석

### 21.1 협상 1건당 비용

**시나리오: 아이패드 구매, 200개 리스팅, Top 5 세션, 10라운드, 에스컬레이션 1회**

| 단계 | 연산 | LLM 호출 | 비용 |
|------|------|----------|------|
| 전략 생성 | LLM (reasoning=ON) | 1-2회 | $0.00055-0.0011 |
| 200개 일괄 평가 | Engine Core × 200 | 0 | 40ms CPU |
| Top 5 세션 × 10라운드 | Engine Core × 50 | 0 | 10ms CPU |
| 재평가 3회 (3일간) | Engine Core × 600 | 0 | 120ms CPU |
| 에스컬레이션 1회 | LLM (reasoning=ON) | 1회 | $0.00031 |
| **합계** | | **2-3회** | **~$0.001-0.002** |

### 21.2 월간 비용/수익 분석

**가정:** 평균 거래액 $340, 성공률 20%, 수수료 1.5%, 평균 LLM 호출 1.5회/제품

| 유저 | 제품/월 | 성공 거래 | GMV | 수수료 수익 | LLM 비용 | 인프라 | 순이익 | 마진 |
|------|---------|----------|-----|------------|---------|--------|--------|------|
| 1K | 2K | 400 | $136K | $2,040 | $2.2 | $8 | $2,030 | 99.5% |
| 10K | 20K | 4K | $1.36M | $20,400 | $22 | $80 | $20,298 | 99.5% |
| 50K | 100K | 20K | $6.8M | $102,000 | $110 | $400 | $101,490 | 99.5% |
| 100K | 200K | 40K | $13.6M | $204,000 | $220 | $800 | $202,980 | 99.5% |

### 21.3 LLM 비용이 스케일에 무관한 이유

```
LLM 비용 = O(제품 수) × $0.001 = 무시 가능

Hot Path 비용 = O(라운드 수) × 200μs = CPU만 소비

제품당 1-3회 LLM, 나머지 전부 Engine Core.
세션 수가 아무리 늘어도 LLM 비용은 제품 수에만 비례.
100K 유저에서도 LLM 비용은 수익의 0.11%.
```

### 21.4 이전 설계 대비

| | 이전 (세션당 LLM) | 현재 (Engine-First) |
|---|---|---|
| LLM 호출 | 200+ | 1~3 |
| LLM 비용 | ~$0.20 | ~$0.001-0.002 |
| 처리 시간 | 수십 초 | < 200ms (Hot Path) |
| 확장성 | 세션 수에 비례 | 거의 일정 |

---

## 22. 데이터 저장

### 22.1 Redis (Hot State)

```
# 세션 데이터 (TTL: 세션 마감 + 1시간)
session:{id}:state           → 세션 상태
session:{id}:last_offer      → 마지막 제안
session:{id}:utility         → 마지막 UtilityResult

# 오케스트레이션 (TTL: 세션 그룹 마감)
orch:{group_id}:topology     → 토폴로지
orch:{group_id}:sessions     → 활성 세션 목록
orch:{group_id}:batna        → 현재 BATNA
orch:{group_id}:rankings     → 세션 순위

# 대기 Intent 인덱스
waiting:buyer:{category}     → Set[intent_id]
waiting:seller:{category}    → Set[intent_id]
intent:{intent_id}           → WaitingIntent (TTL: expires_at)

# 에스컬레이션 제어
escalation:{session_id}:count → 에스컬레이션 횟수 (최대 5)
pressure:{session_id}:count   → 크로스 프레셔 횟수 (최대 2)
```

### 22.2 PostgreSQL (Cold Storage)

```sql
CREATE TABLE master_strategies (
  id UUID PRIMARY KEY,
  user_id UUID NOT NULL,
  category VARCHAR(100),
  strategy JSONB NOT NULL,
  llm_calls_count INT DEFAULT 1,
  created_at TIMESTAMPTZ,
  expires_at TIMESTAMPTZ
);

CREATE TABLE waiting_intents (
  id UUID PRIMARY KEY,
  user_id UUID NOT NULL,
  role VARCHAR(10) NOT NULL,
  category VARCHAR(100) NOT NULL,
  keywords TEXT[],
  strategy_id UUID REFERENCES master_strategies(id),
  min_u_total FLOAT DEFAULT 0.3,
  max_active_sessions INT DEFAULT 5,
  status VARCHAR(20) DEFAULT 'ACTIVE',
  created_at TIMESTAMPTZ NOT NULL,
  expires_at TIMESTAMPTZ NOT NULL,
  fulfilled_at TIMESTAMPTZ
);

CREATE TABLE escalation_log (
  id UUID PRIMARY KEY,
  session_id UUID NOT NULL,
  trigger_reason VARCHAR(50),
  llm_input_summary TEXT,
  strategy_changes JSONB,
  llm_mode VARCHAR(20),            -- "reasoning_on" | "reasoning_off" | "rule_based"
  cost_usd FLOAT,
  created_at TIMESTAMPTZ
);

CREATE INDEX idx_waiting_active 
  ON waiting_intents(category, status) 
  WHERE status = 'ACTIVE';
```

---

## 23. 성능 계약

### 23.1 Engine Core 연산 예산

| 연산 | 예산 | 근거 |
|------|------|------|
| 입력 검증 | < 100μs | 경계 검사만 |
| V_p 계산 | < 50μs | ln() 2회 + 산술 |
| V_t 계산 | < 10μs | pow() 1회 |
| V_r 계산 | < 5μs | 곱셈 1회 |
| V_s 계산 | < 10μs | 나눗셈 1회 + 산술 |
| 경쟁 조정 | < 20μs | ln() 1회 + 곱셈 (선택적) |
| 가중합 | < 5μs | 곱셈 4회 + 덧셈 3회 |
| **총계** | **< 200μs** | **순수 산술, I/O 없음** |

### 23.2 시스템 레벨 성능

| 메트릭 | 목표 |
|--------|------|
| Hot Path P95 | < 50ms |
| Cold Path P95 | < 3s (LLM 포함) |
| Escalation Path P95 | < 2.5s |
| Batch Evaluate 200개 | < 50ms |
| 서버 인스턴스당 처리량 | 10,000 req/sec |

### 23.3 확장 단계

| Phase | 유저 수 | 아키텍처 |
|-------|---------|---------|
| MVP | 1K | 단일 서버, Redis Standalone |
| Growth | 10K | 로드밸런서, Redis Cluster |
| Scale | 100K | Kubernetes, Multi-region |

---

## 24. 적합성 테스트

모든 적합 구현체는 다음 결과를 ±0.001 허용오차 내에서 생성해야 한다(MUST).

**테스트 1: 균형 잡힌 구매자**
```
입력:
  weights: {w_p: 0.4, w_t: 0.3, w_r: 0.2, w_s: 0.1}
  price: {p_effective: 200, p_target: 180, p_limit: 220}
  time: {t_elapsed: 36000, t_deadline: 86400, alpha: 1.0, v_t_floor: 0.0}
  risk: {r_score: 0.85, i_completeness: 0.90, w_rep: 0.6, w_info: 0.4}
  relationship: {n_success: 3, n_dispute_losses: 0, n_threshold: 10, v_s_base: 0.5}

기대값:
  v_p = 0.820   // 구매자(180<220), 200<220이므로 가드 통과, ln(21)/ln(41)
  v_t = 0.583   // max(0.0, (1 - 36000/86400)^1.0) = 0.583
  v_r = 0.870   // 0.6×0.85 + 0.4×0.90
  v_s = 0.800   // clamp(0.5 + 3/10 + 0) = 0.8
  u_total = 0.683
```

**테스트 2: 공격적 판매자**
```
입력:
  weights: {w_p: 0.70, w_t: 0.10, w_r: 0.15, w_s: 0.05}
  price: {p_effective: 210, p_target: 220, p_limit: 180}
  time: {t_elapsed: 7200, t_deadline: 604800, alpha: 3.0, v_t_floor: 0.0}
  risk: {r_score: 0.70, i_completeness: 0.80, w_rep: 0.6, w_info: 0.4}
  relationship: {n_success: 0, n_dispute_losses: 0, n_threshold: 10, v_s_base: 0.5}

기대값:
  v_p = 0.920   // 판매자(220>180), 210>180이므로 가드 통과, ln(31)/ln(41)
  v_t = 0.965   // max(0.0, (1 - 7200/604800)^3.0)
  v_r = 0.740   // 0.6×0.70 + 0.4×0.80
  v_s = 0.500   // clamp(0.5 + 0/10 + 0) = 0.5
  u_total = 0.860
```

**테스트 3: 경쟁 컨텍스트 적용**
```
입력:
  (테스트 1과 동일) +
  competition: {n_competitors: 4, best_alternative: 195, market_position: 0.7}
  gamma: 0.1

기대값:
  v_p_base = 0.820
  adjustment = 1 + 0.1 × ln(5) × 0.7 = 1.1127
  v_p_adjusted = clamp(0.820 × 1.1127, 0, 1) = 0.912
  u_total = 0.4×0.912 + 0.3×0.583 + 0.2×0.870 + 0.1×0.800 = 0.794
```

**테스트 4: 마지노선 도달**
```
입력:
  weights: {w_p: 1.0, w_t: 0.0, w_r: 0.0, w_s: 0.0}
  price: {p_effective: 220, p_target: 180, p_limit: 220}

기대값:
  v_p = 0.000
  u_total = 0.000
```

**테스트 5: 오류 — 유효하지 않은 가중치**
```
입력:
  weights: {w_p: 0.5, w_t: 0.3, w_r: 0.2, w_s: 0.1}  // 합계 = 1.1

기대값:
  error: INVALID_WEIGHTS
```

---

## 25. Skills Marketplace

### 25.1 비전

Skill Layer를 **개방형 마켓플레이스**로 전환한다. Haggle이 제공하는 데이터와 API를 활용하여 외부 개발자가 커스텀 스킬을 직접 만들고, 배포하고, 판매할 수 있다.

```
┌─────────────────────────────────────────────────────────────┐
│  Skills Marketplace                                          │
│                                                              │
│  ┌─────────────────────────────┐                            │
│  │  1st-Party Skills (Haggle)  │                            │
│  │  Strategy, Shipping,        │                            │
│  │  Reputation, Orchestrator   │                            │
│  └─────────────────────────────┘                            │
│                                                              │
│  ┌─────────────────────────────┐  ┌──────────────────────┐  │
│  │  3rd-Party Skills (개발자)  │  │  Community Skills     │  │
│  │  KBB Auto Valuation Skill  │  │  한국 중고나라 스킬   │  │
│  │  Sneaker Market Skill      │  │  일본 메루카리 스킬   │  │
│  │  Vintage Watch Skill       │  │  독일 eBay Kleinanz.  │  │
│  │  Real Estate Comp Skill    │  │  지역 직거래 스킬     │  │
│  └─────────────────────────────┘  └──────────────────────┘  │
│                                                              │
│  ┌─────────────────────────────────────────────────────────┐│
│  │  Haggle Platform Data (스킬에 제공)                     ││
│  │  시장가 데이터 | 거래 패턴 | 카테고리 통계 | 평판 API  ││
│  └─────────────────────────────────────────────────────────┘│
└─────────────────────────────────────────────────────────────┘
```

### 25.2 Haggle이 제공하는 Platform Data

외부 스킬 개발자가 사용할 수 있는 데이터와 API:

| 데이터 | 설명 | 접근 레벨 |
|--------|------|----------|
| **Market Price API** | 카테고리별 평균가, 최저가, 추세 | Public |
| **Transaction Patterns** | 카테고리별 평균 라운드 수, 성공률, 양보 패턴 | Aggregated (익명) |
| **Category Taxonomy** | 표준화된 제품 분류 체계 | Public |
| **Reputation Scores** | 사용자 평판 점수 (본인 동의 시) | Authenticated |
| **Listing Metadata** | 리스팅 상태, 정보 완성도 | Authenticated |
| **Negotiation Events** | 실시간 이벤트 스트림 (세션 생성, 합의, 만료) | Webhook |
| **Engine Core API** | compute_utility, batch_evaluate 직접 호출 | Authenticated |

### 25.3 스킬 유형

#### Strategy Skill (전략 스킬)

Engine Core에 입력할 전략 파라미터를 생성하는 스킬.

```python
# 예: 운동화 전문 전략 스킬
class SneakerStrategySkill:
    """
    StockX, GOAT 데이터를 기반으로 운동화 협상 전략 생성.
    Haggle의 Market Price API + 외부 StockX API 결합.
    """
    def generate_strategy(self, user_goal: dict) -> MasterStrategy:
        # Haggle Platform Data
        haggle_market = haggle_api.get_market_data("footwear/sneakers", user_goal['model'])
        
        # 외부 데이터 (스킬 개발자가 연동)
        stockx_price = stockx_api.get_last_sale(user_goal['model'])
        goat_price = goat_api.get_lowest_ask(user_goal['model'])
        
        # 통합 분석
        fair_value = weighted_average(haggle_market, stockx_price, goat_price)
        
        return MasterStrategy(
            weights={"w_p": 0.50, "w_t": 0.15, "w_r": 0.25, "w_s": 0.10},
            p_target=fair_value * 0.85,
            p_limit=fair_value * 1.05,
            beta=2.0,  # 운동화는 희소성 때문에 고집 전략
            ...
        )
```

#### Data Skill (데이터 스킬)

Engine Core에 특화된 데이터를 공급하는 스킬.

```python
# 예: KBB 자동차 가치 평가 스킬
class KBBAutoValuationSkill:
    """
    Kelley Blue Book 데이터로 중고차 가치 산정.
    Haggle에게 p_target, p_limit 추천값 제공.
    """
    def get_valuation(self, vehicle: dict) -> PriceRecommendation:
        kbb_data = kbb_api.get_value(
            year=vehicle['year'],
            make=vehicle['make'],
            model=vehicle['model'],
            mileage=vehicle['mileage'],
            condition=vehicle['condition']
        )
        return PriceRecommendation(
            fair_market_value=kbb_data.fair_value,
            p_target_suggestion=kbb_data.fair_value * 0.90,
            p_limit_suggestion=kbb_data.fair_value * 1.10,
            confidence=0.92
        )
```

#### Interpretation Skill (해석 스킬)

Reactive Escalation에서 LLM을 보조하거나 대체하는 스킬. 특정 도메인의 비표준 제안을 규칙 기반으로 해석.

```python
# 예: 자동차 트레이드인 해석 스킬
class AutoTradeInInterpretationSkill:
    """
    자동차 트레이드인 제안을 Engine Core가 이해하는 형태로 변환.
    이 스킬이 있으면 LLM 호출 없이 처리 가능.
    """
    def interpret(self, proposal: dict) -> ProposalInterpretation:
        trade_in_value = self.estimate_trade_in(proposal['trade_in_vehicle'])
        net_price = proposal['asking_price'] - trade_in_value
        
        return ProposalInterpretation(
            p_effective=net_price,
            additional_context={
                "trade_in_estimated_value": trade_in_value,
                "net_out_of_pocket": net_price
            },
            confidence=0.88,
            llm_needed=False  # 규칙 기반으로 충분
        )
```

**핵심: Interpretation Skill은 LLM 호출을 줄인다.** 특정 도메인에서 자주 발생하는 비표준 제안(자동차 트레이드인, 운동화 번들, 부동산 조건부 등)을 규칙 기반으로 처리하면 LLM 비용이 절감된다.

### 25.4 Skill Interface 표준

모든 스킬은 표준 인터페이스를 구현해야 한다:

```protobuf
// 스킬 등록 메타데이터
message SkillManifest {
  string skill_id = 1;
  string name = 2;
  string description = 3;
  string version = 4;
  string author = 5;
  
  enum SkillType {
    STRATEGY = 0;           // 전략 생성
    DATA = 1;               // 데이터 공급
    INTERPRETATION = 2;     // 제안 해석
    REPUTATION = 3;         // 평판 데이터
    SHIPPING = 4;           // 배송 데이터
  }
  SkillType type = 6;
  
  repeated string supported_categories = 7;  // 지원 카테고리
  repeated string required_permissions = 8;   // 필요 권한
  
  // 성능 계약
  int32 max_latency_ms = 9;      // 최대 응답 시간
  float reliability_sla = 10;     // 가용성 목표 (0.99 등)
  
  // 과금
  PricingModel pricing = 11;
}

message PricingModel {
  enum Type {
    FREE = 0;
    PER_CALL = 1;       // 호출당 과금
    MONTHLY = 2;        // 월정액
    REVENUE_SHARE = 3;  // 수익 분배
  }
  Type type = 1;
  float price = 2;             // PER_CALL: 호출당 $, MONTHLY: 월 $
  float revenue_share_pct = 3; // REVENUE_SHARE: 수수료의 N%
}
```

### 25.5 스킬이 Engine Core와 상호작용하는 방식

```
사용자 요청: "Air Jordan 1 사고 싶어"
    │
    ▼
Skill Coordinator:
  1. 카테고리 식별 → "footwear/sneakers"
  2. 이 카테고리에 설치된 스킬 확인:
     - SneakerStrategySkill (3rd-party, 유료)
     - SneakerMarketDataSkill (3rd-party, 무료)
     - 기본 Strategy Skill (1st-party)
    │
    ▼
SneakerStrategySkill 호출:
  → StockX + GOAT + Haggle Market Data 통합
  → MasterStrategy 생성 (운동화 특화 전략)
    │
    ▼
Engine Core: 일반적인 compute_utility 수행
  (Engine Core는 스킬이 뭔지 모름. 입력만 받으면 됨.)
    │
    ▼
라운드 진행 중... 상대가 "번들: AJ1 + 정품 박스 + 영수증" 제안
    │
    ▼
Proposal Parser: UNKNOWN_PROPOSAL 감지
    │
    ├─ SneakerInterpretationSkill 설치됨?
    │   → 예 → 스킬이 규칙 기반 해석 (LLM 호출 없음)
    │   → 아니오 → LLM 호출 (기본 경로)
    │
    ▼
Engine Core: 해석된 파라미터로 U_total 재계산
```

### 25.6 마켓플레이스 수익 모델

**수익 분배 (확정):**

```
3rd-Party 스킬 개발자 수익 분배:

  기본: 거래 수수료(1.5%)의 10% → 개발자에게 0.15%p
  Top 3 보너스: 카테고리별 상위 3개 스킬에 +5%p → 최대 0.225%p

  거래 $68 기준:
    기본: $0.102 / 거래
    Top 3: $0.153 / 거래

  월 1만건 사용 시:
    기본: $1,020 / 월
    Top 3: $1,530 / 월
```

**쉬운 스킬 생성이 10%를 매력적으로 만든다.** Haggle은 Skill Builder SDK, 템플릿, 커넥터 라이브러리, 샌드박스, 원클릭 배포를 제공한다. 개발자는 도메인 지식만 얹으면 되므로, 30분~2시간이면 스킬을 만들고 배포할 수 있다.

**랭킹 산정 기준 (성과 기반):**

| 지표 | 가중치 | 설명 |
|------|--------|------|
| 목표가 달성률 | 30% | 이 스킬 사용 시 목표가 대비 실제 합의가 |
| 협상 성공률 | 25% | 합의 도달 비율 |
| 평균 라운드 수 | 15% | 적을수록 높은 점수 (효율성) |
| LLM 절감률 | 15% | Interpretation Skill의 경우 가산 |
| 사용자 평점 | 15% | 5점 만점 |

랭킹은 **카테고리별**로 산정. 동일 스킬이 여러 카테고리를 지원하면 카테고리마다 독립적으로 랭킹된다.

**Haggle 1st-Party 스킬은 랭킹에서 제외.** 기본 제공 스킬은 3rd-party와 경쟁하지 않으며, 3rd-party 스킬이 없는 카테고리에서만 폴백으로 사용된다.

### 25.7 스킬 품질 보장

```
심사 프로세스:
  1. 자동 검증: Skill Interface 준수, 응답 시간, 에러율
  2. 샌드박스 테스트: 모의 협상 1,000건 실행
  3. 수동 리뷰: 데이터 프라이버시, 보안 검토
  4. 베타 출시: 일부 사용자에게 배포, 피드백 수집
  5. 정식 출시: 마켓플레이스 등록

모니터링:
  - 응답 시간 P95 < manifest에 선언한 max_latency_ms
  - 에러율 < 1%
  - 사용자 평점 3.5+ 유지
  - 위반 시 자동 비활성화 + 개발자 통지
```

### 25.8 Skill Builder SDK

**10%를 매력적으로 만드는 핵심: 만드는 게 쉬워야 한다.**

| 도구 | 설명 | 단계 |
|------|------|------|
| **Skill Base Class** | StrategySkill, DataSkill, InterpretationSkill 상속 | MVP |
| **템플릿** | 유형별 보일러플레이트 코드. 핵심 로직만 채우면 됨 | MVP |
| **커넥터 라이브러리** | StockX, eBay, KBB 등 주요 API 플러그인 | Growth |
| **샌드박스** | 모의 협상 1,000건 자동 실행, 성과 리포트 | Growth |
| **원클릭 배포** | manifest 작성 → 심사 제출 → 마켓플레이스 등록 | Growth |
| **노코드 빌더** | 카테고리/데이터소스/파라미터 선택만으로 스킬 생성 | Scale |

**목표: 개발자 30분, 비개발자 2시간이면 스킬 배포.**

상세 구현: `Haggle_Skills_Implementation_Guide_v1_0_0.md` 참조.

### 25.9 구독 연동

Skill Builder 기능을 구독 티어에 통합한다.

| 기능 | Free | Premium ($9.99) | Business ($29.99) |
|------|------|----------------|-------------------|
| **마켓플레이스 스킬 사용** | 무료 스킬만 | 모든 스킬 | 모든 스킬 |
| **스킬 만들기** | ✗ | 템플릿 기반 (3개까지) | 무제한 + API 직접 |
| **노코드 빌더** | ✗ | ✓ | ✓ |
| **커스텀 코드** | ✗ | ✗ | ✓ (풀 SDK) |
| **외부 API 연동** | ✗ | 기본 커넥터 | 모든 커넥터 + 커스텀 |
| **스킬 배포/판매** | ✗ | 비공개만 (본인용) | 마켓플레이스 배포 |
| **수익 분배** | ✗ | ✗ | 10% (Top 3: 15%) |
| **샌드박스 테스트** | ✗ | 100건/월 | 무제한 |
| **분석 대시보드** | ✗ | 기본 | 고급 (성과 추적) |

**전략적 의도:**

- **Free → Premium 전환 동기:** "노코드로 내 카테고리 특화 전략을 만들면 더 좋은 딜을 할 수 있다." 사용자가 직접 만든 스킬은 본인만 사용 → 경쟁 우위.
- **Premium → Business 전환 동기:** "내가 만든 스킬로 돈을 벌 수 있다." 마켓플레이스 배포 + 수익 분배는 Business만 가능.
- **기존 구독 가치와 합산:** Premium은 목표가 추천, 상대 전략 분석에 더해 스킬 빌더까지. $9.99의 ROI가 더 높아짐.

**구독 수익 영향 (월 100K MAU 기준):**

```
기존 구독 수익:
  Premium 4,000명 × $9.99 = $39,960
  Business 1,000명 × $29.99 = $29,990
  합계: $69,950/월

스킬 빌더 추가 시 예상 전환율 변화:
  Premium: 4% → 5% (+1,000명) = $49,950
  Business: 1% → 1.5% (+500명) = $44,985
  합계: $94,935/월 (+$24,985, +36%)
```

### 25.10 로드맵

| Phase | 시기 | 내용 |
|-------|------|------|
| **Foundation** | MVP | 1st-party 스킬만. 스킬 인터페이스 표준 확정. |
| **Invite-Only** | Growth | 초대된 파트너 개발자 5-10팀. KBB, StockX 등 핵심 연동. |
| **Open Beta** | Scale | 개발자 포털 오픈. SDK 배포. 심사 파이프라인 구축. |
| **Marketplace** | Expansion | 마켓플레이스 정식 오픈. 수익 분배 시작. |

---

## 26. 확장 포인트

### 26.1 V_m: 시장 컨텍스트 (예약, 미구현)

5번째 차원 V_m은 향후 사용을 위해 예약한다. v1.0.0의 일부가 아니다.

**포함 기준:**
- V_p, V_t로부터의 독립성 공식 증명
- 결정론적 데이터 신뢰도 임계값
- 1,000건 시뮬레이션에서 파라미터 조정 이상의 결과 개선 입증
- Protobuf 하위 호환 확장

### 26.2 EvoEngine 통합 (예약)

자기 진화 협상 지능은 Skill Layer에서 운용한다. Engine Core의 수학 공식을 변경하지 않는다.

---

## 27. 미결 사항

1. **V_p 곡률.** ln(|차이|+1) 공식의 오목성이 P2P 거래에 최적인가? 대안: 조정 가능한 γ를 가진 거듭제곱 함수. A/B 테스트 필요.

2. **분쟁 패널티 크기.** P_dispute = 패소당 -0.3의 실증적 근거 필요. 표준 고정 vs 구현체 설정 가능 여부.

3. **에스컬레이션 전략 변경 폭.** LLM이 제안한 w_i 변경 ±0.15 제한이 적절한가? 너무 보수적이면 에스컬레이션의 의미가 없고, 너무 공격적이면 사용자 의도를 벗어남.

4. **max_active_sessions 기본값.** 5개가 적절한가? 카테고리별 차등 필요 여부 (전자기기 5, 차량 3, 의류 10?).

5. **Master Strategy 만료.** 7일 전 전략이 여전히 유효한가? 자동 만료 + 재생성 정책 필요.

6. **부동소수점 결정론.** ±0.001 허용오차가 크로스 플랫폼 협상 임계값 판단에 충분한가?

7. **N:M 공정성.** First-come vs 가격 기반 vs 평판 우선 정책.

8. **BATNA 증명과 프라이버시.** 플랫폼 서명 검증이 간접적으로 다른 사용자 행동을 노출하는 문제.

9. **WAITING → ACTIVE 승격 지연.** Top 세션 탈락 후 WAITING 풀에서 승격 시, 상대 리스팅 유효성 검사 필요.

10. **양방향 매칭 동시성.** 구매자 Intent와 판매자 리스팅이 동시 등록 시 이벤트 순서 의존성. 멱등성 보장 필요.

---

## 부록 A: 참조 구현 (Python)

```python
import math

def compute_utility(ctx: dict) -> dict:
    """
    Haggle Engine Core v1.0.0 참조 구현.
    순수 함수: 외부 I/O 없음, 동일 입력 → 동일 출력.
    """
    
    # --- 가중치 검증 ---
    w = ctx['weights']
    w_sum = w['w_p'] + w['w_t'] + w['w_r'] + w['w_s']
    if abs(w_sum - 1.0) > 1e-6:
        return {'error': 'INVALID_WEIGHTS', 'detail': f'sum={w_sum}'}
    if any(v < 0 for v in [w['w_p'], w['w_t'], w['w_r'], w['w_s']]):
        return {'error': 'INVALID_WEIGHTS', 'detail': 'negative weight'}
    
    # --- V_p ---
    p = ctx['price']
    if p['p_target'] == p['p_limit']:
        return {'error': 'ZERO_PRICE_RANGE'}
    
    # 역할 판별: P_target < P_limit이면 구매자, 반대면 판매자
    is_buyer = p['p_target'] < p['p_limit']
    
    # 마지노선 초과 가드
    if is_buyer and p['p_effective'] >= p['p_limit']:
        v_p = 0.0
    elif not is_buyer and p['p_effective'] <= p['p_limit']:
        v_p = 0.0
    else:
        diff_offer = abs(p['p_limit'] - p['p_effective'])
        diff_target = abs(p['p_limit'] - p['p_target'])
        v_p = max(0.0, min(1.0, math.log(diff_offer + 1) / math.log(diff_target + 1)))
    
    # --- V_p 경쟁 조정 (선택적) ---
    comp = ctx.get('competition')
    if comp:
        gamma = ctx.get('gamma', 0.1)
        adjustment = 1 + gamma * math.log(comp['n_competitors'] + 1) * comp['market_position']
        v_p = max(0.0, min(1.0, v_p * adjustment))
    
    # --- V_t ---
    t = ctx['time']
    if t['t_deadline'] <= 0:
        return {'error': 'INVALID_DEADLINE'}
    if t['alpha'] <= 0:
        return {'error': 'INVALID_ALPHA'}
    v_t_raw = max(0.0, 1.0 - t['t_elapsed'] / t['t_deadline']) ** t['alpha']
    v_t = max(t.get('v_t_floor', 0.0), v_t_raw)
    
    # --- V_r ---
    r = ctx['risk']
    if not (0 <= r['r_score'] <= 1 and 0 <= r['i_completeness'] <= 1):
        return {'error': 'INVALID_RISK_INPUT'}
    w_rep = r.get('w_rep', 0.6)
    w_info = r.get('w_info', 0.4)
    v_r = w_rep * r['r_score'] + w_info * r['i_completeness']
    
    # --- V_s ---
    s = ctx['relationship']
    if s['n_threshold'] <= 0:
        return {'error': 'INVALID_THRESHOLD'}
    v_s_base = s.get('v_s_base', 0.5)
    p_dispute = s['n_dispute_losses'] * (-0.3)
    v_s = max(0.0, min(1.0, v_s_base + s['n_success'] / s['n_threshold'] + p_dispute))
    
    # --- U_total ---
    u_total = (w['w_p'] * v_p + w['w_t'] * v_t + 
               w['w_r'] * v_r + w['w_s'] * v_s)
    
    return {
        'u_total': round(u_total, 4),
        'v_p': round(v_p, 4),
        'v_t': round(v_t, 4),
        'v_r': round(v_r, 4),
        'v_s': round(v_s, 4),
        'error': None
    }


def batch_evaluate(strategy: dict, listings: list) -> list:
    """
    같은 전략 × N개 리스팅 → 정렬된 결과.
    """
    results = []
    for listing in listings:
        ctx = {
            'weights': strategy['weights'],
            'price': {
                'p_effective': listing['p_effective'],
                'p_target': strategy['p_target'],
                'p_limit': strategy['p_limit']
            },
            'time': strategy['time'],
            'risk': {
                'r_score': listing['r_score'],
                'i_completeness': listing['i_completeness']
            },
            'relationship': {
                'n_success': listing.get('n_success', 0),
                'n_dispute_losses': listing.get('n_dispute_losses', 0),
                'n_threshold': strategy.get('n_threshold', 10)
            },
            'competition': listing.get('competition')
        }
        result = compute_utility(ctx)
        if not result.get('error'):
            results.append({
                'listing_id': listing['listing_id'],
                'u_total': result['u_total'],
                'utility': result
            })
    
    results.sort(key=lambda x: x['u_total'], reverse=True)
    for i, r in enumerate(results):
        r['rank'] = i + 1
    
    return results


def decide(utility_result: dict, thresholds: dict, session_state: dict) -> str:
    """
    Decision Maker 참조 구현.
    """
    u = utility_result['u_total']
    u_aspiration = thresholds['u_aspiration']
    u_threshold = thresholds['u_threshold']
    v_t = utility_result['v_t']
    rounds_no_concession = session_state.get('rounds_no_concession', 0)
    
    if u >= u_aspiration:
        return 'ACCEPT'
    if u >= u_threshold and v_t < 0.1:
        return 'ACCEPT'
    if u >= u_threshold:
        return 'NEAR_DEAL'
    if rounds_no_concession >= 4:
        return 'ESCALATE'
    if v_t < 0.05 and u < u_threshold:
        return 'ESCALATE'
    if u > 0:
        return 'COUNTER'
    return 'REJECT'
```

---

## 부록 B: 스킬 책임 체크리스트

| 스킬 | 반드시 제공 | 제공 금지 |
|------|-----------|----------|
| **Strategy Skill** | w_p~w_s, α, β, t_deadline, n_threshold, U_threshold, U_aspiration | 시장 데이터, 평판 점수 |
| **Shipping Skill** | p_effective | 원시 캐리어 API 응답 |
| **Goal Parser Skill** | p_target, p_limit | 협상 전략 결정 |
| **Reputation Skill** | r_score, i_completeness, n_success, n_dispute_losses | 플랫폼별 등급명 |
| **Session Manager Skill** | t_elapsed, round_number, role, session_id | 전략 파라미터 |
| **Session Orchestrator** | CompetitionContext, topology, session rankings | Engine Core 수식 변경 |
| **Market Research Skill** | (Strategy Skill에 공급: 시장 데이터) | Engine Core 직접 입력 |

---

## 부록 C: 전체 시스템 흐름도

```
┌───────────────────────────────────────────────────────────────┐
│  이벤트 소스                                                   │
│  ┌────────────┐  ┌────────────┐  ┌────────────┐              │
│  │ 새 리스팅  │  │ 새 구매의도│  │ 가격 변경  │  ...          │
│  └─────┬──────┘  └─────┬──────┘  └─────┬──────┘              │
└────────┼───────────────┼───────────────┼──────────────────────┘
         │               │               │
         ▼               ▼               ▼
┌───────────────────────────────────────────────────────────────┐
│  L1: Matching Engine (이벤트 드리븐)                           │
│                                                               │
│  카테고리별 ACTIVE WaitingIntent 조회                          │
│  → 매칭 대상 발견                                              │
│       │                                                       │
│       ▼                                                       │
│  Engine Core Batch Evaluate                                   │
│  (기존 Master Strategy × 새 데이터)                            │
│  → U_total 순위                                                │
│       │                                                       │
│       ▼                                                       │
│  min_u_total 초과? → 세션 생성                                 │
│  Top N 내? → ACTIVE                                            │
│  Top N 밖? → WAITING                                           │
└───────────────────────┬───────────────────────────────────────┘
                        │
                        ▼
┌───────────────────────────────────────────────────────────────┐
│  L1: Session Orchestrator                                      │
│                                                               │
│  ┌──────────────────────────────────────────┐                 │
│  │  Active Sessions (Top N)                 │                 │
│  │  ┌─────┐ ┌─────┐ ┌─────┐ ┌─────┐       │                 │
│  │  │Ses.1│ │Ses.2│ │Ses.3│ │Ses.4│  ...   │                 │
│  │  └──┬──┘ └──┬──┘ └──┬──┘ └──┬──┘       │                 │
│  │     │       │       │       │            │                 │
│  │     ▼       ▼       ▼       ▼            │                 │
│  │  토폴로지 감지 → 크로스 프레셔 → 재평가    │                 │
│  └──────────────────────┬───────────────────┘                 │
│                         │                                     │
│  ┌──────────────────────▼───────────────────┐                 │
│  │  Waiting Pool (Top N 밖, 자동 승격)       │                 │
│  └──────────────────────────────────────────┘                 │
└───────────────────────┬───────────────────────────────────────┘
                        │
                        ▼
┌───────────────────────────────────────────────────────────────┐
│  L2: Engine Core (v1.0.0)                                      │
│                                                               │
│  Hot Path: 매 라운드 (95%+)                                    │
│    상대 역제안 → compute_utility (200μs) → Decision Maker      │
│    → ACCEPT / COUNTER / REJECT → 완료                          │
│    LLM 호출: 0                                                 │
│                                                               │
│  Escalation Path: 특수 상황 (<5%)                              │
│    Decision Maker → ESCALATE →                                 │
│    → 규칙 기반 해결 시도 (LLM 없음)                             │
│    → 실패 시 LLM (Grok 4.1 Fast) 호출 → 전략 갱신              │
└───────────────────────────────────────────────────────────────┘
```

---

## 부록 D: 이전 버전 대비 변경사항

### D.1 프로젝트 문서 (v2.3.0~v2.4.0) 대비

| 항목 | 이전 | v1.0.0 | 이유 |
|------|------|--------|------|
| 아키텍처 | 6-Layer (엔진이 모든 것 처리) | 4-Layer Skills (순수 계산기) | Skills 아키텍처 정합 |
| V_p | ln(P_limit/P_offer) / ln(P_limit/P_target) | ln(\|P_limit-P_eff\|+1) / ln(\|P_limit-P_target\|+1) | 판매자 관점 파손 수정 |
| V_r | 엔진에 평판 등급 하드코딩 | Reputation Skill이 r_score 제공 | 플랫폼 비의존적 |
| V_s | H_score + P_pattern | clamp(N_success/N_threshold + P_dispute, 0, 1) | 조작 가능 패턴 제거 |
| LLM 원칙 | 세션당 호출 가능 | Engine-First + 리액티브 에스컬레이션 | 모르면 물어보기 |
| LLM 모델 | Grok 4 Fast | Grok 4.1 Fast | 성능 대폭 향상, 가격 동일 |
| 멀티세션 | 별도 Funnel 레이어 | Engine Core Batch Evaluate | 깔때기 불필요 |
| 에스컬레이션 | LLM 기반 재전략화 | UNKNOWN_PROPOSAL + STRATEGY_REVIEW 2유형 | 상대 제안 해석 분리 |
| Skill Layer | 내부 전용 | Skills Marketplace (개방형) | 개발자 생태계 |
| Φ 매트릭스 | 10개 교차 차원 상호작용 항 | 삭제 | 실증 근거 부재 |
| V_m | 조건부 활성화 | 예약, 미구현 | 독립성 위반 |
| 매칭 | 수동 리스팅 탐색 | 이벤트 드리븐 양방향 매칭 | 자동화 |

---

**사양 종료**

문서 버전 이력:
- v1.0.1 (2026-02-17): 효용 함수 수정. V_p 마지노선 초과 가드 추가 (abs() 대칭 버그 수정). V_r 곱셈→가중 평균 전환 (w_rep/w_info Strategy Skill 조절). V_s V_s_base=0.5 도입 (초면 중립). V_t V_t_floor 추가 ("천천히" 모드). Skills Marketplace 수익 확정 (10%/15%). 구독 Skill Builder 통합.
- v1.0.0 (2026-02-17): 통합 초판. Engine Core 수학 + Multi-Session Orchestration + 리액티브 에스컬레이션 (UNKNOWN_PROPOSAL / STRATEGY_REVIEW) + Proposal Parser + Skills Marketplace + 이벤트 드리븐 매칭 + 크로스 프레셔 + 장기 협상 + HNP v1.1 확장 + Grok 4.1 Fast 선정 + 비용 모델.
