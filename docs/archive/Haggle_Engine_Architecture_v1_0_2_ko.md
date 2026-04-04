# Haggle Engine Architecture v1.0.2
## 다중 이슈 협상 엔진 + 상대방 모델링

**버전:** 1.0.2
**작성일:** 2026-03-07
**상태:** 구현 사양서 (개발 승인 완료)
**아키텍처:** 4-Layer Skills (L0 Gateway -> L1 Skill Layer -> L2 Engine Core -> L3 Wire+Data)
**범위:** 다중 이슈 효용, Offer Inversion, 베이지안 상대방 모델, 동적 마감, 선택 정책

**참조 논문:**
- Faratin, P., Sierra, C., & Jennings, N.R. (1998). *Negotiation Decision Functions for Autonomous Agents.* Robotics and Autonomous Systems, 24(3-4), 159-182.
- Jonker, C.M., Hindriks, K.V., Wiggers, P., & Broekens, J. (2012). *Negotiating Agents.* AI Magazine, Fall 2012, 79-91.
- Jennings, N.R., Parsons, S., Sierra, C., & Faratin, P. *Automated Negotiation.* Proceedings of the 5th PAAM.

---

## 변경 이력

| 버전 | 날짜 | 변경 내용 |
|------|------|----------|
| v1.0.2 | 2026-03-07 | **다중 이슈 엔진 업그레이드**: (1) 이슈 타입 시스템 (NEGOTIABLE/INFORMATIONAL) + 다중 이슈 Offer Inverter, (2) 6종 이동 분류 (Jonker et al. Fig.2), (3) 베이지안 상대방 모델 + Reputation Prior, (4) 동적 마감 + 판매자 마감일 통합 (Faratin 4.2.1), (5) 병렬 협상 선택 정책, (6) 미러링 전략 (전술 엔진 확장). v1.0.1과 하위 호환 -- 기존 단일 이슈 모드 보존. |
| v1.0.1 | 2026-03-04 | 엔진 4-Gap 개선: OpponentModel (EMA), 동적 베타, 효용 공간 양보 곡선, AC_next. AgentStats 시스템 (8개 스탯). |
| v1.0.0 | 2026-02-17 | 초판. 4차원 효용 + Decision Maker + Faratin 양보 곡선. |

---

## 0. 아키텍처 개요

### 0.1 시스템 위치

```
+--------------------------------------------------------------+
|  L0: Gateway                                                  |
|  프로토콜 어댑터 (MCP, UCP, REST, AP2)                         |
|  채널 어댑터 (Web App, ChatGPT Apps, WhatsApp)                 |
|  인증 & 제한 (OAuth 2.0, Rate Limiting)                        |
+-----------------------------+--------------------------------+
                              |
+-----------------------------v--------------------------------+
|  L1: Skill Layer                                              |
|  +----------------------------------------------------------+|
|  | Skill Router | Skill Coordinator | Event Bus              ||
|  +----------------------------------------------------------+|
|  | Core:   GoalParser | Strategy | Negotiation | Session     ||
|  | Domain: Listing | Reputation | MarketResearch             ||
|  | Infra:  Settlement | Escrow | Shipping | Dispute          ||
|  | Intel:  Prediction | IntelligenceRouter | StrategyAPI     ||
|  +----------------------------------------------------------+|
|  | v1.0.2 신규:                                              ||
|  | IssueRegistry | OpponentPrior | DeadlineManager           ||
|  | SelectionPolicy | TacticRouter                            ||
|  +----------------------------------------------------------+|
+-----------------------------+--------------------------------+
                              |
+-----------------------------v--------------------------------+
|  L2: Engine Core  <-- 이 문서의 핵심                           |
|  +----------------------------------------------------------+|
|  | 다중 이슈 효용 계산기 (V_j 가중 합산)                       ||
|  | 이슈 공간: NEGOTIABLE + INFORMATIONAL                      ||
|  +----------------------------------------------------------+|
|  | Decision Maker (규칙 기반)                                 ||
|  | U_total vs 임계값 -> ACCEPT/COUNTER/REJECT/ESCALATE        ||
|  +----------------------------------------------------------+|
|  | 양보 곡선 (효용 공간 Faratin)                               ||
|  | U_target(t) + 동적 베타 + AC_next                          ||
|  +----------------------------------------------------------+|
|  | Offer Inverter (v1.0.2 신규)                               ||
|  | U_target -> 다중 이슈 값 조합 역산                          ||
|  +----------------------------------------------------------+|
|  | 이동 분류기 (v1.0.2 확장: 6종)                              ||
|  | + 베이지안 상대방 모델 + Reputation Prior                   ||
|  +----------------------------------------------------------+|
|  | 동적 마감 (v1.0.2 신규)                                    ||
|  | 판매자 마감일 + Faratin t_max 수식                          ||
|  +----------------------------------------------------------+|
|  | 선택 정책 (v1.0.2 신규)                                    ||
|  | 병렬 협상 최적 offer 선택                                   ||
|  +----------------------------------------------------------+|
|  | 일괄 평가기 | 멀티 세션 비교기                               ||
|  +----------------------------------------------------------+|
+-----------------------------+--------------------------------+
                              |
+-----------------------------v--------------------------------+
|  L3: Wire + Data                                              |
|  HNP (Protobuf/gRPC) | Redis (Hot) | PostgreSQL (Cold)       |
+--------------------------------------------------------------+
```

### 0.2 설계 원칙

1. **결정론(Determinism)** -- 동일 입력 -> 동일 출력. 암묵적 상태 없음, 난수 없음.
2. **제한된 출력(Bounded Output)** -- 모든 V_j in [0, 1], U_total in [0, 1]. 예외 없음.
3. **차원 독립성(Dimensional Independence)** -- 각 V_j는 서로소인 입력 집합에 의존.
4. **역할 대칭(Role Symmetry)** -- 구매자/판매자 수식은 구조적으로 동일. 파라미터 방향만 다름.
5. **스킬 경계 명확성(Skill Boundary Clarity)** -- Engine Core는 DB, API, LLM을 호출하지 않음(MUST NOT).
6. **엔진이 곧 깔때기(Engine as Funnel)** -- Engine Core 일괄 평가가 리스팅 선별을 수행. 별도 필터 불필요.
7. **하위 호환성(Backward Compatibility)** -- 단일 이슈(가격만) 모드가 기본값. 다중 이슈는 `issue_space` 파라미터 제공 시 활성화.

### 0.3 Engine-First, 리액티브 에스컬레이션

