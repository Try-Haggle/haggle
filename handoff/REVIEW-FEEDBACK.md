# Review Feedback — Step 67 (P2: 미래 대비 구조)

**Reviewer**: Richard
**Date**: 2026-04-12
**Ready for Builder**: YES

---

## Must Fix

None.

---

## Should Fix

### S1 — `pipeline.ts:54-56` resolveMemoEncoding called without model metadata

- **File**: `apps/api/src/negotiation/pipeline/pipeline.ts:54-56`
- **What is wrong**: The call `resolveMemoEncoding({ encoding: deps.memoEncoding as '...' })` omits `modelContextWindow` and `tokenCostPerM`. The function defaults these to `0` and `999` respectively, which means `auto` will always resolve to `codec`. The brief's pseudocode at Step 67-B shows passing `deps.config.adapters.DECIDE.contextWindow` and `deps.config.tokenCostPerM`, but neither field exists on `ModelAdapter` or `StageConfig` yet.
- **Recommendation**: This is functionally correct for Phase 0 because `auto → codec` is the safe default, and the threshold logic itself is tested in `memo-encoding.test.ts`. Add a brief comment at line 54 explaining that `modelContextWindow`/`tokenCostPerM` will be wired when `ModelAdapter` gains those fields. Under 1 minute. Not blocking because the auto-to-codec fallback is intentionally conservative.

### S2 — `pipeline/types.ts:159` redundant union type

- **File**: `apps/api/src/negotiation/pipeline/types.ts:159`
- **What is wrong**: `memoEncoding: MemoEncoding | MemoEncodingConfig` where `MemoEncoding = 'codec' | 'raw'` and `MemoEncodingConfig = 'auto' | 'codec' | 'raw'`. The union simplifies to just `MemoEncodingConfig`. Having both types in the union suggests two independent concepts when they are a subset relationship.
- **Recommendation**: Change to `memoEncoding: MemoEncodingConfig` and remove the `MemoEncoding` import if unused. Under 1 minute. Not blocking because the types are equivalent at runtime.

---

## Escalate to Architect

None.

---

## Cleared

### Key Review Point 1 — Validator Lite backward compat: PASS

`validator.ts:27` — `mode: ValidationMode = 'full'` is optional with default. The existing signature (`move, memory, coaching, previousMoves, currentPhase`) still works without the sixth argument. Test `validator-lite.test.ts:108-117` explicitly confirms the default mode detects V4. All 9 existing validator tests pass unchanged because they never pass a `mode` argument.

The lite early-return at lines 74-81 is correct: it returns after V1-V3 checks, including only existing violations (all HARD at that point). `passed` checks total violation count, `hardPassed` filters for HARD only. Both fields are populated before the early return.

### Key Review Point 2 — ViolationTracker hit rate and mode recommendation: PASS

`violation-tracker.ts:50` — hit rate: `hard_violations / total_rounds`. Correct. Division-by-zero guarded at line 50: `this._totalRounds > 0 ? ... : 0`.

`getRecommendedMode()` at line 62: returns `'full'` until `MIN_SAMPLE_SIZE` (100) rounds recorded, then `rate < LITE_THRESHOLD` (0.01) for `'lite'`. Tests at lines 68-70 (below min sample), 73-77 (200 clean rounds = lite), 79-85 (2/100 = 2% = full). Correct.

The brief mentions "Lite에서 HARD 히트 발생 → 자동으로 full 복귀 + 경고 로그." The tracker does not implement auto-revert itself; it is a data provider. Auto-revert would be the caller's responsibility (the executor reading `getRecommendedMode()` and switching). This is the correct separation of concerns for a P2 prep step. The tracker is in-memory and session-scoped -- cross-session aggregation is explicitly Phase 1 scope per the review request.

### Key Review Point 3 — resolveMemoEncoding boundary values: PASS

`config.ts:54` — `> 500_000` (strict greater-than, not >=) and `< 0.05` (strict less-than, not <=). Tests in `memo-encoding.test.ts` cover all four boundaries: exact 500K returns codec (line 47-56), 500_001 returns raw (line 58-66), exact $0.05 returns codec (line 68-77), $0.049 returns raw (line 79-87). Both conditions are AND. Defaults are conservative: `modelContextWindow ?? 0` and `tokenCostPerM ?? 999`. Missing both fields always returns codec. Correct.

### Key Review Point 4 — Pipeline presets boundary values: PASS

`pipeline-presets.ts:21-62` — Four tiers with contiguous ranges: [0, 10K), [10K, 50K), [50K, 500K), [500K, Infinity). `getPresetForAmount` uses `>= min_amount && < max_amount`, so boundary values go to the higher tier (e.g., exactly 10000 cents = standard, not quick). Tests at lines 90-93 verify contiguity (`PRESETS[i].min_amount === PRESETS[i-1].max_amount`) and lines 96-99 verify start at 0 and end at Infinity. Boundary tests at lines 15-19 ($99.99 = quick), 20-23 ($100 = standard), 30-33 ($500 = premium), 40-43 ($5000 = enterprise). No gaps, no overlaps.

Fallback at line 72 returns `PIPELINE_PRESETS[1]!` (standard) for any amount that falls through. Only possible for negative amounts, which cannot occur in production (cents are unsigned). Reasonable defensive fallback.

Presets are data-only in this step. Not wired to the executor. Acceptable as P2 prep per the brief.

### Key Review Point 5 — SkillFactory wrapping pattern: PASS

`skill-factory.ts:58-108` — `TemplateSkill` holds a private `_base: DefaultEngineSkill` and a `_template: SkillTemplate`. Template overrides metadata methods: `getLLMContext()`, `getTactics()`, `getConstraints()`, `getTermDeclaration()`. Behavior methods `generateMove()` and `evaluateOffer()` delegate to `this._base`. Clean composition: the base skill handles negotiation logic, the template provides category-specific metadata.

`DefaultEngineSkill` is not modified. Verified via `git diff HEAD` on that file: empty output.

`DefaultSkillFactory` constructor calls `registerElectronicsTemplate()` which calls `createFromTemplate()`, storing both the template and the created skill. `listTemplates()` and `getSkillForCategory()` work correctly. Test at line 64-93 verifies that `generateMove` delegates successfully to the base skill and returns a valid `ProtocolDecision`.

### Key Review Point 6 — Protected files: PASS

`git diff HEAD` against `negotiation/referee/coach.ts`, `negotiation/referee/referee-service.ts`, `negotiation/skills/default-engine-skill.ts`, `negotiation/stages/*`, `negotiation/memo/*` produces empty output. All protected files are untouched.

### Test count — 54 new tests across 5 files: CONSISTENT

violation-tracker (10) + validator-lite (8) + pipeline-presets (18) + memo-encoding (10) + skill-factory (8) = 54. Bob reports 789 existing + 54 new = 843 total. Consistent.

---

## Summary

Solid P2 prep work. All four sub-steps implement the correct interfaces and logic per the brief. Validator lite mode preserves backward compatibility through an optional default parameter. ViolationTracker correctly computes hit rates with conservative minimum sample size. Memo encoding auto-resolution has correct boundary logic, though the pipeline call currently cannot trigger the raw path (see S1 -- acceptable for Phase 0). Pipeline presets have contiguous non-overlapping ranges with proper boundary handling. SkillFactory cleanly wraps DefaultEngineSkill without modifying it. Protected files are untouched. 843 tests pass.

Should Fix items are cosmetic: missing comment on incomplete wiring (S1), redundant union type (S2). Neither is blocking.

Step 67 is clear.

-- Richard
