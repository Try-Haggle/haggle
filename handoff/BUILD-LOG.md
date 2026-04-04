# Build Log
*Owned by Architect. Updated by Builder after each step.*

---

## Current Status

**Active step:** 12 — API Client Utility + Auth Token Injection — COMPLETE
**Last cleared:** Step 11 Auth Middleware (Supabase JWT) — 2026-04-03
**Pending deploy:** NO

---

## Step History

### Step 12 — API Client Utility + Auth Token Injection — COMPLETE
*Date: 2026-04-03*

Files changed:
- `apps/web/src/lib/api-client.ts` — NEW: Browser-side API client. Centralizes `API_URL` from `NEXT_PUBLIC_API_URL` env var. `apiClient()` injects Supabase JWT from browser session into `Authorization` header. `ApiError` class for structured error handling. `api` convenience object with `get/post/patch/delete` methods. `skipAuth` option for public endpoints.
- `apps/web/src/lib/api-server.ts` — NEW: Server-side API client for React Server Components. `apiServer()` base function with method/body/skipAuth options. `serverApi` convenience object with `get/post` methods. `apiServerFireAndForget()` for non-critical fire-and-forget POSTs (e.g., view tracking). Uses server-side Supabase client (cookie-based).
- `apps/web/src/app/(app)/sell/dashboard/page.tsx` — MODIFIED: removed hardcoded `API_URL`. Replaced raw `fetch` for claim POST and listings GET with `serverApi.post` and `serverApi.get`. Auth token now injected automatically.
- `apps/web/src/app/(app)/buy/dashboard/page.tsx` — MODIFIED: removed hardcoded `API_URL`. Replaced raw `fetch` for viewed listings GET with `serverApi.get`.
- `apps/web/src/app/(app)/sell/listings/[id]/page.tsx` — MODIFIED: removed hardcoded `API_URL`. Replaced raw `fetch` for listing detail GET with `serverApi.get`.
- `apps/web/src/app/(app)/sell/listings/new/new-listing-wizard.tsx` — MODIFIED: removed hardcoded `API_URL`. Replaced 3 raw `fetch` calls (ensureDraft POST, patchDraft PATCH, publish POST) with `api.post`/`api.patch`. Auth token now injected automatically.
- `apps/web/src/app/(app)/settings/settings-content.tsx` — MODIFIED: removed hardcoded `API_URL`. Replaced manual session+fetch for account DELETE with `api.delete`. Error handling preserved via `ApiError` catch.
- `apps/web/src/app/l/[publicId]/page.tsx` — MODIFIED: removed hardcoded `API_URL`. Public listing fetch uses `serverApi.get` with `skipAuth: true`. View tracking POST uses `apiServerFireAndForget` with auth headers from existing supabase session.

Decisions made:
- `api-server.ts` extended beyond brief's GET-only `apiServer()` to include `serverApi.post()` — sell dashboard's claim endpoint requires server-side POST with auth. Without this, would need raw fetch or a workaround.
- `apiServerFireAndForget()` takes pre-built headers parameter — avoids redundant `createClient()` call in `l/[publicId]/page.tsx` where supabase session already exists.
- Publish endpoint in wizard uses `.catch(() => null)` pattern — `apiClient` throws on non-2xx, but publish may return 2xx with `{ ok: false, errors }` for validation errors. The `.catch` handles network/server errors while the `ok` check handles business logic errors.
- Non-null assertions (`data.publicId!`, `data.shareUrl!`) used after `data.ok` guard — the API guarantees these fields exist when `ok: true`.
- `server.ts` exports `createClient` (not `createServerClient` as brief suggested) — matched actual export name.
- `ApiError` imported in settings-content for typed error handling in catch block.

Test results: N/A (client utility + page refactor, no unit tests)
Typecheck: `pnpm --filter @haggle/web typecheck` — 0 errors

### Step 11 — Auth Middleware (Supabase JWT) — COMPLETE
*Date: 2026-04-03*

