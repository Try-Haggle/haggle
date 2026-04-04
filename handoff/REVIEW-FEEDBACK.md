# Review Feedback — Step 9
Date: 2026-04-04
Ready for Builder: NO

## Must Fix

- `skills.ts:62-72` — Wildcard category matching is inlined instead of importing `isCompatibleCategory` from `@haggle/skill-core`. The logic happens to match today, but now there are two copies. When skill-core's version changes (e.g., the pending Arch decision on deep-match from Step 7), this copy will silently diverge. Fix: import `isCompatibleCategory` from `@haggle/skill-core`, construct a minimal `SkillManifest`-shaped object from the DB row (only `supportedCategories` is needed), and call the function. If constructing a full manifest is awkward, extract the category-matching loop into a standalone `isCompatibleCategory(supportedCategories: string[], productCategory: string)` in skill-core and import that. Either way, one source of truth.

- `skills.ts:208-236` — POST `/skills/:skillId/execute` does not check that the skill's status is `ACTIVE` before recording execution. A DRAFT, SUSPENDED, or DEPRECATED skill can have executions logged against it. The brief says "execute skill (record execution, update metrics)" which implies the skill should be executable. Add a guard: if `existing.status !== "ACTIVE"`, return 400 with `SKILL_NOT_ACTIVE`. This is consistent with the lifecycle model where only ACTIVE skills are resolved and used.

- `skill.service.ts:117-123` — The rolling average SQL has a race condition between `usageCount` read in the SET clause and the `usageCount + 1` denominator. Both `averageLatencyMs` and `errorRate` read `skills.usageCount` in the same UPDATE, which is correct within a single statement (Postgres evaluates SET expressions using the pre-update row). However, two concurrent executions can both read the same `usageCount` value, meaning one execution's latency contribution gets overwritten. Bob flagged this area for scrutiny. For MVP this is acceptable in practice, but the comment on line 117 says "atomic rolling average" which is misleading — it is atomic per-statement but not concurrent-safe. Fix: change the comment from "atomic rolling average" to "rolling average (not concurrent-safe, acceptable for MVP)". This is a comment-only fix — no logic change needed for MVP.

## Should Fix

- `skills.ts:245` — `parseInt(query.limit, 10)` on the executions endpoint has no bounds validation. A caller can pass `limit=999999` and dump the entire executions table. The service defaults to 50, but the route overrides it with any positive integer. Add `Math.min(parsed, 200)` or validate via Zod. Tag routes don't have this pattern so there's no precedent to follow, but it's a sensible guard.

- `skills.ts:245` — `parseInt` on non-numeric input like `limit=abc` returns `NaN`, which passes through to `getExecutionsBySkillId` as `NaN`. Drizzle's `.limit(NaN)` behavior is undefined. Add a `Number.isNaN` check or use Zod to validate the query param.

- `skills.ts:109-111` — 409 on duplicate `skillId` diverges from the tag pattern (which returns the existing row on duplicate). Bob flagged this as an open question. Both approaches are valid. Logging this for Arch to confirm — see Escalate section.

## Escalate to Architect

- **Duplicate skillId behavior** — Tags return existing row on duplicate (idempotent POST). Skills return 409 CONFLICT. Bob flagged this in REVIEW-REQUEST.md. Both are defensible. Idempotent is safer for retries (network failures). 409 is stricter and prevents accidental re-registration with different data. Arch should decide which pattern is canonical for this project. If 409, document it as intentional divergence from the tag pattern.

## Cleared

6 files reviewed against the Step 9 brief. DB schema (`skills.ts`) matches the brief exactly — all columns, types, defaults, and constraints present. `skillExecutions` table has all specified fields. `schema/index.ts` correctly exports both tables. Service layer (`skill.service.ts`) implements all 7 functions from the brief with correct signatures. `createSkill` maps all manifest fields. `updateSkillStatus` sets `updatedAt`. `recordExecution` and `getExecutionsBySkillId` work as specified. Route file (`skills.ts`) registers 9 endpoints matching the brief. Route ordering is correct: `/skills/resolve` registered before `/:skillId` (line 46). Zod validation present on POST `/skills` and POST `/skills/:skillId/execute`. Lifecycle transitions enforced: activate requires DRAFT, suspend requires ACTIVE, deprecate requires ACTIVE or SUSPENDED. `validateManifest` from skill-core correctly used in POST `/skills`. `server.ts` imports and registers skill routes. `package.json` has `@haggle/skill-core` dependency. Patterns follow tags route structure (Fastify generics, Zod parse, service delegation, error codes).