```
Hot Path (매 라운드, 95%+ 트래픽):
  상대 역제안 -> Skill Coordinator -> Engine Core (200us) -> Decision Maker
    -> v1.0.2: 이동 분류 (6종) -> 상대방 모델 업데이트 (베이지안)
    -> 동적 베타 -> 역제안 (효용 공간 + Offer Inverter)
    -> AC_next 체크 -> 응답
  LLM 호출: 0회

Cold Path (초기 전략 수립):
  사용자 목표 -> Strategy Skill -> LLM (Grok 4.1 Fast) -> MasterStrategy
  빈도: 제품당 1회 이상

리액티브 에스컬레이션 (협상 중 "모르면 물어보기"):
  상대 제안 수신 -> Engine Core가 처리 불가 판단 -> ESCALATE
  -> LLM이 상황 해석 + 전략 갱신 -> Engine Core에 재입력
```

---

## 1. 이슈 공간 (v1.0.2 신규)

### 1.1 이슈 타입 분류

모든 협상 이슈는 두 가지 타입 중 하나로 분류됩니다. 이 분류가 Offer Inverter와 엔진의 조정 범위를 결정합니다.

```
NEGOTIABLE(협상 이슈)
  정의: 협상 중 실시간으로 조율 가능한 조건
  속성: domain [min, max]와 direction (lower/higher is better)이 있음
  Offer Inverter: 대상 -- 엔진이 U_target으로부터 목표값 역산
  예시: price, delivery_speed, shipping_cost, warranty_months
  범위: 모든 카테고리에 보편적 (시스템 레벨)

INFORMATIONAL(정보 이슈)
  정의: 고정된 사실. 협상 카드가 아닌 것.
  속성: domain 범위 없음. 가중치(w_j)만 있음.
  Offer Inverter: 대상 아님 -- 값 고정, U_total 계산 시 수락/거절 판단에만 영향
  예시: battery_health, scratch_level, original_box, component_included
  범위: 카테고리별, DB에서 계층 상속으로 로드
```

### 1.2 이슈 인터페이스

```typescript
interface Issue {
  id: string;                          // 예: "price", "battery_health"
  type: 'NEGOTIABLE' | 'INFORMATIONAL';
  weight: number;                      // w_j, 모든 w_j의 합 = 1.0
  domain?: {                           // NEGOTIABLE 전용. INFORMATIONAL은 null.
    min: number;
    max: number;
    direction: 'lower_is_better' | 'higher_is_better';
  };
}
```

### 1.3 효용 함수 일반화

**v1.0.0-v1.0.1 (4차원 고정):**
```
U_total = w_p * V_p + w_t * V_t + w_r * V_r + w_s * V_s
```

**v1.0.2 (다중 이슈, 하위 호환):**
```
U_total = SUM_j( w_j * V_j(x_j) )    -- j는 모든 이슈 (NEGOTIABLE + INFORMATIONAL)

제약:
  SUM(w_j) = 1.0   (모든 이슈에 걸쳐, 타입 무관)
  모든 V_j in [0, 1]
  따라서 U_total in [0, 1]
```

**하위 호환성:** `issue_space`가 제공되지 않으면, 엔진은 기존 4차원 모드를 사용합니다:
- `V_p` (가격) = NEGOTIABLE, PriceContext에서 domain 생성
- `V_t` (시간) = INFORMATIONAL (라운드별 고정)
- `V_r` (리스크) = INFORMATIONAL (라운드별 고정)
- `V_s` (관계) = INFORMATIONAL (라운드별 고정)

즉 기존 `NegotiationContext` 인터페이스는 변경 없이 계속 동작합니다. 다중 이슈 모드는 `IssueSpace`가 명시적으로 제공될 때만 활성화됩니다.

### 1.4 V_j 평가 함수

**선형 (NEGOTIABLE 기본):**
```
구매자 (lower_is_better):
  V_j(x_j) = (max_j - x_j) / (max_j - min_j)

판매자 (higher_is_better):
  V_j(x_j) = (x_j - min_j) / (max_j - min_j)
```

**로그 스케일 (V_p, v1.0.0에서 보존):**
```
구매자:
  V_p = ln(P_limit - P_effective + 1) / ln(P_limit - P_target + 1)

판매자:
  V_p = ln(P_effective - P_limit + 1) / ln(P_target - P_limit + 1)
```

**INFORMATIONAL 이슈:**
값이 고정 (Skill Layer에서 제공). domain 범위 없음. V_j는 데이터를 제공하는 Skill이 계산.

### 1.5 Skill Layer 연동

```
IssueRegistry Skill (v1.0.2 신규):
  - 카테고리별 이슈 정의 관리
  - 카테고리 계층에서 상속: Electronics > Apple > MacBook
  - Engine Core에 이슈 가중치와 domain 제공
  - GoalParser가 사용자 의도에 따라 가중치 오버라이드 가능

데이터 흐름:
  GoalParser -> IssueRegistry -> Issue[] (가중치 포함)
  리스팅 데이터 -> INFORMATIONAL 이슈 값 (고정)
  Strategy -> NEGOTIABLE 이슈 domain
  -> Engine Core가 완전한 IssueSpace 수신
```

### 1.6 TypeScript 인터페이스

```typescript
interface IssueSpace {
  issues: Issue[];
  current_values: Record<string, number>;  // 각 이슈의 현재 x_j
}

// MasterStrategy에 연결 (선택적 -- null이면 기존 4차원 모드)
interface MasterStrategy {
  // ... 기존 필드 ...
  issue_space?: IssueSpace;  // v1.0.2: null = 기존, 설정 = 다중 이슈
}
```

---

## 2. 총 효용 함수

### 2.1 핵심 공식 (변경 없음)

$$U_{total} = \sum_{i} w_i \cdot V_i$$

**제약조건:**
- 모든 w_i >= 0, SUM(w_i) = 1.0
- 모든 V_i in [0, 1]
- 따라서 U_total in [0, 1]

### 2.2 기존 4차원 모드 (V_p, V_t, V_r, V_s)

v1.0.1과 완전히 동일하게 보존. V_p/V_t/V_r/V_s 상세 사양은 v1.0.1 문서 섹션 2-5 참조.

핵심 공식 (변경 없음):

```
V_p: ln 스케일 가격 효용 (구매자/판매자 대칭)
V_t: max(V_t_floor, (max(0, 1 - t_elapsed/t_deadline))^alpha)
V_r: w_rep * r_score + w_info * i_completeness
V_s: clamp(V_s_base + N_success/N_threshold + P_dispute, 0, 1)
```

### 2.3 다중 이슈 모드

`issue_space`가 제공될 때:

```typescript
function computeMultiIssueUtility(issueSpace: IssueSpace): number {
  let total = 0;
  for (const issue of issueSpace.issues) {
    const x = issueSpace.current_values[issue.id];
    const v = evaluateIssue(issue, x);
    total += issue.weight * v;
  }
  return total;
}
```