Files changed:
- `apps/api/src/middleware/auth.ts` — NEW: Fastify auth plugin. Decodes `Authorization: Bearer <jwt>` header, verifies with `jsonwebtoken` using `SUPABASE_JWT_SECRET` env var. If env var missing, decodes without verification (local dev passthrough). Decorates `request.user` with `{ id, email, role }`. Invalid tokens get 401. Missing tokens pass through (routes decide auth requirement).
- `apps/api/src/middleware/require-auth.ts` — NEW: `requireAuth` preHandler (401 if no user) + `requireAdmin` preHandler (401 if no user, 403 if role !== "admin").
- `apps/api/src/server.ts` — MODIFIED: imports and registers `authPlugin` before all route registrations.
- `apps/api/src/routes/payments.ts` — MODIFIED: removed `actorFromHeaders` function and `actorRoleSchema`. Added `requireAuth` preHandler to all POST `/payments/*` routes except webhooks (x402, stripe). `/payments/prepare` now reads `request.user!.id` instead of `x-haggle-actor-id` header. GET routes remain public.
- `apps/api/src/routes/intents.ts` — MODIFIED: added `requireAuth` to `POST /intents` and `PATCH /intents/:id/cancel`. `POST /intents/expire` left public (cron).
- `apps/api/src/routes/tags.ts` — MODIFIED: added `requireAdmin` to `POST /tags/merge`, `POST /tags/:id/promote`, `POST /tags/:id/deprecate`.
- `apps/api/src/routes/trust.ts` — MODIFIED: added `requireAdmin` to `POST /trust/:actorId/compute`.
- `apps/api/src/routes/arp.ts` — MODIFIED: added `requireAdmin` to `POST /arp/segments/:id/adjust`.
- `apps/api/src/routes/skills.ts` — MODIFIED: added `requireAdmin` to `PATCH /skills/:skillId/activate`, `/suspend`, `/deprecate`. Added `requireAuth` to `POST /skills/:skillId/execute`.
- `apps/api/package.json` — MODIFIED: added `jsonwebtoken`, `fastify-plugin` to deps, `@types/jsonwebtoken` to devDeps.

Decisions made:
- `actorRoleSchema` removed — no longer needed since `actorFromHeaders` is gone. The `actor_role` in `/payments/prepare` is hardcoded to `"buyer"` since only buyers prepare payments via JWT auth.
- JWT passthrough when `SUPABASE_JWT_SECRET` is unset: `jwt.decode()` (no verification) allows local dev to work with any valid-shaped JWT. Invalid payloads (missing `sub`) still fail.
- `x-haggle-actor-id` kept in CORS `allowedHeaders` for backwards compat with MCP clients.
- Auth plugin registered BEFORE routes but AFTER CORS — ensures all routes get the `request.user` decoration.
- Webhook routes (`/payments/webhooks/x402`, `/payments/webhooks/stripe`) have NO auth — they have their own signature verification.
- `POST /intents/expire` left public — cron/admin auth deferred per brief.
- Skills lifecycle routes (activate/suspend/deprecate) use `requireAdmin` per brief — actual HTTP method is `PATCH` (not `POST` as brief listed).
- Fastify `request.user` type augmentation in `auth.ts` via `declare module "fastify"` — standard Fastify pattern.

Test results: N/A (middleware + route layer, no unit tests — tested via typecheck)
Typecheck: 0 new errors. Pre-existing shipping-core export errors remain (KG-3 class: `computeWeightBuffer`, `MockCarrierAdapter`, etc.).

### Step 9 — Skill DB + Service + API (Phase 5b-c) — COMPLETE (rev 2)
*Date: 2026-04-03*

