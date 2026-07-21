# 협상 엔진 그룹 2 (센서부) — 경량 루프 계약

> **목적:** 그룹 2(센서부) 구현을 "검증 가능한 닫힌 루프" 여러 개로 쪼개 안전하게 목적지에 도달한다.
> 이 문서는 구현 agent의 **작업 계약**이다. payment 루프 플랜(`docs/wip/payment-fulfillment-dispute-loop-engineering-plan.md`)의 경량판.
> **작성:** 2026-07-21 · 브랜치 기준 `staging` · 관련: [하이브리드 가이드](../site/negotiation-hybrid-guide.html) · [리뷰 로그](../engine/Negotiation_Review_Log.md)

---

## 0. 최상위 목표

그룹 2 = **"상대 자연어(배터리 89%·무료배송)를 엔진이 아는 특징으로 통역해 가격 결정에 반영"**.
성공 기준: 각 slice가 **확실한 분석 → 구현 → 검증**을 거쳐, 레포를 초록으로 유지하며 닫힌다.

**⚠️ 그룹 2 특유의 검증 난점:** 프로덕션 가격은 `coach.ts`에서 나오고 engine-core와 독립이라, 그룹 1이 열기 전까지 **특징을 추출해도 가격이 안 변한다.** → "값이 바뀌나"로 검증 불가 → 각 slice는 **그룹1 없이도 관측 가능한 검증**을 갖춰야 한다.

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

## 5. slice 목록 (L0~L8)

| 루프 | slice | 독립? | 허용 파일(핵심) | Done/Verify |
|---|---|---|---|---|
| **L0** Orchestrator | 다음 slice 선택 | — | 코드 X | slice가 1 PR에 맞고 검증법 명확 |
| **L1** Category Fix ★파일럿 | HAGGLE-9-A | ✅ | `pipeline/executor.ts`(태그 소스), 스킬 선택 | 비전자 매물에 IMEI 규칙 안 붙음(테스트) |
| **L2** Feature Schema | H4 | ✅ | feature-schema(신규)·types | 리뷰(docs/type only) |
| **L3** Sensor Mapper | H5-a | ✅ | signal→feature 매퍼·memory-reconstructor | 골든 테스트 + shadow 로그 |
| **L4** Skill 카테고리화 | HAGGLE-9-B | ✅ | skills/*·standard-terms | 카테고리별 스킬 선택 + 4중복 통합 회귀 |
| **L5** Feature→Price | H6 | ❌ 합류 | applyFeatures 배선 | "배터리89%→상한내 조정"(그룹1 H1 후) |
| **L6** Tag Garden | H7 | 🟡 | understand·tag-garden | 누락필드→질문 발송 테스트 |
| **L7** Multi-term | HAGGLE-6 | ❌ | engine-core term·memory | term 협상 테스트 |
| **L8** LLM 추출 | H5-b | ✅ | understand(async)·deepseek | 추출 정확도(검증 agent) |

**권장 순서:** L1 → L2 → L3 → L4 (여기까지 그룹1 무관 독립 완주) → L5(합류) → L6 → L7 → L8.

---

## 6. 진행 로그 (slice가 닫힐 때마다 append)

| slice | 상태 | 증거 | 날짜 |
|---|---|---|---|
| L1 | ✅ 닫힘 (파일럿) | 아래 상세 | 2026-07-21 |

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