4차원 V_p/V_t/V_r/V_s는 이슈로 매핑 가능:
```
{ id: "price",        type: "NEGOTIABLE",    weight: w_p, domain: {min: p_target, max: p_limit, ...} }
{ id: "time",         type: "INFORMATIONAL", weight: w_t }
{ id: "risk",         type: "INFORMATIONAL", weight: w_r }
{ id: "relationship", type: "INFORMATIONAL", weight: w_s }
{ id: "battery",      type: "INFORMATIONAL", weight: 0.05 }
{ id: "shipping_cost",type: "NEGOTIABLE",    weight: 0.08, domain: {min: 0, max: 50, ...} }
```

---

## 3. 양보 곡선 (효용 공간)

### 3.1 Faratin 효용 공간 수식 (v1.0.1, 보존)

```
U_target(t) = U_start + (RV - U_start) * (t / t_max)^(1/beta)

여기서:
  U_start   = 초기 제안 효용 목표 (u_aspiration에 대응)
  RV        = Reservation Value (u_threshold에 대응)
  t         = 현재 라운드 (또는 경과 시간)
  t_max     = 마감 (라운드 수 또는 시간)
  beta      = 양보 형태 파라미터
              beta < 1:  Boulware (오래 버티다가 마지막에 양보)
              beta = 1:  Linear (일정하게 양보)
              beta > 1:  Conceder (초반에 빠르게 양보)
```

### 3.2 동적 베타 (v1.0.1 + v1.0.2 확장)

**v1.0.1 수식 (보존):**
```
beta_competition = beta_base * (1 + kappa * ln(n_competitors + 1))
beta_dynamic = beta_competition * (1 + lambda * opponent_concession_rate)
result = clamp(beta_dynamic, 0.1, 10.0)
```

**v1.0.2 추가 -- Faratin 4.2.1 자원 의존 조정:**

`listing_deadline`이 제공될 때, 엔진은 추가로 계산합니다:

```
t_max_dynamic = mu * |N|^2 / max(avg_thread_length, 1)
t_max_calendar = max(1, days_left * avg_rounds_per_day)
t_max_final = min(t_max_calendar, t_max_dynamic)
```

이것이 beta_effective에 영향:
```
ratio = t_max_dynamic / mu_baseline
beta_faratin = beta_base / max(ratio, 0.1)
```

**조율 방법:** 두 수식 모두 실행됩니다. 엔진은 더 보수적인(낮은 beta = 더 Boulware) 값을 사용합니다:

```typescript
function computeEffectiveBeta(params: EffectiveBetaParams): number {
  // v1.0.1 동적 베타 (경쟁 + 상대 EMA)
  const betaDynamic = computeDynamicBeta({
    beta_base: params.beta_base,
    n_competitors: params.n_competitors,
    opponent_concession_rate: params.opponent_concession_rate,
    kappa: params.kappa,
    lambda: params.lambda,
  });

  // v1.0.2 Faratin 자원 의존 베타
  if (params.listing_deadline && params.mu_baseline) {
    const betaFaratin = computeFaratinBeta(params);
    // 더 보수적 (Boulware 방향) 값 사용
    return Math.min(betaDynamic, betaFaratin);
  }

  return betaDynamic;
}
```

### 3.3 AC_next (v1.0.1, 보존)

```
상대 제안이 역제안보다 이미 좋으면 (우리 관점에서):
  COUNTER -> ACCEPT로 즉시 업그레이드

shouldAcceptNext(incoming, counter, p_target, p_limit) -> boolean
```

### 3.4 동적 마감 파라미터

```typescript
interface DynamicDeadlineParams {
  listing_deadline?: string;          // ISO 날짜, 판매자 설정 (기본: 14일, 최소: 7일)
  mu_baseline: number;               // 기준 협상 시간 (기본: 10.0)
  n_active_sessions: number;         // 현재 병렬 협상 수
  avg_thread_length: number;         // 활성 스레드 평균 라운드 수
  avg_rounds_per_day: number;        // 일당 추정 라운드 수 (기본: 5)
}
```

### 3.5 t_max 통합

```
t_max_final = min(t_max_calendar, t_max_dynamic)

이 값이 반영되는 곳:
1. 양보 곡선: U_target(t)에서 T로 t_max_final 사용
2. V_t 계산: t_deadline이 t_max_final로 오버라이드 가능
3. 세션 타임아웃: t_max_final에서 세션 자동 만료

의미:
  경쟁자 많음 -> t_max_dynamic 증가 -> 여유 생김 -> Boulware
  경쟁자 빠져나감 -> t_max_dynamic 감소 -> 압박 증가 -> Conceder
  판매자 마감일 임박 -> t_max_calendar 감소 -> 절대적 상한
  둘 중 더 빠른 마감이 항상 적용됨.
```

---

## 4. Offer Inverter (v1.0.2 신규)

### 4.1 목적

Decision Maker가 COUNTER를 반환하면 엔진은 실제 역제안을 생성해야 합니다. v1.0.1은 가격 공간(단일 이슈)에서만 역산 가능했습니다. v1.0.2는 다중 이슈 역산을 추가합니다.

### 4.2 파이프라인

```
1. Faratin 효용 공간 곡선으로 U_target(t) 계산
2. 이슈를 분리: NEGOTIABLE vs INFORMATIONAL
3. INFORMATIONAL 이슈의 고정 기여분 계산
4. 남은 효용 = U_target - informational_utility
5. 남은 효용을 NEGOTIABLE 이슈들에 분배
6. 각 NEGOTIABLE 이슈에 대해 V_j -> x_j 역산
7. 완전한 offer 반환 {issue_id: value}
```

### 4.3 역산 전략

`inversion_strategy` 파라미터로 두 전략 중 선택:

**PROPORTIONAL (기본, Opponent Model 불필요):**
```
현재 NEGOTIABLE 이슈 효용의 비율을 유지합니다.
U_target 달성을 위해 모두 비례적으로 스케일링.

scale = negotiable_target / current_negotiable_u
각 NEGOTIABLE 이슈 j에 대해:
  v_target_j = min(1.0, v_current_j * scale)
  x_j = invert_V_j(v_target_j, domain_j)
```

**OPPONENT_AWARE (Opponent Model 필요):**
```
추정된 상대 가중치를 활용하여 양보를 분배합니다.
상대가 덜 중시하는 이슈에서 더 많이 양보합니다.
상대가 중시하는 이슈에서는 덜 양보합니다.

각 NEGOTIABLE 이슈 j에 대해:
  상대 가중치 낮은 이슈 -> 더 양보 (우리에게 저렴한 양보)
  상대 가중치 높은 이슈 -> 덜 양보 (우리에게 비싼 양보)
```

### 4.4 V_j 역함수

**선형 V_j (구매자, lower_is_better):**
```
x_j = max_j - v_j * (max_j - min_j)
```

