# Haggle 협상 엔진 — Source of Truth (SOT)

> **이 문서 하나가 협상 엔진의 진실의 원천입니다.**
> 이상적인 목표 설계(**SOT**)와 현재 실제 구현 상태(**현황**)를 능력 단위로 나란히 담습니다.
> 모든 개발자와 AI 툴은 이 문서로 "무엇이 목표(SOT)이고 / 지금 어디까지 됐고(현황) / 다음에 뭘 해야 하는지(할 일)"를 확실히 파악할 수 있어야 합니다.

<!--
  유지 규칙:
  1. **이상형(SOT)** 은 목표 설계다. 바뀌면 여기서 먼저 바꾼다. (구 docs/engine/*.md 통합본)
  2. **현황** 은 실제 코드 대조 결과다. 코드가 바뀌면 갱신한다. 반드시 파일·라인 근거를 단다.
  3. 이상형과 현황이 어긋나는 지점이 곧 **할 일(백로그)** 이다.
  4. 추측 금지. 미확인은 ❓로 표기하고 조사 대상으로 남긴다.
-->

## 현황 범례 (Status Legend)

| 뱃지 | 의미 |
|------|------|
| ✅ | 구현됨 — SOT와 일치 |
| 🚧 | 부분 구현 / advisory (계산은 되나 결정에 영향 약함) |
| 💀 | 미구현 / 죽은 코드 (정의는 있으나 실행 경로에서 안 씀) |
| 📄 | 설계만 존재 — 코드 없음 |
| ❓ | 미확인 — 코드 대조 필요 |

**문서 메타:** 현재 저장소 코드 대조 2026-07-14 · 최초 통합 2026-07 · 통합 출처 `docs/engine/legacy/01~31_*.md` (v1.0.0~v1.1.0 혼재 원본 28개, 1차 백업 보존)

**폴더 구조:** `SOT.md`(이 문서, 유일 SOT) · `legacy/`(원본 28개 백업) · `reference/`(SOT에 담기엔 방대한 현재-엔진 심화, 필요 시)

---

## 0. 목표 & 비전

### 0.1 이 엔진이 하는 일
Haggle 협상 엔진은 **AI 에이전트가 사람 대신 가격을 협상**하도록 만드는 계산·의사결정 코어입니다. 판매자/구매자가 각자의 목표가·마지노선·성향을 설정하면, 에이전트가 상대와 라운드를 주고받으며 **양쪽에 공정한 합의점**을 찾습니다.

### 0.2 설계 철학 (이상형)
1. **결정론** — 동일 입력 → 동일 출력. 난수 없음.
2. **제한된 출력** — 모든 효용 차원 `V ∈ [0,1]`, `U_total ∈ [0,1]`.
3. **역할 대칭** — 구매자/판매자 수식 구조 동일, 파라미터 방향만 반대.
4. **양쪽 공정** — 구매자 AI ≠ 플랫폼 AI. 크로스프레셔도 실제 BATNA만 사용, 허위 금지.
5. **저비용** — Codec 압축 + DeepSeek V4 Pro. 고정 비용을 가정하지 않고 실측 token/latency와 설정된 모델 단가로 관리.
6. **Stateless 엔진** — 수평 확장 가능.

> **현황 총평:** 🚧 위 철학 중 *결정론·제한출력·역할대칭*은 순수 수학 레이어(`engine-core`)에서 지켜지나, 그 레이어가 **프로덕션 결정 경로에서 우회**되어 있습니다(§1.3). 실제 결정은 LLM이 내리고 엔진은 보조(추천가·검증)만 합니다. 이 괴리가 이 문서 전반의 핵심 known issue입니다.

---

## 1. 아키텍처

### 1.1 이상형 — 4계층 Skills 아키텍처
```
L0 Gateway   외부 프로토콜/채널 어댑터 (MCP·REST·AP2 / Web·WhatsApp) + 인증·제한
L1 Skill     비즈니스 로직 오케스트레이션 (DB/API/LLM 접근 가능, 이벤트버스)
L2 Engine    순수 수학 (DB/API/LLM 호출 금지, 외부 의존성 0, ~200μs/계산)
L3 Wire+Data 프로토콜 직렬화(HNP) + Redis(hot) / PostgreSQL(cold)
```
엔진 코어(L2)는 효용 계산기 · 의사결정기 · 양보 곡선 · 상대 모델 · 일괄 평가기로 구성되며, **"LLM은 협상가, 엔진은 심판(Referee)"** 이 v2.0 설계의 핵심 비유입니다.

### 1.2 이상형 — 실행 파이프라인 (v2.0)
매 라운드 **6-Stage**를 돕니다. LLM이 2개 스테이지(Understand·Decide)를 담당하고, 엔진은 Validate에서 검증·교정합니다.
```
1 UNDERSTAND [LLM]  상대 제안 해석
2 CONTEXT    [Code] 메모리+코칭+스킬 조립
3 DECIDE     [LLM]  의사결정 + 역제안 생성
4 VALIDATE   [Code] Referee 검증·교정
5 RESPOND    [Code] 구조화 메시지 렌더
6 PERSIST    [Code] 상태 저장
```

### 1.3 현황 — 실제 실행 경로 ✅ (경로) / 🚧 (역할 분담)
프로덕션 라운드는 **단일 경로**로만 실행됩니다. 여러 진입점이 모두 하나의 executor로 수렴:
```
POST /negotiations/start · /sessions/:id/offers · MCP haggle_submit_offer
  → getExecutor()                       lib/executor-factory.ts
  → executeStagedNegotiationRound        negotiation/pipeline/executor.ts (DB 트랜잭션)
      ├ reconstructCoreMemory            상태 → 라운드 작업본
      ├ computeCoachingAsync             추천가·유틸 스냅샷 (referee/coach.ts)
      └ executePipeline                  6-Stage (pipeline/pipeline.ts)
            └ decide → LLM(DeepSeek V4 Pro)이 최종 가격·메시지 작성
```
- ✅ 6-Stage 파이프라인은 실제로 구현·가동 (프로덕션 유일 경로).
- ✅ Stage 1 Understand: 설계는 LLM 파싱이나 **현재는 정규식/휴리스틱**. 구조화 오퍼(숫자)면 우회. → 라운드당 실제 LLM 콜은 **Stage 3 Decide 최대 1회**.

### 1.4 현황 — known issue: 엔진 코어 우회 🚧
- `engine-core`의 `computeUtility`/`makeDecision`(4D 효용 → ACCEPT/REJECT)과 `engine-session`의 `executeRound`는 **데모·CLI·테스트 전용**입니다. `executor-factory.ts` 주석에 명시, 어떤 프로덕션 라우트도 호출 안 함.
- 단, **가격 계산 함수**(`computeCounterOffer`, Faratin)는 engine-core 것을 코치가 import해 씀 → "엔진이 죽음"이 아니라 **"엔진의 의사결정 경로가 죽음"**이 정확.
- **할 일:** 엔진 코어를 권위 있는 advisory로 다시 결정 경로에 연결할지 결정 (§5.5, §11 참조).

---

## 2. 상태 모델

### 2.1 이상형 — 하나의 제품 = 하나의 전략
반복 선호는 사용자 메모리에 저장하고, **실제 협상 시작 시에만** 메모리 + 리스팅 데이터를 결합해 Master Strategy 스냅샷을 컴파일합니다. 같은 전략이 여러 세션에 공유되며, 세션마다 상대 정보가 달라 세션별 컨텍스트가 다르게 생성됩니다.

### 2.2 현황 — 실제 4계층 ✅
```
① EngineParameters   재사용 성향 폼 (가격 없음)
   negotiation_agents 테이블            shared/agent-stats/types.ts
        │ 협상 시작 시 compile (+리스팅 가격/마감)
        ▼
② MasterStrategy     성향 + 이 거래의 p_target/p_limit/t_deadline
   = negotiation_sessions.negotiationAgentSnapshot (jsonb, notNull)
   engine-session/strategy/types.ts
        ▼
③ negotiation_sessions (row 전체) ★ 살아있는 협상 상태
   db/schema/negotiation-sessions.ts
   status·phase·currentRound·roundsNoConcession·lastOfferPriceMinor·
   lastUtility·coachingSnapshot·opponentModel·coreMemorySnapshot·memoHash…
        │ 매 라운드 재구성
        ▼
④ CoreMemory         라운드 작업 메모리 (영속 아님, 매 라운드 조립)
   negotiation/types.ts · memory-reconstructor.ts
   session·boundaries·terms·coaching·buddy_dna·strategy_context·
   strategy_params·listing_context·competition
        ▼
   StrategyParams = { beta, alpha, anchor_ratio, v_t_floor, u_threshold, u_aspiration, weights }
   ← 결정 로직이 실제로 읽는 서브셋
```
- ✅ `EngineParameters`는 상태 계층의 **최하단 입력 한 조각**. 진짜 "살아있는 상태"는 ③ `negotiation_sessions` row.
- ✅ CoreMemory는 영속 아님 — 스냅샷 + 라운드 로그 + 코칭으로 매번 재조립.

### 2.3 현황 — known issue
- 🚧 `terms.active`는 항상 `[]` — 다중 Term 협상 미구현(§6.5).
- 🚧 **IMEI/아이폰 하드코딩 (단순 예시가 아니라 기본 스킬 자체)** — 기본 엔진 스킬 id가 `"electronics-iphone-pro-v1"`(`default-engine-skill.ts:15`)이고 `IMEI_REQUIRED` 규칙·"IMEI and Find My verification are deal-breakers"가 내장(`:23,:40`). `standard-terms.ts:100`의 `imei_verification`은 "Required for **all** transactions", `understand.ts`는 IMEI 확인 질문. `skill_summary`·L5 category `"electronics"`도 하드코딩. → **어떤 카테고리를 팔든 기본 스킬이 아이폰 스킬이라 IMEI 규칙이 딸려 들어옴.** Tag Garden 일반화 설계를 이 하드코딩 기본 스킬이 우회. (출처: 팀 리뷰 로그 F7)
- 🔎 `opponent_offer` 2단계: `reconstructCoreMemory`가 일단 `coaching.recommended_price`(플레이스홀더)로 채우고 executor가 즉시 실제 offer로 덮어씀(`executor.ts:222`).

### 2.4 현황 — 컴파일러 (① → ②) ✅ `engine-session/strategy/compiler.ts`
`compileNegotiationAgentSnapshot(params, listing)` — 협상 시작 시 성향 폼 + 리스팅을 MasterStrategy 스냅샷으로 합침.
- ✅ **성향은 그대로 통과(verbatim)** — stat→param 수식 없음(구 5-stat/8-stat 제거의 결과). beta·anchor_ratio·weights·u_threshold·u_aspiration·alpha·v_t_floor·w_rep·v_s_base·n_threshold·gamma·late_round_aggression_modifier를 스냅샷에 충실히 기록.
- ✅ 리스팅에서 붙는 것: `p_target`/`p_limit`(역할별 방향 보정 — SELLER `min(target,floor)`, BUYER `max`), `t_deadline`(마감 없으면 기본 7일 `DEFAULT_WINDOW_MS`), `time_value`, `thresholds`(accept=u_aspiration, counter=u_threshold, reject=u_threshold−0.25, near_deal=u_aspiration−0.06), `w_info=1−w_rep`.
- ⚠️ **중요한 뉘앙스:** 컴파일러는 파라미터를 잃지 않습니다. **손실은 하위에서** — `memory-reconstructor`의 `extractStrategyParams`가 7개(beta·alpha·anchor_ratio·v_t_floor·u_threshold·u_aspiration·weights)만 뽑고, 그중 결정이 읽는 건 beta·anchor_ratio뿐(§4.2). 즉 "컴파일러는 충실, 소비처가 빈약".
- 💀 `market_utilization`·`cross_pressure_sensitivity`·`r_score_minimum`·`i_completeness_minimum`는 `EngineParamsInput` 타입에 **아예 없음** → 컴파일러에 도달조차 안 함(API `ENGINE_PARAM_KEYS` 화이트리스트에서 탈락).

---

## 3. 상태 머신

### 3.1 이상형
협상은 국면(phase)에 따라 앵커링·양보·확정으로 진행되고, 세션은 생성→진행→(교착)→합의/만료의 생명주기를 가집니다.

### 3.2 현황 — 두 개의 독립 축 ✅
`negotiation_sessions`에 상태 컬럼이 **둘** 있습니다. 서로 다른 질문에 답합니다.

**(a) `phase` — 협상 국면 (5단계, 이벤트 기반)** `phase/phase-machine.ts`
```
DISCOVERY (건너뜀) →(INITIAL_OFFER_MADE)→ OPENING
  →(COUNTER_OFFER_MADE)→ BARGAINING →(NEAR_DEAL_DETECTED)→ CLOSING
  →(BOTH_CONFIRMED)→ SETTLEMENT (종단)
역행: BARGAINING/CLOSING → REVERT_REQUESTED · 모든 국면 ABORT → SETTLEMENT
```

**(b) `status` — 세션 생명주기 (11 enum)** 저장 시 `phaseToDbStatus(phase, action, roundsNoConcession)`로 도출:
```
REJECT → REJECTED · ACCEPT/CONFIRM → ACCEPTED (국면 무관 종단)
OPENING → ACTIVE
BARGAINING: HOLD→WAITING / roundsNoConcession≥4→STALLED / 그외→ACTIVE
CLOSING → NEAR_DEAL
```
enum 전체: CREATED·ACTIVE·NEAR_DEAL·STALLED·ACCEPTED·REJECTED·EXPIRED·SUPERSEDED·WAITING·NEGOTIATING_VERSION·FAILED_COMPATIBILITY

- ✅ **phase = "어느 단계냐", status = "살아있냐/멈췄냐/끝났냐".** 잇는 함수: `inferPhaseFromStatus`(읽기)·`phaseToDbStatus`(쓰기).
- 🚧 DISCOVERY는 우회 (CREATED→OPENING 직행).
- ❓ `NEGOTIATING_VERSION`·`FAILED_COMPATIBILITY` 실제 사용 경로 미확인.

---

## 4. 파라미터 (EngineParameters)

### 4.1 이상형
에이전트 "성향"을 표현하는 단일 폼. 4D 효용 가중치 + 행동 곡선들로, 프리셋·Advanced 슬라이더·빌더 챗이 무엇을 채우든 결국 이 폼으로 모입니다. 각 필드가 협상 행동(양보 속도·앵커·수락 기준·리스크 태도)을 조율해야 합니다.

> **개념 정리 — 축 vs 성향 vs 상황 (헷갈리기 쉬움).** 세 층이 서로 다른 종류다:
> - **4개 축(차원)** — 가격·시간·위험·관계. 딜을 평가하는 *기준*(고정).
> - **17개 파라미터** — 내 *성향*: 각 축을 얼마나 중시(가중치 w)/어떻게 채점하나. 에이전트 생성 시 고정.
> - **컨텍스트** — 이 딜의 *상황·사실*(상대 오퍼·마감·신뢰…). **매 라운드** 바뀜.
>
> `U_total = w_p·V_p + w_t·V_t + w_r·V_r + w_s·V_s`. **"17→4로 좁혀진다"가 아니라 17개 성향이 4개 축에 배분**된다 — 가격축(`anchor_ratio`·`gamma`) · 시간축(`alpha`·`v_t_floor`) · 위험축(`w_rep`·`w_info`) · 관계축(`v_s_base`·`n_threshold`) + 4개 가중치. `beta`·`u_threshold`·`u_aspiration`은 축이 아니라 "언제 양보/수락"의 전역 손잡이. → 태그에서 들어오는 조건은 **값 조정(가격축 입력) / 새 Term 축(§6.5) / 게이트(정보성)** 셋 중 하나로 분류해 꽂는다.

### 4.2 현황 — known issue: 17개 중 2개만 실제 작동 🚧
저장소 전체 grep 검증 결과, `strategy_params`의 개별 필드를 읽는 런타임 코드는 이것뿐:
```
default-engine-skill.ts:75   strategy_params?.anchor_ratio
default-engine-skill.ts:99   strategy_params?.beta
coach.ts:101 / :115          params?.anchor_ratio / params?.beta
```

| 필드 | 상태 | 실제 영향 |
|------|------|-----------|
| `beta` | ✅ 가격 | Faratin 양보 속도 → BARGAINING 추천가 |
| `anchor_ratio` | ✅ 가격 | OPENING 앵커 마진 `(1-ratio)*0.2` |
| `weights` (w_p/w_t/w_r/w_s) | 🚧 무시 | coach `u_total`이 **하드코딩 가중치 0.5/0.2/0.15/0.15** 사용 (`coach.ts:163`) |
| `alpha` · `v_t_floor` | 🚧 미소비 | StrategyParams에 저장되나 결정 경로가 안 읽음 |
| `u_threshold` · `u_aspiration` | 🚧 미소비 | engine-core `makeDecision`(데모)만 사용 |
| `w_rep` · `w_info` · `v_s_base` · `n_threshold` · `gamma` | 🚧 미소비 | engine-core 순수함수(비활성)에서만 |
| `market_utilization` · `cross_pressure_sensitivity` · `r_score_minimum` · `i_completeness_minimum` · `late_round_aggression_modifier` | 💀 죽음 | 읽는 런타임 코드 전무. 앞 4개는 스냅샷 화이트리스트에도 없어 영속화조차 안 됨 |

> **핵심:** `beta`·`anchor_ratio`조차 최종가를 직접 정하지 않고 **LLM 프롬프트의 추천가(recommended_price) 계산 입력**입니다. LLM이 유효 가격을 반환하면 최종 COUNTER는 LLM 값으로 대체(`decide.ts:84`).

> **프롬프트에도 안 감(추가 검증):** `/start`가 스냅샷에 넣는 `agent_weights`·`agent_overrides:{alpha,u_threshold,…}`는 `strategy_context`에 저장되지만, **LLM 프롬프트 STRATEGY 블록은 이를 렌더하지 않습니다** — `encodeStrategyContext`(`deepseek-adapter.ts:380`)는 `persona` + **빌더챗 메모리(tone·dealBreakers·urgency·mustEmphasize·mustHave·avoid·notes)만** 넣음. 즉 숫자 파라미터 15개는 advisory 텍스트로도 LLM에 도달하지 않는 **죽은 데이터**. → **LLM에 실제로 닿는 유일한 전략 채널 = 빌더챗 메모리**(숫자 성향이 아님).

### 4.3 현황 — 4개 프리셋 값
`shared/agent-presets/negotiation-agent-presets.ts · preset-to-params.ts`

| 필드 | hunter 🎯 | closer ⚡ | verifier 🔍 | balancer ⚖️ |
|------|-----------|-----------|-------------|-------------|
| w_p/w_t/w_r/w_s | .5/.15/.2/.15 | .2/.5/.15/.15 | .25/.2/.4/.15 | .3/.25/.25/.2 |
| **beta** | **0.4** | **2.0** | 1.0 | 1.0 |
| alpha | 0.5 | 2.0 | 1.0 | 1.0 |
| **anchor_ratio** | 0.5 | 0.85 | 0.7 | 0.7 |
| u_threshold | 0.55 | 0.4 | 0.6 | 0.5 |
| u_aspiration | 0.7 | 0.55 | 0.75 | 0.65 |
| v_t_floor | 0.7 | 0.3 | 0.55 | 0.5 |
| n_threshold | 12 | 10 | 12 | 10 |

### 4.4 할 일 — 미사용 필드를 살리는 법
관여시킬 지점은 둘: **(A)** LLM 프롬프트로 가는 추천가·유틸, **(B)** LLM이 못 뒤집는 룰/레퍼리 게이트.

| 필드 | 방법 | 난이도 |
|------|------|--------|
| weights | `coach.ts:163` 하드코딩 → `params.weights`. **단, 프로덕션 프롬프트는 utility를 안 실음(§5.4) → 프롬프트에도 추가해야 실제 효과** | 🟢이나 헛수고 주의 |
| alpha·v_t_floor | `V_t = max(v_t_floor, (1−time_pressure)^alpha)`로 recommended_price 곡선에 접기 (검증된 채널) | 🟡 |
| u_threshold·u_aspiration | decide/룰에서 `u_total`과 비교해 ACCEPT/NEAR_DEAL/COUNTER 게이트 | 🟡 리스크 |
| w_rep·v_s_base·gamma… | V_r·V_s·경쟁 계산해 유틸 주입 (r_score/관계 데이터 배선 필요) | 🟠 |
| **근본** | 매 라운드 `NegotiationContext` 조립 → engine-core `computeUtility`/`makeDecision` advisory 호출 → **17개 필드 전부 자동 활성** | 🟠 |

---

## 5. 라운드 파이프라인 (6-Stage)

### 5.0 현황 — 실행 모드: 두 개의 진입점 ★ `routes/negotiations.ts`
협상을 시작하는 경로가 **둘**이며, 프로덕션 제품 흐름은 첫 번째입니다.

**(A) `POST /negotiations/start` — AI-vs-AI 자동재생 (buyer-landing 실제 흐름)** `:931`
- 구매자 **AND** 판매자 **양쪽 스냅샷을 컴파일**(`:1018`·`:1038`)한 뒤, `for (i<AUTO_PLAY_MAX_ROUNDS)` 루프(`:1099`)에서 **매 라운드 `setSessionPerspective`로 역할·스냅샷을 교체**(`:1104`)하며 executor를 번갈아 호출.
- **협상 전체를 한 HTTP 요청에서 서버가 자동으로 끝까지 재생.** 양쪽 다 Haggle AI 에이전트 — 사람이 라운드마다 개입하지 않음. 이전 라운드의 메시지를 다음 입력으로 전달(대화 연속성), 터미널/REJECT/무효가격에서 중단.
- ⚠️ **이게 제품의 실제 형태:** "사람 vs AI가 시간을 두고 주고받는" 게 아니라 **AI 양측이 즉시 자동 협상**하고 결과(합의/결렬)를 반환.

**(B) `POST /negotiations/sessions/:id/offers` — 단건 오퍼 (외부/HNP 에이전트)** `:429`
- 외부에서 오퍼 하나를 제출하면 executor가 **한 라운드**만 실행. HNP/agent-delegation 검증 경유. 세션이 그룹 소속이면 라운드 후 그룹 오케스트레이션 호출(§9).

두 경로 모두 아래 §5.1 executor 한 라운드를 공유합니다. §5.1~5.5는 "한 라운드"의 내부입니다.

### 5.1 현황 — executor 실행 흐름 ✅
`executeStagedNegotiationRound`이 DB 트랜잭션 안에서:
```
1  세션 로드 (version 락)
2b 만료 체크 → EXPIRED, throw
2c 라운드 한도(기본 15) 초과 → REJECTED, throw
3  멱등성 체크 (idempotencyKey)
4  라운드 로그 → reconstructRoundFacts → reconstructOpponentPattern(EMA α=0.3)
   → computeCoachingAsync(DB trust score) → reconstructCoreMemory → computeBriefing
   → updatedMemory: boundaries.opponent_offer = 실제 들어온 offer로 덮어씀
5  스크리닝 (trust+가격편차 스팸) → 스팸이면 persistSpamRound
6  phase 감지: NEAR_DEAL은 round≥3 & gap/(target-floor)<5%에서만 → tryTransition
7  개입 체크 (intervention_mode) → auto 아니면 persistHoldRound (WAITING)
8  L5 시장 시그널 fetch (category 하드코딩 "electronics")
9  executePipeline (6-Stage)
```

### 5.2 현황 — 6-Stage ✅ `pipeline/pipeline.ts`
| # | 단계 | 담당 | 내용 |
|---|------|------|------|
| 1 | Understand | 규칙 | 구조화 오퍼면 `understandFromStructured` 우회(LLM 미호출). 자유텍스트는 정규식 price·action·sentiment + **대화신호 추출·대화유형 분류·missing-info 추론(tag-garden 질문)** (LLM 없이) |
| 2 | Context | 코드 | CoreMemory → 압축 컨텍스트 + memo codec + Skill hook dispatch |
| 3 | Decide | **LLM** | 룰 baseline(`DefaultEngineSkill`) → OPENING/BARGAINING COUNTER면 LLM이 실제 가격·메시지. **라운드당 유일 LLM 콜** |
| 4 | Validate | 코드 | Referee 규칙 검증 + auto-fix |
| 5 | Respond | 코드 | 메시지 렌더 (가격 개입 없음 — lock 아님, §5.5). LLM 메시지에 **인젝션 sanitization**(600자·jailbreak 패턴 차단, `respond.ts:114`) 후 통과 시 상대에게 전달, 실패 시 템플릿 |
| 6 | Persist | 코드 | 라운드 저장(append-only) + phase 전이 + memo SHA-256 |

### 5.3 현황 — Coach vs Briefing 🚧 `referee/coach.ts · briefing.ts`
executor는 매 라운드 **coach와 briefing을 둘 다** 호출하며, 역할이 다릅니다:
- **coach (`@deprecated` 딱지지만 여전히 LIVE)** → `memory.coaching`으로 들어가 **LLM 프롬프트의 `recommended_price` 앵커를 공급**(`decide.ts` → `deepseek-adapter.ts:205`). 즉 실제 가격 추천의 원천. **"briefing이 coach를 대체" 설계는 미완성** — `@deprecated`는 오해를 부르는 상태.
  - ✅ phase별 recommended_price: OPENING `target×(1±margin)`(margin=anchor_ratio 기반) · BARGAINING Faratin(`p_start:target,p_limit:floor,t=time_pressure||round/max,beta`) · CLOSING 확정가.
- **briefing (facts-only)** → `context.briefing`으로 들어가 **(a) reasoning 모드 판단**(`shouldUseReasoning`, `decide.ts:47`) **(b) Validate 스테이지**에만 쓰임. 가격 앵커 아님.
- ⚠️ **utility_snapshot이 두 곳에서 서로 다른 하드코딩 가중치로 중복 계산** — coach(`0.5/0.2/0.15/0.15`, `coach.ts:163`)·briefing(`0.5/0.2/0.3`, `briefing.ts:63`). 둘 다 사용자 weights 무시. coach만 trust score를 u_risk로 반영, briefing은 u_risk=0.5 고정.

### 5.4 현황 — LLM Decide & 프롬프트 🚧 `stages/decide.ts · adapters/deepseek-adapter.ts`
- ✅ executor는 **`DeepSeekAdapter`를 고정 사용**(`executor.ts:70`). 클라이언트는 OpenAI-compatible DeepSeek 엔드포인트(`api.deepseek.com/v1`)와 `DEEPSEEK_API_KEY`, `process.env.DEEPSEEK_MODEL ?? 'deepseek-v4-pro'`를 사용(`deepseek-client.ts:49-62`).
- ✅ 프로덕션 프롬프트 `C:` 라인은 `rec$..|tactic|opp|conv|tp`만 실음 — **`recommended_price`만 하드 앵커, utility_snapshot/weights는 미도달**(`deepseek-adapter.ts:205`).
- ✅ decide 흐름: `skill.evaluateOffer`(룰 baseline) → **OPENING/BARGAINING의 COUNTER**면 LLM 증강. LLM이 유효 COUNTER 가격(또는 ACCEPT/REJECT/HOLD) 반환 시 대체, 실패 시 룰 결정 fallback(`decide.ts:84-96`).
- 🎯 **ACCEPT를 유도하는 실제 gap 휴리스틱 = `encodeClosingHint`**(`deepseek-adapter.ts:317`): 서버가 gap 비율을 계산해 **gap<5% 또는 <$5 → "이건 사실상 딜, ACCEPT하라"**, gap<10%+종반 → "ACCEPT 강하게 고려"를 프롬프트에 직접 주입. 시스템 프롬프트의 추상 규칙을 서버가 숫자로 못박음.
- 🔎 프롬프트 STRATEGY 블록 = persona + **빌더챗 메모리만**(숫자 파라미터 미도달, §4.2). `encodeDelta`(차등 컨텍스트)는 decide 경로에서 **죽은 코드**(`prevMemory=undefined`로 호출 → 항상 full).

### 5.5 현황 — Referee / Validate 🚧 `referee/validator.ts` → 상세 [`reference/referee.md`](./reference/referee.md)
- ✅ 7규칙 실제 가동. V1~V3 HARD(V1 가격 floor 초과→floor / V2 phase 미허용 action→allowed[0] / V3 라운드소진 COUNTER→REJECT), V4~V7 SOFT(역전·정체·일방양보·양보폭과다, auto-fix 없음).
- ⚠️ **HARD도 실제로는 차단 안 됨** — auto-fix `MAX_RETRY=2` 후 위반 남아도 그대로 통과. `'BLOCK'`은 감사 라벨일 뿐 실행 미차단.
- ⚠️ **"가격 lock" 없음** — `respond.ts`에 clamp/lock 전무. 코드의 유일한 가격 개입은 V1 위반 시 floor 덮어쓰기(soft, 2회). 최종가는 결국 LLM/skill `decision.price`.
- 💀 `ViolationTracker`(세션 위반 누적·lite 모드 전환) 미사용 → 항상 `full`. 🚧 Stage 4.5 skill validate hook은 로깅만("Future: merge").

---

## 6. 협상의 수학

### 6.1 효용 함수 U_total
**이상형:**
```
U_total = w_p·V_p + w_t·V_t + w_r·V_r + w_s·V_s      (Σw=1, 각 V∈[0,1])
V_p(seller) = clamp( ln(offer−floor+1) / ln(target−floor+1), 0, 1 )   ← 로그: 한계효용 체감
V_r = w_rep·r_score + w_info·i_completeness
V_s = clamp( v_s_base + n_success/n_threshold − 0.3·n_dispute_losses, 0, 1 )
```
로그를 쓰는 이유: 마지노선 근처 1달러는 민감, 목표가 근처 1달러는 둔감. `V_s_base=0.5`로 초면을 중립 처리.

**현황:** 🚧 advisory. engine-core에 정확히 구현돼 있으나 **프로덕션 결정엔 미사용**. 코치는 단순화된 `u_price·0.5 + u_time·0.2 + u_risk·0.15 + u_quality·0.15`(하드코딩)만 계산하고, 그마저 프롬프트에 안 실림(§5.4).
**할 일:** §4.4 근본 해법.

### 6.2 Faratin 양보 곡선 ✅ (가격 결정 핵심)
**이상형:**
```
P(t) = P_start + (P_limit − P_start) × (t/T)^(1/β)      t/T는 [0,1] clamp
β<1 Boulware(초반 버티다 막판 양보) · β=1 선형 · β>1 Conceder(초반 급양보)
```
확장(설계): 효용공간 역산(`use_utility_space`), 동적 β(경쟁 κ·상대반응 λ), AC_next 즉시수락, 후반 라운드 공격 완화.

**현황:**
- ✅ price-space `computeCounterOffer` 구현·가동 (`engine-core/decision/faratin.ts`), 코치·룰이 β와 함께 사용.
- 🚧 `t`는 실경과시간이 아니라 `time_pressure || round/max_rounds`(라운드 비율 근사).
- 💀 효용공간 역산 · 동적 β · AC_next · 후반 완화: **미구현.** β 고정.

### 6.3 시간 효용 V_t & 시간 압박
**이상형:** `V_t = max(v_t_floor, (1 − t_elapsed/t_deadline)^α)`. urgency enum이 아니라 **실제 마감시각(UTC) 연속 계산**이 표준. α=곡선모양, v_t_floor=바닥.
**현황:** 🚧 `computeSessionTimePressure`가 `created_at_ms`/`deadline_at_ms`에서 time_pressure를 계산하지만, **α·v_t_floor 파라미터는 안 쓰임**(선형). time_pressure는 recommended_price의 `t`로만 흘러감.

### 6.4 상대방 모델 ✅ (EMA만)
**이상형:** EMA 양보율(Layer1) + 베이지안 추정(Layer2, β·Term 가중치) + Reputation 사전분포 + 6종 이동분류(Jonker).
**현황:**
- ✅ EMA만: `ema ← 0.3·observed + 0.7·ema`, `aggression = ema<0.005?0.8 : ema>0.05?0.2 : 0.5`, pattern = BOULWARE/LINEAR/CONCEDER. 2라운드부터. (`memory-reconstructor.ts` · `coach.ts:classifyOpponent`)
- 📄 베이지안·6종 분류·Reputation prior: **코드 없음.**

### 6.5 다중 Term (term_space)
**이상형:** 가격 외 조건(배송·보증 등)을 NEGOTIABLE/INFORMATIONAL Term으로 다차원 협상. Offer Inverter가 U_target → Term 값 조합 역산.
**현황:** 🚧 `terms.active` 항상 `[]`. 단일 가격 Term만. Offer Inverter 미구현.

---

## 7. 의사결정 전술

### 7.1 이상형 — 규칙 (우선순위 순)
```
0. 처리불가 요소(번들/조건부/트레이드인) → ESCALATE
1. u_total ≥ U_aspiration → ACCEPT
2. u_total ≥ U_threshold & 마감임박(V_t<0.1) → ACCEPT
3. u_total ≥ U_threshold → NEAR_DEAL
4. u_total > 0 → COUNTER (Faratin 역제안)
5. u_total ≤ 0 → REJECT
6. rounds_no_concession ≥ 4 → ESCALATE (교착)
7. 마감임박 & 합의불가 → ESCALATE
```
전술 엔진(설계): 미러링, 상대패턴×단계 매트릭스.

**현황:** 🚧 위 규칙은 engine-core `makeDecision`(비활성 경로)에 있음. **프로덕션 ACCEPT/REJECT는 LLM**이 내리되, **gap 휴리스틱은 서버가 `encodeClosingHint`로 프롬프트에 주입**(gap<5%/<$5→"ACCEPT하라", §5.4)해 유도. `u_total` 기반 임계 게이트는 실제로 안 돎(u_threshold/u_aspiration 미소비). 코치가 `suggested_tactic`(nibble/anchoring/reciprocal_concession 등)을 파생해 프롬프트로 전달하나 강제력 없음. 전술 매트릭스·미러링 미구현. 시스템 프롬프트에 역할별 강제 규칙(구매자는 자기 이전 제안보다 낮게 못 부름, 판매자는 floor 밑 금지)이 있음.

---

## 8. LLM 통합

**이상형:** 필요한 단계에만 LLM을 호출하고 Codec 압축으로 토큰을 최소화한다. 비용은 고정값이 아니라 provider usage와 적용 단가로 측정한다.
**현황:**
- 💀 **"라운드당 2회"는 틀림 → 실제 1회(Decide만).** Understand·Validate는 규칙, **Respond는 템플릿**(`executor.ts:104` `RESPOND:"template"`)이라 LLM 미호출. pipeline의 respond 토큰 합산은 항상 0(죽은 코드).
- ✅ DeepSeek V4 Pro 기본 모델. 일반 모드는 30초/temperature 0.5, reasoning 요청 모드는 45초/temperature 0.3이다. ⚠️ 현재 reasoning은 별도 provider reasoning parameter가 아니라 이 timeout/temperature 정책과 `reasoning_used` 표시다(`deepseek-client.ts:54-55,121-130`).
- ✅ 프롬프트용 `S:/B:/C:` 압축은 `deepseek-adapter.ts:205`의 `encodeCoreMemoCompact`. (별개로 `memo-codec.ts`의 `NS:/PT:…`는 **해시 전용**이고 프롬프트에 안 쓰임 — `context.ts`의 `memo_snapshot`은 dead field.)
- ✅ 토큰은 DeepSeek API 실측(`usage.prompt_tokens/completion_tokens`) → 라운드별 `negotiation_rounds.llm_tokens_used` 저장. latency와 token usage는 telemetry에도 수집된다.
- 🚧 **정확한 USD 비용은 단가 설정이 필요** — `LLM_PRICE_DEEPSEEK_V4_PRO_INPUT_PER_1M_USD`와 `LLM_PRICE_DEEPSEEK_V4_PRO_OUTPUT_PER_1M_USD`(또는 global 가격 env)가 모두 있어야 telemetry cost가 계산된다. 미설정 시 null이다. pipeline의 `tokens/1000 × 0.0007`은 입출력 미분리 러프 추정이며 DB에 저장되지 않는다.
- 🚧 **세션당 정확 비용 집계 없음** — `LLM_TELEMETRY=db`에서 호출별 row는 저장하지만 세션 합계 read model이 없다. DB telemetry의 `reasoningUsed`도 현재 false로 고정되어 실제 요청 모드와 어긋날 수 있다.

---

## 9. 토폴로지 & 크로스프레셔 (1:N)

**이상형:** 1:N(구매자1·판매자N) 병렬 협상. `batchEvaluate`로 Top N 세션 선정, 나머지 WAITING. 한 세션 ACCEPTED 시 나머지 SUPERSEDED. 크로스프레셔로 BATNA만 주입(허위 금지, 세션당 최대 2회, 차이<5%면 미주입). Anti-Sniping(N:1).
**현황 — 완성돼 있으나 실전 흐름에서 도달 불가 (dormant):**
1:N 서브시스템(엔진·DB·전용 라우트)은 배선돼 있으나, **프로덕션 진입점 `POST /negotiations/start`가 그룹을 생성하지 않습니다**(`createSession`을 `groupId` 없이 호출, `negotiations.ts:1079`). 그룹은 수동 `POST /negotiations/groups`(`routes/groups.ts:49`)로만 생성되며 웹앱은 이를 호출 안 함.
- 💀 `batchEvaluate` — Top N 일괄평가. 프로덕션 호출자 **0건**(테스트뿐). `engine-core/batch/evaluator.ts`.
- 💀 **크로스프레셔/BATNA dead branch** — 소비 코드는 있으나(coach·adapter·utility) **`memory.competition`이 절대 채워지지 않음**(memory-reconstructor 미설정, L5 provider가 competition 미반환 `"Not implemented in Phase 0"`). `adjustVpForCompetition`도 항상 no-op.
- 🚧 supersede — `group-executor.ts:124` 구현됐으나 `if(session.groupId)` 가드 뒤(그룹 세션만 도달).
- 🚧 `compareSessions` — 그룹 오케스트레이터에서만 호출(도달 불가 경로). `selectBestOffer`는 심볼 부재.
- ❓→💀 Anti-Sniping — 협상 데드라인 연장 로직 **코드에 없음**.

---

## 10. 데이터 영속화

**현황 ✅** `db/schema/negotiation-sessions.ts`
- `negotiation_sessions` — 세션 상태 + 스냅샷 + 데이터모트 컬럼(outcome·priceTrajectory·opponentModel·coreMemorySnapshot·memoHash·sessionFactChainHash…)
- `negotiation_rounds` — append-only 라운드 로그 (utility·coaching·validation·referee_violations·coach_recommended·deviation…)
- `negotiation_groups` — 1:N 컨테이너
- 💀 **Memo/체인 무결성 = write-only, 검증 안 됨.** SHA-256 memo 해시(shared 레이어만, `memo-manager.ts`)와 Level-2 해시체인(`sha256(payload+prev)`, GENESIS 시작, `integrity/hash-chain.ts`)을 생성·저장(`checkpoints.memo_hash`, `sessions.session_fact_chain_hash`)하나, **저장 후 재계산·비교하는 런타임 경로가 없음.** `verifyMemoIntegrity`·`verifyChain` 둘 다 호출자는 테스트뿐. 온체인 앵커(Level 3)는 주석만, 미구현. → 실질 tamper-detection 미작동.

---

## 11. 종합 백로그 (SOT ↔ 현황 갭)

### 🧭 열린 설계 결정 — 가격·수락 결정을 LLM 대신 엔진이 하게 할까? (미결정, 하이브리드로 기울음)
> 출처: 팀 리뷰 로그 F0/F4/F5 (2026-07). SOT §0.2 철학 vs §1.4/§5.4 현황의 충돌 지점.

**"가격은 LLM이 정한다"(§1.4·§5.4)는 *현재 구현*일 뿐, 지켜야 할 *원칙*이 아니다.** LLM이 최종가를 정하면 모델·요청마다 금액이 흔들려 Haggle의 결정론·공정·감사가능 철학(§0.2)과 충돌. 선택지 3:
- **(A) advisory 배선** — 숫자 파라미터를 코치·프롬프트에 연결. LLM 결정 구조 유지. *(약함 — LLM이 여전히 최종가)*
- **(B) 엔진 뇌 복귀** — `makeDecision`을 결정 경로로. 17개 필드 활성.
- **(C) 현행 인정** — "LLM + 빌더메모리 + beta/anchor 2개"를 진짜 설계로.

**정착 방향(Jongwoo 기울음) = 하이브리드(B 변형):** *엔진이 가격·수락을 결정(권위) + LLM은 언어·비가격 지렛대·통역.* 구현 라드 = **센서/통역(LLM) → 판사(엔진) → 작가(LLM)**: ① LLM이 자연어를 엔진이 아는 수치·태그로 통역 → ② 엔진이 결정론적으로 가격·수락 결정(가격 clamp) → ③ LLM이 그 가격을 자연스럽게 포장. 파이프라인 슬롯(Stage 1 Understand=센서, Stage 3 Decide=판사, Stage 5 Respond=작가)이 이미 존재 → 새 아키텍처가 아니라 **결정 권한을 Stage 3 LLM→엔진으로 이동 + Stage 1 특징추출 강화 + Stage 5 clamp**. 대가 = 엔진이 자연어 주장·비가격 term·경매 상황을 다루려면 **상대모델(백로그#4)·multi-term(#6)** 필요.

우선순위는 "실제 협상 품질에 미치는 영향" 기준.

| # | 갭 | 현재 | 목표(SOT) | 규모 |
|---|-----|------|-----------|------|
| 1 | 파라미터 사장 | beta·anchor_ratio만 작동 | 17개 필드 협상에 관여 | 🟠 (근본: engine-core 재연결) |
| 2 | 효용함수 미사용 | 하드코딩 u_total, 프롬프트 미도달 | 사용자 weights 반영 → 결정 | 🟡 |
| 3 | 연속 시간 미반영 | round 비율 근사 | 실 마감시각 + α·v_t_floor | 🟡 |
| 4 | 상대모델 거침 | EMA 3버킷 | 베이지안 + 6종 분류 | 🟠 |
| 5 | 동적 β 없음 | β 고정 | 경쟁·상대반응 조정 | 🟡 |
| 6 | 다중 Term 없음 | 가격 단일 | term_space + Offer Inverter | 🟠 |
| 7 | 전술/미러링 없음 | suggested_tactic 텍스트만 | 전술 매트릭스 강제 | 🟡 |
| 8 | 1:N 전체 dormant | 그룹 미생성 → 크로스프레셔·batchEvaluate·supersede·anti-sniping 도달 불가 | `/start` 그룹 생성 or 별도 트리거 | 🟠 |
| 9 | 카테고리/IMEI 하드코딩 | 기본 스킬이 `electronics-iphone-pro-v1`(IMEI_REQUIRED 내장), 카테고리 무관 적용 | 카테고리별 스킬·term 일반화 (§2.3) | 🟡 |
| 10 | Referee HARD 미차단 | 'BLOCK' 라벨뿐 통과 | HARD 실제 차단 여부 결정 | 🟡 |
| 11 | 무결성 검증 미작동 | memo/체인 해시 write-only | verify 런타임 연결 + 온체인 앵커 | 🟡 |
| 12 | 비용 계측 부분 구현 | 실측 token/latency 있음, 단가 미설정 시 비용 null, 세션 집계 없음 | DeepSeek 단가 설정 + reasoning mode 전달 + 세션 집계 | 🟢 |
| — | **조사 백로그** | 협상 엔진 주요 경로 코드 검증 **완료.** 남은 미확인 없음(신규 발견 시 추가) | — | — |

---

## 부록 A. 파일 지도

| 역할 | 파일 |
|------|------|
| 페르소나 폼 | `packages/shared/src/agent-stats/types.ts` |
| 프리셋 | `packages/shared/src/agent-presets/*` |
| 컴파일 | `packages/engine-session/src/strategy/compiler.ts` |
| 세션 스키마 | `packages/db/src/schema/negotiation-sessions.ts` |
| 실행 진입 | `apps/api/src/lib/executor-factory.ts` |
| 라운드 실행 | `apps/api/src/negotiation/pipeline/executor.ts` |
| 6-Stage | `apps/api/src/negotiation/pipeline/pipeline.ts` · `stages/*` |
| 상태머신 | `apps/api/src/negotiation/phase/phase-machine.ts` |
| 메모리 재구성 | `apps/api/src/negotiation/memory/memory-reconstructor.ts` |
| 코치·검증 | `apps/api/src/negotiation/referee/*` |
| LLM 어댑터 | `apps/api/src/negotiation/adapters/deepseek-adapter.ts` · `deepseek-client.ts` |
| Faratin | `packages/engine-core/src/decision/faratin.ts` |
| 효용 | `packages/engine-core/src/utility/*` |

## 부록 B. 용어

| 용어 | 뜻 |
|------|-----|
| EngineParameters | 재사용 성향 폼 (가격 없음) |
| MasterStrategy | 성향 + 이 거래 가격/마감 (세션 스냅샷) |
| CoreMemory | 매 라운드 재구성되는 작업 메모리 |
| StrategyParams | 결정이 실제 읽는 CoreMemory 서브셋 |
| phase / status | 협상 국면(5) / 세션 생명주기(11) |
| β (beta) | 양보 속도. 낮을수록 고집(Boulware) |
| Coach | 매 라운드 추천가(LLM 앵커) 생성 |
| Referee | LLM 결정 규칙 검증 (Validate) |
| BATNA | 최선의 대안 (크로스프레셔 주입값) |

---

*통합 출처: `docs/engine/legacy/*.md`(원본 백업) + 실제 코드 감사. 이상형은 설계 문서, 현황은 코드 대조 기준.*
