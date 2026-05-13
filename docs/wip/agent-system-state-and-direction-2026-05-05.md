# Agent System: 현 상태 진단 + 발전 방향 토론 자료

*작성: 2026-05-05 / 미팅용 / 작성자: Sean + Claude*

> **읽는 순서:** Part 1 → Part 2 → Part 3 → Part 4. Part 1이 가장 중요. 여기서 머릿속 그림 잡고 나면 나머지는 토론 자료.

---

## 한 페이지 요약 (TL;DR)

- `feature/agent-builder` rebase 깨끗하게 끝남. typecheck 30/30 통과. **충돌 0**.
- main에는 우리 노트 컨셉의 일부가 이미 구현돼 있음. **단, buyer-side만**. seller-side는 거의 빈 상태.
- 우리 작업(8-stat agent persona)은 main의 시스템과 **다른 레이어**. 충돌이 아니라 **수직으로 쌓일 수 있음**.
- 가장 큰 통합 기회: **`preset-tuning.service`의 4개 하드코딩 preset ID를 우리 8-stat 벡터로 동적 대체**.
- 노트 컨셉 4개 중 1개만 main에 정확히 매핑되고, 3개는 우리가 채우거나 인접 시스템과 다리 놓아야 함.

---

## Part 1 — 현 상태 깊이 이해

### 1.1 시스템 전체 다이어그램

```
                        ┌─────────────────────────────────┐
                        │    AGENT (앞으로 우리가 정의할)    │
                        │                                 │
                        │   • voice profile id (어떻게 말할지)│
                        │   • 8-stat vector (어떻게 협상할지) │
                        │   • category overrides (태그별 조정)│
                        └────┬────────┬────────┬───────────┘
                             │        │        │
       ┌─────────────────────┘        │        └────────────────────────┐
       ▼                              ▼                                  ▼
┌──────────────┐              ┌────────────────┐              ┌──────────────────┐
│ Lumen Voice  │              │ statsTo        │              │ Tag-specific     │
│ Profiles (12)│              │ Parameters()   │              │ weight overrides │
│ ✅ main에 있음│              │ ✅ 우리가 만듦 │              │ ❌ 미구현         │
└──────┬───────┘              └────────┬───────┘              └────────┬─────────┘
       │                               │                               │
       │  LLM 프롬프트 voice 섹션      │  EngineParameters             │  per-tag w_p,w_t,...
       │                               │                               │
       ▼                               ▼                               ▼
┌──────────────────────────────────────────────────────────────────────────────┐
│                       NEGOTIATION ENGINE PIPELINE                            │
│                                                                              │
│   engine-core (V_p, V_t, V_r, V_s)  ←────  preset-tuning.service             │
│   engine-session (assembleContext)         (priceCap, opening, walkAway 등) │
│                                                                              │
│   LLM Stage (understand → decide → render)                                   │
└──────────────────────────────────────────────────────────────────────────────┘
                                ▲                                ▲
                                │                                │
                                │                                │
                  ┌─────────────┴──────────┐         ┌───────────┴────────────┐
                  │ negotiation-readiness  │         │ user-memory-card       │
                  │ ✅ BUYER만 검증        │         │ ✅ buyer 신호 누적     │
                  │ ❌ SELLER 미구현       │         │ (price/style/...)      │
                  └─────────────┬──────────┘         └────────────────────────┘
                                │
                                │ slot 부족 시 질문 생성
                                ▼
                  ┌────────────────────────────┐
                  │  tag-garden-requirements   │
                  │  ✅ main에 있음            │
                  │                            │
                  │  3-tier slot:              │
                  │   • UNIVERSAL_BUYER_SLOTS  │
                  │   • GENERIC_REQUIREMENT    │
                  │   • TAG_REQUIREMENTS       │
                  │     (e.g. iphone slots)    │
                  └────────────────────────────┘
```

