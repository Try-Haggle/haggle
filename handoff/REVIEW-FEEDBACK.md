# Review Feedback — Step 65 (6-Stage Pipeline 리팩토링 + 모듈화)

**Reviewer**: Richard
**Date**: 2026-04-12
**Ready for Builder**: YES

---

## Must Fix

None.

---

## Should Fix

### S1 — `SessionState` type is defined but unused

- **File**: `apps/api/src/negotiation/pipeline/types.ts:167-172`
- **What is wrong**: `SessionState` interface is defined but never referenced by any stage or by `executePipeline()`. The brief shows `executePipeline(session: SessionState, ...)` as the first parameter, but Bob's implementation extracts session data from `PipelineDeps.memory.session` instead. The approach works, but `SessionState` is dead code.
- **Recommendation**: Either remove `SessionState` from types.ts or use it in `executePipeline()`'s signature. Under 2 minutes. Not blocking because there is no runtime effect.

### S2 — `decide.ts:79` bare catch swallows error silently

- **File**: `apps/api/src/negotiation/stages/decide.ts:79`
- **What is wrong**: `catch {}` with no logging. When the LLM call fails, the fallback to skill is correct, but the error is completely discarded. In production, if every LLM call is silently failing (e.g., API key expired, network issue), there is zero observability. The legacy executor at least had `console.warn`.
- **Recommendation**: Add `catch (err) { console.warn('[decide] LLM fallback:', (err as Error).message); }`. Quick fix. Not blocking because the fallback behavior is correct.

### S3 — `executor.ts` hardcodes `skill_summary: 'electronics-iphone-pro-v1'` in `buildInitialMemory`

- **File**: `apps/api/src/negotiation/pipeline/executor.ts:491`
- **What is wrong**: Same issue flagged in Step 57 review (S4). Still hardcoded. Acceptable for Phase 0 (electronics only) but should be logged in BUILD-LOG if not already.
- **Recommendation**: Already logged from Step 57. No additional action needed.

### S4 — `executor.ts` duplicates `mapActionToDbDecision` and `mapActionToMessageType` from legacy executor

- **File**: `apps/api/src/negotiation/pipeline/executor.ts:520-546`
- **What is wrong**: These two functions are near-identical copies of the ones in `lib/llm-negotiation-executor.ts`. When one is fixed, the other must be fixed too — maintenance risk. Note: the staged executor version correctly includes HOLD→ESCALATE and DISCOVER→ESCALATE cases for `mapActionToMessageType` (lines 539-542), which was flagged as S1 in the Step 57 review. Good — Bob applied the fix in the new code. But the duplication remains.
- **Recommendation**: Extract to a shared utility in `negotiation/` when the legacy executor is removed. Not blocking now because the feature flag means only one path runs at a time.

---

## Escalate to Architect

None.

---

## Cleared

### Key Review Point 1 — Feature flag safety: PASS

`executor-factory.ts:31-35` — `getPipelineMode()` defaults to `'legacy'`. Only explicit `NEGOTIATION_PIPELINE=staged` activates the new pipeline. `getExecutor()` checks engine mode first (`rule` vs `llm`), then pipeline mode. When `NEGOTIATION_ENGINE` is unset, `getExecutor()` returns the rule-based executor — the staged pipeline is never reachable. The two-gate pattern (engine mode + pipeline mode) means zero risk to existing behavior.

### Key Review Point 2 — Stage independence: PASS

Stages 1-5 are pure functions with no DB, no I/O (Stage 3 calls `callLLM` but that is its stated purpose and falls back to skill on failure). Stage 6 (`persist.ts`) has the synchronous `persist()` for pure logic and the async `persistWithDb()` for DB writes — clean separation.

`hybrid.test.ts` demonstrates external agent cherry-picking: Stage 1 alone, Stage 2 alone, Stage 4 with an external decision, Stage 5 alone, and the composed flow Stage 2→4→5 skipping Stage 3. All 5 tests exercise independent stage invocation. The `stages/index.ts` re-exports all 6 stage functions as named exports.

