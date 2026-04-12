# Review Request — Step 67 (P2: 미래 대비 구조)

**Builder:** Bob
**Date:** 2026-04-12
**Ready for Review:** YES

## Scope

Doc 28 P2 features: Validator Lite 모드 + HARD 히트율 추적, Codec/Raw 동적 전환, 카테고리/금액별 파이프라인 프리셋, Skill Factory 인터페이스. 기존 789 tests 전부 통과 + 54 new = 843 total.

## Architecture Change

```
[67-A] validateMove(move, mem, coaching, prevMoves, phase, mode='full')
       mode='lite' → V1-V3 HARD only, V4-V7 SOFT skipped
       ViolationTracker → HARD hit rate tracking → recommended mode

[67-B] resolveMemoEncoding({ encoding, modelContextWindow?, tokenCostPerM? })
       'auto' → context 500K+ AND cost < $0.05/M → 'raw', else 'codec'
       pipeline.ts resolves before Stage 2 and Stage 6

[67-C] PIPELINE_PRESETS: quick(<$100)/standard($100-500)/premium($500-5K)/enterprise($5K+)
       getPresetForAmount(cents) → { max_rounds, phases, reasoning_enabled, respond_mode }

[67-D] SkillFactory → createFromTemplate(template) → TemplateSkill (wraps DefaultEngineSkill)
       DefaultSkillFactory auto-registers electronics template
```

## Files Created (8)

- `apps/api/src/negotiation/referee/violation-tracker.ts`
  ViolationTracker class: record(), getStats(), getRecommendedMode(), reset(). LITE_THRESHOLD=0.01, MIN_SAMPLE_SIZE=100.

- `apps/api/src/negotiation/config/pipeline-presets.ts`
  PipelinePreset interface, PIPELINE_PRESETS array (4 tiers), getPresetForAmount(), getPresetByName().

- `apps/api/src/negotiation/skills/skill-factory.ts`
  SkillTemplate, SkillFactory interface, DefaultSkillFactory, TemplateSkill (wraps DefaultEngineSkill).

- `apps/api/src/negotiation/referee/__tests__/violation-tracker.test.ts` — 10 tests
- `apps/api/src/negotiation/referee/__tests__/validator-lite.test.ts` — 8 tests
- `apps/api/src/negotiation/config/__tests__/pipeline-presets.test.ts` — 18 tests
- `apps/api/src/negotiation/config/__tests__/memo-encoding.test.ts` — 10 tests
- `apps/api/src/negotiation/skills/__tests__/skill-factory.test.ts` — 8 tests

## Files Modified (5)

- `apps/api/src/negotiation/config.ts:19-55`
  ValidationMode, getValidationMode(), MemoEncodingConfig, getMemoEncoding(), resolveMemoEncoding().

- `apps/api/src/negotiation/referee/validator.ts:8,25,73-81`
  Import ValidationMode. Optional `mode` param (default 'full'). Lite early-return after V3.

- `apps/api/src/negotiation/types.ts:350`
  StageConfig.memoEncoding: `'codec' | 'raw'` → `'auto' | 'codec' | 'raw'`.

- `apps/api/src/negotiation/pipeline/types.ts:24-25,158`
  Import MemoEncodingConfig. PipelineDeps.memoEncoding type widened.

- `apps/api/src/negotiation/pipeline/pipeline.ts:20,52-57,99`
  Import resolveMemoEncoding. Resolve encoding before Stage 2 and Stage 6.

## Files NOT Touched

- `negotiation/referee/coach.ts` — unchanged
- `negotiation/referee/referee-service.ts` — unchanged
- `negotiation/skills/default-engine-skill.ts` — unchanged
- `negotiation/stages/*` — unchanged
- `negotiation/memo/*` — unchanged
- `lib/llm-negotiation-executor.ts` — unchanged

## Validation

```
pnpm --filter @haggle/api typecheck   # 2 pre-existing errors (llm-executor-integration.test.ts), 0 in new/modified files
pnpm --filter @haggle/api test        # 843 passed (0 failing)
```

## Key Review Points (Richard)

1. **Validator Lite backward compat** — `mode` parameter is optional with default `'full'`. All 9 existing validator tests pass unchanged. Verify no caller needs updating.

2. **StageConfig type widening** — `memoEncoding` now accepts `'auto'`. Existing code always passes `'codec'` explicitly, so no runtime behavior change. Verify no downstream type narrowing breaks.

3. **resolveMemoEncoding boundary values** — `> 500_000` (not `>=`) and `< 0.05` (not `<=`). Tests cover exact boundaries. Verify this matches Doc 28 intent.

4. **Pipeline presets are data-only** — Not wired into executor.ts in this step. The executor still uses `DEFAULT_MAX_ROUNDS` and `buildDefaultStageConfig()`. Future step should call `getPresetForAmount(dbSession.listingPriceMinor)` and apply preset to StageConfig. Verify this is acceptable as P2 prep-only.

5. **SkillFactory wraps DefaultEngineSkill** — TemplateSkill delegates generateMove/evaluateOffer to DefaultEngineSkill instance. Template only overrides metadata (getLLMContext, getTactics, getConstraints, getTermDeclaration). Verify this delegation pattern is acceptable vs. template-based behavior override.

6. **ViolationTracker is in-memory** — No DB persistence. Session-scoped usage only. Verify Phase 1 plan for cross-session HARD rate aggregation is separate.

7. **Preset range contiguity** — Tests verify PIPELINE_PRESETS have contiguous non-overlapping ranges [0, 10K), [10K, 50K), [50K, 500K), [500K, Inf). Verify boundary at $100 (10K cents) aligns with business logic.