### 1.2 main에 이미 있는 5개 컴포넌트 — 한 줄씩

| 파일 | 줄수 | 역할 | 핵심 한 줄 |
|---|---|---|---|
| `apps/api/src/services/tag-garden-requirements.ts` | 518 | 태그별 정보 슬롯 정의 | iPhone → battery_health, carrier_lock, IMEI, find_my 같은 **정보 수집 질문**을 코드 상수로 보유 |
| `apps/api/src/services/preset-tuning.service.ts` | 1103 | preset → 협상 파라미터 변환 | 4개 preset ID(`safe_buyer`, `balanced_closer`, `lowest_price`, `fast_close`) + listing + memory → priceCap, opening, walkAway, leverages |
| `apps/api/src/services/user-memory-card.service.ts` | 527 | buyer 취향/제약 누적 | LLM 신호(ConversationSignal) → 6개 cardType의 strength 누적 → 다음 협상에 hint |
| `apps/api/src/services/term-intelligence.service.ts` | 133 | cross-listing term 학습 | "insured shipping", "clean IMEI" 같은 표현이 3회+ 관찰되면 OBSERVED → CANDIDATE 승격 |
| `apps/api/src/services/negotiation-readiness.service.ts` | 277 | 협상 시작 가능한지 검증 | BUYER에 한해 product_intent / budget / priority 3개 슬롯 + product identity gate 검사. **SELLER는 무조건 ready 처리 (line 43-45)** |
| `apps/api/src/negotiation/lumen-persona-profiles.ts` | 156 | LLM 발화 voice 12종 | fab/vel/judge/hark/mia/vault/dealer_kai/hana/ethan/claire/buddy_fizz/echo — 각각 voiceStyle, prompt 스니펫 |

### 1.3 우리 8-stat 시스템 — 한 줄씩

| 파일 | 역할 | 비고 |
|---|---|---|
| `packages/shared/src/agent-stats/types.ts` | 8개 stat 타입 정의, [10..90], total=400 | anchoring, tenacity, resolve, market_sense, risk_radar, scrutiny, patience, rapport |
| `packages/shared/src/agent-stats/stats-to-params.ts` | stats → EngineParameters 결정론적 변환 | w_p, w_t, w_r, w_s + alpha, beta, gamma 등 도출 |
| `packages/shared/src/agent-stats/presets.ts` | 6개 동물 프리셋 (Tiger/Fox/Turtle/Owl/Dolphin/Eagle) | 각각 stat 벡터 + role(seller/buyer/both) + description |
| `packages/shared/src/agent-stats/copy.ts` | seller/buyer role별 stat 설명 텍스트 | UI 카피 |
| `apps/web/src/app/(app)/sell/agents/**` | agent CRUD UI (slider, radar, list) | localStorage 저장 |
| `apps/web/src/lib/local-agents.ts` | agent persistence (localStorage) | DB 미연결 |

### 1.4 두 시스템의 관계 — 한 문장으로

> **main의 시스템 = "buyer가 무엇을 사고 싶은지 LLM 대화로 알아내고, 그걸로 협상 파라미터를 튜닝".**
>
> **우리 시스템 = "seller(또는 user)가 자기 협상 페르소나를 명시적으로 정의(8-stat slider)".**

→ 같은 actor를 다루지 않음. 같은 pipeline의 다른 입력을 만들고 있음.

### 1.5 현 코드의 한계 (= 발전 여지)