**선형 V_j (판매자, higher_is_better):**
```
x_j = min_j + v_j * (max_j - min_j)
```

**로그 V_p (기존 invertVp, 보존):**
```
P_effective = P_limit - exp(v_p * ln(P_limit - P_target + 1)) + 1
```

### 4.5 인터페이스

```typescript
interface OfferInverterParams {
  u_target: number;                    // 목표 총 효용
  issues: Issue[];                     // 이슈 정의
  current_values: Record<string, number>;
  inversion_strategy: 'PROPORTIONAL' | 'OPPONENT_AWARE';
  estimated_opponent_weights?: Record<string, number>;  // OPPONENT_AWARE용
}

interface InvertedOffer {
  values: Record<string, number>;      // 각 이슈의 제안값
  achieved_utility: number;            // 역산된 offer의 실제 U
}

function invertOffer(params: OfferInverterParams): InvertedOffer;
```

### 4.6 단일 이슈 하위 호환

`issue_space`가 null (기존 4차원 모드)일 때, 기존 `computeUtilitySpaceCounterOffer()` 함수가 활성 경로로 유지됩니다. V_p만 `invertVp()`를 사용해 역산하며, 이는 NEGOTIABLE 이슈 1개(가격)와 INFORMATIONAL 이슈 3개(시간, 리스크, 관계)로 구성된 Offer Inverter와 동등합니다.

---

## 5. 이동 분류기 (v1.0.2 확장)

### 5.1 v1.0.1 (3종, 폴백으로 보존)

```
CONCESSION: 상대가 우리 선호 방향으로 가격 이동
SELFISH:    상대가 우리 선호 반대 방향으로 가격 이동
SILENT:     가격 변화 없음 (노이즈 임계값 이내)
```

단일 이슈(가격만) 모드에서 활성 분류기로 유지됩니다.

### 5.2 v1.0.2 (6종, Jonker et al. 2012 Figure 2)

Opponent Model이 추정 상대 효용을 제공할 때 전체 6종 분류가 활성화됩니다:

```
delta_u_self    = 상대의 최신 제안에서 우리 효용 변화량
delta_u_opp     = 추정 상대 효용 변화량 (Opponent Model 필요)
epsilon         = 노이즈 임계값 (기본: 0.02)

분류 규칙:
  delta_u_self > epsilon  AND delta_u_opp > epsilon  -> FORTUNATE  (행운)
  delta_u_self < -epsilon AND delta_u_opp > epsilon  -> CONCESSION (양보)
  delta_u_self > epsilon  AND delta_u_opp < -epsilon -> SELFISH    (이기적)
  delta_u_self < -epsilon AND delta_u_opp < -epsilon -> UNFORTUNATE(불운)
  |delta_u_self| <= epsilon AND delta_u_opp > epsilon -> NICE      (배려)
  그 외                                              -> SILENT     (침묵)
```

### 5.3 이동 타입별 최적 응답

```
FORTUNATE   -> 즉시 수락 고려 (파레토 개선)
CONCESSION  -> 우리도 양보로 응답 (협력 신호에 협력)
SELFISH     -> SILENT 또는 Boulware (착취 시도에 강하게 대응)
UNFORTUNATE -> NICE로 응답 (실수 가능성, 관대하게)
NICE        -> 양보 또는 수락 (배려에 보답)
SILENT      -> 강한 역제안 또는 마감 압박
```

### 5.4 인터페이스

```typescript
type OpponentMoveType6 =
  | 'FORTUNATE' | 'CONCESSION' | 'SELFISH'
  | 'UNFORTUNATE' | 'NICE' | 'SILENT';

interface OpponentMove6 {
  type: OpponentMoveType6;
  delta_u_self: number;
  delta_u_opp: number;
}

function classifyMove6(
  delta_u_self: number,
  delta_u_opp_estimated: number,
  epsilon?: number,
): OpponentMove6;
```

### 5.5 활성화 로직

```
if (opponentModel에 estimated_utilities가 있으면):
  classifyMove6 사용 (6종)
else:
  classifyMove 사용 (3종, 가격 기반)  -- v1.0.1 폴백
```

---

## 6. 상대방 모델 (v1.0.2 확장)

### 6.1 아키텍처

v1.0.2는 이중 레이어 상대방 모델을 도입합니다:

```
Layer 1: EMA 양보율 추적기 (v1.0.1, 보존)
  - 빠르고 단순, 라운드 1부터 동작
  - 지수 이동 평균으로 양보율 추적
  - computeDynamicBeta()에 입력

Layer 2: 베이지안 상대방 모델 (v1.0.2 신규)
  - 2+ 라운드 관찰 후 활성화
  - 상대 beta (양보 형태) 추정
  - 상대 이슈 가중치 (w_j) 추정
  - Reputation 데이터를 베이지안 사전분포로 활용
```

### 6.2 EMA 양보율 추적기 (Layer 1, 보존)

```typescript
interface OpponentModel {
  concession_rate: number;   // 상대 양보율의 EMA
  move_count: number;        // 관찰된 이동 수
  last_move: OpponentMove | null;
}

// EMA 업데이트 (alpha = 0.3 기본)
new_rate = alpha * observed + (1 - alpha) * current_rate
```

### 6.3 베이지안 상대방 모델 (Layer 2, v1.0.2 신규)

#### 6.3.1 베타 추정

관찰된 행동에서 상대의 양보 형태(beta_opp)를 추정합니다:

```
사전분포(Prior):
  beta_prior_mean = Reputation Skill에서 로드 (이력 없으면 1.0)
  beta_prior_var = Reputation Skill에서 로드 (이력 없으면 1.0)

관찰:
  offer 이력에서 평균 양보 크기 계산
  높은 평균 양보 -> Conceder (beta > 1)
  낮은 평균 양보 -> Boulware (beta < 1)
  안정적 양보    -> Linear (beta ~ 1)

베이지안 업데이트 (결정론적 가중 평균):
  likelihood_weight = min(n_observations / 10.0, 1.0)
  beta_posterior = (1 - likelihood_weight) * beta_prior_mean
                 + likelihood_weight * beta_likelihood
  posterior_var = beta_prior_var * (1 - likelihood_weight)
```

**결정론 보장:** 확률적 샘플링 없음. 항상 사후 평균만 사용.

```python
# 잘못된 방식 (비결정론):
beta_sample = random.gauss(beta_posterior_mean, beta_posterior_std)

# 올바른 방식 (결정론):
beta_to_use = beta_posterior_mean  # 사후 평균만 사용
```

#### 6.3.2 가중치 추정

상대의 이슈 선호도(어떤 이슈를 가장 중시하는지)를 추정합니다:

```
핵심 통찰 (Hindriks & Tykhonov 2008):
  이슈 j에서 상대가 크게 양보 -> 낮은 w_j (그 이슈를 덜 중시)
  이슈 j에서 상대가 거의 안 양보 -> 높은 w_j (그 이슈를 중시)

초기값: 균등 가중치 (n개 이슈에 대해 1/n)
업데이트: 관찰된 이슈별 양보 패턴에 따라 조정
```

#### 6.3.3 Cold Start 해결

```
이력 없음 (신규 상대):
  beta_prior_mean = 1.0  (중립 가정)
  beta_prior_var = 1.0   (최대 불확실성)
  estimated_weights = 균등
  -> 수렴에 15-20회 이동 필요

과거 5건:
  beta_prior_mean = 이력 평균
  beta_prior_var = sigma^2 / 5
  -> 수렴에 8-10회 이동 필요

과거 50건+:
  beta_prior_mean = 정밀 보정됨
  beta_prior_var = 매우 낮음
  -> 2-3회 이동으로 수렴 (거의 즉시 파악)
```

### 6.4 Reputation을 사전분포로 (Skill Layer 연동)

```
L1: Reputation Skill이 제공하는 것:
  - r_global (공개 평판 점수)
  - beta_history_mean (이 상대와 과거 협상의 평균 beta)
  - beta_history_var (그 추정의 불확실성)
  - n_past_sessions (과거 세션 수)
  - defection_count (합의 후 이탈 횟수)

L2: Engine Core가 수신하는 것:
  - OpponentPrior { beta_mean, beta_var }
  - 세션 내 추정을 위한 베이지안 사전분포로 사용
```

Engine Core는 Reputation을 직접 조회하지 않습니다. Skill Layer가 사전분포 데이터를 `OpponentContext` 파라미터에 주입합니다.

### 6.5 인터페이스

```typescript
interface OpponentContext {
  opponent_id: string;
  // 베이지안 베타 추정
  beta_prior_mean: number;        // Reputation에서 (기본: 1.0)
  beta_prior_var: number;         // 불확실성 (기본: 1.0)
  beta_posterior?: number;         // 엔진 계산 (자동 업데이트)
  // 가중치 추정
  estimated_weights?: Record<string, number>;  // 이슈별 가중치 추정
  // 신뢰 보정
  trust_weight: number;           // 사전분포 vs 세션 균형 [0,1] (기본: 0.5)
  // 관찰 이력
  offer_history: OfferRecord[];
  move_history: MoveRecord[];
  epsilon: number;                // 이동 분류 임계값 (기본: 0.02)
}

interface OfferRecord {
  round: number;
  u_from_my_perspective: number;    // 내 효용 기준
  u_from_opp_estimated: number;     // 상대 효용 추정
  issue_values: Record<string, number>;
}

interface MoveRecord {
  round: number;
  move_type: OpponentMoveType6;
  delta_u_self: number;
  delta_u_opp: number;
}
```

### 6.6 에스컬레이션 컨텍스트 강화

ESCALATE 발동 시, LLM에 더 풍부한 컨텍스트가 전달됩니다:

```typescript
interface EscalationContext {
  // v1.0.1 필드 (보존)
  reason: 'UNKNOWN_PROPOSAL' | 'STRATEGY_REVIEW';
  session_round: number;
  // v1.0.2 추가
  last_move_type: OpponentMoveType6;      // 상대 이동 타입
  beta_estimated: number;                  // 상대 beta 사후 추정
  u_target_current: number;                // 현재 목표 효용
  opponent_pattern: string;                // 'BOULWARE' | 'LINEAR' | 'CONCEDER'
  estimated_opponent_weights?: Record<string, number>;
}
```

---

## 7. Decision Maker (v1.0.2 확장)

### 7.1 핵심 로직 (v1.0.0, 보존)

```
if u >= u_aspiration:                      -> ACCEPT
if u >= u_threshold AND v_t < 0.1:         -> ACCEPT
if u >= u_threshold:                       -> NEAR_DEAL
if rounds_no_concession >= 4:              -> ESCALATE
if v_t < 0.05 AND u < u_threshold:        -> ESCALATE
if u > 0:                                 -> COUNTER
그 외:                                     -> REJECT
```

### 7.2 v1.0.2 의사결정 흐름 추가

핵심 결정 이후 추가 체크:

```
1. 핵심 결정 (위)
2. COUNTER 또는 NEAR_DEAL인 경우:
   a. effective beta 계산 (동적 + Faratin)
   b. Faratin 효용 공간 곡선으로 U_target 계산
   c. Offer Inverter 실행 (PROPORTIONAL 또는 OPPONENT_AWARE)
   d. AC_next 체크: 상대 제안 >= 역제안 -> ACCEPT
3. 상대 이동 분류 (모델 있으면 6종, 없으면 3종)
4. 상대 모델 업데이트 (EMA + 베이지안)
5. 미러링 전략 조정 적용 (선택적, 섹션 8 참조)
```

### 7.3 FORTUNATE 이동 즉시 수락

`classifyMove6`이 FORTUNATE(양쪽 모두 이득)을 반환하면, U_total < u_aspiration이더라도 U_total > u_threshold이면 즉시 수락을 고려합니다.

```
if move_type == 'FORTUNATE' AND u_total > u_threshold:
  -> ACCEPT (파레토 개선, 놓치지 않음)
```

---

## 8. 전술 엔진 (v1.0.2 신규)

### 8.1 개요

전술 엔진은 엔진이 얼마나 양보하는지가 아니라 어떻게 양보하는지를 관장합니다. 상대 모델과 세션 상태를 기반으로 협상 전술을 선택하고 적용합니다.

### 8.2 미러링 전략 (Jonker et al. 5.2)

```
1. 상대의 마지막 이동을 분류 (6종)
2. 같은 카테고리의 이동으로 미러링
3. 선택적으로 NICE 이동 추가 (파레토 개선 시도)

예시:
  상대: CONCESSION (가격 +$20)
  우리 응답: CONCESSION (가격 -$10) + NICE (배송 1일 단축)
  -> 상대의 협력에 호응하면서, 파레토 개선 시도
```

### 8.3 전술 선택 매트릭스

```
상대 패턴        세션 단계      전술
BOULWARE         초반           미러링 + 버팀
BOULWARE         후반           점진적 양보 + 마감 신호
CONCEDER         초반           버팀 (상대가 알아서 양보)
CONCEDER         후반           소폭 상호 양보
LINEAR           모든 단계      비례적 미러링
UNKNOWN          초반           기본 (PROPORTIONAL 역산)
UNKNOWN          후반           전략 검토 에스컬레이션
```

### 8.4 Offer Inverter와의 연동

전술 엔진은 `inversion_strategy`를 조정하고, Offer Inverter에 전달하기 전에 `U_target`을 수정할 수 있습니다:

```
상대가 BOULWARE (강하게 버팀)?
  -> U_target 감소율 낮춤 (우리도 버팀)
  -> PROPORTIONAL 역산 사용 (모델을 드러내지 않음)

상대가 CONCEDER (빠르게 양보)?
  -> 높은 U_target 유지 (더 많은 가치 추출)
  -> OPPONENT_AWARE 역산 사용 (양보 대상 최적화)

FORTUNATE 이동 감지?
  -> 역산 생략, 수락 또는 현 위치 유지
```

---

## 9. 선택 정책 (v1.0.2 신규)

### 9.1 목적

판매자가 여러 구매자와 동시에 협상하고, 여러 offer가 수용 가능 수준에 도달했을 때 선택 메커니즘이 필요합니다.

### 9.2 수식

```
score_i = alpha * U(offer_i) + (1 - alpha) * R(buyer_i)

여기서:
  alpha           = 효용 vs 평판 가중치 (기본: 0.7)
  U(offer_i)      = 해당 offer의 총 효용
  R(buyer_i)      = 구매자의 공개 평판 점수 [0, 1]
```

### 9.3 인터페이스

```typescript
interface SelectionPolicyParams {
  alpha_selection: number;            // 효용 vs 평판 가중치 (기본: 0.7)
  selection_threshold: number;        // 자동 수락 효용 임계값
  dropout_policy: 'TIMEOUT' | 'RV_MISS' | 'EXPLICIT_REJECT' | 'LISTING_EXPIRED';
}

interface OfferCandidate {
  session_id: string;
  u_total: number;
  r_score: number;
  buyer_id: string;
}

function selectBestOffer(
  candidates: OfferCandidate[],
  alpha?: number,
): OfferCandidate;
```

### 9.4 Skill Layer 연동

```
L1: NegotiationSkill이 병렬 세션 관리
    -> 어떤 세션이 ACCEPT 가능 상태에 도달하면:
       1. 모든 활성 세션 상태 수집
       2. selectBestOffer() 호출
       3. 최적 offer 수락, 나머지는 거절 또는 보류
       4. 'session.selected' 이벤트 발행
```

---

## 10. 에이전트 능력치 시스템 (v1.0.1, 보존)

### 10.1 개요

8개의 사용자 친화적 스탯이 협상 성격을 정의합니다. Strategy Skill이 스탯을 엔진 파라미터로 변환합니다. Engine Core는 스탯을 직접 보지 않습니다.

```
총 예산: 400 포인트
스탯당 범위: 10 - 90

그룹 1 (전투 스타일): Anchoring, Tenacity, Resolve
그룹 2 (분석력): Market Sense, Risk Radar, Scrutiny
그룹 3 (시간/관계): Patience, Rapport
```

### 10.2 스탯 -> 다중 이슈 매핑 (v1.0.2 확장)

다중 이슈 모드에서 AgentStats가 이슈 가중치 분배에 영향:

```
Anchoring    -> U_start (얼마나 공격적으로 시작하는가)
Tenacity     -> beta_base (양보 형태)
Resolve      -> u_threshold, u_aspiration (수락 기준)
Market Sense -> 역산 전략 선택 (PROPORTIONAL vs OPPONENT_AWARE)
Risk Radar   -> 리스크 관련 INFORMATIONAL 이슈 가중치
Scrutiny     -> 품질 관련 INFORMATIONAL 이슈 가중치
Patience     -> t_deadline 스케일링, V_t_floor
Rapport      -> Opponent Model의 trust_weight (사전분포 신뢰도)
```

---

## 11. 전체 라운드 실행 파이프라인 (v1.0.2)

```
executeRound(session, strategy, incomingOffer, roundData):

  1. 컨텍스트 조립
     - issue_space가 있으면: 다중 이슈 효용 사용
     - 없으면: 기존 4차원 (NegotiationContext)

  2. 효용 계산 (U_total)

  3. 핵심 의사결정
     ACCEPT / COUNTER / NEAR_DEAL / REJECT / ESCALATE

  4. COUNTER 또는 NEAR_DEAL인 경우:
     4a. 동적 마감 계산 (listing_deadline 제공 시)
     4b. effective beta 계산
         - v1.0.1: computeDynamicBeta(경쟁 + EMA)
         - v1.0.2: min(betaDynamic, betaFaratin) (마감 데이터 있을 때)
     4c. Faratin 효용 공간 곡선으로 U_target 계산
     4d. Offer Inversion:
         - 단일 이슈: computeUtilitySpaceCounterOffer() [기존]
         - 다중 이슈: invertOffer() [v1.0.2 신규]
     4e. AC_next 체크: 상대 제안 >= 역제안 -> ACCEPT

  5. 상대 이동 분류
     - 3종 (가격 기반): 상대 효용 추정 없을 때
     - 6종 (Jonker): 상대 모델이 추정 효용 제공할 때

  6. 상대 모델 업데이트
     - Layer 1: EMA 업데이트 (항상)
     - Layer 2: 베이지안 beta + 가중치 추정 (OpponentContext 제공 시)

  7. 전술 조정 적용 (미러링 전략, 선택적)

  8. 발신 HNP 메시지 생성

  9. ESCALATE면 에스컬레이션 요청 생성
     - v1.0.2 강화 컨텍스트 포함 (move_type, beta_estimated 등)

  10. RoundResult 반환
```

---

## 12. 파라미터 계층 (v1.0.2 전체)

### Layer 1: 이슈 공간 (v1.0.2 신규)

| 파라미터 | 타입 | 설명 | 출처 | LLM 조절 |
|----------|------|------|------|----------|
| `issues` | `Issue[]` | 협상 이슈 집합 | IssueRegistry Skill | GoalParser 경유 |
| `issue.type` | enum | NEGOTIABLE / INFORMATIONAL | 카테고리 DB | 불가 |
| `domain[j]` | `(min, max)` | 이슈 j 범위 (NEGOTIABLE 전용) | Strategy Skill | 가능 |
| `V_j(x_j)` | function | 이슈 평가 함수 (선형 기본) | Engine Core | 간접 |
| `w_j` | float | 이슈 가중치 (합산=1.0, 타입 무관) | GoalParser -> Strategy | 가능 |

### Layer 2: 단일 스레드 전략 (보존 + 확장)

| 파라미터 | 타입 | 설명 | 출처 | LLM 조절 |
|----------|------|------|------|----------|
| `RV` / `u_threshold` | float [0,1] | Reservation Value | Strategy Skill | 가능 |
| `U_start` / `u_aspiration` | float [RV,1] | 초기 제안 효용 목표 | Strategy Skill | 가능 |
| `beta` | float > 0 | 양보 형태 | Strategy Skill / AgentStats | 가능 |
| `T` / `t_deadline` | int/float | 마감 | Strategy Skill | 가능 |
| `use_utility_space` | bool | 효용 vs 가격 공간 곡선 | Strategy Skill | 가능 |
| `inversion_strategy` | enum | PROPORTIONAL / OPPONENT_AWARE | Strategy Skill | 가능 |

