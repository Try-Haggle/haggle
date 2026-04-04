# Review Request — Step 7: Skill System Foundation
*Written by Builder. Read by Reviewer.*

Ready for Review: YES

---

## What Was Built

New `packages/skill-core` package — pure logic foundation for the skill/marketplace system. Types, manifest validation, in-memory registry with lifecycle transitions, and pipeline execution planning. Zero external dependencies. 62 tests, 0 typecheck errors.

## Files Changed

| File | Lines | Change |
|---|---|---|
| `packages/skill-core/package.json` | 1-20 | NEW — package config, vitest devDep only |
| `packages/skill-core/tsconfig.json` | 1-9 | NEW — extends base, standard pattern |
| `packages/skill-core/vitest.config.ts` | 1-7 | NEW — standard vitest config |
| `packages/skill-core/src/types.ts` | 1-68 | NEW — all core types (SkillManifest, RegisteredSkill, HookPoint, etc.) |
| `packages/skill-core/src/manifest.ts` | 1-121 | NEW — validateManifest, isCompatibleHookPoint, isCompatibleCategory with wildcard |
| `packages/skill-core/src/registry.ts` | 1-95 | NEW — SkillRegistry class (Map-based, lifecycle, queries, recordUsage) |
| `packages/skill-core/src/pipeline.ts` | 1-60 | NEW — PipelineConfig, resolveSkills, createExecutionPlan (planning only) |
| `packages/skill-core/src/index.ts` | 1-4 | NEW — re-export barrel |
| `packages/skill-core/src/__tests__/manifest.test.ts` | 1-170 | NEW — 26 tests |
| `packages/skill-core/src/__tests__/registry.test.ts` | 1-210 | NEW — 26 tests |
| `packages/skill-core/src/__tests__/pipeline.test.ts` | 1-130 | NEW — 10 tests |

## Key Areas to Scrutinize

1. **Wildcard matching** (`manifest.ts:109-121`) — "vehicles.*" matches "vehicles.cars" and "vehicles.cars.sedans" but NOT "vehicles". The brief said match "vehicles.cars" — confirm deep subcategory match is desired or should be single-level only.
2. **deprecate() dual source** (`registry.ts:48-53`) — Accepts both ACTIVE and SUSPENDED per brief. Other transitions are strict single-source.
3. **Rolling average math** (`registry.ts:77-87`) — Uses cumulative mean for latency and error rate. Confirm this is acceptable vs exponential moving average.
4. **skillId regex** (`manifest.ts:33`) — Allows single-char IDs like "a". Brief said "non-empty, lowercase, alphanumeric + hyphens" — single char passes all rules.

## Open Questions

None. Brief was unambiguous on all major design points.

## Verification

```
pnpm --filter @haggle/skill-core test       — 62 tests passing
pnpm --filter @haggle/skill-core typecheck   — 0 errors
External dependencies: 0
```