- **L1.** `tag-garden-requirements`는 정보 슬롯**만** 있음. 태그별 협상 weight 오버라이드 없음. (= 노트의 "태그별 다른 weight"가 미구현인 정확한 위치)
- **L2.** `preset-tuning.service`는 **4개 하드코딩 ID**로 동작. 사용자가 디테일하게 조작할 여지가 4개 카테고리뿐. (= 노트의 "디테일한 수정 → 디테일한 결과"가 막히는 정확한 지점)
- **L3.** `negotiation-readiness`는 **BUYER만**. SELLER agent를 다른 카테고리에 적용할 때 부족 정보 검증 흐름은 0%. (= 노트의 "iPhone 에이전트로 MacBook 협상시 missing info 채우기"가 빈 곳)
- **L4.** Voice profile(12개)과 8-stat이 **별개 차원**. agent 한 개체가 둘을 동시에 가질 데이터 모델 없음.
- **L5.** `tag-garden-requirements`의 TAG_REQUIREMENTS는 **iPhone 1개 카테고리만 정의됨**. 다른 카테고리 (MacBook, vehicles, ...) 미정의.
- **L6.** 거리(distance) 차원은 어디에도 없음.
- **L7.** 배송은 `shipping_terms` 슬롯으로만 존재 (정보 수집 용). 협상 weight 아님 — 노트의 직감("양쪽 부담이라 weight 의미 없음")과 일치.

---

## Part 2 — 노트 컨셉의 정확한 매핑 (수정본)

내가 처음에 했던 1:1 매핑 다 틀림. 깊이 까보고 수정한 결과:

| 노트 컨셉 | 처음 진단 | 정확한 현실 | 누가 채워야 함 |
|---|---|---|---|
| "에이전트 재사용 + missing info 채우기" | advisor가 함 | advisor는 **buyer가 상품 고를 때**용. seller agent를 다른 카테고리에 적용할 때 missing info 채우기는 **0%**. product_identity gate가 비슷한 발상이지만 "다른 상품 맞아?" 만 묻고 끝. | **우리** |
| "유니버셜 term + 카테고리 term" | term-intelligence가 함 | term-intelligence는 cross-listing **신호 학습**. 우리 노트는 **선험적 거래 차원 분류**. 다른 컨셉. <br><br>BUT — `tag-garden-requirements`의 3-tier 구조 (UNIVERSAL/GENERIC/TAG)가 컨셉상 **정확히 노트의 분류 = 정보 슬롯 버전**. 협상 weight 버전은 미구현. | 일부 main 차용 + 새로 만들기 |
| "태그별 다른 weight 협상" | preset-tuning이 함 | preset-tuning은 preset×listing 튜닝. **태그별 weight 오버라이드는 미구현**. `tag-garden`은 정보 슬롯만. 둘 사이에 빈 곳이 우리 sweet spot. | **우리** |
| "디테일한 수정 → 디테일한 결과" | persona-profiles가 함 | voice는 12개로 다양하지만 **stat이 LLM 프롬프트에 정량적으로 들어가는 흐름은 미구현**. preset-tuning도 4개 ID에서 멈춤. | **우리** + main 통합 |

→ **결론: 4개 컨셉 중 0개가 완전히 main에 있음**. 1.5개는 인접 시스템 차용 가능, 2.5개는 우리가 채워야 함.

---

## Part 3 — 둘이 결정해야 할 것 (미팅 토론 항목)

> 컨셉 → 아키텍처 → 우선순위 순서. 위에서부터 막히면 아래는 못 정함.

### A. 컨셉 결정

**A1. Universal term의 정의를 둘 중 어느 쪽으로 갈까?**
- (a) **정보 슬롯**(현 main 방식) — "이 정보를 알아야 협상 시작" — 이미 코드에 있음
- (b) **협상 차원**(노트 원래 의도) — "모든 협상에서 weight 부여되는 universal axis (가격, 시간, ...)"
- (c) **둘 다 별개로 정의** — 정보 슬롯 ≠ 협상 차원

내 추천: **(c)**. 다른 컨셉이라 같은 이름으로 묶으면 코드가 꼬임. 우리 노트가 말한 건 (b). main의 tag-garden은 (a). 두 시스템이 공존하면 됨.