### Layer 3: 역제안 생성 (v1.0.2 신규)

| 파라미터 | 타입 | 설명 | 출처 | LLM 조절 |
|----------|------|------|------|----------|
| `move_history` | MoveRecord[] | 세션 이동 분류 이력 | 엔진 (자동) | 불가 |
| `last_move_type` | string | 상대의 마지막 이동 (6종) | 엔진 (자동) | 불가 |
| `epsilon` | float | 이동 분류 임계값 | Strategy Skill | 간접 |

### Layer 4: 상대방 모델 (v1.0.2 신규)

| 파라미터 | 타입 | 설명 | 출처 | LLM 조절 |
|----------|------|------|------|----------|
| `beta_prior_mean` | float | 상대 beta 사전 평균 | Reputation Skill | 불가 |
| `beta_prior_var` | float | 사전분포 불확실성 | Reputation Skill | 불가 |
| `beta_posterior` | float | 세션 내 업데이트 추정 | 엔진 (자동) | 불가 |
| `estimated_weights` | dict | 상대 이슈 가중치 추정 | 엔진 (자동) | 불가 |
| `trust_weight` | float [0,1] | 사전분포 vs 세션 균형 | Strategy / AgentStats | 가능 |

### Layer 5: 다자간 & 경쟁 (v1.0.2 확장)

| 파라미터 | 타입 | 설명 | 출처 | LLM 조절 |
|----------|------|------|------|----------|
| `n_active_sessions` | int | 현재 병렬 협상 수 | 시스템 | 불가 |
| `avg_thread_length` | float | 평균 스레드 라운드 수 | 시스템 | 불가 |
| `mu_baseline` | float | 기준 협상 시간 (기본: 10) | Strategy Skill | 가능 |
| `listing_deadline` | date | 판매자 마감일 (기본: 14일) | Listing Skill | 가능 |
| `t_max_final` | int | 통합 마감 (자동) | 엔진 (자동) | 불가 |
| `alpha_selection` | float [0,1] | 효용 vs 평판 선택 가중치 | Strategy Skill | 가능 |
| `selection_threshold` | float | 자동 수락 효용 임계값 | Strategy Skill | 가능 |

### Layer 6: Reputation (보존 + 확장)

| 파라미터 | 타입 | 설명 | 출처 | LLM 조절 |
|----------|------|------|------|----------|
| `r_global` | float [0,1] | 공개 평판 점수 | Reputation Skill | 불가 |
| `beta_history_mean` | float | 과거 이력 beta 평균 | Reputation Skill | 불가 |
| `beta_history_var` | float | 과거 이력 불확실성 | Reputation Skill | 불가 |
| `n_past_sessions` | int | 과거 협상 횟수 | Reputation Skill | 불가 |
| `defection_count` | int | 합의 후 이탈 횟수 | Reputation Skill | 불가 |

---

## 13. Intent-First API 연동

### 13.1 다중 이슈와 Intent-First API 매핑

Intent-First API (Agentic Implementation 사양)는 다중 이슈 협상을 자연스럽게 지원합니다:

```
Explicit params -> NEGOTIABLE 이슈 domain
  max_price, target_price -> price 이슈의 domain

Hard constraints -> INFORMATIONAL 이슈 필터
  { key: "battery_cycle", op: "lt", value: 100 }
  -> Issue { id: "battery_cycle", type: INFORMATIONAL, ... }

Soft preferences -> 이슈 가중치 조정
  { key: "original_box", weight: 0.4 }
  -> "original_box" 이슈의 w_j 증가

Well-known keys -> 기존 4차원 가중치 시드
  price_sensitivity -> w_p 시드
  time_pressure -> w_t 시드

Free context + Intent -> GoalParser LLM이 나머지 가중치 보강
  "배터리 상태가 핵심이에요" -> battery_health의 w_j 증가
```

### 13.2 GoalParser v1.0.2 강화

GoalParser가 기존 가중치에 더해 `IssueSpace`도 생성합니다:

```
GoalParser 출력 (v1.0.2):
  NegotiationGoal {
    // 기존 (보존)
    weights: UtilityWeights
    p_target, p_limit, alpha, beta, ...

    // v1.0.2 신규
    issue_space?: IssueSpace {
      issues: Issue[]           // IssueRegistry + 사용자 오버라이드
      current_values: {...}     // 리스팅 데이터에서
    }
  }
```

---

## 14. 구현 계획

### 14.1 의존성 순서

```
Phase 1: 기반 (의존성 없음)
  [A] 이슈 타입 시스템 (Issue 인터페이스 + IssueSpace)
  [B] V_j 평가 함수 (선형, 로그)
  [C] 동적 마감 계산 (compute_t_max)
  [D] 선택 정책 (selectBestOffer)

Phase 2: 핵심 (Phase 1에 의존)
  [E] Offer Inverter (A, B에 의존)
      - PROPORTIONAL 전략
      - V_j 역함수
  [F] 6종 이동 분류기 (A에 의존)
      - classifyMove6() 함수
  [G] computeEffectiveBeta() 통합 (C에 의존)
      - v1.0.1 동적 베타 + v1.0.2 Faratin 베타 조율

Phase 3: 상대방 모델 (Phase 2에 의존)
  [H] 베이지안 beta 추정 (F에 의존)
      - Reputation에서 Prior, 세션에서 Posterior
  [I] 상대 가중치 추정 (F에 의존)
      - 이슈별 양보 추적
  [J] OPPONENT_AWARE 역산 전략 (E, I에 의존)

Phase 4: 통합 (Phase 3에 의존)
  [K] executeRound() 파이프라인 업데이트 (전부에 의존)
  [L] 전술 엔진 + 미러링 전략 (F, H에 의존)
  [M] 에스컬레이션 컨텍스트 강화 (H, I에 의존)
  [N] E2E 테스트 (전부에 의존)
```

### 14.2 하위 호환성 보장

- 기존 모든 테스트 (137 engine-core + 178 engine-session = 315개)가 변경 없이 통과해야 함.
- `computeUtility()`, `makeDecision()`, `computeCounterOffer()`, `executeRound()` 시그니처 변경 없음.
- 새 기능은 `issue_space` 또는 `OpponentContext`가 제공될 때만 활성화.
- 기본 동작 (새 파라미터 없음) = v1.0.1과 동일.

### 14.3 패키지 배치

