# Review Request — Step 66 (Phase B: P0 차별화 기능)

**Builder:** Bob
**Date:** 2026-04-12
**Ready for Review:** YES

## Scope

Doc 28 P0 features: Explainability API 노출, L5 Signals 서비스, Checkpoint DB 영속화 인터페이스, 외부 에이전트용 Stage API 라우트. 기존 752 tests 전부 통과 + 37 new = 789 total.

## Architecture Change

```
[66-A] POST /offers → explainability in response (when staged + ?include_explainability=true)
       GET /sessions/:id/decisions → round-by-round explainability log

[66-B] executeStagedRound → getL5SignalsProvider() → pipeline deps.l5_signals
       StaticL5SignalsProvider → hardcoded Swappa medians

[66-C] CheckpointStore(persistence?) → in-memory + optional DB callback
       Checkpoint { ...existing, explainability?, memo_hash? }

[66-D] POST /negotiations/stages/context  → Stage 2 (external agent)
       POST /negotiations/stages/validate → Stage 4 (external agent)
       POST /negotiations/stages/respond  → Stage 5 (external agent)
```

## Files Created (6)

- `apps/api/src/services/l5-signals.service.ts`
  L5SignalsProvider 인터페이스 + StaticL5SignalsProvider (Swappa hardcoded medians, condition multiplier). Singleton 관리 + test reset.

- `apps/api/src/routes/negotiation-stages.ts`
  Stage 2/4/5 API 라우트. Zod 스키마 검증, pipeline mode guard (`NEGOTIATION_PIPELINE=staged` 필수), auth + `x-haggle-actor-id` 헤더 필수.

- `apps/api/src/__tests__/explainability-api.test.ts` — 4 tests
- `apps/api/src/__tests__/l5-signals.test.ts` — 14 tests
- `apps/api/src/__tests__/checkpoint-persistence.test.ts` — 11 tests
- `apps/api/src/__tests__/stage-routes.test.ts` — 8 tests

## Files Modified (5)

- `apps/api/src/negotiation/types.ts:215-227`
  Checkpoint에 `explainability?: RoundExplainability`, `memo_hash?: string` 추가.

- `apps/api/src/negotiation/memory/checkpoint-store.ts:1-153`
  CheckpointPersistence 인터페이스 추가, constructor에 optional persistence 파라미터, save()에서 persistence?.save() 호출, hydrate() 메서드 추가. 기존 API 시그니처 100% 호환.

- `apps/api/src/negotiation/pipeline/executor.ts:47,207-218,288-300,370-389,523-527`
  L5 signals 주입 (getL5SignalsProvider), explainability를 PersistRoundParams에 추가, 반환 결과에 explainability 포함, round metadata에 explainability 저장.

- `apps/api/src/routes/negotiations.ts:162,220-226,373-398`
  POST offers에 `include_explainability` 쿼리 파라미터 추가, GET /sessions/:id/decisions 엔드포인트 추가.

- `apps/api/src/server.ts:24,103`
  registerStageRoutes import + 호출 추가.

## Files NOT Touched

- `negotiation/referee/` — 전부 미변경
- `negotiation/skills/` — 전부 미변경
- `negotiation/stages/` — Step 65 그대로 (import만)
- `negotiation/memo/` — memo-codec.ts, memo-manager.ts 미변경 (checkpoint-store.ts만 수정)
- `negotiation/phase/` — 전부 미변경
- `negotiation/adapters/xai-client.ts` — 미변경
- `lib/llm-negotiation-executor.ts` — 삭제 안 함

## Validation

```
pnpm --filter @haggle/api typecheck   # 2 pre-existing errors (llm-executor-integration.test.ts), 0 in new/modified files
pnpm --filter @haggle/api test        # 789 passed (0 failing)
```

## Key Review Points (Richard)

1. **Feature flag 안전성** — `NEGOTIATION_PIPELINE=legacy`이면 explainability 필드 미포함, stage routes 404 반환. 기존 동작 100% 보존.

2. **CheckpointStore 하위 호환** — persistence 파라미터가 optional이라 `new CheckpointStore()` 기존 호출 전부 동일 동작. 기존 checkpoint 테스트 통과 확인.

3. **L5 Signals non-fatal** — executor에서 `.catch(() => undefined)`로 감싸서 market data 실패 시 pipeline 중단 없음. 이 패턴이 에러를 삼키지 않는지 확인.

4. **Explainability in metadata** — round metadata JSON에 explainability 저장. 대량 데이터 시 metadata 필드 크기 문제 가능성 (Phase 1: 별도 테이블 고려).

5. **Stage routes stateless** — validateStage에 previousMoves=[] 전달. 외부 에이전트가 충분한 컨텍스트 없이 호출하면 V6_STAGNATION 등 판정이 부정확할 수 있음. API 문서에 명시 필요.

6. **Swappa medians 하드코딩** — Phase 0 정적 데이터. 가격 변동 반영 안 됨. Phase 1: API 연동 시 StaticL5SignalsProvider를 SwappaApiProvider로 교체하면 됨 (인터페이스 변경 불필요).

7. **extractItemModel fallback** — strategy_snapshot에 item_model 없으면 `iphone-14-pro-128` 하드코딩. Phase 0 전용이라 허용 가능하지만, Phase 1에서 다른 카테고리 추가 시 수정 필요.