**A2. 거리(distance)는 어떻게 모델링?**
- (a) 새 차원 V_d 추가 (5번째)
- (b) V_t (시간)에 일부 + V_r (리스크)에 일부 흡수
- (c) Universal term이 아닌 category-specific (vehicles에서만 의미)

내 추천: **(b)**. 새 차원 추가는 utility 합 = 1 정규화 깨짐. V_t에 거리 계수, V_r에 파손 위험 입력으로 추가하면 깔끔.

**A3. 배송은?**
- (a) 정보 슬롯으로만 (현 main `shipping_terms`)
- (b) V_p에 흡수 (effective_price = price + shipping_share)
- (c) 협상 가능 term으로 노출

너 직감대로 (a)+(b) 조합. 양쪽 부담 모델 확정이면 협상 변수가 아니라 거래 비용.

### B. 아키텍처 결정

**B1. 우리 8-stat은 preset-tuning을 *대체*인가, *입력*인가?**
- (a) 대체: 4개 preset ID 폐기, 8-stat이 preset-tuning 내부 로직
- (b) 입력: preset ID는 그대로 두고, 8-stat이 preset의 *override*
- (c) 동등: preset과 8-stat agent 두 종류가 공존

내 추천: **(b)**. 4개 preset ID는 빠른 selection용으로 유용 (스피드 다이얼). 8-stat은 advanced editor. preset-tuning 내부 함수가 두 입력을 받게 시그니처 확장.

**B2. 6개 동물 프리셋(우리) vs 4개 negotiation preset(main) — 합칠까?**
- 도메인이 다름. 동물 = persona/personality. main 4개 = bargaining posture (safe/balanced/lowest/fast).
- 합치지 말고 **두 차원으로 곱하기**: agent = (animal preset 또는 8-stat) × (negotiation posture)? 또는 8-stat에서 posture 도출.

질문: animal preset에 negotiation posture 정보가 *내포*돼있다고 보는 게 맞을까? (Tiger = aggressive ≈ lowest_price?)

**B3. Voice profile(12개)을 agent에 포함시킬까?**
- 옵션1: 8-stat → voice 자동 추천 (e.g. tenacity 높으면 → Hark)
- 옵션2: agent 정의에 voice_id 필드 추가, user가 명시 선택
- 옵션3: voice는 협상 컨텍스트별 (buyer vs seller vs buddy)로 자동, agent랑 분리

**B4. seller 측 missing-info 흐름은 어떻게 만들까?**
- buyer 측 패턴(advisor + tag-garden + memory-card) 그대로 mirror?
- 또는 seller agent 입장에선 "이 listing의 카테고리 → 내 agent가 이 카테고리 weight override 가지고 있나?" 만 체크하면 충분?

### C. 데이터 모델 결정

**C1. Agent 스키마 최종형:**
```ts
type Agent = {
  id: string;
  name: string;
  role: 'seller' | 'buyer' | 'both';
  // 우리 시스템
  stats: EngineStats; // 8-stat
  // 통합 결정 사항:
  voiceId?: AgentProfileId; // ?
  categoryOverrides?: Record<string, {
    weightAdjustments?: Partial<UtilityWeights>; // ← B1 결정 후
    requiredSlots?: string[]; // ← tag-garden 슬롯 ID
    answeredSlots?: Record<string, unknown>; // ← user가 채운 답
  }>;
};
```
이 모양 OK?

**C2. 저장 위치:** 지금 localStorage. 미팅 후 DB로 옮길지, MVP 동안은 localStorage 유지할지?

### D. 우선순위

**D1. 다음 1주 작업 한 가지만 뽑으면?**
- (a) 8-stat → preset-tuning 통합 (가장 큰 leverage)
- (b) sell/agents UI 완성 (사용자 가시성)
- (c) seller 측 missing-info 흐름 prototype
- (d) 카테고리별 weight override 데이터 모델 + 한 카테고리(electronics) 채우기

