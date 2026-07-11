# reference/referee — Stage 4 Validate (Referee) 상세

> [`../SOT.md`](../SOT.md) §5.5의 확대 문서. **현재 코드 기준**, 모든 인용 `file:line`.
> 요약: 검증 로직 본체 `validateMove()` — 7개 규칙(V1~V3 HARD, V4~V7 SOFT). 프로덕션 진입점은 `validateStage()`(Stage 4, `pipeline.ts:160`).

## 핵심 결론 (SOT 반영용)
- ✅ V1~V7 규칙 실제 구현·가동 (`validator.ts`).
- ⚠️ **HARD 위반도 실제로는 차단 안 됨** — auto-fix 2회 후 위반이 남아도 그대로 통과. `'BLOCK'`은 감사 로그 라벨일 뿐 실행을 막지 않음.
- ⚠️ **"가격 lock" 없음** — `respond.ts`에 clamp/lock 전무. 코드의 유일한 가격 개입은 V1 위반 시 floor로 덮어쓰기(soft, 2회 한정). 최종가는 결국 LLM/skill의 `decision.price`.
- 💀 `ViolationTracker`(세션 위반 누적·lite 모드 전환) **미사용** — 정의+테스트만. → 항상 `full` 모드(V1~V7 전부 평가).
- 🚧 Stage 4.5 skill validate hook: 현재 `console.info` 로깅만, 검증에 미반영("Future: merge").

## 규칙 상세 (`referee/validator.ts`, `validateMove()` `:21`)

| 규칙 | 심각도 | 검사 | 조건 (코드) | auto-fix |
|------|--------|------|-------------|----------|
| **V1** 가격 floor 초과 | HARD | 역제안가가 마지노선 위반 | buyer: `price > floor` / seller: `price < floor` (`:35,:42`) | `{price: floor}` ✅ |
| **V2** phase 미허용 action | HARD | `PHASE_ALLOWED_ACTIONS[phase]`에 action 없음 (`:54`) | `{action: allowed[0]}` ⚠️ SETTLEMENT은 `[]`라 undefined(무의미) |
| **V3** 라운드 소진 후 COUNTER | HARD | `action===COUNTER && rounds_remaining===0` (`:64`) | `{action: 'REJECT'}` ✅ |
| **V4** 양보 방향 역전 | SOFT | 최근 내 move 2개 부호 뒤집힘 (`:92`) | 없음 |
| **V5** 정체(stagnation) | SOFT | 최근 4개 move 상대변화 <2% (`STAGNATION_WINDOW=4, THRESHOLD=0.02`) | 없음 |
| **V6** 일방적 양보 | SOFT | 최근 3개 move 전부 내 양보 (`ONE_SIDED_WINDOW=3`, "approximate" 주석) | 없음 |
| **V7** 양보 폭 과다 | SOFT | `actualStep > recommendedStep × 2` (`LARGE_CONCESSION_MULTIPLIER=2`). coaching.recommended_price=0이면 미발동 | 없음 |

`PHASE_ALLOWED_ACTIONS` (`prompts/protocol-rules.ts:31`): DISCOVERY `[DISCOVER]` · OPENING `[COUNTER]` · BARGAINING `[COUNTER,ACCEPT,REJECT,HOLD]` · CLOSING `[CONFIRM,HOLD,REJECT]` · SETTLEMENT `[]`.

반환 (`:166`): `passed`(SOFT 포함 전부 통과) · `hardPassed`(HARD만) · `violations[]`.

## Auto-fix (`stages/validate.ts`)
- `MAX_RETRY = 2` (`:19`). 루프 `while (!hardPassed && retryCount < 2)` (`:46`).
- HARD 위반의 `suggested_fix`만 병합: `currentDecision = {...currentDecision, ...suggested_fix}` (`:47-53`) → 재검증 → `retryCount++`.
- **SOFT는 절대 auto-fix 안 됨.** fix 가능한 건 V1·V2·V3뿐.
- 2회 후에도 HARD 남으면 → **차단 없이 그대로 반환**(`:71-78`). explainability `referee_result.action`만 `'BLOCK'`/`'AUTO_FIX'`/`'WARN_AND_PASS'`/`'PASS'`로 기록(감사용 문자열).

## 배선 (`pipeline.ts:160`)
- 입력: `decideOutput.decision`(LLM/skill 결정) + `briefing` + `memory` + `phase` + `previousMoves`.
- `validateMove(decision, memory, memory.coaching, previousMoves, phase)` (mode 미전달 → 기본 `full`).
- 출력 `final_decision`(auto-fix 반영) → Stage 5 `respond()` (`pipeline.ts:186`)가 메시지만 렌더(가격 개입 없음).

## 대체 경로
- `RefereeService.process()` — 동일 로직, `MAX_RETRY=2`. `llm-negotiation-executor.ts`에서만 사용(파이프라인과 별개, 프로덕션 라운드 경로 아님).

## 실제 사용 여부
| 구성요소 | 프로덕션 | 근거 |
|---|---|---|
| `validateMove` / `validateStage` | ✅ | `pipeline.ts:160` |
| `RefereeService` | 별도 경로 | `llm-negotiation-executor.ts`(비주류) |
| `ViolationTracker` | 💀 미사용 | 정의+테스트뿐 |
| lite 모드 | 💀 미발동 | 항상 full |
| Stage 4.5 skill hook | 로깅만 | `pipeline.ts:176` "Future: merge" |
