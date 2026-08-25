# Decide 프롬프트 계약

**이 문서가 Decide가 보는 입력의 변경 기준이다.**  
코드와 이 문서가 어긋나면 이 문서를 먼저 고치고, 인코더와 계약 테스트를 같이 맞춘다.

| 역할 | 문서 |
|------|------|
| 올리기 → 라운드 → 타결 전체 흐름 | [`tag-spec-fewshot.md`](./tag-spec-fewshot.md) |
| 공개 와이어 (HNP만) | [`../protocol/HNP.md`](../protocol/HNP.md) |
| 공개 압축 규칙 | [`hnp-compact-state.md`](./hnp-compact-state.md) |
| 엔진 이상형·현황 | [`SOT.md`](./SOT.md) §5.4 · §8 · §10 |
| criteria vs issues | [`criteria-and-issues.md`](./criteria-and-issues.md) |

구현: `decide-user-prompt.ts` · `decide-system-prompt.ts` · `criteria-fewshot.ts` · `skill-slots.ts`  
호출: `stages/decide.ts` → `DeepSeekAdapter.buildSystemPrompt` + `buildUserPrompt`  
검증: `decide-prompt-contract.test.ts` · `tag-family-fewshot.test.ts` · `skill-slots.test.ts`

---

## 산 경로 (이것만 살아 있다)

프로덕션 Decide LLM 콜은 하나다.

```
pipeline.ts
  skillSlots ← collectSkillSlots(decide + validate peek + respond peek + context market)
decide.ts
  system ← adapter.buildSystemPrompt(encodeSkillSlots(skillSlots), role, listing_context)
           └ decide-system-prompt.ts  (프로토콜 범례 + 역할 + criteria 카드 + ## Skills)
  user   ← adapter.buildUserPrompt(memory, facts, L5 signal lines, undefined, conversation)
           └ decide-user-prompt.ts  (블록 조립의 유일 구현)
```

`prevMemory`는 프로덕션에서 항상 `undefined`다. 차등(`DELTA`)은 어댑터 API로만 남아 있고, 산 경로가 아니다.

---

## 산 블록 (유저 프롬프트)

한 정보가 두 블록에 들어가면 안 된다.

**공개 프로토콜은 HNP 하나다.** 상대·외부 에이전트와 주고받는 수는 봉투와 `HNP:` compact state다. 말한 턴이 없으면 저장된 가격 fact를 HNP act로 바꾼다. `HIST`는 내지 않는다.

**MEMO는 프로토콜이 아니라 엔진 기억이다.** 바닥·목표·추천가·패턴. 우리 모델만 보고, 봉투에 안 실으며, 세션 row의 스냅샷·해시와 라운드 로그로 DB에 남는다. 다음 라운드는 DB에서 다시 조립한다. 없으면 엔진이 앞 대화를 잃어버린다.

| 순서 | 라벨 | 공개? | 내용 | 인코더 |
|------|------|-------|------|--------|
| 1 | `LISTING:` | 공개 | 제목, 태그, 판매자가 밝힌 스펙 | `encodeListingContext` |
| 2 | `FULFILLMENT:` | 공개 | 배송 방법·제약 | `encodeFulfillmentContext` |
| 3 | `STRATEGY:` | 비공개 | 페르소나, 말투, 필수/선호 조건 | `encodeStrategyContext` |
| 4 | `MEMO:` | 비공개 | `S:` phase/라운드, `B:` 내 목표·바닥·양쪽 호가, `C:` 추천가·패턴 | `encodePrivateMemo` |
| 5 | `BOX:` | 비공개 | 이번 COUNTER 허용 범위 | `encodeBox` |
| 6 | `OPP_SAID:` | 공개 | 지금 답할 상대 한 줄 | conversation |
| 7 | `HNP:` | 공개 | compact state. PRICE / ISSUES / ACTS. 말한 턴 또는 가격 fact에서 만든 행위 열 | `encodeHnpCompactStateForLlm` |
| 8 | `NEGOTIATION_HINT:` | 서버 | 작은 갭이면 ACCEPT를 숫자로 못 박음 | `encodeClosingHint` |
| 9 | `SIG:` | 공개 | Context가 만든 L5 한 줄들만 | `decide.ts`가 layers.L5_signals를 넘김 |

말한 턴이 있으면 턴이 행위가 된다. 없으면 라운드 fact의 구매자/판매자 호가가 행위가 된다. `HIST`를 다시 넣지 않는다.

---

## 프롬프트에 넣지 않는 것