### Key Review Point 3 — Explainability integrity: PASS

`validate.ts:39-55` — `allViolations` array collects violations from every validation pass (initial + each retry). After auto-fix, the re-validation violations are appended, not replacing the originals. `buildExplainability` at line 58 receives `allViolations` (the complete history) and deduplicates by `rule:severity` key. The `refereeAction` logic at lines 94-102 correctly distinguishes:
- `AUTO_FIX` — when `autoFixApplied` is true (even if final validation passes)
- `BLOCK` — when final validation still has HARD failures
- `WARN_AND_PASS` — when there were violations but all resolved
- `PASS` — clean run

Test `validate.test.ts:72-91` confirms AUTO_FIX detection and `validate.test.ts:136-164` confirms WARN_AND_PASS for SOFT-only violations.

### Key Review Point 4 — Memo hash consistency: PASS

`memo-manager.ts:31-33` — `computeMemoHash` takes `sharedMemo: string` only. `createSnapshot` at lines 43-82 splits the full encoded memo on `\n---\n` separator, extracts the shared layer, and hashes only that portion. The private layer is stored separately and never included in the hash.

`memo-manager.test.ts:103-108` — explicitly tests that modifying the private layer does not affect hash verification. `memo-manager.test.ts:97-101` — confirms tampered shared content fails verification.

The `encodeCompressed` function in `memo-codec.ts:31-35` joins shared and private with `\n---\n`. The split in `createSnapshot` is the inverse operation. For raw encoding (no separator), the entire content is treated as shared and private is empty string — hash still covers everything, which is correct.

### Key Review Point 5 — LLM call isolation: PASS

`decide.ts:38-83` — LLM call only fires when `phase === 'BARGAINING' && decision.action === 'COUNTER'`. The `catch {}` at line 79 ensures any LLM failure silently falls back to the skill decision already computed at line 26. No exception propagates.

Pipeline tests use `reasoningEnabled: false` in `StageConfig` (pipeline.test.ts:17). This prevents `shouldUseReasoning()` from returning true, so `callLLM` is never invoked. The test still exercises the full pipeline because the skill always produces a valid decision. This is the correct approach — unit tests should not depend on external LLM services.

`decide.test.ts:137-156` confirms that without a real LLM endpoint, the BARGAINING+COUNTER path falls back to skill and returns a valid decision with latency tracking.

### Key Review Point 6 — context-assembly.ts preserved: PASS

`context.ts:9` imports `assembleContextLayers` from `../adapters/context-assembly.js`. The file exists at its original path (`apps/api/src/negotiation/adapters/context-assembly.ts`). No modifications to the file. Existing imports from the legacy executor path remain valid.

### Protected files: PASS

`git diff HEAD` against `negotiation/referee/`, `negotiation/skills/`, `negotiation/memory/`, `negotiation/phase/`, `negotiation/adapters/xai-client.ts`, and `lib/llm-negotiation-executor.ts` produces empty output. All protected files are untouched.

### Type compliance: PASS

All interfaces in `pipeline/types.ts` match the brief's specifications exactly. `L5Signals`, `RoundExplainability`, `StageConfig` in `types.ts:282-348` match the brief. `ModelAdapter` extended with `location` and `capabilities` at `types.ts:354-369`. `GrokFastAdapter` implements both new fields at lines 18-19.

### Test count: Bob reports 752 total (640 existing + 58 new + 54 from Step 57). New test files account for 58 tests across 9 files (8+5+5+6+5+9+7+8+5 = 58). Consistent.

---

## Summary

Clean modular decomposition. The 6-stage pipeline is well-separated with correct I/O boundaries. Each stage is independently testable and callable by external agents. The feature flag is safe — `legacy` is the default, `staged` requires explicit opt-in. Protected files are untouched. Memo hash correctly covers only the shared layer. Explainability tracks the full violation history including pre-fix state.

Should Fix items are minor: dead type (S1), silent catch (S2), known hardcoded value (S3), function duplication pending legacy removal (S4). None are blocking.

Step 65 is clear.

-- Richard
