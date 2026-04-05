# Build Log
*Owned by Architect. Updated by Builder after each step.*

---

## Current Status

**Active step:** 1 — Tag System (packages/tag-core)
**Last cleared:** Phase 1-2 committed (1d793cb) — 2026-04-03
**Pending deploy:** NO

---

## Step History

### Step 1 — Tag System (packages/tag-core) — COMPLETE
*Date: 2026-04-03*

Files changed:
- `packages/tag-core/src/types.ts` — TagStatus, Tag, TagConfig, TagCluster, MergeSuggestion, ExpertTag, ExpertCandidateInput, TagValidationResult, LifecycleResult types + defaultTagConfig()
- `packages/tag-core/src/normalize.ts` — normalizeTagName, validateTag, extractHierarchy, getParentPath
- `packages/tag-core/src/lifecycle.ts` — promote, autoPromote, deprecate, reactivate, isValidTransition, VALID_TRANSITIONS
- `packages/tag-core/src/cluster.ts` — levenshtein (pure DP impl), findSynonymCanonical, areSynonyms, findSimilarTags, suggestMerges
- `packages/tag-core/src/expert.ts` — isExpertQualified, qualifyExpert, qualifyExperts
- `packages/tag-core/src/index.ts` — re-exports all modules
- `packages/tag-core/package.json` — matches arp-core pattern, vitest devDep only
- `packages/tag-core/tsconfig.json` — extends base, matches arp-core pattern
- `packages/tag-core/vitest.config.ts` — matches arp-core pattern
- `packages/tag-core/src/__tests__/normalize.test.ts` — 17 tests
- `packages/tag-core/src/__tests__/lifecycle.test.ts` — 18 tests
- `packages/tag-core/src/__tests__/cluster.test.ts` — 21 tests
- `packages/tag-core/src/__tests__/expert.test.ts` — 9 tests

Decisions made:
- Levenshtein: Wagner-Fischer DP with single-row O(min(m,n)) space optimization
- autoPromote skips CANDIDATE straight to OFFICIAL when useCount >= emergingToOfficialUses
- reactivate always returns to CANDIDATE (not to previous status)
- suggestMerges: higher useCount tag becomes merge target; deduplicates pairs
- MergeSuggestion type added alongside TagCluster (brief did not list it explicitly but merge suggestions need source/target/reason)
- TagValidationResult and LifecycleResult types added for structured return values

Test results: 65 tests, all passing
Typecheck: clean, 0 errors

Reviewer findings: pending

### Pre-Step — Phase 1-2 Foundation & Systems — COMPLETE
*Date: 2026-04-03*

Files changed:
- `packages/trust-core/` — refactored to compute/normalize/weights modules
- `packages/dispute-core/` — v2 cost tiers, DS ⭐1-5, deposit + settlement
- `packages/arp-core/` — new package, 3-layer adaptive review period
- `packages/shipping-core/` — SLA defaults, validation, violation

Decisions made:
- Dispute cost: T1 max(0.5%,$3), T2 max(2%,$12), T3 max(5%,$30)
- DS Rating: ⭐1-5 stars (not Bronze~Diamond)
- 30/70 platform/jury split

Reviewer findings: N/A (pre-team)
Deploy: committed 1d793cb

---

## Known Gaps
*Logged here instead of fixed. Addressed in a future step.*

- **KG-1** — trust-core/packages/ contains duplicate dispute-core files (likely accidental copy) — logged 2026-04-03
- **KG-2** — DB schemas not yet updated for Phase 1-2 types — logged 2026-04-03

---

## Architecture Decisions
*Locked decisions that cannot be changed without breaking the system.*

- Pure logic packages have 0 external deps, vitest only for dev — 2026-04-03
- Re-export-only index.ts pattern across all core packages — 2026-04-03
- Drizzle ORM + pgTable pattern for all DB schemas — 2026-04-03
- API routes: register*Routes(app, db) pattern with Zod validation — 2026-04-03
- Tag Levenshtein: pure Wagner-Fischer DP, no external libs — 2026-04-03