```
engine-core (순수 수학, 외부 의존성 0):
  + src/issue/types.ts               -- Issue, IssueSpace 인터페이스
  + src/issue/evaluate.ts            -- V_j 평가 함수
  + src/issue/invert.ts              -- Offer Inverter (PROPORTIONAL + OPPONENT_AWARE)
  + src/decision/dynamic-deadline.ts  -- t_max 계산
  + src/decision/selection.ts        -- selectBestOffer()
  + src/decision/classify-move6.ts    -- 6종 분류기
  + src/opponent/bayesian.ts         -- 베이지안 beta 추정
  + src/opponent/weight-estimator.ts  -- 상대 가중치 추정

engine-session (오케스트레이션):
  * src/round/executor.ts            -- 업데이트된 파이프라인 (하위 호환)
  + src/round/tactic-engine.ts       -- 미러링 전략 + 전술 선택
  * src/round/types.ts               -- 확장된 OpponentModel, MoveRecord6
  * src/strategy/types.ts            -- 확장된 MasterStrategy (issue_space?, opponent_context?)
```

`*` = 수정, `+` = 신규 파일

### 14.4 테스트 전략

각 Phase마다 자체 테스트 스위트:

```
Phase 1: ~30개 테스트
  - 이슈 타입 검증
  - V_j 평가 엣지 케이스 (0, 1, 경계, 방향)
  - 다양한 경쟁 시나리오의 동적 마감
  - 선택 정책 점수 계산

Phase 2: ~40개 테스트
  - Offer Inverter: 단일 이슈, 다중 이슈, 경계 케이스
  - PROPORTIONAL 역산: 스케일 업/다운, 클램프
  - 6종 분류: 모든 6가지 타입 + epsilon 경계
  - Effective beta 조율

Phase 3: ~30개 테스트
  - 베이지안 beta: prior만, 관찰 포함, 수렴
  - 가중치 추정: 균등 시작, 비대칭 양보
  - OPPONENT_AWARE 역산: 가중치 기반 분배

Phase 4: ~20개 테스트
  - 전체 파이프라인 E2E: 다중 이슈 협상 생명주기
  - 하위 호환성: 기존 테스트 전부 통과
  - 전술 엔진: 미러링 응답
  - 에스컬레이션 강화
```

---

## 15. 데이터 윤리 (Agentic Implementation에서)

### 15.1 상대방 모델 데이터 취급

베이지안 상대방 모델은 상대방에 관한 민감한 데이터를 생성합니다. 규칙:

| 데이터 | 공개 여부 | 이유 |
|--------|----------|------|
| 카테고리 집계 beta 평균 | 공개 (Intelligence API) | 카테고리 수준 통계 |
| 개인 상대 beta_posterior | 비공개 (엔진 전용) | 개인 행동 패턴 |
| 추정 상대 가중치 | 비공개 (엔진 전용) | 개인 선호 데이터 |
| 이동 분류 이력 | 비공개 (세션별) | 세션 기밀 |

### 15.2 원칙

1. **양쪽 공정성:** Haggle은 구매자와 판매자 모두의 플랫폼. 한쪽에만 유리한 데이터 노출 금지.
2. **집계만 공개:** Intelligence API로 공개하는 데이터는 모두 카테고리 수준 집계.
3. **비공개 = 대행 가치:** 개인 패턴 데이터는 엔진의 "비밀 무기" -- Haggle 대행 서비스를 통해서만 활용 가능.
4. **양쪽에 동일 적용:** 판매자 패턴을 구매자에게 안 파는 것처럼, 구매자 패턴도 판매자에게 안 팜.

---

## 16. 리스크 및 완화

| 리스크 | 심각도 | 완화 |
|--------|--------|------|
| 다중 이슈 복잡도 폭발 | 중간 | NEGOTIABLE 이슈를 협상당 최대 5개로 제한. INFORMATIONAL은 무제한. |
| 베이지안 모델 과적합 | 낮음 | 사후 분산 하한선 (0.05 이하로 내려가지 않음). trust_weight로 prior 영향 제한. |
| 하위 호환성 파괴 | 높음 | 기본 = 기존 4차원. 다중 이슈 = 옵트인. 기존 315개 테스트 전부 통과 필수. |
| Offer Inverter 퇴화 케이스 | 중간 | OPPONENT_AWARE가 유효하지 않은 offer를 생성하면 PROPORTIONAL로 폴백. 모든 V_j를 [0,1]로 클램프. |
| Cold start (상대 이력 없음) | 중간 | 중립 prior (beta=1.0, var=1.0). 균등 가중치. 데이터 축적까지 보수적 행동. |
| 성능 저하 (다중 이슈 오버헤드) | 낮음 | 모든 계산이 O(n_issues), n_issues는 보통 < 10. 여전히 서브 밀리초. |

---

## 요약: v1.0.1 -> v1.0.2 변경 사항

| 컴포넌트 | v1.0.1 | v1.0.2 | 변경 이유 |
|----------|--------|--------|-----------|
| 이슈 모델 | 4차원 고정 (V_p, V_t, V_r, V_s) | 다중 이슈 (NEGOTIABLE + INFORMATIONAL) | Faratin 3.1 준수 |
| 양보 단위 | 효용 (단일 이슈 V_p 역산) | 효용 (다중 이슈 Offer Inverter) | Faratin 3.2 준수 |
| 이동 분류 | 3종 (가격 기반) | 6종 (Jonker Fig.2) + 3종 폴백 | Jonker 2012 4 |
| 상대 모델 | EMA 양보율 | EMA (L1) + 베이지안 beta + 가중치 추정 (L2) | Hindriks 2008 |
| Reputation 활용 | V_r 수락/거절에만 사용 | V_r + 베이지안 Prior로 상대 모델 강화 | Jonker 2012 4 |
| 경쟁 반영 | 동적 beta (로그 스케일) | + 동적 마감 + Faratin beta | Faratin 4.2.1 |
| 마감 | t_deadline (고정) | t_max_final = min(달력, 동적) | Faratin 4.2.1 |
| 선택 정책 | 없음 | alpha * U + (1-alpha) * R | Haggle 설계 |
| 전술 엔진 | 없음 | 미러링 전략 + 전술 선택 | Jonker 2012 5.2 |
| AgentStats | 8 스탯 -> 4차원 파라미터 | 8 스탯 -> 다중 이슈 + 상대 모델 설정 | 확장 |
| 하위 호환 | -- | 100% (기존 모드 = 기본값) | 설계 원칙 |

---

*이 문서는 Haggle Engine v1.0.2의 완전한 기술 사양서입니다.
모든 수식에 논문 섹션 번호를 병기했으므로, 원문 대조가 필요한 경우 해당 섹션을 직접 참조하시기 바랍니다.
구현은 섹션 14의 Phase별 접근 방식을 따릅니다.*

**문서 끝**