**D2. main의 demo developer 화면 vs 우리 sell/agents 화면 — 어느 쪽이 user-facing 정식 entry?**
지금 demo developer는 marketing 페이지. sell/agents는 app 페이지. 통합하거나 역할 분리해야.

---

## Part 4 — 발전 방향 옵션 (제안)

내가 보기엔 다음 단계 옵션은 4가지. 각각 장단:

### 옵션 A: 수직 통합 (Stat → Preset Tuning)

8-stat 시스템을 preset-tuning.service의 동적 입력으로 연결.

**작업:**
1. preset-tuning.service의 컴파일 함수를 stat 입력도 받게 시그니처 확장
2. priceCapMinor / openingOfferMinor / concessionSpeed 계산이 preset ID 대신 stat 벡터 참고
3. 4개 preset ID는 "stat 프리셋"으로 재정의 (각 preset = 특정 stat 벡터)

**효과:** 노트의 "디테일한 수정 → 디테일한 결과" 즉시 달성. 4단계 → 연속값.

**리스크:** preset-tuning이 1103줄. 회귀 테스트 양 많음.

### 옵션 B: 카테고리 Weight 시스템 신설

`tag-garden-requirements`와 평행한 `tag-weight-overrides` 추가.

**작업:**
1. `packages/shared/src/term-presets/` 신설 (또는 비슷한 위치)
2. 카테고리별 weight 조정 상수 정의: electronics → {w_t: +0.05}, vehicles → {w_r: +0.1, distance_weight: 0.3}
3. assembleContext가 listing.category를 보고 weight 오버라이드 적용
4. agent 스키마에 user-level overrides 추가

**효과:** 노트의 "태그별 다른 weight 협상" 정확히 구현. 디테일한 조작 새 차원 열림.

**리스크:** 카테고리별 default 정하는 거 자체가 컨셉 결정 작업.

### 옵션 C: Seller Missing-Info Mirror

buyer 측 advisor 패턴을 seller 쪽에 mirror.

**작업:**
1. negotiation-readiness.service에 SELLER 분기 추가
2. seller agent가 listing의 category × agent.categoryOverrides로 missing slot 검출
3. 부족시 LLM으로 짧은 Q&A 생성 → agent.categoryOverrides 채움
4. UI: agent 적용 시점에 "이 카테고리 처음이네요, 2가지만 빠르게 알려주세요" 모달

**효과:** 노트의 "iPhone agent로 MacBook 협상시 부족 정보 채우기" 정확히 구현.

**리스크:** B의 데이터 모델이 먼저 있어야 함.

### 옵션 D: UI 정합성 (sell/agents 정식화)

지금 sell/agents는 8-stat slider만. main의 page.tsx는 "Coming Soon" stub. demo developer에 있는 advisor/preset-tuning panel을 sell/agents에 통합.

**작업:**
1. sell/agents/page.tsx를 우리 agent list로 교체 (이미 부분 진행)
2. agent detail 페이지에 stat editor + voice picker + category overrides 통합
3. demo developer는 "playground"로 격하, 정식 entry는 sell/agents

**효과:** 사용자 가시성. 데모로 끝나던 게 production path로.

**리스크:** 위 옵션 결정에 의존.

### 추천 순서

내가 보기엔 **B → A → C → D**.
- B 먼저 — 데이터 모델 결정. C/D가 다 여기 의존.
- A 다음 — leverage 가장 큼, B 데이터 활용.
- C — UX 차별화 포인트.
- D — 정식 노출.

---

## 부록: rebase 정리 메모

- WIP 커밋: `b483f59` "WIP: 8-stat agent builder progress (pre-rebase snapshot)"
- rebase 후 conflict 0
- typecheck 30/30 통과
- 보고서 검토 후 진행 결정 시: WIP 커밋을 squash해서 의미있는 커밋으로 정리 가능
- 다음 작업은 **이 보고서 결정사항이 정해진 뒤 시작**
