# Review Feedback — Step 7
Date: 2026-04-04
Ready for Builder: YES

## Must Fix
None.

## Should Fix

- `manifest.ts:34` — The skillId regex `/^[a-z0-9][a-z0-9-]*[a-z0-9]$|^[a-z0-9]$/` allows consecutive hyphens like `"a--b"`. The brief says "alphanumeric + hyphens" without prohibiting consecutive hyphens, so this is technically compliant. Note for future: if skill IDs become user-facing or used in URLs, consecutive hyphens look ugly. No action needed now.

- `registry.ts:91` — `Math.round(skill.errorRate * prevCount)` recovers the previous error count from the floating-point error rate. This introduces rounding drift over many calls. Example: after thousands of mixed success/failure calls, the recovered integer error count could be off by one. A dedicated `errorCount` integer field would eliminate this. Acceptable for in-memory MVP. Note if this package ever gets persistence.

## Escalate to Architect

- **Wildcard category depth** — `isCompatibleCategory` at `manifest.ts:140-145` makes `"vehicles.*"` match both `"vehicles.cars"` (single-level) and `"vehicles.cars.sedans"` (deep sub). The brief says `"vehicles.*" matches "vehicles.cars"` and the flag says it must NOT match `"vehicles"`. Both are satisfied. But the brief is silent on deep subcategories. Bob flagged this in REVIEW-REQUEST.md. Arch should confirm: is deep matching intended, or should `"vehicles.*"` be single-level only (matching `"vehicles.cars"` but NOT `"vehicles.cars.sedans"`)? If single-level is desired, the fix is to check that `productCategory.slice(prefix.length)` contains no dots.

## Cleared

All 11 files reviewed against the Step 7 brief. Types in `types.ts` match the brief exactly — all 5 type unions, 4 interfaces with every field present and correctly typed. Manifest validation in `manifest.ts` covers all rules: skillId format (non-empty, lowercase, alphanumeric+hyphens, max 64), name (non-empty, max 128), semver, valid category, at least one hookPoint, at least one supportedCategory, pricing model constraints (PER_USE requires perUseCents > 0, SUBSCRIPTION requires monthlySubscriptionCents > 0, REVENUE_SHARE requires 0-100). Registry lifecycle is correct: DRAFT to ACTIVE, ACTIVE to SUSPENDED, ACTIVE/SUSPENDED to DEPRECATED. Invalid transitions (DEPRECATED to anything, DRAFT to SUSPENDED, DRAFT to DEPRECATED) correctly rejected. Pipeline is planning-only with no execution logic. Zero external dependencies — vitest as devDep only. Package structure (package.json, tsconfig.json, vitest.config.ts) matches tag-core pattern exactly. 62 tests passing (26 manifest + 26 registry + 10 pipeline), exceeding brief targets (~15 + ~18 + ~8). Typecheck clean.
