# 협상 엔진 그룹 2 (센서부) — 경량 루프 계약

> **목적:** 그룹 2(센서부) 구현을 "검증 가능한 닫힌 루프" 여러 개로 쪼개 안전하게 목적지에 도달한다.
> 이 문서는 구현 agent의 **작업 계약**이다. payment 루프 플랜(`docs/wip/payment-fulfillment-dispute-loop-engineering-plan.md`)의 경량판.
> **작성:** 2026-07-21 · 브랜치 기준 `staging` · 관련: [하이브리드 가이드](../site/negotiation-hybrid-guide.html) · [리뷰 로그](../engine/Negotiation_Review_Log.md)

---

## 0. 최상위 목표 — 두 기둥

그룹 2는 **두 기둥**이다 (2026-07-21 담당자와 범위 재확인):

- **기둥 A · 센서:** 상대 자연어(배터리 89%·기스 많음·무료배송)를 **엔진이 아는 구조화 특징으로 통역**해 가격 결정에 반영. (그룹1은 엔진이 가격을 결정하게 만듦.)
- **기둥 B · 카테고리 일반화:** "무슨 물품이든 IMEI·배터리 물어봄"에서 벗어나, **물품 카테고리/태그별로 "협상 시 물어볼 것"을 결정**한다. 그리고 이건 **3개 LLM 접점 전부**에 적용:
  1. **셀러**가 리스팅 만들고 협상 에이전트 붙일 때의 LLM
  2. **구매자**가 그 리스팅용 에이전트 만들 때의 LLM
  3. **두 에이전트가 실제 협상**하는 LLM

성공 기준: 각 slice가 **확실한 분석 → 구현 → 검증**을 거쳐, 레포를 초록으로 유지하며 닫힌다.

**⚠️ 기둥 A 검증 난점:** 프로덕션 가격은 `coach.ts`에서 나오고 engine-core와 독립이라, 그룹 1이 열기 전까지 **특징을 추출해도 가격이 안 변한다.** → "값이 바뀌나"로 검증 불가 → 각 slice는 **그룹1 없이도 관측 가능한 검증**을 갖춰야 한다.

---

## 0.5 카테고리 일반화 모델 — NAICS식 taxonomy + Tag Garden 동적 backbone

기둥 B의 핵심 아이디어: **NAICS(산업분류)처럼 큰 카테고리에서 시작해 태그로 구체화하는 계층 분류를 만들고, 각 노드에 "협상 시 물어보면 좋은 질문/확인 세트"를 미리 매핑**한다. Tag Garden이 이 매핑을 **동적으로 확장**(학습·승격)한다.

