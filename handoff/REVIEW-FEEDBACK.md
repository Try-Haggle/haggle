# Review Feedback — Step 66 (Phase B: P0 Explainability + L5 Signals + Checkpoint Persistence + Stage Routes)

**Reviewer**: Richard
**Date**: 2026-04-12
**Ready for Builder**: YES

---

## Must Fix

None.

---

## Should Fix

### S1 — `executor.ts:211` `.catch(() => undefined)` swallows L5 Signals errors silently

- **File**: `apps/api/src/negotiation/pipeline/executor.ts:211`
- **What is wrong**: L5 Signals fetch failure is caught and discarded without any logging. Non-fatal is correct per the brief. But if the static provider itself throws (e.g., future provider with network calls), there is zero observability. Same class of issue as S2 from Step 65 review.
- **Recommendation**: Change to `.catch((err) => { console.warn('[staged-executor] L5 signals fallback:', (err as Error).message); return undefined; })`. Under 1 minute. Not blocking because the static provider cannot throw in Phase 0.

### S2 — `negotiation-stages.ts:277` `previousMoves` hardcoded to empty array

- **File**: `apps/api/src/routes/negotiation-stages.ts:277`
- **What is wrong**: Bob documented this in REVIEW-REQUEST point 5 and the brief's Stage 4 spec does not include `previousMoves` in the request body. The validate route passes `[]` which means V6_STAGNATION detection will not work for external agents calling this route. This is a known limitation, not a bug.
- **Recommendation**: Add a brief JSDoc comment at line 277 explaining why `[]` is intentional and what the limitation is. Under 1 minute. Not blocking because it matches the brief's stateless design intent.

### S3 — Stage route tests validate schemas but do not exercise actual route handlers

- **File**: `apps/api/src/__tests__/stage-routes.test.ts`
- **What is wrong**: Tests verify data structures and mock the pipeline mode guard, but never call the actual Fastify route handlers (no `app.inject()`). The pipeline mode guard test at lines 19-29 just checks the mock return value, not the guard's 404 behavior. Schema validation tests at lines 32-58 construct request bodies and assert field values without running them through Zod.
- **Recommendation**: Not blocking for Step 66 because the route logic is thin (Zod parse + stage function call + response mapping) and the stage functions themselves are tested in Step 65. However, for Phase 1 an integration test with `app.inject()` should cover the auth + guard + parse + response chain end-to-end. Log to BUILD-LOG.

---

## Escalate to Architect

None.

---

## Cleared

### Key Review Point 1 — Explainability only exposed when staged + client opts in: PASS

`routes/negotiations.ts:162` — `Querystring` generic includes `include_explainability?: string`. At line 226, the guard is `request.query.include_explainability === 'true'` AND `extended.explainability` must be truthy. When `NEGOTIATION_PIPELINE=legacy`, the executor returns no `explainability` field, so even if a client sends `?include_explainability=true`, the response omits it. Double-gate pattern: pipeline mode + client opt-in.

`GET /sessions/:id/decisions` at lines 373-400: extracts `explainability` from round metadata. Legacy rounds have no `metadata.explainability`, so the filter at line 393 returns an empty array. Safe.

### Key Review Point 2 — L5 Signals non-fatal, static data correct: PASS

`executor.ts:207-211` — `getL5SignalsProvider()` returns the singleton. `.catch(() => undefined)` ensures pipeline continues without signals. The `l5_signals` parameter at line 233 is optional in `executePipeline()`.

`l5-signals.service.ts:28-36` — Swappa medians match the brief exactly: 13 Pro 128=$450, 13 Pro 256=$500, 14 Pro 128=$620, 14 Pro 256=$680, 15 Pro 128=$850, 15 Pro 256=$920, 15 Pro 512=$1050 (all in minor units). Condition multipliers at lines 67-69: fair=0.90, mint=1.05, good=1.0 (default). Reasonable for Phase 0 iPhone Pro. 14 tests cover all SKUs, conditions, normalization, and singleton management.

`extractItemModel` at line 528-531 checks `strategy.item_model`, `strategy.itemModel`, `strategy.model` with fallback to `'iphone-14-pro-128'`. Phase 0 only.

### Key Review Point 3 — Checkpoint persistence optional, backward compatible: PASS

`checkpoint-store.ts:38` — constructor accepts `persistence?: CheckpointPersistence`. When omitted, `this.persistence` is undefined. Line 55: `if (this.persistence)` guards the DB write. Line 80: `if (!this.persistence) return` short-circuits hydrate. Existing callers using `new CheckpointStore()` see zero behavior change.

`types.ts:226-228` — `explainability?: RoundExplainability` and `memo_hash?: string` are optional fields on `Checkpoint`. Existing checkpoint code that omits them still type-checks. Test at `checkpoint-persistence.test.ts:163-168` confirms backward compat explicitly.

11 tests cover: basic in-memory CRUD (5), explainability in checkpoint (2), persistence backend callbacks (3), no-persistence default (1). Revert logic tested with free-first and cost-second scenarios.

### Key Review Point 4 — Stage routes: auth + pipeline guard + input validation: PASS

`negotiation-stages.ts:222` — `preHandler: [requireAuth, guardStagedPipeline]` on all three routes. Auth runs first via `requireAuth` (imported from existing middleware). `guardStagedPipeline` at lines 201-217 checks `getPipelineMode() !== 'staged'` and returns 404, then validates `x-haggle-actor-id` header and returns 400 if missing.

Zod schemas are thorough: `contextRequestSchema` (lines 125-132), `validateRequestSchema` (lines 162-174), `respondRequestSchema` (lines 189-193). All use `.safeParse()` with 400 response on failure including Zod issues. Enum values match the pipeline types.

`server.ts:25,105` — `registerStageRoutes(app, db)` registered after negotiation routes. No `eventDispatcher` needed (stage routes are stateless calls).

### Key Review Point 5 — Test count: 789 (752 + 37 new): CONSISTENT

New test files: explainability-api (4) + l5-signals (14) + checkpoint-persistence (11) + stage-routes (8) = 37. Bob reports 789 total = 752 existing + 37 new. Consistent.

### Protected files: PASS

`git diff HEAD` against `negotiation/referee/`, `negotiation/skills/`, `negotiation/stages/`, `negotiation/memo/`, `negotiation/phase/`, `negotiation/adapters/xai-client.ts` produces empty output. `lib/llm-negotiation-executor.ts` still exists at its original path (not deleted). All protected files are untouched.

---

## Summary

Clean implementation of all four sub-steps. Explainability is properly gated behind both pipeline mode and client opt-in. L5 Signals uses a pluggable provider interface with correct Phase 0 static data. Checkpoint persistence is optional with zero impact on existing callers. Stage routes have auth, pipeline mode guard, and Zod validation on all three endpoints. Protected files are untouched. Test count is consistent.

Should Fix items are minor: silent error swallowing (S1), missing comment on known limitation (S2), shallow route tests (S3). None are blocking.

Step 66 is clear.

-- Richard