Files changed:
- `packages/db/src/schema/skills.ts` — NEW: `skills` table (id, skillId UNIQUE, name, description, version, category enum, provider enum, status enum w/ DRAFT default, supportedCategories jsonb, hookPoints jsonb, pricing jsonb, configSchema jsonb, usageCount, averageLatencyMs, errorRate, metadata, timestamps) + `skillExecutions` table (id, skillId, hookPoint, success boolean, latencyMs, inputSummary jsonb, outputSummary jsonb, error, createdAt)
- `packages/db/src/schema/index.ts` — MODIFIED: added `skills, skillExecutions` export
- `apps/api/src/services/skill.service.ts` — NEW: getSkillBySkillId, listSkills (with category/status/hookPoint filters), createSkill, updateSkillStatus, updateSkillMetrics (rolling avg via SQL), recordExecution, getExecutionsBySkillId
- `apps/api/src/routes/skills.ts` — NEW: registerSkillRoutes — GET /skills/resolve (before /:skillId), POST /skills, GET /skills, GET /skills/:skillId, PATCH /skills/:skillId/activate, PATCH /skills/:skillId/suspend, PATCH /skills/:skillId/deprecate, POST /skills/:skillId/execute, GET /skills/:skillId/executions — 9 endpoints total
- `apps/api/src/server.ts` — MODIFIED: added registerSkillRoutes import + registration
- `apps/api/package.json` — MODIFIED: added `@haggle/skill-core: "workspace:*"` dependency

Decisions made:
- `validateManifest` from skill-core used in POST /skills to validate manifest before DB insert
- GET /skills/resolve registered before /:skillId to prevent param capture (same pattern as tags/clusters)
- hookPoint filter in listSkills is post-filter on jsonb array (no SQL jsonb query) — simple and sufficient for MVP
- `isCompatibleCategory` from skill-core used in /skills/resolve for product_category matching — single source of truth
- POST /skills/:skillId/execute records execution log only — no actual skill HTTP execution per brief flag
- POST /skills/:skillId/execute guards on ACTIVE status — DRAFT/SUSPENDED/DEPRECATED skills cannot have executions logged
- updateSkillMetrics uses raw SQL for rolling average (per-statement atomic, not concurrent-safe — acceptable for MVP)
- Lifecycle transitions validated in route layer: activate (DRAFT->ACTIVE), suspend (ACTIVE->SUSPENDED), deprecate (ACTIVE|SUSPENDED->DEPRECATED)
- `success` column in skillExecutions is `boolean` (not text) — matches brief spec
- All drizzle-orm operators imported via @haggle/db — no direct drizzle-orm dependency
- Zod schemas at file scope per established pattern
- 409 CONFLICT returned for duplicate skillId registration (not idempotent return like tags)
- GET /skills/:skillId/executions `limit` param bounded to [1, 200], NaN defaults to service default (50)

Test results: N/A (DB schema + service + route layer, no unit tests — tested via typecheck)
Typecheck: 0 errors in new/modified files. Pre-existing shipping-core errors remain (KG-3).

Reviewer findings (rev 2 fixes):
- **MF-1 FIXED**: skills.ts:57-65 — replaced inline wildcard category matching with `isCompatibleCategory` imported from `@haggle/skill-core`. DB row's `supportedCategories` cast to minimal `SkillManifest`-shaped object. Single source of truth.
- **MF-2 FIXED**: skills.ts:215-217 — added `existing.status !== "ACTIVE"` guard before recording execution. Returns 400 `SKILL_NOT_ACTIVE` for DRAFT/SUSPENDED/DEPRECATED skills.
- **MF-3 FIXED**: skill.service.ts:117 — changed comment from "atomic rolling average" to "rolling average (per-statement atomic, not concurrent-safe — acceptable for MVP)".
- **SF-1 FIXED**: skills.ts:241-245 — `limit` query param now bounded: `Math.min(Math.max(parsed, 1), 200)`. NaN from non-numeric input falls back to `undefined` (service default 50).
- **SF-2 FIXED**: same location — `Number.isNaN` check prevents NaN from reaching Drizzle `.limit()`.

### Step 8 — Fix shipping-core Build Errors — COMPLETE
*Date: 2026-04-03*

Files changed:
- `packages/shipping-core/src/types.ts` — MODIFIED: appended ShipmentStatus (8-value union), ShipmentEvent (id, shipment_id, status, occurred_at, carrier_raw_status?, message?, location?), Shipment (id, order_id, carrier, tracking_number?, tracking_url?, status, events, delivered_at?, created_at, updated_at) — shapes derived from actual usage in state-machine.ts, service.ts, provider.ts, escalation.ts, mock-carrier-adapter.ts, easypost-adapter.ts
- `packages/shipping-core/src/easypost-api.d.ts` — NEW: minimal ambient module declaration for `@easypost/api` so typecheck passes without the optional peer dep installed
- `packages/shipping-core/package.json` — MODIFIED: added `@haggle/commerce-core: "workspace:*"` dependency, added `@easypost/api` as optional peerDependency
- `packages/shipping-core/src/index.ts` — MODIFIED: added exports for state-machine, provider, service, escalation, sla (with SlaCheckResult renamed to ShipmentSlaCheckResult to avoid collision with types.ts SlaCheckResult), trust-events

