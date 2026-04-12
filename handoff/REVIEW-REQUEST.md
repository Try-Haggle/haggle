# Review Request — Step 65 (6-Stage Pipeline 리팩토링 + 모듈화)

**Builder:** Bob
**Date:** 2026-04-12
**Ready for Review:** YES

## Scope

13-step monolith executor를 6-Stage 독립 모듈로 분리. Feature flag `NEGOTIATION_PIPELINE=legacy|staged`로 전환 가능. 기존 legacy 경로 미변경, 기존 640 tests 전부 통과.

## Architecture Change

```
[기존] POST /offers → executor-factory → llm-negotiation-executor (13 steps)
                                                    ↓ (NEGOTIATION_PIPELINE=staged)
[신규] POST /offers → executor-factory → pipeline/executor → executePipeline()
                                                    ↓
                    Stage 1 Understand → Stage 2 Context → Stage 3 Decide →
                    Stage 4 Validate → Stage 5 Respond → Stage 6 Persist
```

## Files Created (17)

### Types (65-A)
- `apps/api/src/negotiation/pipeline/types.ts`
  Stage I/O 타입 정의 (UnderstandInput/Output, ContextInput/Output, DecideInput/Output, ValidateInput/Output, RespondInput/Output, PersistInput/Output, PipelineDeps, PipelineResult).

### Memo (65-B)
- `apps/api/src/negotiation/memo/memo-codec.ts`
  Living Memo Compressed Codec — 공유 레이어(NS/PT/CL/RM) + 비공개 레이어(SS/OM/TA/TR). codec|raw 인코딩 선택.

- `apps/api/src/negotiation/memo/memo-manager.ts`
  SHA-256 해시 계산, MemoSnapshot 생성, 무결성 검증.

### Stages (65-C)
- `apps/api/src/negotiation/stages/understand.ts`
  Stage 1. Structured input bypass (offerPriceMinor 직접 전달 시 LLM 호출 없음). 텍스트 파싱 fallback.

- `apps/api/src/negotiation/stages/context.ts`
  Stage 2. 기존 context-assembly.ts를 import하여 L0-L5 조립 + coaching 계산 + memo 인코딩.

- `apps/api/src/negotiation/stages/decide.ts`
  Stage 3. BARGAINING+COUNTER → LLM 호출(실패 시 skill fallback). 그 외 → skill 규칙 기반.

- `apps/api/src/negotiation/stages/validate.ts`
  Stage 4. V1-V7 검증 + auto-fix 루프 + RoundExplainability 생성. 전체 violation 이력 추적.

- `apps/api/src/negotiation/stages/respond.ts`
  Stage 5. template|llm 모드 분기 (llm은 현재 template fallback).

- `apps/api/src/negotiation/stages/persist.ts`
  Stage 6. Phase 전이 감지 + DB 저장 콜백. 유일한 DB 의존 Stage.

- `apps/api/src/negotiation/stages/index.ts`
  6개 Stage 함수 re-export.

- `apps/api/src/negotiation/pipeline/pipeline.ts`
  6-Stage 순차 오케스트레이터. cost 계산, explainability 누적.

### Executor (65-D)
- `apps/api/src/negotiation/pipeline/executor.ts`
  새 진입점. TX lock → memory reconstruct → screening → pipeline → persist.

### Tests (65-E)
- `apps/api/src/negotiation/stages/__tests__/understand.test.ts` — 8 tests
- `apps/api/src/negotiation/stages/__tests__/context.test.ts` — 5 tests
- `apps/api/src/negotiation/stages/__tests__/decide.test.ts` — 5 tests
- `apps/api/src/negotiation/stages/__tests__/validate.test.ts` — 6 tests
- `apps/api/src/negotiation/stages/__tests__/respond.test.ts` — 5 tests
- `apps/api/src/negotiation/memo/__tests__/memo-codec.test.ts` — 9 tests
- `apps/api/src/negotiation/memo/__tests__/memo-manager.test.ts` — 7 tests
- `apps/api/src/negotiation/pipeline/__tests__/pipeline.test.ts` — 8 tests (E2E)
- `apps/api/src/negotiation/pipeline/__tests__/hybrid.test.ts` — 5 tests (외부 에이전트 Stage 혼합 호출)

## Files Modified (3)

- `apps/api/src/negotiation/types.ts:282-352`
  L5Signals, RoundExplainability, StageConfig 인터페이스 추가. ModelAdapter에 location, capabilities 필드 추가.

- `apps/api/src/negotiation/adapters/grok-fast-adapter.ts:17-18`
  `readonly location = 'remote'`, `readonly capabilities = ['parse', 'reason', 'generate']` 2줄 추가.

- `apps/api/src/lib/executor-factory.ts`
  `NEGOTIATION_PIPELINE` feature flag 추가. `staged` → executeStagedNegotiationRound 라우팅.

## Files NOT Touched

- `negotiation/referee/` — coach.ts, validator.ts, referee-service.ts 전부 미변경
- `negotiation/skills/` — default-engine-skill.ts 미변경
- `negotiation/memory/` — core-memory.ts, session-memory.ts, checkpoint-store.ts 미변경
- `negotiation/phase/` — phase-machine.ts 미변경
- `negotiation/adapters/xai-client.ts` — 미변경
- `lib/llm-negotiation-executor.ts` — 삭제 안 함, legacy flag로 병행
- 기존 640 tests 전부 통과

## Validation

```
pnpm --filter @haggle/api typecheck   # 2 pre-existing errors (llm-executor-integration.test.ts), 0 in new files
pnpm --filter @haggle/api test        # 752 passed (0 failing)
```

## Key Review Points (Richard)

1. **Feature flag 안전성** — `NEGOTIATION_PIPELINE` 기본값 `legacy`이면 기존 코드 경로 100% 동일.
   `staged`일 때만 새 pipeline/executor 사용.

2. **Stage 독립성** — 각 Stage가 순수 함수인지 확인 (Stage 6 persist 제외).
   외부 에이전트가 Stage 2,4,5를 골라 쓸 수 있는지 (hybrid.test.ts 참조).

3. **Explainability 무결성** — validateStage가 auto-fix 전후 모든 violation을 추적하는지.
   AUTO_FIX 후 violations이 빈 배열이 아니라 원본 violation을 포함하는지.

4. **Memo Hash 일관성** — computeMemoHash(shared)가 shared layer만 해싱하는지.
   private layer 변경이 hash에 영향 안 주는지.

5. **LLM 호출 격리** — decide.ts의 callLLM 실패 시 skill fallback이 정상 작동하는지.
   Pipeline 테스트에서 reasoningEnabled=false로 LLM 호출 우회하는 방식이 적절한지.

6. **context-assembly.ts 미삭제** — Stage 2가 기존 모듈을 import하여 사용.
   기존 import 경로가 깨지지 않는지.