```
계층 taxonomy (NAICS식) — 현재 구현된 seed (TAX/P3):
  electronics                         → [작동, 외관]
    electronics/phones                → + [배터리, 캐리어락, 저장용량]
      electronics/phones/iphone       → + [IMEI(필수), Find My(필수)]   aliases: iphone·아이폰
    electronics/laptops               → + [배터리 사이클, 사양]        aliases: macbook·notebook·노트북
  clothing                            → [사이즈, 정품(필수), 외관]      aliases: fashion·패션·의류
  vehicles                            → [주행거리, 명의(필수), 정비이력]
  (매칭 = 태그/하이픈-토큰 vs path·leaf·alias · 하위는 상위 상속)
  ~~확장 예정: 폰 브랜드(galaxy·pixel) · fashion/shoes~~ → **D3 done for galaxy/pixel HARD; shoes HARD removed** · home·sports·music still expand later
```
> **D3 (2026-09-06 / #141, SoT in [product-decisions-2026-09-07.md](./product-decisions-2026-09-07.md)):** shoes/sneaker authenticity **HARD removed** (`sneaker_authenticity` gone; aliases cleared). Electronics **galaxy/pixel/phone HARD kept**. `dead-pixel` / `no-dead-pixel` remain **ambiguous** (do not open Pixel phone gates). Older “확장 예정: fashion/shoes HARD” / “galaxy 미매칭” open items below are superseded where they conflict.


- **한 개의 "카테고리 → 질문/특징 세트" 소스**가 3접점 공통 backbone.
- 현재 조각들: `FEATURE_SCHEMA.category`(L2, 특징별 카테고리) + Tag Garden `TAG_REQUIREMENTS`(태그별 슬롯, **현재 iPhone 하나뿐**). → 이 둘을 **계층 taxonomy로 통합·확장**하는 게 backbone 작업.
- **Tag Garden의 힘 = 동적:** 어떤 카테고리/태그에서 특정 질문이 반복적으로 필요한데 매핑에 없으면 → **학습해서 그 카테고리/태그의 기본 질문으로 승격**(H7).
- 이 backbone이 열리면 파트1(셀러 빌더)·파트2(구매자 빌더)·파트3(협상 런타임) 셋 다 **같은 소스로** 카테고리별 질문을 함. → ✅ **달성**: TAX(backbone) + P3(런타임) + P12(셀러·구매자 빌더)로 **3접점 모두 taxonomy 소비 완료** (2026-07-24).

---

## 0.6 프로덕션 방향 — 2레이어 하이브리드 (2026-07-25 확정, **픽스**)

> 카테고리 게이트를 실제 앱에서 검증한 뒤, **production-level "모든 상품 커버"** 로 끌어올리기 위해 사용자가 확정한 방향. 이건 재논의 대상 아님(고정).

**핵심 = 2레이어 하이브리드 (LLM 우선 + taxonomy 안전/가격 오버레이):**

| 레이어 | 담당 | 커버 | 성격 |
|---|---|---|---|
| **결정론 (taxonomy 슬롯)** | 안전 게이트(명의·IMEI·정품) + 가격 규칙 | 큐레이션된 고위험·고빈도 카테고리 | hard 강제·ask-once·만족판정·**골든 테스트** |
| **생성 (LLM)** | 카테고리별 advisory 질문 | **모든 상품**(롱테일) | LLM이 대화로 관리(슬롯 아님)·**eval 검증** |

**Taxonomy 구조 (사용자 명세):**
```
2자리(대분류) + 3자리(태그)  = 수동 리서치 큐레이션 (필수/옵션 확정, 인터넷 검색 필요)
                              예: phones→IMEI·용량 / vehicles→clean·rebuilt title·mileage
4~6자리(구체 물품)           = LLM 재량 생성 (taxonomy 미포함 → LLM이 해당 물품 판단)
```

**유저 관점 3플로우 (되어야 하는 것):**
1. **셀러 리스팅→에이전트:** 리스팅 올릴 때 마지막 단계에서 (기존 에이전트 or default 선택 후) LLM이 카테고리/태그 보고 **그 물품 협상 전 세팅할 [필수+옵션]**을 물어 에이전트에 기준 저장.
2. **바이어 리스팅→에이전트:** 바이어도 그 상품에 대해 LLM으로 협상 전 기준 세팅. 이때 카테고리/태그 + **셀러가 세팅해 놓은 기준**을 (최소한) 다 세팅할 수 있어야 함 → 양쪽 기준이 협상 factor가 됨.
3. **셀러↔바이어 에이전트 협상:** 셀러가 지정한 기준에 **바이어 답/세팅이 없으면** 협상 도중 **멈춰서 바이어에게 물음 → 답하면 재개**. 그래야 정해진 기준별 답을 갖고 협상 엔진이 결정.

**경계 갱신 (2026-07-25):** 플로우 ③은 실제 협상 런타임 + 라운드 루프를 건드림. **프로덕션 협상은 engine-core가 아니라 LLM(DECIDE)이 결정**(SSOT)하므로, 우리가 **기준을 협상 LLM 프롬프트에 factor로 주입 + PAUSE를 라운드 루프 hold에 배선**한다(§4/§8의 "라운드 루프=상호/그룹1" 갱신). **engine-core 가격 수학은 여전히 그룹1**, 우리는 LLM 경로 + 조건/PAUSE. (사용자 동의 완료.)

**검증 방식 전환:** 결정론 레이어=골든 테스트 그대로 / 생성 레이어=**eval**(대표 상품 20+종 LLM-judge·수동 리뷰). "모든 상품"은 본질적으로 eval 기반.

→ 구현 로드맵은 **§5 Phase G**. 실행 원칙: **핵심 루프(①→②→③)를 현재 카테고리로 먼저 관통**해 메커니즘 증명 → 그다음 G-GEN(롱테일)·G-TAX(폭)로 확장.

---

## 1. 루프 사이클

각 slice(루프)는 스스로 이 5단계를 돈다:

```
Discover → Plan → Execute → Verify → Iterate
```

- **Discover** — 관련 코드·문서 읽기, `git status`/브랜치 확인, 이전 실패 노트 확인.
- **Plan** — 미니 브리프 작성(아래 템플릿). ← **분석 게이트**
- **Execute** — 허용 파일만 수정.
- **Verify** — 3층 검증 + typecheck + 회귀 + `git diff --check`. ← **검증 게이트**
- **Iterate** — 통과 시 닫고 증거 기록. 실패/범위이탈 시 반환.

---

## 2. slice 미니 계약 템플릿

각 slice 착수 전 이 브리프를 채우고 **사람 승인**을 받는다:

```
### slice: <이름>
- 무엇 / 왜:
- 허용 파일:            (건드려도 되는 곳)
- 금지:                (건드리면 안 되는 곳 — 특히 coach/decide/engine-core 결정)
- Done 기준:           (관측 가능하게)
- 검증 명령:           (결정론적 테스트 커맨드)
- Stop-And-Ask 조건:
```

---

## 3. 검증 게이트 — 3층 (그룹 2 핵심)

가격이 안 변해도 slice를 확실히 검증하기 위해:

| 층 | 무엇 | 왜 |
|---|---|---|
| **1층 · 결정론 테스트** | 입력 X → 출력 Y 골든 테스트 (메시지→특징, 매물→스킬) | 재현 가능한 정답 고정 |
| **2층 · 검증 agent** | 작성 agent와 **별개** agent가 적대적 검증 (오탐·누락·충실도) | 자기검증만으로 완료 안 함 |
| **3층 · shadow 관측** | 라운드 로그에 `extracted_features` + "적용됐다면 얼마" 기록 | 가격이 안 변해도 센서 동작 확인 |

+ 공통: `pnpm typecheck` · 기존 협상 회귀 테스트 · `git diff --check` 초록.

---

## 4. 그룹 2 Non-Negotiable

- 센서는 **결정론적·감사가능**해야 한다 (`raw_span` 로그 필수).
- 어떤 특징도 **바운드 규칙 + 로그 없이 가격에 영향 금지**.
- **coach / decide / engine-core 결정 로직은 그룹1 영역** — 센서 루프(L1~L4·L6)에서 안 건드린다 (합류 L5·L7 제외).
- 그룹1이 열기 전엔 **shadow 계산으로만 검증**, 프로덕션 가격 경로 변경 금지.
- 스킬/카테고리 변경은 **기존 협상 회귀 테스트 통과** 후에만.
- 커밋/머지/푸시/배포는 **사람이 명시 요청할 때만**.

---

## 5. 로드맵 (재구성 — 3접점 + Tag Garden backbone)

> 2026-07-21 범위 재확인으로 **협상 런타임 중심 → 3접점 + backbone**으로 재구성. 기존 백로그(협상 엔진 중심)는 파트3에 해당하고, 파트1·2(빌더)·backbone·멈춤이 새로 명시됨.

### Phase 0 — 센서 기반 + 파트3 카테고리 (✅ **완료**, 그룹1 무관)
| slice | 내용 | 상태 |
|---|---|---|
| L1 | 협상 런타임 스킬 선택을 매물 카테고리로 (파트3) | ✅ |
| L2 | 특징 스키마 = 센서 어휘 + "카테고리→특징" 씨앗 | ✅ |
| L3 | 센서 매퍼 (regex 신호 → 특징, shadow) | ✅ |
| L4a | v1 스킬 카테고리 프로필 (파트3, iPhone 누출 차단) | ✅ |

### Phase 1 — 카테고리 taxonomy backbone ★ **신규 최우선** (3접점 공통 기반)
| slice | 내용 | 상태 |
|---|---|---|
| **TAX** | NAICS식 계층 taxonomy + 노드별 "협상 체크(질문+특징키)" 세트 + 계층 상속 `resolveChecks`. `packages/shared`에 신규(3접점 공통), 얇은 seed | ✅ **완료** (additive·미소비) |

### Phase 2 — 3접점이 backbone 소비
| slice | 내용 | 독립? |
|---|---|---|
| **P1** | 파트1 **셀러 빌더**가 taxonomy로 카테고리별 강조점 (`negotiation-agent-builder-chat`) | ✅ **완료** (P12) |
| **P2** | 파트2 **구매자 빌더**가 taxonomy로 카테고리별 요구슬롯 | ✅ **완료** (P12) |
| **P3** | 파트3 **협상 런타임**을 taxonomy 기반으로 (L1/L4a의 iPhone-프로필 → taxonomy-driven) | ✅ **완료** |
| **PAUSE** | **협상 중 멈춤** — 한쪽 세팅을 다른쪽이 없으면 멈춰 질문. `intervention_mode`(현재 FULL_AUTO 고정) → feature-mismatch 연결 | ✅ **감지기 완료** (게이트 flip은 그룹1 co-design seam) |

### Phase 3 — Tag Garden 동적화
| slice | 내용 | 상태 |
|---|---|---|
| **L7 (H7)** | 반복 누락 질문 → 해당 카테고리/태그 기본 질문으로 학습·승격 (동적 backbone) | ✅ **완료** (승격 두뇌 + 오버레이, shadow·미소비) |

### Phase 4 — 그룹1 합류 (kickoff 계약 필요 — §8)
| slice | 내용 | 상태 |
|---|---|---|
| **L5 (H6)** | Feature → Price: applyFeatures로 가격에 바운드 반영 | ✅ **내 몫 완료** (바운드 규칙 시드, shadow·미배선) |
| **L6 (HAGGLE-6)** | Multi-term: 비가격 조건 협상 (term_space 재설계 필요) | 🔴 **그룹1 블락** (term_space=engine-core=그룹1 상류, 미착수) |

### Phase 5 — 센서 LLM 업그레이드
| slice | 내용 |
|---|---|
| **L8 (H5-b)** | 정규식 → LLM structured-output 추출 (커버리지 부족 실측 시) |

### Phase G — 프로덕션 레벨 "모든 상품" (2026-07-25 확정, §0.6 방향) ★ **현재 최우선**
> 배포 전제조건: 이거 다 커버 + 실제 동작 확인 후 배포 (사용자: "production-level 커버 후 배포").
> 실행 순서: 핵심 루프(①→②→③) 먼저 관통 → 폭 확장(GEN·TAX).

| slice | 내용 | 검증 | 상태 |
|---|---|---|---|
| **FOUNDATION** | `packages/shared` `CategoryCriterion`(checkId-keyed) + scaffold/required/unresolved 헬퍼 | 골든 12 | ✅ |
| **G-SELLER** | 셀러 빌더: 아이템별 [필수+옵션] 물어 `categoryCriteria` 저장. 결정론 재조정(scaffold 권위, LLM은 requirement/stance만) | 골든(재조정)+통합 | ✅ |
| **G-BUYER** | 바이어 빌더: public 엔드포인트가 **셀러 required만 buyer-safe 노출** → 웹 prop → `seller_required_criteria` → 빌더가 [SELLER REQUIRES] 미러링 | 골든+통합 | ✅ |
| **G-NEGO** ★ | (a) 액팅 사이드 required 기준을 DECIDE 프롬프트에 주입 (b) PAUSE를 executor hold에 배선 (c) **Flow 3 resume**: pause가 루프 차단→`/pause/answer`로 답변 수신→스냅샷 갱신→재개 + 웹 PauseAnswerPanel | 골든+순수헬퍼+전체 회귀 | ✅ |
| **G-MIRROR** | Flow 2 **결정론적 미러링**: `pickSellerMirrorQuestion`이 셀러 required를 바이어에 강제 질문(ask-once) + planner가 categoryCriteria stance 인정 | 골든 | ✅ |
| **G-GEN** | LLM 롱테일 블록(제품별 advisory) — 가드레일=reconcile이 비-taxonomy checkId 구조적 드롭 | 골든 | ✅ |
| **G-TAX** | taxonomy 확장: sports(+bicycles), collectibles, furniture, books. 안전 hard 게이트(bike_serial 도난·coa_authenticity 감정) | 골든+리서치 | ✅ |
| **G-EVAL** | 대표 상품 20+종 결정론 커버리지 매트릭스(게이트·누출·wedge). LLM-judge eval=수동 하네스 후속 | 골든 23 | ✅ (결정론) |
| **G-PERF** | `callLLM`에 per-call `model` override + `BUILDER_LLM_MODEL` env 레버. 기본=pro 유지(사용자 선택) | 타입+테스트 | ✅ |

### Phase E2E — 실사용 e2e에서 드러난 결함 대응 (2026-08-02 ~ 08-08) ★ **현재**
> Phase G까지는 "결정론 레이어가 존재하는가"를 만들었다면, 여기는 **사용자가 실제로 앱을 돌려서** 나온 것만 다룬다.
> 개발자 피드백 4건(①흔한 카테고리 즉시 ②데이터 없는 태그 학습 ③Tag Garden 매핑 ④주관식→객관식)에서 시작해, e2e 중 발견된 협상 결함으로 이어졌다.

**A. 에이전트 세팅 (피드백 ①~④)**

| slice | 내용 | 상태 |
|---|---|---|
| **TAG-BRIDGE** (③) | criteria 전체가 태그 키인데 vision은 속성("256gb")만 뱉어 **자식 hard 게이트가 조용히 미발화**. 제목에서 item-type 추론(`tag-inference.ts`). 측정: 매트리스/카시트/소파/드릴 **0 게이트 → 65/65 커버**. vision 실패해도 동작(로컬은 항상 실패) | ✅ |
| **LEARN** (②) | `learned_category_checks`(+evidence, migration 0144). 승급 ≥3회 × ≥2 distinct source. 관측 소스 **allowlist**(LLM 생성 질문만; 플래너 슬롯 기록 시 "예산 범위는?"이 자기강화 체크로 승급) | ✅ |
| **LEARN-DEDUP** | 정규화 토큰 + Jaccard. **임계 2개 분리**: 0.7(taxonomy 중복→기록 안 함, 오탐이 신호를 잃음) / 0.5(기존 학습 체크와 병합, 안 합치면 영원히 승급 불가). 저장 시 같은 스코프의 기존 행과 대조 | ✅ |
| **LEARN-SCOPE** | taxonomy 미매칭 리스팅(`other`)은 통째로 버려져 **정작 롱테일이 학습에서 제외**. `tag:` 스코프 폴백. 어떤 태그가 품목명인지 **추측하지 않고** 후보 전부(≤3)에 기록 → 임계값이 골라냄 | ✅ |
| **SYMMETRY** | soft 체크 11개가 구매자 선택지만 있고 판매자 대응 없음 → 구매자가 요구하는데 판매자는 질문받은 적 없음. `mileage`만 의도적 제외(구매자=상한선 / 판매자=정확한 수치) | ✅ |
| **SETUP-UX** (①④) | 인사말이 Quick Setup을 가리킴 / 탭이 STRATEGY 칩으로 보임(면제 답변을 빨간 딜브레이커로 표시하던 함정 회피) / 한 턴 한 질문(명령형 포함) / 대화가 "알겠어"로 끝나지 않음 / 빌더 턴 실패 시 재시도 | ✅ |

**B. 협상 정확성 (e2e 중 발견)**

| slice | 내용 | 상태 |
|---|---|---|
| **CLOSE-PRICE** | 채팅은 "$215에 합의", 정산은 $217.75. CLOSING skill은 `CONFIRM`을 내는데 정합성 가드가 전부 `ACCEPT`만 검사 → **단일 술어 `isDealClosingAction`**. 표시도 통일(센트는 있을 때만) | ✅ |
| **PRICE-ENVELOPE** ★ | 호가 $120인데 $130 역제안 / 자기 $200 제안 후 $194. 근본: `opponent_offer`에 **자기 추천가**가 들어가 엔진이 테이블 위 가격을 본 적이 없었음. 실제 두 가격을 transcript에서 측정해 주입 + 봉투(자기 한계·자기 직전 제안·상대 제안)로 clamp + 레퍼리 **V8 HARD** | ✅ |
| **E-PAUSE** | PAUSE는 정상 발화하는데 **웹이 응답을 안 읽어** 재개 불가. 체크별 정식 선택지로 답변 → `/pause/answer` → 재개, 답변은 질문 라운드 metadata에 남아 `↳ You answered` 댓글로 표시(새로고침 후에도) | ✅ |
| **FAIL-VISIBLE** | 대기 점이 에러를 몰라 **실패가 정지처럼** 보임 + `paused_for_buyer` 무한 스핀 + 정지 워치독(120s) | ✅ |

### 정리 slice (아무때나, backbone에 흡수)
| slice | 내용 |
|---|---|
| L4b/c/d | IMEI 4중복 통합 / standard-terms 범용·카테고리 분리 / skill_summary 파생 → **TAX backbone으로 대부분 흡수** |
| DEDUP | intelligence-demo 라우트 ↔ 서비스 빌더 로직 중복 제거(공유 모듈) — 지금 양쪽 수동 동기화(BUILDER-UX 교훈). **2026-08-08 확인: 여전히 열림** |

**Phase G 코드 완료** (FOUNDATION·G-SELLER·G-BUYER·G-NEGO·G-GEN·G-TAX·G-EVAL·G-PERF, 2026-07-25). 핵심 루프 ①셀러세팅→②바이어미러→③협상PAUSE 관통 + 롱테일/폭 확장. 적대적 검증에서 3버그(PAUSE 재발화 stall·stance 누출·criteria 덮어쓰기) 발견→전부 수정.

**Phase G 후속 처리 현황 (2026-08-08 기준):**
- ✅ **PAUSE 인터랙티브 resume** — Phase E2E의 E-PAUSE에서 완결. API는 처음부터 완비였고 **웹 클라이언트가 응답을 읽지 않던 것**이 원인이었음.
- ✅ **non-Apple 폰 매칭** — `Samsung Galaxy S24 Ultra` → phones 노드 10 checks. 동시에 `Samsung 65" QLED TV`는 TV(6 checks)로 정확히 분기(`WEAK_BRAND_TERMS` 가드).
- ⬜ **G-EVAL LLM-judge**: 생성 레이어(롱테일 질문 품질) 수동/CI eval 하네스(API 키 필요).
- ⬜ **DEDUP**: `intelligence-demo.ts` 빌더 로직 중복 — 프로덕션 경로(서비스)만 반영, 데모 라우트 미동기화. 확인함(2026-08-08): 여전히 열림.

**남은 그룹1-블락:** L6(term_space) · L5 landing 배선 · L8(선택).

> **✅ 2026-07-24 커밋:** L7·PAUSE·L5 코드 9파일.
> **✅ 2026-07-25 커밋:** SAT(게이트 만족+hard 승격+buyerAskKo) 5파일 → **BUILDER-UX**(ask-once·영어통일·마무리·budget가드·timeout) 7파일. 실제 앱에서 자동차/옷/아이폰 카테고리 게이트를 **영어 요구형으로 강제 질문 + 답하면 안 되묻고 + 502/budget오염 없이** 동작 확인.
> **이 loop-plan.md는 로컬 SOT라 커밋 제외.** 이후: 그룹1 kickoff에서 라이브 배선(§8).

- **그룹1 협업·의존 전략은 §8.**

---

## 6. 진행 로그 (slice가 닫힐 때마다 append)

| slice | 상태 | 증거 | 날짜 |
|---|---|---|---|
| L1 | ✅ 닫힘 (파일럿) | 아래 상세 | 2026-07-21 |
| L2 | ✅ 닫힘 | 아래 상세 | 2026-07-21 |
| L3 | ✅ 닫힘 | 아래 상세 | 2026-07-21 |
| L4a | ✅ 닫힘 | 아래 상세 | 2026-07-21 |
| TAX | ✅ 닫힘 | 아래 상세 | 2026-07-24 |
| P3 | ✅ 닫힘 | 아래 상세 | 2026-07-24 |
| P12 (P1+P2) | ✅ 닫힘 | 아래 상세 | 2026-07-24 |
| L7 (H7) | ✅ 닫힘 | 아래 상세 | 2026-07-24 |
| PAUSE | ✅ 닫힘 (감지기) | 아래 상세 | 2026-07-24 |
| L5 (H6) | ✅ 닫힘 (내 몫: 규칙 시드) | 아래 상세 | 2026-07-24 |
| SAT (P12 후속) | ✅ 닫힘 (게이트 만족+hard 승격) | 아래 상세 | 2026-07-25 |
| BUILDER-UX (SAT 후속) | ✅ 닫힘 (ask-once·영어·마무리·budget가드·timeout) | 아래 상세 | 2026-07-25 |
| Phase G 전 slice | ✅ 닫힘 | 위 Phase G 표 | 2026-07-25 |
| TAG-BRIDGE / LEARN / SYMMETRY / SETUP-UX | ✅ 닫힘 | 아래 Phase E2E 상세 | 2026-08-02~08 |
| CLOSE-PRICE / PRICE-ENVELOPE / E-PAUSE / FAIL-VISIBLE | ✅ 닫힘 | 아래 Phase E2E 상세 | 2026-08-08 |

### L1 — Category Fix (HAGGLE-9-A) 종료 기록

**변경 (3파일):**
- `skills/skill-stack.ts` — `resolveItemTags(listingContext)` 순수 함수 추가. `[category, ...tags]`를 trim+lowercase 정규화, 정보 없으면 `[]`(폴백 A = electronics 기본값 제거).
- `pipeline/executor.ts` — 존재하지 않던 `dbSession.category` → `SkillStack.fromTags(resolveItemTags(updatedMemory.listing_context))`.
- `skills/__tests__/skill-stack.test.ts` — 골든 테스트 6개.

**검증 (3층 + 게이트):**
- 1층 결정론: skill-stack.test.ts 26/26 통과 (비전자→electronics 스킬 미부착 / 전자→부착 / casing 정규화 / 폴백 A).
- 2층 독립 검증 agent: 정상경로에서 `listing_context` 채워짐 확인 · `resolveItemTags` 정확 · v1 싱글톤 IMEI 누출은 L1 범위 밖 확인.
- 회귀: `vitest run src/negotiation/skills src/negotiation/pipeline` → 78/78 통과.
- `git diff --check` clean · 변경 파일 typecheck 에러 0 (기존 sharp/@haggle/shared 이슈만).

**결정:** 폴백 (A) 유지. 근거 = 티켓 의도("신뢰할 카테고리 없으면 전자 취급 금지"). false-positive(옷→아이폰) 제거가 우선, false-negative(null-category 전자→스킬 없음)는 '*' 스킬로 협상 정상 작동.

**남은 후속 (별도 티켓):**
- ⬜ `listingDrafts.category` populate/enforce (nullable·미강제 = 근본 원인, 데이터 레이어) — L1 잔여 회귀의 진짜 해결.
- ⬜ v1 `DefaultEngineSkill`(id `electronics-iphone-pro-v1`)이 skillStack과 무관하게 IMEI/아이폰 컨텍스트를 DECIDE 프롬프트에 항상 주입 → **L4 (HAGGLE-9-B)** 에서 처리. IMEI 누출의 나머지 절반.
- ⬜ `git status` clean이 아니므로 커밋은 사람 요청 시 (executor·skill-stack·test + 문서 변경 未커밋).

### L2 — Feature Schema (H4) 종료 기록

**변경 (3파일):**
- `packages/engine-core/src/features/schema.ts` — 신규. `FeatureDef` 타입 + `FEATURE_SCHEMA`(폰-우선 11개: value_adjust 5 / term 6) + `getFeatureDef`/`isKnownFeatureKey`. 순수 데이터, engine-core→app 의존 없음.
- `packages/engine-core/src/index.ts` — 스키마 export 추가.
- `packages/engine-core/__tests__/feature-schema.test.ts` — 무결성 골든 테스트 8개.

**설계 결정 (승인됨):**
- 위치 = engine-core/features (계약과 co-locate, 순수성 유지).
- L2는 **어휘만** — 숫자 효과/cap = L5(`CategoryFeatureRule.apply`), 신호→key 매핑 = L3.
- 게이트(IMEI·Find My) = `routing:"term"` + `termKind:"informational"` (FeatureRouting에 gate 버킷 없음 → term에 접음, 계약과 일치).

**검증:**
- 1층 무결성 테스트 8/8 (key 유일 · term은 termKind · enum은 enumValues · 게이트 routing 등).
- 회귀: engine-core 전체 159/159 (`public-api.test.ts` 15 포함 — export 스냅샷 무손상).
- typecheck OK · biome exit=0.
- 2층 검증 agent 생략 — 순수 정적 어휘라 런타임 행동 없음(Spec 성격 slice). 대신 신호 정렬 셀프체크: 스키마 key가 기존 `conversation-signal-extractor` 신호(battery_health_pct·storage_gb·carrier·imei·shipping·warranty·returns)에 대응 확인.

**남은 후속:**
- ⬜ enum 값(storage/shipping/warranty 등)은 **provisional** — L4(HAGGLE-9-B)에서 `standard-terms.ts`와 정합화.
- ⬜ 카테고리 확장(폰 외)은 후속 — 현재 '*' 범용 + electronics/phones만.

### L3 — Sensor Mapper (H5-a) 종료 기록

**변경 (5+빌드):**
- `apps/api/src/negotiation/features/signals-to-features.ts` — 신규. `mapSignalsToFeatures(signals, source)`. entityType 기반 매핑, 스키마 게이트, key별 dedup.
- `pipeline/types.ts` — `UnderstandOutput.extracted_features?` 추가.
- `stages/understand.ts` — 매퍼 호출 (동기 유지, LLM 없음). *(biome가 파일 전체를 double-quote로 재포맷 → diff 큼, 포맷뿐)*
- `pipeline/executor.ts` — `updatedMemory.extracted_features` 부착 + redacted shadow 로그.
- `features/__tests__/signals-to-features.test.ts` — 골든 10개.
- (빌드) engine-core dist 리빌드 — L2 export가 dist에 없어 런타임 `isKnownFeatureKey` undefined였음(stale dist). `pnpm --filter @haggle/engine-core build`. dist는 gitignore/CI 빌드라 커밋 미포함.

**v1 매핑:** battery_health·storage_capacity·carrier_lock = 구체값. imei/cosmetic/warranty/return/shipping = null(멘션 → H7). 스키마 밖 신호 drop.

**검증 (3층):**
- 1층 골든 10/10 · 회귀 stages+pipeline+features 62/62 · typecheck 0 · biome exit=0.
- 2층 독립 검증 agent → **버그 2개 발견·수정**:
  - 🐛 (a) `shipping`(null)이 `fulfillment`(local_pickup)를 dedup에서 덮음. → **dedup 규칙: 같은 key는 concrete 값이 null을 이김.** 회귀 테스트 추가.
  - 🐛 (c) shadow 로그가 `raw_span`(원문) 노출(PII). → **{key,type,value}만 로깅.**
- 3층 shadow: `coreMemorySnapshot` 편승 + per-round 로그.

**남은 한계/후속 (검증 agent 지적):**
- ⚠️ shadow 스냅샷은 **터미널 라운드만**(coreMemorySnapshot 구조). per-round 관측은 **로그**로만.
- ⬜ 추출기 갭: 단자리 TB(1~9TB) 미탐지, bare "it's locked" 미탐지 → 신호층 개선 후속.
- ⬜ 센서 미커버 스키마 key: `original_accessories`·`find_my_status`·`shipping_cost_split`. 스키마가 센서보다 넓음.
- ⬜ `applyFeatures`(→H7)는 이 경로에서 **아직 미호출** — 주석의 "→ H7"은 미래 배선(L5/L6).

---

## 7. L4 쪼개기 (HAGGLE-9-B)

L4가 커서 서브슬라이스로 분할. **L4a만 완료**, 나머지는 후속.

| 서브 | 내용 | 상태 |
|---|---|---|
| L4a | v1 DefaultEngineSkill 누출 차단 (CategoryProfile) | ✅ 닫힘 |
| L4b | IMEI/Find My 4중복 정의 → 단일 카테고리 소스 통합 | ⬜ 후속 |
| L4c | standard-terms 범용/카테고리 분리 | ⬜ 후속 |
| L4d | skill_summary 하드코딩 4곳 파생 (현재 비전자에 stale) | ⬜ 후속 |

### L4a — Category Profiles 종료 기록

**변경 (4파일):**
- `skills/category-profiles.ts` — 신규. `CategoryProfile` + `ELECTRONICS_PHONE_PROFILE`(기존 아이폰 내용 verbatim) + `DEFAULT_PROFILE`(중립, IMEI 없음) + `resolveCategoryProfile(tags)`.
- `skills/default-engine-skill.ts` — 생성자로 profile 받음(기본=electronics 하위호환). 3 accessor(getLLMContext/getConstraints/getTermDeclaration)를 profile에서. **결정 로직 불변.**
- `pipeline/executor.ts` — 모듈 싱글톤 `const skill` 제거 → 세션별 `new DefaultEngineSkill(resolveCategoryProfile(itemTags))` (L1 `resolveItemTags` 재사용).
- `skills/__tests__/category-profiles.test.ts` — 골든 8개.

**검증 (3층):**
- 1층 골든 8개(중립→IMEI 없음/id generic-v1 · 전자→유지/id electronics · 기본값 하위호환 · 결정로직 불변).
- 회귀: skills 69/69 · pipeline+stages 53/53 · typecheck 0 · biome exit=0.
- 2층 독립 검증 agent → **새 버그 0**. 핵심 배선 확인: 실제 누출 벡터=`getLLMContext` 문자열뿐(constraints/tactics는 DECIDE LLM 미도달), 정확히 겨냥. 전자 세션 byte-identical 보존.

**잔여/후속 (검증 agent):**
- ⬜ (a) 비폰 전자(노트북 `electronics/laptops`)는 여전히 폰 프로필 → 전자 서브타입별 프로필 필요(후속).
- ⬜ (b) `skill_summary` 하드코딩(memory-reconstructor:205 등)이 비전자엔 stale — 단 LLM 프롬프트 미도달(cosmetic) → **L4d**.
- ⬜ (c) 레거시 `llm-negotiation-executor`(NEGOTIATION_PIPELINE≠staged)는 여전히 누출 — out-of-path 한정 안전.
- ⚠️ 전자 해피패스는 `listing_context.category` populate 의존(L1과 동일 조건부).

---

### TAX — Category Taxonomy Backbone (Phase 1) 종료 기록

**발견 (Discover):** 계층 taxonomy TREE는 이미 존재 — `seed-tag-garden.ts`(DB 3단계 트리 + top 카테고리 electronics/fashion/sports/home/vehicles/music/gaming) + `tag-garden-requirements.ts`(`TagRequirementSlot` 구조, 단 매핑은 iPhone뿐). → TAX = "노드→체크 매핑 확장 + 계층 상속"으로 축소.

**변경 (4파일):**
- `packages/shared/src/category-taxonomy/types.ts` — `NegotiationCheck`{id,questionKo,featureKey?,enforcement} + `CategoryNode`{path,aliases?,checks}.
- `.../taxonomy.ts` — `CATEGORY_TAXONOMY`(seed: electronics·/phones·/iphone·/laptops·clothing·vehicles) + `resolveChecks(tags)`(leaf/alias 매칭 + 조상 상속 + dedup) + `getCategoryNode`.
- `.../index.ts` + `src/index.ts` — export.
- `.../__tests__/taxonomy.test.ts` — 골든 11개.

**설계 결정 (승인됨):**
- 위치 = `packages/shared` (3접점 apps/api·apps/web 공통 import). featureKey는 문자열 참조(engine-core 의존 회피).
- top 카테고리 = canonical `LISTING_CATEGORIES` 기준. tag-garden "fashion"은 clothing alias로 흡수.
- v1 = 구조 + resolve + 얇은 seed. **additive·미소비** (P1/P2/P3에서 배선).

**검증:**
- 1층 골든 11/11 (iphone→IMEI 포함 상속 · 비폰전자→IMEI 없음 · 비전자→IMEI 없음 · alias · dedup · 미지 태그→빈값).
- 회귀: shared 66/66 · typecheck 0 · biome exit=0.
- 2층 agent 생략(순수 데이터+테스트 로직, additive·미소비 = L2 선례). 셀프: featureKey 6개 전부 FEATURE_SCHEMA에 존재 확인.

**남은 후속:**
- ⬜ 나머지 카테고리/서브카테고리 매핑 확장(콘텐츠, 점진).
- ⬜ `LISTING_CATEGORIES` vs seed-tag-garden(fashion/home 등) 명칭 불일치 정합화.
- ⬜ featureKey↔FEATURE_SCHEMA 교차 일관성 테스트(shared는 engine-core import 불가 → apps/api 레벨 테스트로).
- ⬜ **커밋 시 loop-plan.md는 제외** (문서는 로컬 SOT, 코드만 커밋).

---

### P3 — Runtime taxonomy 배선 (Phase 2) 종료 기록

**변경 (4파일):**
- `skills/category-profiles.ts` — `resolveCategoryProfile(tags)`를 **taxonomy-driven**으로. `resolveChecks(tags)`(shared) → checks를 DECIDE 프롬프트 llmContext(hard=[필수]/soft=[권장]) + hard checks→constraints. 빈 checks → DEFAULT_PROFILE. 정적 프로필은 no-arg 기본값으로만 잔존.
- `skills/__tests__/category-profiles.test.ts` — 갱신(realistic 태그).
- `packages/shared/.../taxonomy.ts` — **토큰화 매칭**(하이픈 태그) + laptops aliases (아래 회귀 수정).
- `packages/shared/.../__tests__/taxonomy.test.ts` — realistic 태그 테스트.
- (빌드) shared dist 리빌드(새 export/로직) — 커밋 미포함.

**효과 (첫 "보이는" 배선):** 협상 LLM이 카테고리별 체크를 프롬프트로 받음 — 자전거→주행거리/명의, 아이폰→배터리/IMEI[필수]. **L4a 잔여(노트북이 아이폰 취급)도 수정.**

**검증 (3층) + 2층이 잡은 안전 회귀:**
- 2층 독립 검증 agent → 🐛 **안전 회귀 발견:** 실제 리스팅은 category=bare "electronics" + tags=하이픈("iphone-15-pro")인데, taxonomy가 exact "iphone"만 매칭 → **실제 폰이 iphone 노드에 안 걸려 IMEI/배터리를 통째로 잃음**(L4a 대비 안전 후퇴). 내 골든 테스트가 합성 토큰(`["iphone"]`)을 써서 못 잡음.
  - **수정:** `resolveChecks` **토큰화**(태그를 하이픈/공백으로 쪼갠 토큰도 매칭) → "iphone-15-pro"의 "iphone" 토큰이 iphone 노드에 걸림. + laptops aliases. **realistic 골든 테스트로 재발 방지.**
- 최종: taxonomy 13/13 · category-profiles 9/9 · api 회귀 125/125 · typecheck 0 · biome exit=0.

**교훈:** 골든 테스트는 **실제 프로덕션 입력 형식**(bare category + 하이픈 태그)으로. 합성 토큰은 배선을 못 검증함.

**남은 후속:**
- ✅ 비-Apple 폰(galaxy/pixel) HARD — D3/#141: galaxy·pixel phone HARD kept; shoes authenticity HARD removed; dead-pixel ambiguous kept.
- ⬜ `resolveItemTags`가 `subtype`("phone") 무시(skill-stack) → subtype 배선하면 매칭 견고(L1 영역).
- ⬜ out-of-path no-arg 2곳(`llm-negotiation-executor:74`·`routes/negotiation-stages:40`)은 여전히 전 품목 아이폰 프로필 — pre-existing, L4d/정리 때.
- ⬜ furniture/collectibles/sports/books/other는 taxonomy 노드 없음 → 중립(콘텐츠 확장).

---

### P12 — Builder taxonomy (P1 셀러 + P2 구매자, Phase 2) 종료 기록

P1·P2가 같은 빌더 프롬프트/플랜을 공유하므로 한 slice로. **근본 방향:** taxonomy를 빌더의 실제 카테고리 질문 소스로(옆에 블록 추가 X).

**변경 (3파일):**
- `services/tag-garden-requirements.ts` — `ListingForRequirements.category?` 추가 · `taxonomyCategorySlots(listings)`(resolveChecks → 요구슬롯) · `buildAdvisorRequirementPlan`에서 `tagSlots 없으면 taxonomy`. → **buyer 빌더가 비-iPhone 전 카테고리로 일반화**(iPhone rich 슬롯 보존).
- `services/negotiation-agent-builder-chat.service.ts` — `buildSellerCategoryHint` + seller 프롬프트에 emphasis 블록 주입("강조·dealBreaker 판단, 묻지는 마"). shared resolveChecks import.
- `__tests__/tag-garden-requirements.test.ts` — 골든(vehicles→taxonomy, iPhone 보존, wedge-guard).

**효과:** 자동차 사려는 구매자 빌더 → "주행거리/명의", 옷 → "사이즈/정품". 셀러 빌더도 카테고리 강조점 인지. iPhone-only 탈피.

**검증 (3층) + 2층이 잡은 치명 버그:**
- 2층 독립 검증 agent → 🐛 **치명(§3):** hard taxonomy 슬롯(vehicles title·clothing authenticity·초기턴 iPhone imei)이 `memorySatisfiesSlot`에 만족 로직 없어(aliases:[]) **영원히 blocking → 빌더 무한 재질문·추천 불가.** + iPhone은 memory에 "iphone" 토큰 없는 초기턴엔 taxonomy 경로로 imei 하드블록.
  - **수정:** `taxonomyCategorySlots`를 **soft·비차단**으로(만족 로직 없으니). 체크의 hard/soft는 P3 런타임 프롬프트엔 유지. wedge-guard 테스트 추가(soft 검증 + iPhone-taxonomy 비블록).
  - 🔎 **runtime-reality 확인(P3 교훈):** buyer-landing이 `listing.category`(bare canonical) + tags를 실제로 보냄 → category 토큰으로 taxonomy 매칭 → P3 하이픈 실패 회피. (category nullable 시 tags-only fallback.)
- 최종: tag-garden 20/20 · negotiation 회귀 125/125 · builder route · typecheck 0 · biome exit=0.

**교훈:** 골든 테스트는 슬롯 "존재"만 아니라 **blocking/만족/무한루프**까지 검증해야 함.

**남은 후속:**
- ⬜ taxonomy 슬롯 **만족 로직**(답하면 satisfied) — 있으면 hard 승격 가능(현재 soft 임시).
- ⬜ category nullable / underscore-form 태그(`iphone_15_pro`) 미토큰화 → category populate + split 확장.
- ⬜ no-node 카테고리(furniture/sports/books/collectibles/other) taxonomy 커버 0 → 콘텐츠 확장.
- ⬜ `intelligence-demo.ts`도 buyer wedge 상속(참조용), seller hint 미적용 — 정리 때.

---

### L7 — Dynamic Taxonomy Learning (H7, Phase 3) 종료 기록

**발견 (Discover):** Tag Garden 학습 인프라는 이미 존재하나(`tag-garden-intelligence.service.ts` — `conversation_market_signals`→`tag_suggestions`→`promote_candidate`, `tag_promotion_rules` 테이블) **태그 라벨** 레벨. L7이 필요로 하는 "카테고리별 협상 **질문/체크** 승격"은 빈 자리 → `resolveChecks` backbone을 동적 확장하는 조각.

**변경 (4파일, `packages/shared` additive):**
- `category-taxonomy/learning.ts` — 신규. 순수 승격 두뇌.
  - `promoteLearnedChecks(observations, opts)`: (categoryPath, checkId/featureKey/질문슬러그)별 버킷팅 → **두 임계값**(minOccurrences=3 AND minDistinctSources=2) 통과 + 정적 taxonomy 미보유 시 `LearnedCheck` 방출. 학습분 **enforcement 항상 soft**(P12 wedge 교훈).
  - `resolveChecksWithLearned(tags, learned, base)`: 오버레이. `matchedCategoryPaths` 게이트로 태그가 걸리는 노드(+상속)의 학습분만 append, 정적 id 충돌 시 정적 우선, 학습분 soft 강제.
  - `LearnedCheckStore`(주입식) + `createInMemoryLearnedCheckStore` + `recordCheckObservation`(+ `// TODO(observation-source)` seam).
- `category-taxonomy/taxonomy.ts` — `matchedCategoryPaths(tags)` 추출·export (resolveChecks가 이를 호출, **동작 byte-identical**).
- `category-taxonomy/index.ts` — export 추가.
- `category-taxonomy/__tests__/learning.test.ts` — 골든 23개.

**설계 결정 (승인됨):** TAX와 동일 패턴 — `packages/shared`에 순수·additive·**미소비(shadow)**. 관측 소스(센서 멘션→미매칭 / 빌더 ad-hoc)는 DB persistence(보호 경계)라 별도 slice, seam으로 표시. L7 v1 = "배우는 두뇌" 완성 + 테스트 증명.

**검증 (3층) + 2층이 잡은 견고성 버그 4개(모두 수정):**
- 안전 불변식 **CONFIRMED**: 학습분 hard 방출/블로킹 경로 없음(승격·오버레이 양쪽 soft 강제).
- 2층 독립 검증 agent → 🐛 입력 위생 버그 4개:
  - (MED) slug 48자 truncation + emoji/구두점-only가 `learned:check`로 병합 → **전체 질문 FNV-1a 해시 append**로 충돌 방지.
  - (MED) `categoryPath` 미정규화 → 대소문자로 정적 dedup 우회(정적 default 재승격) → **normalizeCategoryPath**(lowercase + slash trim).
  - (LOW) trailing-slash → dead 학습분 / (LOW) blank 질문 승격 → 정규화 + **식별불가 관측 drop**(no checkId/featureKey/질문 → skip).
  - (테스트품질) "static wins" 테스트가 tautological + slug/정규화/shuffle/오버레이-soft 미검증 → **8개 회귀 테스트 추가**(hand-built 충돌·prefix/emoji 충돌·대소문자·trailing-slash·blank·shuffle 결정론·오버레이 soft 강제).
- 최종: shared **91/91**(learning 23 + taxonomy 13 무변) · api 회귀 **506 통과**(taxonomy 소비처 tag-garden/category-profiles/signals-to-features/negotiation 전부; 실패 2파일=chain/ABI collection, taxonomy 무관 사전존재) · typecheck 0 · biome exit=0 · `git diff --check` clean · dist 리빌드.

**사고 노트:** Edit 중 파일에 NUL 바이트 혼입(바이너리화)로 매칭 실패 → 전체 `Write`로 재기록 정상화. 이후 rg로 NUL 부재 확인.

**남은 후속:**
- ⬜ **관측 소스 라이브 배선**(seam): 센서(L3) "멘션됐지만 카테고리 매칭 체크 없음" + 빌더 ad-hoc 질문 → DB persistence(보호 경계, 별도 slice). 배선 전까지 L7은 shadow.
- ⬜ 학습분 **hard 승격 정책**: 만족 로직 생기면(P12 후속) soft→hard 에스컬레이션 고려.
- ⬜ 승격 임계값 튜닝(현 3/2)은 실측 데이터 확보 후.

---

### PAUSE — Feature-mismatch 감지기 (Phase 2, §8 (다) 상호) 종료 기록

**발견 (Discover):** hold 인프라는 이미 프로덕션에 존재 — `phase/human-intervention.ts`의 `checkIntervention`(순수) → executor.ts:277에서 `intervention_mode` 기반으로 라운드를 `persistHoldRound`(사람 검토 대기)로 돌림. `intervention_mode`가 FULL_AUTO 고정이라 실제 멈춤은 안 일어남. → PAUSE = "feature-mismatch면 이 hold를 트리거"하는 **추가 조건**. 게이트 flip = §8 (다) 상호설계(그룹1).

**결정 (사용자):** PAUSE v1 = **순수 감지기 + 테스트만**, executor 무접촉(shadow 로그도 안 함). 게이트 배선은 그룹1 co-design seam.

**변경 (2파일, additive):**
- `negotiation/phase/feature-mismatch-pause.ts` — 신규. `detectFeatureMismatchPause({tags, resolvedFeatureKeys?, resolvedCheckIds?, round, minRound?})`. `resolveChecks(tags)`의 **HARD 체크** 중 상대 미해소분(featureKey∈resolvedFeatureKeys OR id∈resolvedCheckIds로 해소 판정) 탐지 → `{shouldPause, unresolvedHardChecks, question(=첫 체크 questionKo), reason}` | null. round<minRound(기본2)면 discovery라 no-pause. 게이트 flip은 `// TODO(group1/mutual)` seam.
- `negotiation/phase/__tests__/feature-mismatch-pause.test.ts` — 골든 11개.

**검증 (3층):**
- 1층 골든 11/11 (하드 미해소→멈춤+정확 질문 / 전부 해소→null / no-featureKey 체크는 id채널로만 해소(vehicles title·clothing authenticity) / soft만 미해소→null / early round→null / no-node·빈태그·bare electronics→null / 양 채널 대소문자 정규화 / NaN·음수·Infinity round→no-op).
- 2층 독립 검증 agent → **VERDICT PASS, 프로덕션 버그 0.** 6개 제약 전부 CONFIRMED. 지적: (LOW) `round:NaN`이 `NaN<minRound=false`로 게이트 fail-open → **`Number.isFinite` 가드 추가**(수정). + 테스트 품질 갭(tautological question assert, clothing authenticity/양채널 casing/bare category 미검증) → **테스트 강화**(9→11, 리터럴 질문 문자열 assert 등).
- 회귀: api phase/skills/tag-garden 등 초록 · 내 파일 typecheck 0 · biome 0 · diff clean.

**교훈/사고:** typecheck 사전존재 에러 확인하려 `git stash` 오조작 → 무관 옛 stash가 잘못 적용돼 executor/skill-stack 충돌 → `git checkout HEAD -- <파일>`로 복구(stash 유실 없음). 메모리 `gotcha-git-stash-bare-pop` 기록.

**남은 후속 (그룹1 co-design):**
- ⬜ **게이트 배선**: `checkIntervention`/executor hold에 감지기 연결 + `intervention_mode` ↔ feature-mismatch 상호작용(§8 (다), 라운드 루프).
- ⬜ resolved 집합의 **실제 소스 매핑**: 센서 extracted_features(featureKey) + 리스팅 declared attrs → resolvedFeatureKeys/Ids (배선 시).

---

### L5 — Feature→Price 규칙 시드 (H6, Phase 4, 내 몫) 종료 기록

**발견 (Discover):** L5 인프라 대부분 **이미 존재** — `applyFeatures(features, rules)`(engine-core, value_adjust 라우팅+missing 수집)는 `assembleNegotiationContext`(하이브리드 브리지)에 배선됨(단 `categoryRules` 기본=`[]` → 효과 0), 합성은 `adjustVpForFeatures`(utility, **곱셈** 합성+V_p clamp, 그룹1 소유). **진짜 빈 자리 = `CategoryFeatureRule` 테이블 자체가 없음.** → 원래 계획한 `composeAdjustments`는 중복이라 폐기, **규칙 시드**로 전환(사용자 승인).

**변경 (3파일, engine-core additive):**
- `features/category-rules.ts` — 신규. `SEED_CATEGORY_FEATURE_RULES`: 5개 value_adjust 규칙(battery_health %슬로프 / storage·cosmetic enum 사다리 / carrier_lock / original_accessories). 각 규칙 **자기 clamp**(`clampRatio`, per-rule 바운드), **부호·바운드 확정 / 매그니튜드 mock**(`// TODO(group1): calibrate`).
- `index.ts` — export.
- `__tests__/category-rules.test.ts` — 골든 16개.

**설계 결정:** 부호·바운드=내 몫(기둥A semantics, §8 가), 매그니튜드=그룹1 calibration(mock), landing(vp_delta_ratio 반영처)·전역 합성 cap=그룹1(§8 나/다). **자동 배선 안 함**(assemble 기본 `[]` 유지) → shadow. 곱셈 복리 우려는 kickoff 항목3으로 명시.

**검증 (3층) + 2층 반영:**
- 2층 독립 검증 agent → **VERDICT PASS, reachable 버그 0.** 5개 제약 전부 CONFIRMED(순수·per-rule clamp·부호 monotonic·미배선(assemble 기본 `[]`, 게다가 assembleNegotiationContext 호출처 자체가 아직 없음)·NaN/-0 무유출). 곱셈 합성 worst-case 실측: 하락 factor 0.625/상승 1.223 → 최종 `clamp(_,0,1)`이 안전 보장(부호 안 뒤집힘), 전역 cap은 정당한 그룹1 kickoff 항목(correctness hole 아님).
- 지적 반영: (LOW) `clampRatio` NaN 비방어 → **`Number.isFinite` 가드 추가**(안전망 완전화). (MED, 테스트품질) loose ±0.15가 per-rule 바운드 위반 은폐 → **per-rule 바운드 assert로 강화** + Infinity/NaN/−0/malformed 샘플 확장. (LOW) compounding 커버리지 0 → **adjustVpForFeatures worst-case 스모크 2개 추가**.
- 최종: engine-core **175/175**(신규 16 + 기존 159 무변) · typecheck 0 · biome 0 · build ok · diff clean.

**남은 후속 (그룹1 kickoff):**
- ⬜ **매그니튜드 calibration**(현재 mock) — 실측/정책.
- ⬜ **landing 배선**: `SEED_CATEGORY_FEATURE_RULES`를 assemble에 주입 + `adjustVpForFeatures`를 실제 결정 경로에 연결(그룹1이 engine 켤 때).
- ⬜ **전역 합성 cap 정책**(곱셈 복리) — kickoff 항목3, 상호.
- ⬜ term-routed 특징(L6): term_space 배선은 그룹1(apply.ts `// TODO(H8)`).

---

### SAT — Taxonomy 슬롯 만족 + hard 승격 (P12 후속) 종료 기록

**발단:** 사용자 실제 앱 테스트에서 자동차 구매자 빌더가 **주행거리/명의를 안 물음**. 원인 = P12 wedge 수정 때 taxonomy 슬롯을 전부 **soft(비차단)** 로 뒀는데, 빌더는 hard(blocking) 질문만 강제로 물어서 LLM이 카테고리 게이트를 건너뜀. loop-plan P12 "남은 후속(만족 로직 → hard 승격)"을 실행.

**변경 (3파일 + 테스트):**
- `packages/shared/.../types.ts` — `NegotiationCheck.answerHints?: string[]` 추가.
- `packages/shared/.../taxonomy.ts` — 게이트 4개(title_status·authenticity·imei_verification·find_my_status)에 topic-specific answerHints.
- `apps/api/.../tag-garden-requirements.ts` — `taxonomyCategorySlots`가 check의 **실제 hard/soft 존중**(단 answerHints 있는 hard만 hard, 없으면 soft) + aliases=answerHints. `memorySatisfiesSlot`의 taxonomy 만족 = **answerHints 키워드 매칭만**(블랭킷 no-preference 불허).
- 테스트: tag-garden wedge-guard 3 + **fail-open 가드 1**, intelligence-demo 2건 갱신.

**효과 (실제 앱 확인):** 자동차 빌더 → **"is the title clean?"**(명의) 강제 질문. 옷→정품, 아이폰(taxonomy 경로)→IMEI. mileage/size는 soft 유지. iPhone 하드코딩 rich 슬롯 경로 보존.

**검증 (3층) + 2층 반영:**
- 2층 독립 검증 agent → **wedge 없음 CONFIRMED**(4개 게이트 전부 satisfiable: 미해소 시 막고, topic 단어로 해소, wedge 불가). 그러나 🐛 **fail-open over-satisfaction 클러스터(HIGH)**: answerHints가 너무 generic — `택`→택배/선택, `정상·이력·깨끗`→일반 상태, `이전`→"이전에", `해제`→통신사 잠금해제, + topic-agnostic no-preference가 한 방에 전 게이트 해제.
  - **수정:** answerHints를 **topic-specific로 축소**(generic 단어 제거, imei엔 분실·도난·장물 추가) + taxonomy 만족에서 **블랭킷 no-preference 제거**(명시적 wave-off "명의 상관없어"는 topic 단어로 여전히 해소 → wedge 안 남). **verifier가 준 오매칭 문장들을 네거티브 테스트로 고정.**
- 최종: shared 91/91 · tag-garden 24/24 · intelligence-demo 37/37 · **api 전체 스위트 실패 0** · typecheck 0 · biome 0 · diff clean.

**교훈:** hard 게이트의 만족 키워드는 **일상어 substring 오매칭**을 반드시 네거티브 테스트로 막아야 함(안전 게이트 fail-open = 안전 > 편리 위반).

**후속 버그 수정 (buyer 문구, 같은 커밋):** 사용자가 실제 앱에서 발견 — 구매자 빌더가 **"명의가 명확한가요?"(사실 확인)** 를 구매자한테 물어봄. 근데 그건 셀러만 아는 사실 → 구매자 맥락에서 잘못된 문구. 구매자에겐 **요구**를 물어야 함. 수정: `NegotiationCheck.buyerAskKo`(요구형 문구) 추가, `taxonomyCategorySlots`가 `buyerAskKo ?? questionKo` 사용. 이제 구매자 빌더 = "명의(소유권)가 깨끗한 매물만 볼까요?"(요구), 런타임/셀러 = `questionKo`(사실 확인) 그대로. 15개 체크 전부 buyerAskKo 부여. 근거: 기존 아이폰 하드코딩 슬롯도 요구형("언락 필수인가요?")이라 일관성 확보. **접점별로 다른 질문이 필요하다**는 걸 taxonomy가 반영(questionKo=사실 / buyerAskKo=요구).

**남은 후속:**
- ⬜ answerHints substring → 토큰/경계 매칭 고도화(한국어 경계 어려움, 현재 topic-specific 키워드로 회피).
- ✅ 게이트 답변을 turn-context로 추적 → **BUILDER-UX ask-once로 구현됨**(이미 물어본 게이트는 satisfied).
- ⬜ 카테고리 확대 시 새 hard 체크마다 answerHints + 네거티브 테스트 필수.

---

### BUILDER-UX — 구매자 빌더 실사용 다듬기 (SAT 후속) 종료 기록

**발단:** 사용자가 실제 앱(`/l/…` 구매자 빌더)에서 연속 테스트하며 골든으로 안 잡히는 **실사용 버그 5개**를 발견. 전부 커밋 `buyer builder: ask category gates as English requirements, robustly` (7파일, 2026-07-25).

**변경 (커밋된 7파일):** `shared/category-taxonomy/{types,taxonomy}.ts` · `apps/api/services/{tag-garden-requirements,negotiation-agent-builder-chat}.service.ts` · `apps/api/routes/intelligence-demo.ts` · 각 test 2개.

**5개 버그 → 수정:**
1. **502 (간헐적) = truncation 착각 → 실제는 TIMEOUT.** deepseek-v4-pro는 **reasoning 모델이라 느림**(정상 턴 ~29s). 빌더 callLLM 기본 30s 타임아웃에 걸려 502. → **timeoutMs 90s** 부여. *(초기 오진: maxTokens 2400→6000 truncation 가정했으나 로그가 timeout 증명. maxTokens 6000은 유지.)*
2. **답한 게이트 재질문** ("rebuilt is okay" → 또 "clean title?"). 키워드 만족이 topic 단어 없는 답을 못 잡음. → **ask-once**: 슬롯 질문이 `previous_memory.questions`(지난 턴 질문)에 있으면 satisfied. `buildAdvisorRequirementPlan`에 `askedQuestions` 추가 → `memorySatisfiesSlot`이 answerHints OR asked-once. (SAT "남은 후속: turn-context 추적" 실행.)
3. **한국어 섞임.** LLM이 한국어 buyerAskKo를 verbatim 복사. → **확정적 영어화**: buyerAskKo 15개 전부 영어 + 프롬프트 "reply ENTIRELY in English, 한국어 질문은 영어로 번역, 한국어 문자 0" 강화. (questionKo는 런타임/셀러용 한국어 유지.)
4. **"협상 시작?" 마무리.** 빌더는 에이전트 만드는 곳이지 협상 시작(별도 버튼) 아님. → 프롬프트 CLOSING 지침: "start/begin negotiation 제안 금지, 에이전트 준비 완료 + 추가 요청 물어보기." → soft 질문(mileage 등)도 이 마무리에서 "옵션으로" 초대되어 자연스럽게 처리(옵션 B).
5. **mileage 숫자가 budget 오염** ("for mileage, 25000 or under" → budget $21,000→$25,000). 2단 원인: LLM 오인 + `extractExplicitDollarBudget`가 이전 질문 "What **maximum** mileage"의 "maximum"을 budget 키워드로 오인해 bare 25000 추출. → **`hasMeasurementContext`** 신설, `latestIsNonBudgetNumeric` + `extractExplicitDollarBudget` 가드 양쪽에 추가 + LLM 프롬프트 "비가격 숫자를 budget으로 읽지 마라". **중복 발견: intelligence-demo 라우트가 빌더 로직 복사본 보유 → 서비스+데모 라우트 양쪽 다 수정.**

**검증:** tag-garden 27(ask-once 2 + fail-open 1 등) · intelligence-demo 38(mileage-budget 가드 1 추가) · **api 전체 스위트 2512 통과, 실패 0** · typecheck 0 · biome 0 · diff clean. **실제 앱 end-to-end 확인**(영어·마무리·ask-once·502없음·budget보존).

**교훈:**
- **tsx watch가 hot-reload 안 함**(fd 한도 회피 설정) → 코드 수정마다 `make dev` 재시작 필요. 프로세스 시작 시각 vs 파일 수정 시각 비교로 stale 확인.
- 골든 테스트로 안 잡히는 **실사용 버그는 실제 앱 반복 테스트로만** 나옴(502 원인, 문구 혼동, 숫자 오염 전부 그렇게 발견).
- **코드 중복 주의:** `intelligence-demo.ts`가 빌더 로직 전체 복사본 보유 — 빌더 수정 시 양쪽 확인 필수.

**남은 후속:**
- ⬜ **intelligence-demo 라우트 ↔ 서비스 빌더 로직 중복 제거**(공유 모듈로) — 지금은 양쪽 수동 동기화.
- ⬜ `buyerAskKo` 필드명이 이제 영어 담아서 명칭 부정확(Ko 접미사) — 정리 시 `buyerAsk`로 rename 고려.
- ⬜ 영어 통일은 LLM 지침+영어 문자열 이중 방어지만, 완전 현지화(유저 언어 매칭) 원하면 언어별 문자열 필요.
- ⬜ soft 질문 정책 = 현재 "마무리에서 초대"(옵션 B). 특정 soft(예: 차량 주행거리) hard 승격 여부는 제품 판단.

---

## 8. 그룹1 협업·의존 전략 (2026-07-24 확정)

남은 slice를 그룹1과의 관계로 셋으로 나눈다. **실행 원칙: 블락 때문에 멈추지 않는다.**

### (가) 내가 결정하는 것 → 결정 · 먼저 구현 · 후 보고
- **대상:** 특징 key 세트(`FEATURE_SCHEMA` / TAX taxonomy 어휘), 센서 매핑, 빌더 질문(P1·P2), P3 런타임 taxonomy화, L7.
- 내가 상류다. 그룹1 승인 안 기다린다. **내가 정하고 구현·검증한 뒤 그룹1에 "이 key/규칙으로 간다" 공유.**
- 단 특징 key 세트는 그룹1이 그걸로 rule을 쓰므로, **가능한 빨리 확정본을 던져** 그쪽을 unblock.

### (나) 그룹1에 블락된 것 → "됐다고 가정" + non-breaking mock + 내 쪽 완주
- **대상:** L5(feature→price 착지점), L6(term_space), 엔진 결정 경로(H1~H3) 라이브 타이밍.
- **원칙:** 그룹1 쪽이 완성됐다고 **가정**하고, break 안 나는 선에서 **mock/stub**으로 내 쪽 부분을 다 끝낸다.
- **mock 규칙:**
  - 프로덕션 가격 경로는 **절대 안 건드림**(Non-Negotiable §4) — mock은 shadow/인터페이스 경계 뒤에만.
  - 그룹1이 채울 자리는 **명확히 표시**(`// TODO(group1): …` / `assumes group1: …`)해 실제 배선 시 스왑 쉽게.
  - mock이 있어도 내 slice의 **1·2층 검증은 실제로** 통과해야 함(mock은 그룹1 경계에만, 내 로직엔 아님).
- → 그룹1을 기다리는 동안에도 내 Phase 1~3를 **다 닫아둘 수 있다.**

### (다) 상호 설계 → 도달 시 같이
- **대상:** applyFeatures 합성·상한 정책, PAUSE(협상 중 멈춤) 메커니즘.
- 어느 한쪽도 단독 결정 못 함. 해당 slice 착수 직전 짧게 합의.

### 방향 요약
| 항목 | 방향 | 내 액션 |
|---|---|---|
| 특징 key 세트 | 내가 상류 (내가 그룹1 blocker) | 결정→구현→**조기 공유** |
| 착지점 / term_space / 엔진 타이밍 | 그쪽이 상류 (그쪽이 나 blocker) | **가정+mock**, 내 쪽 완주 |
| applyFeatures 상한 / PAUSE | 상호 | 도달 시 co-design |

### kickoff 체크리스트 (그룹1과 만날 때 이것만 확정)
1. 특징 key 세트 (내가 제안 → 그쪽 sanity-check)
2. 특징 착지점: `V_p` 조정 vs coach `recommended_price` vs `p_target/limit`
3. applyFeatures 합성·전역 상한 정책 (곱셈 복리 지뢰)
4. term_space 배타분기 재설계 (engine-core = 그쪽)
5. PAUSE ↔ 결정 상호작용 (라운드 루프/intervention)
6. 그룹1 엔진 경로 라이브 타이밍 (그전까진 내 features는 shadow)

### 배선 seam 위치 (그룹2가 만들어둔 것 → 그룹1이 연결할 곳)

내 몫은 전부 shadow로 완성돼 있고, 아래가 그룹1이 **라이브로 잇기만 하면 되는** 지점이다.

| kickoff | 그룹2 산출물 (커밋됨) | 배선할 seam / 위치 |
|---|---|---|
| 1 | `FEATURE_SCHEMA`(engine-core) · `CATEGORY_TAXONOMY`(shared) | 어휘 확정본 — 그룹1 rule이 이 key로 |
| 2·3 | `SEED_CATEGORY_FEATURE_RULES`(engine-core/features/category-rules.ts) | `assembleNegotiationContext`(apps/api/.../assemble-context.ts:23, 현재 `categoryRules=[]`)에 주입 + `adjustVpForFeatures`를 결정 경로에 연결. **매그니튜드 mock → calibrate** (`// TODO(group1): calibrate`). 전역 합성 cap 정책 결정 |
| 4 | (미착수 — L6) | `apply.ts` `// TODO(H8)`: term-routed 특징 → `NegotiationContext.term_space` (engine-core 재설계 = 그룹1) |
| 5 | `detectFeatureMismatchPause`(apps/api/.../phase/feature-mismatch-pause.ts) | `checkIntervention`/executor.ts:277 hold 게이트에 연결 + `intervention_mode` 상호작용 (`// TODO(group1/mutual)`) |
| 6 | L3 센서 `extracted_features`(shadow) · L7 `promoteLearnedChecks`(shared/learning.ts) | 엔진 라이브 시 features가 shadow 탈출. L7 관측 소스(센서 멘션→미매칭 / 빌더 ad-hoc → DB persistence, `// TODO(observation-source)`) 배선 |

> resolved 집합 매핑(PAUSE·L5 공통): 센서 `extracted_features`(featureKey) + 리스팅 declared attrs → `resolvedFeatureKeys`/`resolvedCheckIds` / `ExtractedFeature[]`. 배선 시 이 어댑터만 채우면 됨.

---

## 9. Phase E2E 종료 기록 (2026-08-02 ~ 08-08)

사용자가 실제로 앱을 돌려 나온 것만 다룬 회차. 각 항목은 **증상 → 근본 원인 → 불변식** 순으로 적는다.
원인이 표면과 다른 경우가 반복됐으므로, 재발 시 같은 자리를 다시 파지 않도록 **틀렸던 가설도 함께 남긴다.**

### A. 에이전트 세팅

**TAG-BRIDGE (③)** — `packages/shared/.../tag-inference.ts` 신규.
- 측정 먼저: vision 스타일 태그로 매트리스·카시트·소파·드릴·(모델 태그 없는)아이폰이 **hard 게이트 0개**. 전체 taxonomy 123 hard 게이트가 자식 노드에서 도달 불가였다.
- **제목만** 사용. 설명문은 taxonomy 어휘를 산문으로 포함한다("I *saw* no dead *pixel*, kept on my *desk*") → 모니터에 IMEI·공구·목재 게이트가 붙었다.
- `GENERIC_STOPWORDS`(saw/table/wood/pet/book/desk/pixel/grill/coin…) · `WEAK_BRAND_TERMS`(samsung/galaxy는 더 구체적 매칭이 없을 때만) · 액세서리 가드(포함 마커는 **prev1만**; 한국어는 공백이 없어 substring — "아이폰15케이스").
- 커버리지 프로브(현실적 71 리스팅): **65/65 기대 게이트 해소, 누락 0.** 남은 3건(황동망원경·도자기화병·모형기차)은 설계상 롱테일.

**LEARN (②)** — `category-check-learning.service.ts` + migration `0144`.
- 관측 소스 **allowlist**: LLM `parsed.memory.questions`만. 플래너 슬롯을 기록하면 "예산 범위는?"이 두 리스팅 만에 승급하고 **매 턴 자기를 다시 관측**한다.
- evidence 유니크 인덱스가 distinct-source 카운트의 근거. 두 write는 **한 트랜잭션** — 쪼개면 evidence만 성공한 소스가 "이미 봤음"으로 영구 고정되어 승급이 멈춘다.
- 가장 구체적 경로에 귀속(`matchedCategoryPaths().at(-1)`).

**LEARN-DEDUP / LEARN-SCOPE** — 실사용 데이터가 드러낸 두 결함.
- taxonomy `lien_status.buyerAskKo`와 모델 질문이 `&`↔`and`, `/`↔` or `만 달라 **같은 게이트가 재학습**될 뻔했다. 완전일치 → 정규화 토큰 비교.
- 표현이 조금씩 달라 7행이 전부 `occ=1`. **저장된 행과 대조하지 않던 것**이 근본. 임계값은 **용도별로 분리**(0.7 억제 / 0.5 병합) — 실패 비용이 반대 방향이라 하나로 합치면 안 된다.
- 전치사(`inside/within/around/through/over/out`)가 불용어에 없어 기능어 하나로 0.40에 갈렸다.
- `other` 카테고리는 통째로 버려져 **정작 롱테일이 학습에서 제외**되어 있었다 → `tag:` 스코프. 어떤 태그가 품목명인지 **추측하지 않는다**(`["vintage","brass-telescope","1900s"]`에서 하나를 고르면 "1900s"를 집는다) — 후보 전부에 기록하고 임계값이 고른다.
- ⚠️ `"기타"`는 generic 목록에 **넣지 않는다**: taxonomy가 기타(악기) 별칭으로 claim해 `instruments`로 매칭된다.

**SYMMETRY / SETUP-UX** — 180 체크 전수 조사: buyer-only 12개(전부 soft, hard는 0). 11개에 판매자 선택지 추가.
- 판매자 옵션은 전부 `requirement: "optional"`. `required`로 넣으면 판매자가 사실 하나를 진술할 때마다 **PAUSE가 발화**한다.
- STRATEGY 칩 톤은 체크의 `enforcement`가 아니라 **탭한 옵션의 `requirement`** 기준. hard 체크 4개(title_status 등)가 "Doesn't matter" 같은 면제 답변을 갖고 있어, enforcement로 칠하면 "상관없음"이 빨간 딜브레이커가 된다.

### B. 협상 정확성

**CLOSE-PRICE** — 채팅 "$215에 합의" vs 정산 $217.75.
- CLOSING skill은 `CONFIRM`을 내고 `mapActionToDbDecision`이 `CONFIRM→ACCEPT`로 바꾼다. 정합성 가드 **3곳이 전부 `ACCEPT`만** 검사해 실제 마감 라운드에서 한 번도 발화하지 않았다 → `isDealClosingAction` 단일 술어.
- `messageStatesPrice`가 달러 반올림 정규식이라 **정확히 "$217.75"라 쓴 메시지를 탈락**시키고 "$218"을 통과시켰다 → 값 비교로 교체.

**PRICE-ENVELOPE ★** — 이번 회차에서 가장 깊었던 것.
- 증상 2개(판매자 호가 초과 / 구매자 역행)가 **같은 뿌리**였다: `reconstructCoreMemory`가 `opponent_offer = coaching.recommended_price`, 즉 **자기 추천가**를 넣고 있었다. `gap`은 |내 제안 − 내 추천가| ≈ 0이었고, 엔진은 테이블 위 가격을 본 적이 없다.
- 앵커는 `my_target × (1±margin)`인데 **판매자의 `my_target`이 곧 공개 호가**($120×1.1=$132=보고된 $130). 구매자 거울은 $200×0.97=$194.
- 하류에서 같이 고쳐진 것: `decide.ts` `incomingOffer` · `assemble-context` `p_effective` · skills ACCEPT 가격이 전부 "우리 추천가"였고, `gap≈0` 때문에 near-deal 게이트가 매 라운드 즉시수락하고 있었다.
- ⚠️ **틀렸던 가설**: 초기엔 `lastOfferPriceMinor` off-by-one이 원인이라 봤다. 그건 CLOSE-PRICE는 설명하지만 이 건은 설명하지 못한다(구매자 역제안은 Faratin 곡선에서 나오고 `current_offer`를 읽지 않는다). **재현 없이 고치지 않기로 한 판단이 옳았다.**
- ⚠️ 라운드 행 한 개에 **양쪽이 같이** 들어간다: `priceminor`=보낸 쪽, `counterPriceMinor`=응답한 쪽. 이걸 뒤집어 읽어 PAUSE가 상대 가격($115)을 싣고 구매자가 전 구간을 양보한 것처럼 됐다.
- ⚠️ coach는 `buildInitialMemory`가 만든 **별도 메모리**로 돈다. 여기에 실제 가격을 안 넘기면 봉투 clamp가 낡은 경계 위에서 돌고, **레퍼리가 최종값을 잡아주기 때문에 증상이 안 보인다.** 최종 검토에서 발견.
- 불변식: 판매자 ≤ 공개 호가 / 자기 직전 제안보다 뒤로 못 감 / 테이블 위 제안을 못 넘음. **구매자에게 `my_target` 하한은 없다**(target은 비공개라 그 아래 앵커링은 정상). 초안에서 구매자도 clamp했다가 정당한 테스트 3개가 깨진 것이 신호였다.

**E-PAUSE / FAIL-VISIBLE**
- `git log -S`로 전 브랜치 확인: **웹 PAUSE UI는 존재한 적이 없다**(지워진 게 아님). API는 처음부터 완비.
- 답변은 질문 라운드 `metadata.buyer_pause_answers`에 기록 → 새로고침 후에도 `↳ You answered`. 라벨은 서버가 stance→label로 되돌려 저장(내부 값이 아니라 사람이 본 라벨).
- 대기 점이 `liveError`를 몰라 **실패가 정지로 보였다.** 원인 불명 상황에서도 조용히 죽지 않도록 워치독(120s, LLM 상한 45s보다 충분히 위).
- ⚠️ **테스트 함정**: `vi.useFakeTimers()`는 같은 파일 이후 테스트에서 framer-motion exit 애니메이션을 깨뜨린다(요소가 unmount되지 않음). `toFake` 축소로도 안 되고 **파일 분리**가 답. 증상: `-t`로는 통과, 파일 전체로는 실패.
- ⚠️ **부재 단언에는 positive control이 필요하다.** `ThinkingDots`에 role/aria-label이 없어 "사라졌는지" 단언이 무엇과도 매칭되지 않아 항상 통과했다(접근성 결함이기도 해서 같이 수정).

### 최종 상태 (2026-08-08)

- **shared 235 / web 68 / api 2733 통과 · 0 실패**, typecheck 4/4, `verify:migrations`·`verify:db-schema` OK.
- 신규 마이그레이션 `0144`(additive). 삭제: `feature-mismatch-pause.*` — checkId 키의 `seller-criteria-pause`가 대체.
- 커밋 규모 167파일 중 **~100개는 repo 전역 biome 패스**(import 정렬·줄바꿈)로 이 회차 이전부터 있던 것.

### 남은 것

- ⬜ **첫 라운드 정지의 서버 측 원인 미상.** 이제 화면에 에러/정지 메시지가 뜨고 재시도 가능 — 재현 시 API 로그(`"negotiation agent builder chat turn failed"`) 한 줄이면 특정 가능.
- ⬜ DEDUP(intelligence-demo) · G-EVAL LLM-judge.
- ⬜ 의미 기반 학습 병합: `"brass telescope 상태"` vs `"lenses 상태"`는 0.20이라 안 합쳐진다. 임베딩(`generateTextEmbedding` 존재)이 필요하나 관측당 비용이 붙으므로 **실트래픽 이후 판단.**
- ⬜ Tag Garden `missing_tags` → `tag_suggestions` 캡처 후 자동 승급. `resolveChecks`는 DB `tags`를 읽지 않으므로 **협상 질문 품질과는 무관** — 트래픽 생긴 뒤로 미룸.