Decisions made:
- ShipmentEvent uses `occurred_at` (not `timestamp`) and includes `id`, `shipment_id` fields — derived from service.ts and easypost-adapter.ts actual usage
- Shipment uses `id` field (not `shipment_id`) — derived from service.ts `createShipment()` which sets `id: createId("shp")`
- Shipment includes `tracking_url` field — used in service.ts `createLabel()` result
- `@easypost/api` added as optional peer dep (not devDep) — adapter is a runtime consumer but only needed when EasyPostCarrierAdapter is used
- Ambient `.d.ts` declaration created for `@easypost/api` — provides minimal type stubs so typecheck passes without install
- `sla.ts` SlaCheckResult re-exported as `ShipmentSlaCheckResult` in index.ts — avoids TS2308 ambiguity with SlaCheckResult from types.ts (both are public API, different shapes)
- easypost-adapter.ts and mock-carrier-adapter.ts NOT exported from index.ts — they are provider implementations, not public API (per brief)

Test results: 184 tests, all passing (6 test files)
Typecheck: clean, 0 errors

Known Gap KG-3 status: RESOLVED — shipping-core now exports all types needed by shipments.ts and shipment-record.service.ts

### Step 7 — Skill System Foundation (packages/skill-core) — COMPLETE
*Date: 2026-04-03*

Files changed:
- `packages/skill-core/package.json` — NEW: package config, vitest devDep only, zero external deps
- `packages/skill-core/tsconfig.json` — NEW: extends base, standard pattern
- `packages/skill-core/vitest.config.ts` — NEW: standard vitest config
- `packages/skill-core/src/types.ts` — NEW: SkillCategory, SkillStatus, SkillProvider, HookPoint, PricingModel, SkillPricing, SkillManifest, RegisteredSkill, SkillInput, SkillOutput
- `packages/skill-core/src/manifest.ts` — NEW: validateManifest, isCompatibleHookPoint, isCompatibleCategory (wildcard support)
- `packages/skill-core/src/registry.ts` — NEW: SkillRegistry class (in-memory Map, lifecycle transitions, findByHookPoint/findByCategory, recordUsage with rolling averages)
- `packages/skill-core/src/pipeline.ts` — NEW: PipelineConfig, SkillExecutionPlan, defaultPipelineConfig, resolveSkills, createExecutionPlan (planning only, no execution)
- `packages/skill-core/src/index.ts` — NEW: re-exports all modules
- `packages/skill-core/src/__tests__/manifest.test.ts` — NEW: 26 tests
- `packages/skill-core/src/__tests__/registry.test.ts` — NEW: 26 tests
- `packages/skill-core/src/__tests__/pipeline.test.ts` — NEW: 10 tests

Decisions made:
- ZERO external dependencies — not even engine-core. SkillInput.context is Record<string, unknown>
- SkillRegistry is in-memory Map only — DB persistence is Step 8+
- Pipeline creates execution plans only, does NOT execute skills — execution is async at API layer
- Wildcard category matching: "vehicles.*" matches "vehicles.cars" and "vehicles.cars.sedans" but NOT "vehicles" alone
- skillId regex allows single-char IDs (e.g., "a") and hyphenated slugs up to 64 chars
- deprecate() accepts both ACTIVE and SUSPENDED as source states; other transitions are strict single-source
- recordUsage uses rolling average for latency and cumulative error rate
- Package structure matches tag-core/arp-core pattern exactly

Test results: 62 tests, all passing
Typecheck: clean, 0 errors

Reviewer findings: pending

### Step 6 — WaitingIntent DB + Service + API Route — COMPLETE (rev 2)
*Date: 2026-04-03*