| 이름 | 실제 역할 | 넣으면 안 되는 이유 |
|------|-----------|---------------------|
| `memo-codec` (`NS:`/`PT:`/`CL:`/`RM:`) | Persist 해시 (`createSnapshot`) | `S:`/`B:`/`C:` 및 HNP ACTS와 같은 숫자·이력을 다시 씀 |
| `ContextLayers.L0_protocol` | `NEGOTIATION_PROTOCOL_RULES` 문자열 | Decide가 안 읽음. `message` 금지 등 낡은 규칙 |
| `L1_model` · `L2_skill` · `L3_coaching` · `L4_history` | Context 스테이지가 조립 | Decide는 어댑터로 시스템/유저를 다시 만듦. L2/L3 덤프는 안 읽음. 스킬은 `## Skills` 칸으로만 감 |
| `PHASE_ALLOWED_ACTIONS` | Validate(Referee) | 프롬프트가 아니라 코드 가드 |

`memo_snapshot` 필드와 `memo-codec`은 **죽은 것이 아니다.** 해시·무결성용이다. 죽은 것은 “코덱 문자열을 유저 프롬프트에 또 넣는 것”이다.

HNP의 “비공개”는 **상대 에이전트·공개 GET** 기준이다. Decide는 바닥·목표·BOX를 DeepSeek 프롬프트에 싣는다. 텔레메트리는 토큰 수와 짧은 에러 분류만 남기고 프롬프트 원문·API 에러 본문은 저장하지 않는다.

---

## 시스템 프롬프트

`decide-system-prompt.ts`만 산다. `DeepSeekAdapter.buildSystemPrompt`는 이걸 호출한다.

순서: 역할 → **프로토콜 범례** → 흥정 습관 → 블록 읽는 법 → **criteria 범례 + 이 태그가 연 카드**(`criteria-fewshot.ts`, 매 Decide 호출에 항상 붙음) → **`## Skills` 칸**(`skill-slots.ts`) → JSON 출력.

`## Skills`는 항상 있다. 빈 라운드는 범례만. 채워지는 칸:

| 칸 | 누가 채우나 | 모델이 하는 일 |
|---|---|---|
| Knowledge | `getLLMContext()` + decide `categoryBrief` | 이번 품목 지식. 대본 아님 |
| Valuation | decide `valuationRules` | 칸이 가격에 어떻게 닿는지. 고정 $표 금지 |
| Tactics | decide `tactics` | `tactic_used` 후보 |
| Advisor | decide advisories | 무시해도 됨 |
| Market | context/decide 시세 | 참고. BOX가 이김 |
| Constraints | validate peek HARD/SOFT | 글로 알림. 코드 validate가 권위 |
| Tone | respond peek | Decide가 쓰는 `message` 말투 |
| Services | 이미 받은 인증/시세 사실 | 호출이 아님. 공개된 값만 |

스킬은 조언이다. BOX·바닥·HARD criteria가 이긴다. 스킬이 HNP issue id를 만들지 않는다. 스킬 달러 힌트를 바닥이나 “항상 $X”로 쓰지 않는다.

같은 역할은 같은 시스템 앞부분(역할·프로토콜·criteria 범례)을 쓴다. 아이폰 패밀리 대본을 넣지 않는다. 열린 criteria마다 짧은 카드 한 장. 이번 매물의 답과 이번 라운드 대화는 유저 쪽에만 넣는다. 이름·겹침은 [`criteria-and-issues.md`](./criteria-and-issues.md). 스킬은 엔진 플러그인이지 HNP 필드가 아니다. [`../protocol/HNP.md`](../protocol/HNP.md).

여기 문장을 바꿀 때도 이 문서를 먼저 고친다.

---

## 돈과 행위 단어

- 와이어·엔진 내부: 정수 minor (`48000`)
- Decide 프롬프트와 LLM JSON `price`: USD 달러 (`480.00`)
- HNP 행위: `OFFER` / `COUNTER` / `ACCEPT` / `REJECT`
- LLM JSON `action`: `COUNTER` / `ACCEPT` / `REJECT` / `HOLD` / `DISCOVER` / `CONFIRM`

호스트가 JSON을 봉투로 싼다. 모델이 봉투를 만들지 않는다.

---

## 변경 절차

1. 이 문서의 산 블록 표를 고친다.
2. `decide-user-prompt.ts`만 고친다. 어댑터에 두 번째 조립을 만들지 않는다.
3. `decide-prompt-contract.test.ts`가 새 표를 대변하게 고친다.
4. SOT §5.4는 이 문서로 연결만 유지한다. 블록 목록을 SOT에 다시 적지 않는다.

새 이력을 넣고 싶으면 HNP ACTS를 확장한다. `HIST`나 `RM:`을 프롬프트에 되살리지 않는다.

시스템 프롬프트를 바꿀 때는 `decide-system-prompt.ts`와 `criteria-fewshot.ts`와 `skill-slots.ts`만 고친다. 어댑터에 두 번째 시스템 본문을 만들지 않는다. 카테고리 패밀리 대본을 다시 넣지 않는다. 카드는 민감도만 — 고정 가격 표 금지. 새 스킬은 훅을 채우고 칸에 넣는다. HNP 봉투에 스킬 본문을 넣지 않는다.
