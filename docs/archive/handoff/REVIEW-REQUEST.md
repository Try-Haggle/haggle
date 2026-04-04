# Review Request — Step 1
*Written by Builder. Read by Reviewer.*

Ready for Review: YES (post-feedback fixes applied 2026-04-03)

---

## What Was Built

Pure logic tag system package (`@haggle/tag-core`) with tag normalization, lifecycle management (CANDIDATE/EMERGING/OFFICIAL/DEPRECATED), similar tag clustering via Levenshtein distance + synonym maps, and expert tag qualification. Zero external dependencies. 65 tests, all passing. Typecheck clean.

## Files Changed

| File | Lines | Change |
|---|---|---|
| `packages/tag-core/src/types.ts` | 1-115 | All types, interfaces, and defaultTagConfig() with injectable thresholds |
| `packages/tag-core/src/normalize.ts` | 1-95 | Tag normalization (lowercase, trim, collapse whitespace, truncate) + validation + hierarchy extraction |
| `packages/tag-core/src/lifecycle.ts` | 1-165 | promote, autoPromote, deprecate (time-based), reactivate, isValidTransition, VALID_TRANSITIONS map |
| `packages/tag-core/src/cluster.ts` | 1-155 | Pure Levenshtein (Wagner-Fischer DP), synonym lookup, findSimilarTags, suggestMerges with deduplication |
| `packages/tag-core/src/expert.ts` | 1-70 | isExpertQualified, qualifyExpert (returns ExpertTag or null), qualifyExperts (batch) |
| `packages/tag-core/src/index.ts` | 1-5 | Re-exports all modules |
| `packages/tag-core/package.json` | 1-23 | Matches arp-core pattern exactly, vitest devDep only |
| `packages/tag-core/tsconfig.json` | 1-9 | Matches arp-core pattern exactly |
| `packages/tag-core/vitest.config.ts` | 1-7 | Matches arp-core pattern exactly |
| `packages/tag-core/src/__tests__/normalize.test.ts` | 1-95 | 17 tests: normalization, validation, hierarchy, edge cases |
| `packages/tag-core/src/__tests__/lifecycle.test.ts` | 1-130 | 18 tests: promote, autoPromote, deprecate, reactivate, valid transitions |
| `packages/tag-core/src/__tests__/cluster.test.ts` | 1-155 | 21 tests: Levenshtein correctness, synonyms, findSimilar, suggestMerges |
| `packages/tag-core/src/__tests__/expert.test.ts` | 1-85 | 9 tests: qualification, batch qualifying, custom thresholds |

## Open Questions

- `autoPromote` allows CANDIDATE to jump to OFFICIAL in one call when useCount >= 50 (skips EMERGING). The `isValidTransition` map says CANDIDATE->OFFICIAL is invalid. These serve different purposes: autoPromote is the engine, isValidTransition is the single-step constraint. Richard should confirm this is the intended design.
- Added `MergeSuggestion`, `TagValidationResult`, and `LifecycleResult` types not explicitly listed in the brief but needed for structured return values. Verify these are acceptable additions.

## Review Feedback Fixes Applied (2026-04-03)

**MUST FIX (all 3 resolved):**
1. `lifecycle.ts deprecate()`: Added isNaN guards on both parsed timestamps. Returns non-transitioned LifecycleResult with "Invalid date: lastUsedAt" or "Invalid date: nowIso" on malformed input.
2. `lifecycle.ts isValidTransition`: Added JSDoc clarifying it validates single-step transitions only, and that autoPromote may perform compound transitions.
3. `lifecycle.test.ts`: Added 5 new tests — deprecate with garbage nowIso, deprecate with invalid lastUsedAt, autoPromote on OFFICIAL (no-op), autoPromote on DEPRECATED (no-op), promote on DEPRECATED (no-op). Also added 1 promote-on-DEPRECATED test.

**SHOULD FIX (all 4 resolved inline):**
1. `cluster.ts findSimilarTags` JSDoc: Fixed to say "Uses Levenshtein distance" (removed synonym mention).
2. `cluster.ts suggestMerges`: Added one-line comment noting O(n^2) complexity is intentional at MVP scale.
3. `normalize.test.ts`: Added test for extractHierarchy("///") returning [].
4. `expert.ts qualifyExpert`: Added comment that date validation is caller's responsibility.

**ARCH DECISION (kept as-is per Architect):**
- autoPromote vs isValidTransition: Both kept. JSDoc added to isValidTransition stating it validates single-step transitions only. No isValidCompoundTransition added. VALID_TRANSITIONS map unchanged.

**Test count**: 65 -> 71 (6 new tests). All passing. Typecheck clean.

## Known Gaps Logged

None. All brief requirements addressed.