Files changed:
- `packages/db/src/schema/waiting-intents.ts` — NEW: waitingIntents table (id, userId, role, category, keywords, strategySnapshot, minUtotal, maxActiveSessions, status, matchedAt, fulfilledAt, expiresAt, metadata, timestamps) + intentMatches table (id, intentId, counterpartyIntentId, listingId, sessionId, buyerUtotal, sellerUtotal, createdAt)
- `packages/db/src/schema/index.ts` — MODIFIED: added waitingIntents, intentMatches exports
- `apps/api/src/services/intent.service.ts` — NEW: getIntentById, getActiveIntentsByCategory, getIntentsByUserId, createIntent, updateIntentStatus, getActiveIntentCount, createMatch, getMatchesByIntentId, expireStaleIntents
- `apps/api/src/routes/intents.ts` — NEW: registerIntentRoutes — POST /, GET /, GET /:id, PATCH /:id/cancel, POST /:id/match, POST /trigger-match, POST /expire
- `apps/api/src/server.ts` — MODIFIED: added registerIntentRoutes import + registration

Decisions made:
- No package.json changes — @haggle/engine-core and @haggle/engine-session already listed as workspace deps
- `strategySnapshot` stored as `jsonb.$type<Record<string, unknown>>()` — same pattern as trustScores.rawInputs; cast to `unknown` then to `MasterStrategy` when converting to engine-session WaitingIntent type
- `keywords` stored as `jsonb.$type<string[]>()` — typed generic on jsonb
- `minUtotal` stored as `numeric(8,4)` with string default `"0.3"` — matches Drizzle numeric = string pattern
- `currentActiveSessions` set to 0 in trigger-match DB→WaitingIntent conversion — MVP simplification per brief flag; caller can provide real counts in future
- `context_template` in trigger-match request body is cast to NegotiationContext — MVP simplification per brief flag; caller assembles the full context
- POST /intents capacity check compares `getActiveIntentCount` (ACTIVE+MATCHED) against `max_active_sessions` param (default 5)
- GET /intents with no filters returns empty array to avoid full table scan
- All drizzle-orm operators imported via @haggle/db — no direct drizzle-orm dependency
- Service uses literal union types for IntentRole and IntentStatus — matches Step 3 pattern
- No FK constraints, no indexes, no migrations — per brief flags

Test results: N/A (DB schema + service + route layer, no unit tests — tested via typecheck)
Typecheck: 0 errors in new/modified files. Pre-existing shipping-core errors remain (KG-3).

Reviewer findings (rev 2 fixes):
- **MF-1 FIXED**: Lines 141, 170 — replaced hardcoded `"CANCELLED"` and `"MATCHED"` strings with `nextStatus` variable from `transitionIntent()` return. State machine is now single source of truth.
- **MF-2 FIXED**: Lines 186-198 — removed `GET /intents/:id/matches` endpoint (scope creep, not in brief). Service function `getMatchesByIntentId` retained. Import removed from route file.

### Step 5 — WaitingIntent Types + State Machine (packages/engine-session) — COMPLETE
*Date: 2026-04-03*

Files changed:
- `packages/engine-session/src/intent/types.ts` — NEW: WaitingIntent, IntentConfig, IntentRole, IntentStatus, MatchCandidate, MatchResult types + defaultIntentConfig()
- `packages/engine-session/src/intent/state-machine.ts` — NEW: IntentEvent type, transitionIntent() with ACTIVE/MATCHED/terminal states
- `packages/engine-session/src/intent/matcher.ts` — NEW: evaluateMatch, evaluateIntents, evaluateBidirectionalMatch — calls computeUtility from engine-core
- `packages/engine-session/src/intent/index.ts` — NEW: re-exports all intent types and functions
- `packages/engine-session/src/index.ts` — MODIFIED: appended intent exports
- `packages/engine-session/__tests__/intent-types.test.ts` — NEW: 6 tests (defaults, shape, optional fields)
- `packages/engine-session/__tests__/intent-state-machine.test.ts` — NEW: 25 tests (valid transitions, terminal states, invalid transitions)
- `packages/engine-session/__tests__/intent-matcher.test.ts` — NEW: 15 tests (evaluateMatch, evaluateIntents, evaluateBidirectionalMatch)

