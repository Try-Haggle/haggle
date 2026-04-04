# Review Feedback — Step 1
*Written by Reviewer. Read by Builder and Architect.*

Date: 2026-04-03
Ready for Builder: NO

---

## Must Fix
*Blocks the step. Builder fixes before anything moves forward.*

- **lifecycle.ts:132-134** — `deprecate()` does no validation on the `nowIso` or `tag.lastUsedAt` date strings. If either is malformed, `new Date(...)` returns `Invalid Date` and `.getTime()` returns `NaN`. The subtraction produces `NaN`, the comparison `NaN >= 90` is `false`, and the function silently reports "Only NaN days since last use" as the reason. This is a silent failure on untrusted input. Fix: add an `isNaN` guard on both `lastUsed` and `now` after parsing. Return a non-transitioned `LifecycleResult` with a clear error reason like `"Invalid date: lastUsedAt"` or `"Invalid date: nowIso"`. This is the same pattern arp-core uses for invalid inputs — fail explicitly, never silently.

- **lifecycle.ts:60-101 + lifecycle.ts:189-201** — `autoPromote` performs CANDIDATE->OFFICIAL in one call, but `isValidTransition("CANDIDATE", "OFFICIAL")` returns `false`. Both are public API. Any external consumer who calls `autoPromote` and then validates the result with `isValidTransition(previousStatus, newStatus)` will get `false` for a transition that `autoPromote` intentionally performed. This is a semantic contradiction in the exported API surface. See Escalate section below for resolution options. Blocks because shipping contradictory public APIs creates integration bugs downstream.

- **lifecycle.test.ts** — Missing edge case tests for failure paths. Add tests for: (1) `deprecate` with an invalid/garbage date string for `nowIso`, (2) `deprecate` with an invalid `lastUsedAt` on the tag, (3) `autoPromote` on an OFFICIAL tag (should be no-op), (4) `autoPromote` on a DEPRECATED tag (should be no-op), (5) `promote` on a DEPRECATED tag (should be no-op). These are all reachable states and the current test suite has zero coverage for them.

## Should Fix
*Does not block. Fix inline if under 5 minutes, otherwise log to BUILD-LOG.*

- **cluster.ts:98-99 (JSDoc)** — `findSimilarTags` JSDoc says "Uses both Levenshtein distance and synonym map" but the implementation only checks Levenshtein distance. The synonym logic lives in `suggestMerges`, not here. Either add synonym detection to `findSimilarTags` or fix the JSDoc to say "Uses Levenshtein distance." Misleading documentation is a defect. Under 5 minutes — fix inline.

- **cluster.ts:138-183** — `suggestMerges` is O(n^2) with Levenshtein inside the inner loop, making total complexity O(n^2 * m) where m is max tag name length. Not a blocker for MVP tag pool sizes, but add a one-line comment noting the quadratic complexity so the next person knows it is intentional at this scale, not an oversight.

- **normalize.test.ts** — No test for a tag consisting only of hierarchy separators (e.g., `"///"`). `extractHierarchy` would filter the empty parts and return `[]`, which is likely correct, but a test documenting this behavior would prevent future regressions. Under 5 minutes — add one test case.

- **expert.ts:36-53** — `qualifyExpert` accepts `nowIso` as a string and stores it directly in `qualifiedAt` without validation. Unlike the `deprecate` case there is no arithmetic on this value, so it is lower severity. Add a brief comment noting that date validation is the caller's responsibility, or add a minimal `isNaN(new Date(nowIso).getTime())` guard. Not blocking.

- **types.ts:73-78, 109-125** — `MergeSuggestion`, `TagValidationResult`, and `LifecycleResult` are not listed in the brief. Bob flagged this. All three are structured return types required by the functions the brief did specify. They follow the same pattern as arp-core's `AdjustmentResult` and `SignalResult`. Acceptable drift — no action required. Noted for the record.

## Escalate to Architect
*Product or business decision required.*

- **autoPromote vs isValidTransition contradiction** — `autoPromote` allows CANDIDATE to jump to OFFICIAL in one call (multi-step). `isValidTransition("CANDIDATE", "OFFICIAL")` returns `false` (single-step only). Both are public exports. Arch needs to decide one of: (a) Keep both as-is but add a `isValidCompoundTransition` function or prominent JSDoc on `isValidTransition` stating it validates single-step transitions only, so downstream consumers know not to use it to validate `autoPromote` results. (b) Add `"OFFICIAL"` to `VALID_TRANSITIONS.CANDIDATE` — but this weakens the single-step constraint which other code may rely on. (c) Remove the CANDIDATE->OFFICIAL skip from `autoPromote` and require two separate calls. This is a design decision about the public API contract, not a code fix. I cannot resolve it at the code level because either direction changes the intended semantics.

## Cleared

Package scaffolding (package.json, tsconfig.json, vitest.config.ts, index.ts) matches arp-core exactly — verified field by field. Tag normalization logic (lowercase, trim, collapse whitespace, truncate) is correct with good edge case coverage. Levenshtein implementation is textbook Wagner-Fischer with single-row space optimization and early termination — verified against known distance for "kitten"/"sitting". Synonym lookup with canonical resolution and deduplication in merge suggestions is sound. Expert qualification is clean with correct boundary-inclusive checks tested at exact thresholds. All functions are immutable (spread copies, never mutate input). Config is fully injectable with sensible defaults via `defaultTagConfig()`. Hierarchy extraction and parent path resolution handle edge cases correctly. 65 tests exceeds the brief minimum of 25+. Zero external dependencies confirmed. Code is readable, well-organized, and follows project conventions throughout.
