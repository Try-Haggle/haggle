# Review Request — Step 9: Skill DB + Service + API (rev 2)
*Written by Builder. Read by Reviewer.*

Ready for Review: YES

---

## What Was Built

Skill DB persistence (2 tables), service layer (7 functions), and API routes (9 endpoints). Follows exact same patterns as tags.ts/tag.service.ts. Uses validateManifest from skill-core for manifest validation on registration. Lifecycle transitions enforced in route layer.

## Rev 2 Fixes (from REVIEW-FEEDBACK.md)

All 3 Must Fix items resolved. Both Should Fix items resolved.

| # | Type | Fix |
|---|------|-----|
| MF-1 | Must Fix | `/skills/resolve` now imports `isCompatibleCategory` from `@haggle/skill-core` instead of inlining wildcard matching logic. DB row `supportedCategories` cast to minimal `SkillManifest`-shaped object. |
| MF-2 | Must Fix | POST `/skills/:skillId/execute` now checks `existing.status !== "ACTIVE"` before recording execution. Returns 400 `SKILL_NOT_ACTIVE` for DRAFT/SUSPENDED/DEPRECATED skills. |
| MF-3 | Must Fix | Comment on `updateSkillMetrics` changed from "atomic rolling average" to "rolling average (per-statement atomic, not concurrent-safe — acceptable for MVP)". |
| SF-1 | Should Fix | `limit` query param on GET `/skills/:skillId/executions` bounded to `[1, 200]` via `Math.min(Math.max(parsed, 1), 200)`. |
| SF-2 | Should Fix | `Number.isNaN` check on parsed limit — NaN from non-numeric input falls back to `undefined` (service default 50). |

## Files Changed

| File | Lines | Change |
|---|---|---|
| `packages/db/src/schema/skills.ts` | 1-42 | NEW — `skills` table + `skillExecutions` table |
| `packages/db/src/schema/index.ts` | 28 | MODIFIED — added skills/skillExecutions export |
| `apps/api/src/services/skill.service.ts` | 1-178 | NEW — 7 service functions (CRUD + metrics + executions). Rev 2: comment fix line 117. |
| `apps/api/src/routes/skills.ts` | 1-252 | NEW — 9 endpoints via registerSkillRoutes. Rev 2: isCompatibleCategory import, ACTIVE guard on execute, limit bounds validation. |
| `apps/api/src/server.ts` | 20, 70 | MODIFIED — import + registration |
| `apps/api/package.json` | 38 | MODIFIED — added @haggle/skill-core dep |

## Key Areas to Scrutinize

1. **Rolling average SQL** (`skill.service.ts:117-123`) — Comment now clarifies concurrency limitation. No logic change for MVP.

2. **hookPoint post-filter** (`skill.service.ts:46-52`) — Fetches rows filtered by category/status in SQL, then filters hookPoint in JS (since it's a jsonb array). Correct for MVP but suboptimal at scale.

3. **isCompatibleCategory cast** (`skills.ts:63`) — DB row's `supportedCategories` wrapped as `{ supportedCategories: supported } as SkillManifest`. The cast is safe because `isCompatibleCategory` only accesses `supportedCategories`.

4. **409 on duplicate skillId** (`skills.ts:102-104`) — Escalated to Architect per review feedback. Awaiting decision on idempotent vs 409 pattern.

## Open Questions

1. Should duplicate skillId registration be idempotent (return existing) or error (409)? Currently 409. Escalated to Architect.

## Verification

```
pnpm --filter @haggle/db typecheck       — 0 errors
pnpm --filter @haggle/api typecheck      — 0 errors in new files (pre-existing KG-3 shipping-core errors only)
```