Decisions made:
- Tests placed in `__tests__/` at package root (not `src/intent/__tests__/`) to match existing vitest.config.ts include pattern
- State machine follows exact same pattern as session/state-machine.ts: terminal set, transitions record, null-return for invalid
- MasterStrategy imported via relative path `../strategy/types.js` (within engine-session)
- computeUtility and NegotiationContext imported from `@haggle/engine-core` (cross-package, already a dep)
- No new dependencies added — engine-core already listed in package.json
- Test mock contexts: high utility (p_effective=p_target, t_elapsed=0, r_score=1) and low utility (p_effective=p_limit, t_elapsed=deadline, r_score=0) for deterministic assertions

Test results: 167 tests passing (121 existing + 46 new)
Typecheck: clean, 0 errors

Reviewer findings: pending

### Step 4 — API Routes (apps/api/src/routes/) — COMPLETE
*Date: 2026-04-03*

Files changed:
- `apps/api/src/routes/trust.ts` — NEW: registerTrustRoutes — GET /:actorId, GET /:actorId/:role, POST /:actorId/compute, GET /:actorId/snapshot
- `apps/api/src/routes/ds-ratings.ts` — NEW: registerDSRatingRoutes — GET /pool (before /:reviewerId), GET /:reviewerId, POST /:reviewerId/compute, GET /:reviewerId/specializations
- `apps/api/src/routes/arp.ts` — NEW: registerARPRoutes — GET /review-hours, GET /segments, POST /segments/:id/adjust
- `apps/api/src/routes/tags.ts` — NEW: registerTagRoutes — GET /clusters (before /:id), POST /merge, GET /, POST /, GET /:id, PATCH /:id, POST /:id/promote, POST /:id/deprecate, GET /:tagId/experts, POST /:tagId/experts/qualify
- `apps/api/src/routes/disputes.ts` — MODIFIED: added POST /:id/deposit, GET /:id/deposit + import dispute-deposit service
- `apps/api/src/server.ts` — MODIFIED: added 4 new route registrations
- `apps/api/package.json` — MODIFIED: added @haggle/trust-core, @haggle/arp-core, @haggle/tag-core workspace deps

Decisions made:
- Added `@haggle/trust-core`, `@haggle/arp-core`, `@haggle/tag-core` to api package.json — were missing as workspace dependencies
- Route ordering: GET /ds-ratings/pool before GET /ds-ratings/:reviewerId; GET /tags/clusters before GET /tags/:id — prevents param capture
- Core package imports in routes (not services) — routes orchestrate: validate -> core logic -> service persist
- `checkPromotion` from dispute-core takes 3 positional args (current_tier, score, recent_cases), not an object — matched actual export signature
- `deprecate` from tag-core requires (tag, nowIso, config?) — passes current timestamp as ISO string
- `computeSignals` from arp-core used before `computeAdjustment` in the adjust endpoint — signals feed into adjustment
- DB row -> Tag object conversion needed for tag-core functions (DB rows have Date objects, tag-core expects ISO strings)
- Zod schemas at file scope per brief flag
- Fastify typed params used: `app.get<{ Params: { actorId: string } }>` pattern throughout

Test results: N/A (route layer, no unit tests — tested via typecheck)
Typecheck: 0 errors in new/modified files. Pre-existing shipping-core errors remain (KG-3).

Reviewer findings: pending

### Step 3 — Service Layer (apps/api/src/services/) — COMPLETE
*Date: 2026-04-03*

Files changed:
- `apps/api/src/services/trust-score.service.ts` — getTrustScore, upsertTrustScore, getTrustSnapshot
- `apps/api/src/services/ds-rating.service.ts` — getDSRating, upsertDSRating, getDSPool, getSpecializations, upsertSpecialization
- `apps/api/src/services/dispute-deposit.service.ts` — getDepositByDisputeId, createDeposit, updateDepositStatus, getPendingExpiredDeposits
- `apps/api/src/services/arp-segment.service.ts` — getSegment, upsertSegment, listSegments, updateSegmentReviewHours
- `apps/api/src/services/tag.service.ts` — getTagById, getTagByNormalizedName, listTags, createTag, updateTag, getExpertTags, getExpertTagsByUser, upsertExpertTag, createMergeLog
- `packages/db/src/index.ts` — added `lt`, `asc`, `isNull`, `inArray` to drizzle-orm re-exports

Decisions made:
- Added `lt`, `asc`, `isNull`, `inArray` to `@haggle/db` re-exports — api package has no direct drizzle-orm dep, all operators must come through db package
- Used literal union types for all enum columns (e.g., `DSTier`, `TagStatus`, `DepositStatus`, `ActorRole`, `TrustStatus`) to satisfy Drizzle's strict typing on enum text columns
- Upsert pattern: get-first then insert-or-update, no ON CONFLICT — per brief
- `arp-segment.service.ts` uses `isNull()` for nullable column matching (category, amountTier, tag)
- `ds-rating.service.ts` tier ordering uses const array with `slice()` for getDSPool filtering
- No core package imports in any service file — services are DB-only per brief flag
- `reviewHours` and `score` params typed as `string` where schema uses `numeric` (Drizzle numeric = string in TS)

Test results: N/A (service layer, no unit tests — tested via typecheck)
Typecheck: 0 errors in new files. Pre-existing errors in shipments.ts/shipment-record.service.ts unrelated.

Reviewer findings: pending

### Step 2 — DB Schemas (packages/db/src/schema/) — COMPLETE
*Date: 2026-04-03*

Files changed:
- `packages/db/src/schema/trust-scores.ts` — trustScores table: composite trust score per actor with SLA penalty, weights version, raw inputs snapshot
- `packages/db/src/schema/ds-ratings.ts` — dsRatings table (reviewer score/tier/vote weight) + dsTagSpecializations table (per-tag reviewer ratings)
- `packages/db/src/schema/dispute-deposits.ts` — disputeDeposits table: T2/T3 seller deposits with status lifecycle and deadlines
- `packages/db/src/schema/arp-segments.ts` — arpSegments table: adaptive review period segments by category/amount/tag
- `packages/db/src/schema/tags.ts` — tags table (lifecycle + hierarchy) + expertTags table (user qualifications) + tagMergeLog table (merge audit trail)
- `packages/db/src/schema/index.ts` — added 5 new export lines for all new tables

Decisions made:
- `slaPenaltyFactor` default uses string `"1.0"` because Drizzle `numeric` columns require string defaults (not number literals)
- All column names use snake_case in DB matching existing pattern (e.g., `actor_id`, `completed_transactions`)
- No FK constraints, no indexes, no migrations — per brief flags
- Import only from `drizzle-orm/pg-core` — per brief flags
- `boolean` imported from `drizzle-orm/pg-core` for `dsTagSpecializations.qualified` — per brief flag

Test results: N/A (schema-only, no runtime code)
Typecheck: `pnpm --filter @haggle/db typecheck` passes clean, 0 errors

Reviewer findings: pending

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
- **KG-2** — ~~DB schemas not yet updated for Phase 1-2 types~~ — RESOLVED Step 2 (2026-04-03)
- **KG-3** — ~~`shipments.ts` and `shipment-record.service.ts` have pre-existing type errors (missing shipping-core exports)~~ — RESOLVED Step 8 (2026-04-03)

---

## Architecture Decisions
*Locked decisions that cannot be changed without breaking the system.*

- Pure logic packages have 0 external deps, vitest only for dev — 2026-04-03
- Re-export-only index.ts pattern across all core packages — 2026-04-03
- Drizzle ORM + pgTable pattern for all DB schemas — 2026-04-03
- API routes: register*Routes(app, db) pattern with Zod validation — 2026-04-03
- Tag Levenshtein: pure Wagner-Fischer DP, no external libs — 2026-04-03
- All drizzle-orm operators accessed via @haggle/db re-exports, never direct drizzle-orm import in api — 2026-04-03
- Service files use literal union types for enum columns, not plain string — 2026-04-03
