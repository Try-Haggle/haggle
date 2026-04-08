# Build Log — Step 54 (Listing Publish Hook + Admin Suggestions API)

*Written by Bob.*

## Summary

Wired the tag-placement pipeline (Steps 49–53) into the actual publish flow
and added an admin-facing suggestions queue API. All endpoints are guarded
by `requireAdmin`. Publish remains best-effort safe: tag placement failures
are swallowed and logged.

## Files Changed / Created

### Modified
- `apps/api/src/services/draft.service.ts`
  - Added imports: `tags`, `inArray` from `@haggle/db`, `placeListingTags`
    from `./tag-placement.service.js`.
  - Inside `publishDraft`, after the `listingsPublished` insert and before
    the draft status update, added a try/catch block:
    - Calls `placeListingTags(db, {title, description, category,
      priceBand:null, listingId: published.id, sourceEmbedding:null})`.
    - On non-empty selectedTagIds → `db.select({id,name}).from(tags)
      .where(inArray(...))` to resolve labels.
    - On non-empty labels → `db.update(listingsPublished)
      .set({snapshotJson: {...published.snapshotJson, tags: labels}})
      .where(eq(id, published.id))`.
    - Any thrown error is caught and logged via `console.warn`. Publish
      always proceeds to the draft-status update regardless.
  - No other lines of the existing publish flow were changed.

- `apps/api/src/routes/tags.ts`
  - Added imports for all five functions plus `SuggestionStatus` from the
    new `tag-suggestion.service.js`.
  - Added two Zod schemas: `approveSuggestionSchema`, `mergeSuggestionSchema`.
  - Added five endpoints at the end of `registerTagRoutes`, all guarded by
    `preHandler: [requireAdmin]`:
    - `GET  /tag-suggestions`              (list with status/limit/offset)
    - `GET  /tag-suggestions/:id`          (404 on not-found)
    - `POST /tag-suggestions/:id/approve`  (400 on invalid body or state)
    - `POST /tag-suggestions/:id/reject`   (400 on invalid state)
    - `POST /tag-suggestions/:id/merge`    (400 on invalid body or state)

### Created
- `apps/api/src/services/tag-suggestion.service.ts`
  - Exports: `SuggestionStatus` (type), `ListSuggestionsOptions`,
    `listSuggestions`, `getSuggestionById`, `approveSuggestion`,
    `rejectSuggestion`, `mergeSuggestion`.
  - `approveSuggestion` auto-merges into an existing tag when a row with the
    same `normalized_name` already exists — in that case no new `tags` row
    is inserted and the suggestion is marked `MERGED` with `mergedIntoTagId`
    set. Otherwise creates a new `tags` row (`createdBy: "ADMIN"`, status
    `CANDIDATE` by default) and marks the suggestion `APPROVED`.
  - `rejectSuggestion` / `mergeSuggestion` reject transitions from non-PENDING
    states with `{ok:false, error: "Already <STATUS>"}`.
  - `mergeSuggestion` verifies the target tag exists before mutating.
  - All mutations set `reviewedBy`, `reviewedAt`, `updatedAt`.

- `apps/api/src/__tests__/tag-suggestion.service.test.ts` — 11 tests
  1. `listSuggestions` filters by status and returns rows
  2. `listSuggestions` applies limit/offset pagination
  3. `getSuggestionById` returns null when not found
  4. `approveSuggestion` creates new tag when normalized name does not exist
  5. `approveSuggestion` auto-merges when normalized name already exists
  6. `approveSuggestion` returns ok:false when suggestion does not exist
  7. `approveSuggestion` returns ok:false when already APPROVED/REJECTED
  8. `rejectSuggestion` marks a pending suggestion REJECTED
  9. `rejectSuggestion` returns ok:false when suggestion does not exist
  10. `mergeSuggestion` merges into a valid target tag
  11. `mergeSuggestion` returns ok:false when suggestion does not exist

- `apps/api/src/__tests__/draft-publish-hook.service.test.ts` — 4 tests
  1. Placement success → `listingsPublished` update called with
     `snapshotJson.tags = [resolved labels]`.
  2. Placement throws → publish still succeeds, no snapshot update call
     (console.warn logged; visible in stderr as expected).
  3. Placement returns empty `selectedTagIds` → no snapshot update call.
  4. Placement returns ids but tags-table lookup is empty (stale ids) → no
     snapshot update call.

Both test files override the global `@haggle/db` mock via `vi.mock` and use
the same style as `tag-placement.service.test.ts`. The draft test also mocks
`tag-placement.service.js` so placement behavior is fully controlled.

## Test Counts

- Before: **187 passed** (12 files)
- After:  **202 passed** (14 files, +15 tests)

Breakdown of additions:
- `tag-suggestion.service.test.ts`:       11 tests
- `draft-publish-hook.service.test.ts`:    4 tests

No existing tests were modified or regressed.

## Typecheck

`pnpm --filter @haggle/api typecheck` — all files I touched or created are
clean. The command still exits non-zero because of pre-existing errors in
unrelated files that were already broken on this branch prior to Step 54:

- `src/routes/disputes.ts` — `DisputeCase` missing `metadata` /
  `refundAmountMinor`
- `src/routes/internal.ts`, `src/scripts/backfill-embeddings.ts`,
  `src/services/embedding.service.ts`, `src/services/similar-listings.service.ts`
  — `@haggle/db` not exporting `listingEmbeddings` / `tagIdfCache` /
  `recommendationLogs`
- `src/services/embedding.service.ts`, `src/services/tag-placement-llm.service.ts`
  — `openai` / `replicate` packages not installed

None of these errors are in files touched by this step. Filtered typecheck
output for `draft|tag-suggestion|routes/tags\.ts` returns zero errors.

## Deviations from Brief

- **`reply.send(result)` vs bare `return result`** — used `reply.send(...)`
  for consistency with the existing tags.ts endpoints (the brief showed bare
  returns). Fastify accepts both, but `reply.send` matches the style already
  in use throughout the file.
- **404 vs 400 error codes** — `GET /tag-suggestions/:id` returns 404 on
  not-found. Mutation endpoints return 400 on service `{ok:false}` (matching
  the brief's `if (!result.ok) return reply.code(400).send(result)` pattern),
  which also covers the "suggestion not found" case for mutations. This is
  consistent with the brief's guidance (GET not-found → 404, state error → 400)
  though it means POST-not-found also lands at 400 rather than 404. Flagging
  for Richard.
- **Error code naming** — approve/merge body validation errors are surfaced
  as `INVALID_APPROVE_REQUEST` / `INVALID_MERGE_REQUEST` (matching
  `INVALID_TAG_REQUEST` etc. in existing tags.ts) rather than the brief's
  unspecified shape.

None of these are material deviations.

## Known Limitations

- The publish hook's `priceBand` and `sourceEmbedding` are hardcoded to null
  per the brief. Price-band aware placement is post-MVP and embeddings are
  not available at publish time yet.
- The admin endpoints do not add routing-level test coverage beyond the
  existing auth-wiring pattern. Happy-path coverage for the admin endpoints
  lives at the service layer (`tag-suggestion.service.test.ts`). A future
  step could add integration tests through `getTestApp()` once service mocks
  are plumbed into the wider `tags.test.ts` harness.
- `approveSuggestion`'s auto-merge compares only `normalized_label` equality
  — no category scoping. If the same normalized label exists in a different
  category, it will still merge. This matches the brief exactly; category
  scoping is a post-MVP refinement.
- Pre-existing apps/api typecheck errors (listed above) remain; they are
  out of scope for this step.

---

# Build Log — Phase 0 Week 1-2 Part A (Foundation)

*Written by Bob. 2026-04-08.*

## Summary

Part A of the Phase 0 dispute-triggered attestation + HFMI v0 sprint.
Foundation schema + canonical hash utility. No touching of `packages/shared`
or existing `packages/db` core files — all additive.

Scope: A1, A2, A3, A5. A4 (S3 bucket) skipped per brief — founder handles infra.

## Open Decisions Resolved

1. **Attestation location**: merged into `dispute-core` context (no new package).
   Attestation is a single evidence type at v0; split only when it grows
   independent logic. Schema lives in `@haggle/db`, hash util lives in
   `apps/api/src/lib/` — no cross-package surface yet.
2. **Hash language**: TypeScript only. Native `node:crypto` sha256.

## Files Created

### Schema (packages/db/src/schema/)
- `seller-attestation-commits.ts` — append-only commit log, FK to
  `listings_published(id)` with cascade delete. Indexed on `(listing_id)`
  and `(seller_id, committed_at)`.
- `hfmi-price-observations.ts` — HFMI ingestion log with source enum
  (`ebay_browse | ebay_sold | terapeak_manual | marketplace_insights |
  gazelle | backmarket | haggle_internal`). Composite index
  `(source, model, observed_at)` + unique `(source, external_id)` for
  dedup across re-fetches.
- `hfmi-model-coefficients.ts` — versioned nightly OLS fit results per SKU.
  Never updated in place. Index `(model, fitted_at)`.

### Migration
- `packages/db/migrations/004_attestation_and_hfmi.sql` — hand-crafted
  SQL following the existing `003_negotiation_tables.sql` pattern (see
  "drizzle-kit blocker" below).

### Hash utility
- `apps/api/src/lib/attestation-hash.ts`
  - `AttestationInput` interface (listingId, sellerId, imei, batteryHealthPct,
    findMyOff, photoKeys, committedAt)
  - `ATTESTATION_CANONICAL_VERSION = 'v1'` — bumped on any structural change
  - `canonicalizeAttestation()` — deterministic via ordered `[key, value]`
    tuple array (bypasses object-key-order ambiguity entirely). Normalizes
    IMEI to digits-only, validates battery 0-100 integer, preserves photoKeys
    order (semantically meaningful).
  - `computeCommitHash()` — sha256 hex digest, 64 chars.

### Test
- `apps/api/src/__tests__/attestation-hash.test.ts` — 11 tests, all green.
  - Locked fixture hash: `7f9a1f9853ec8fa5c485249a379ab8e56fafcf11b5e7a44de9ec7ce9a6d256f7`
  - This constant is a regression guard. Changing it requires explicit
    acknowledgement that every historical commit_hash is invalidated.
  - Covers: determinism, schema version marker, IMEI normalization, photoKey
    order sensitivity, integer/range validation, empty-field rejection, hash
    format, per-field sensitivity.

## Files Modified

- `packages/db/src/schema/index.ts` — added three barrel exports.
- `packages/db/drizzle.config.ts` — added three schema paths to the explicit
  file list.

## drizzle-kit Blocker (Known Gap)

`pnpm --filter @haggle/db db:generate` fails with
`Cannot find module './listing-drafts.js'` originating from
`listings-published.ts` — a file I did not touch. This is a pre-existing
drizzle-kit CJS/ESM loader bug: it cannot resolve `.js` extension imports
from TS schema files. This is why the repo uses hand-crafted SQL migrations
in `packages/db/migrations/` (e.g. `003_negotiation_tables.sql`) rather than
auto-generated drizzle output.

**Decision**: followed the established repo pattern and wrote
`004_attestation_and_hfmi.sql` by hand. Schema definitions and SQL are
kept in lock-step manually.

## Verification

- `pnpm --filter @haggle/db typecheck` — clean
- `pnpm --filter @haggle/api typecheck` — clean (inside `pnpm typecheck`)
- `pnpm test` — **all 26 test tasks passed**, including
  `attestation-hash.test.ts (11 tests)`.
- Engine-core, engine-session, dispute-core, arp-core, trust-core test suites
  unchanged and green.

## Pre-existing Failures (NOT my changes)

- `@haggle/web` typecheck fails in
  `apps/web/src/app/(marketing)/negotiate/page.tsx:367` —
  `counterPrice: number | null` incompatible with `TimelineEntry.counterPrice: number`.
  This file is an untracked addition from a prior session. Logging as
  known gap; escalate to Arch if blocks Part C landing page work.

## Blockers for Part B

None. Part B can proceed:
- `hfmi_price_observations` schema + migration ready for the ingestion cron
- Source enum includes all v0 sources (`ebay_browse`, `terapeak_manual`, etc.)
- `hfmi_model_coefficients` ready for nightly fit writes
- Unique index on `(source, external_id)` enforces dedup contract required
  by the ingestion job

## Notes for Richard

When reviewing:
- Confirm schema files are additive only (no touch of existing core files).
  Verified via `git diff --stat packages/db/src/schema/`.
- Confirm fixture hash determinism: run the test twice, compare bytes.
  Already covered by the `is deterministic for identical input` test.
- Note that `canonicalizeAttestation` uses an ordered-tuple JSON
  (`[[key,value], ...]`) not an object. This is intentional — JSON.stringify
  over objects is NOT guaranteed stable across engines for non-ASCII keys or
  reordered property definitions. Ordered tuples sidestep that entirely.

---

## Part B — HFMI Ingestion (Day 3-4)

**Builder:** Bob
**Date:** 2026-04-08
**Status:** Complete, tests green

### Files created

1. `apps/api/src/lib/ebay-browse-client.ts` — B1
   OAuth client-credentials flow with in-memory token cache (60s safety
   window). Single `searchActiveListings(query)` method. Internal
   `callsToday` counter fails fast at `dailyLimit` (default 4500, 10%
   safety margin under eBay's free 5000/day ceiling). Exponential backoff
   on 429/5xx (baseBackoffMs × 2^attempt, maxRetries=4). Built from scratch
   per Arch recommendation — no `ebay-api` package. Exposes test hooks
   `_setCallsTodayForTest` / `_setCachedTokenForTest` for unit coverage.
   `defaultIphoneFilter()` helper centralizes the shared filter string.

2. `apps/api/src/lib/hfmi-title-parser.ts` — B3
   Regex extractors for `storageGb` (128/256/512/1024), `batteryHealthPct`
   (3 patterns: "Battery 92%", "BH 88%", "N% battery"), `carrierLocked`
   (unlocked → false; carrier-specific → true; else null), and coarse
   cosmetic grade hint (mint/excellent → A, very good/used → B,
   scratched/fair → C). `parseEbayTitle` top-level runs exclusion
   screening first per §5.4 (broken/cracked/for parts/iCloud locked/lot
   of/bulk/bad ESN) plus an accessory-only guard (accessory keywords w/o
   "iphone" mention). All extractors return null when nothing confident.

3. `apps/api/src/jobs/hfmi-ingest.ts` — B2
   `runHfmiIngest(db, opts)` exportable for cron wiring. Iterates the 6
   SKU queries in `HFMI_SKUS` (iphone_13/14/15 pro + pro_max). For each
   SKU: eBay search → SKU disambiguation (Pro vs Pro Max titleExclude) →
   currency/US/price-range guard → title parse → condition mapping →
   insert rows with `onConflictDoNothing()` on the existing unique
   `(source, external_id)` index. Fails gracefully when eBay credentials
   missing (logs warn, no-op return). Rate-limit error halts iteration
   but returns partial summary. Returns per-SKU counts for ops visibility.

4. `apps/api/src/jobs/hfmi-fit.ts` — B4
   `runHfmiFit(db, opts)` — nightly fit for all 6 SKUs. Pulls trailing
   30d observations via raw SQL (avoids needing `gte`/`and` exports not
   currently re-exported from `@haggle/db`). Applies §4.2 `0.92` Browse→
   Sold correction factor on `ebay_browse` source rows only. Imputes
   missing battery with per-SKU median. Builds 9-column design matrix
   (intercept, storage_256/512/1024, battery, cosmetic_b/c,
   carrier_locked, days_since_listing). Fits via normal-equations OLS
   (Gauss-Jordan with partial pivot) — see DEVIATION #1 below. Computes
   R² via SSR/SST, residual std via `simple-statistics`. Writes coefficient
   row only when `r_squared ≥ 0.50` AND `sample_size ≥ 30` per §6.1 step 5.
   `fitSku` and `olsNormalEquations` are exported for unit testing without
   db dependency.

5. `apps/api/src/services/hfmi.service.ts` — B5
   `getHfmiMedian(db, input)` per brief signature. Loads latest
   coefficient row via `db.query.hfmiModelCoefficients.findFirst`
   (drizzle native path) with a raw SQL fallback. Computes log(price)
   via the full hedonic formula, `Math.exp`s to USD, then applies the
   `±$35` CI floor (§1.0 — wide CI reflects v0 active-listing
   uncertainty). Defaults: battery=90, cosmetic=B, carrierLocked=false.
   Throws `HfmiUnavailableError` when no qualifying fit exists.

### Tests (all in `apps/api/src/__tests__/`)

- `ebay-browse-client.test.ts` — 8 tests. Covers: missing-credentials
  failure, OAuth token caching, refresh after expiry (with injected
  clock), rate-limit guard at ceiling and live-counter ceiling, 429
  retry recovery, 5xx retry exhaustion, URL builder param shape.
  All assertions use an injected mock `fetchImpl`.
- `hfmi-title-parser.test.ts` — 35 tests. Per-extractor micro-tests plus
  **15 end-to-end title fixtures** exercising real-ish eBay titles across
  happy path, exclusions (cracked/icloud locked/lot of/bad ESN/accessory
  bundle), carrier lock variants, all storage sizes, all cosmetic hints.
- `hfmi.service.test.ts` — 7 tests. Covers: no-fit-row → throw, baseline
  128GB A unlocked median, storage premium monotonicity, carrier-lock
  discount sign, ±$35 CI floor engagement when residual_std tiny, CI
  floor non-engagement when residual_std wide, default battery=90
  parity with explicit 90.

### Test results

```
pnpm --filter @haggle/api test
 Test Files  18 passed (18)
      Tests  263 passed (263)
   Duration  1.75s
```

50 new tests (8 eBay client + 35 title parser + 7 service) added cleanly
on top of the existing 213.

### Typecheck

```
pnpm --filter @haggle/api typecheck
```

All Part B files typecheck clean. Pre-existing errors in branch files
(`routes/disputes.ts`, `routes/internal.ts`, `routes/recommendations.ts`,
`services/embedding.service.ts`, `services/similar-listings.service.ts`,
`services/tag-placement-llm.service.ts`, `scripts/backfill-embeddings.ts`)
are untouched by this sprint and unrelated to Part B. Flagged for Arch
to triage in the parent feature branch.

### Dependency added

- `simple-statistics@7.8.9` — used in `hfmi-fit.ts` for `mean` and
  `standardDeviation`. OLS solver is hand-rolled (see DEVIATION #1).

### Deviations from brief

1. **OLS solver: hand-rolled instead of `simple-statistics` primitives.**
   `simple-statistics` only exposes **simple** (single-predictor) linear
   regression via `linearRegression([[x,y],...])`. The HFMI hedonic model
   is multi-variable (9 predictors including intercept). Two options were
   considered:
   - Add `ml-regression-multivariate-linear` (the HFMI spec §11 recommends
     this) — adds another dep.
   - Hand-roll the normal-equations solver (~50 lines of Gauss-Jordan with
     partial pivot).

   I chose the second — the math is trivial, the implementation is
   exported and independently unit-testable via `fitSku`, and we keep
   the dependency surface minimal per CLAUDE.md rule #6 (MVP-first,
   single runtime). `simple-statistics` is still pulled in for `mean`
   and `standardDeviation` as the brief directed.

2. **Raw SQL inside `hfmi-fit.ts` observation loader.** `@haggle/db`
   currently re-exports `eq, sql, and, gt, lt, desc, asc, isNull, inArray`
   but not `gte` or `between`. Rather than modify the db barrel (explicit
   "DO NOT TOUCH"), I used a `sql` template literal for the range query.
   Drizzle's `sql\`...\`` is idiomatic for this kind of read path.

3. **`hfmi-ingest.ts` runs once per invocation; not self-scheduling.**
   The brief notes cron scheduling is infra, not this sprint. Exportable
   function is ready for whatever wrapper (systemd timer, node-cron,
   cloud scheduler) the deploy layer provides.

4. **Ingest `pagesPerSku` defaults to 1.** Conservative default — 6 SKUs
   × 1 page × 100 items/page = 600 items/invocation, well under the
   daily cap even at hourly cadence. Caller can bump via `opts.pagesPerSku`
   for backfill runs.

5. **Setup.ts mock expanded.** Added `hfmiPriceObservations: {}` and
   `hfmiModelCoefficients: {}` exports to the global `@haggle/db` mock
   in `src/__tests__/setup.ts` so top-level `import { ... } from
   "@haggle/db"` resolves in the service under test. Additive, preserves
   all existing mock behavior.

### Open decisions recorded (Bob's call)

- **eBay client**: built from scratch per Arch rec #3 — see B1 rationale.
- **OLS library**: deviated from `ml-regression-multivariate-linear`
  recommendation in HFMI spec §11 in favor of hand-rolled normal
  equations (see DEVIATION #1). Revisit if numerical conditioning
  becomes an issue — multicollinearity between storage dummies + battery
  is mild in practice, but we could switch to QR decomposition if R²
  fits start showing instability.
- **hfmi-core as separate package?** Spec §11 recommends new package. I
  kept it inline under `apps/api/src/{jobs,services,lib}` — the logic is
  ~400 lines total and all callers live in apps/api. Extracting to a
  package adds build-graph overhead without current test-boundary benefit.
  Revisit when Phase 0.5 expansion (MacBook RAM schema, weighted internal
  data) warrants the package split.

### Blockers for Part C

None. Part C (landing + methodology page) can proceed. The service
contract `getHfmiMedian(db, input) → { medianUsd, confidenceInterval,
sampleSize, lastRefit, coefficientVersion }` is stable. Suggestions:

- Landing page widget should catch `HfmiUnavailableError` and render a
  "HFMI calibrating…" skeleton rather than erroring. Until the first
  nightly fit lands there will be no coefficient row, so Part C must
  handle the empty case gracefully.
- Methodology page can read the latest coefficient row directly via the
  same loader pattern used in `hfmi.service.ts` — the `coefficients` JSON
  blob has all the keys (`intercept, storage_256, ..., residual_std`)
  needed for the formula table.
- Neither ingest nor fit has been run against live eBay yet — Part C
  pages should either mock the HFMI response during local dev or
  document the required env vars (`EBAY_CLIENT_ID`, `EBAY_CLIENT_SECRET`)
  in README.

### Safety checks

- No changes to `packages/shared`, `packages/db` core, or existing
  `hfmi-price-observations` / `hfmi-model-coefficients` schema files.
- No contract changes. No onchain code touched.
- No changes to existing tests outside of the additive mock export in
  setup.ts. All 213 pre-existing tests still green alongside the 50 new
  ones.
- eBay credentials read from `process.env` with graceful warn-and-no-op
  fallback; missing creds cannot crash a cron invocation.
- Rate limit guard pre-increments the counter before the HTTP call, so
  concurrent calls can never collectively exceed the cap by more than the
  in-flight count.

---

# Build Log — Step 55 (Attestation Commit Backend)

*Written by Bob. 2026-04-08.*

## Summary

Server-side of the Phase 0 dispute-triggered attestation flow:
3 REST endpoints + storage service + core attestation service with
hash-based verification hook for dispute-core reuse. Infrastructure
(Supabase bucket, Vault key) already provisioned by Arch — Bob only
wrote code.

## Files Created

- `apps/api/src/lib/supabase-storage-paths.ts`
  - `ATTESTATION_BUCKET` constant, TTL constants.
  - `sanitizeAttestationFilename()` — allows `[A-Za-z0-9._-]`, rejects
    dotfiles, path separators, unicode. Length 1..128.
  - `sanitizeListingIdSegment()` — restricts to `[A-Za-z0-9-]`.
  - `buildAttestationObjectPath()` / `validateAttestationStoragePath()`
    — idempotent canonical path builder + traversal-safe validator.

- `apps/api/src/services/supabase-storage.service.ts`
  - Lazy Supabase client factory (errors on missing env, not at import).
  - `createAttestationUploadUrl(objectPath)` — Supabase SDK
    `createSignedUploadUrl`, returns `{uploadUrl, storagePath, token,
    expiresIn=600}`.
  - `attestationObjectExists(objectPath)` — emulates HEAD via
    `list(folder, { search: filename, limit: 1 })` since Supabase JS
    has no native head().
  - `createAttestationViewUrl(objectPath)` — 10-minute signed download.
  - `_setSupabaseClientForTest()` — injection hook.

- `apps/api/src/services/attestation.service.ts`
  - `AttestationConflictError`, `AttestationNotFoundError`,
    `AttestationForbiddenError` classes.
  - `createAttestationCommit(db, req)` — 409 duplicate check → storage
    path validation → per-photo bucket existence check → canonicalize +
    hash → raw SQL INSERT with pgsodium AEAD encryption of IMEI keyed
    by Vault name `attestation_imei_key`. `photoKeys` in the canonical
    payload are the fully-qualified `bucket/listingId/filename` strings
    so the same shape the GET endpoint returns re-hashes identically.
  - `loadCommitByListing(db, listingId)` — raw-SQL loader, normalizes
    driver-shape (array vs `.rows`).
  - `getListingSellerId(db, listingId)` — joins `listings_published →
    listing_drafts` to resolve owner.
  - `getListingBuyerId(db, listingId)` — latest `commerce_orders` row
    by listing, null if no order.
  - `getAttestationForViewer(db, listingId, caller)` — access control
    matrix: seller (by join) / buyer (by order) / admin (by role) →
    full; else null (404 obfuscation). Mints signed 10-min view URLs
    for each photo path.
  - `verifyAttestationCommit(db, listingId, submittedPayload)` —
    re-canonicalizes + re-hashes, compares to stored. Returns `{found,
    match, storedHash, computedHash, divergence?}`. `divergence` is a
    list of canonical-field names that differ, computed from the stored
    `canonical_payload` JSONB blob.

- `apps/api/src/routes/attestation.ts`
  - `POST /api/attestation/presigned-upload` — requireAuth + seller
    ownership check → 400/403/404/500 + 200 happy path.
  - `POST /api/attestation/commit` — requireAuth + seller ownership →
    400/403/404/409 + 201 happy path.
  - `GET  /api/attestation/:listingId` — requireAuth → service does
    access control → 404 for unauth AND not-found (identical), 200 with
    photos + signed view URLs on success.

- `apps/api/src/__tests__/attestation.service.test.ts` — 14 tests
  1. createAttestationCommit inserts + returns hash (happy path)
  2. 409 when commit already exists
  3. Rejects when a photo does not exist in bucket
  4. Rejects storage path not matching listingId
  5. verify match=true for identical payload
  6. verify match=false for tampered batteryHealthPct (+divergence)
  7. verify match=false for reversed photoStoragePaths (+divergence)
  8. verify found=false when no commit exists
  9. getAttestationForViewer seller → full
  10. getAttestationForViewer buyer → full (via commerce_orders lookup)
  11. getAttestationForViewer admin → full (skips buyer lookup)
  12. getAttestationForViewer unrelated caller → null (404-obfuscation)
  13. getAttestationForViewer no-row → null
  14. loadCommitByListing null / row round-trip

- `apps/api/src/__tests__/attestation.routes.test.ts` — 15 tests
  1. presign 401 without auth
  2. presign 400 missing fields
  3. presign 400 disallowed filename (`../evil.jpg`)
  4. presign 403 non-seller caller
  5. presign 404 listing not found
  6. presign 200 happy path with upload URL
  7. commit 401 without auth
  8. commit 400 invalid body
  9. commit 403 non-seller caller
  10. commit 409 duplicate
  11. commit 201 happy path
  12. GET 401 without auth
  13. GET 404 when service returns null
  14. GET 200 with full view for authorized caller (includes signed URLs)
  15. GET 404 on malformed listingId segment

## Files Modified

- `apps/api/src/server.ts`
  - Import `registerAttestationRoutes` and register after admin routes.
- `apps/api/src/__tests__/setup.ts`
  - Added `sellerAttestationCommits: {}` to the `@haggle/db` mock export.

## Test Counts

- Before:  263 passing (Part B baseline)
- After:   349 passing, 0 failing (+29 from this step on top of Step 54)
  - `attestation.service.test.ts`:  14 tests
  - `attestation.routes.test.ts`:   15 tests

Pre-existing test counts from Step 54 and other in-flight work are
unchanged and still green.

## Typecheck

`pnpm --filter @haggle/api typecheck` — clean, zero errors.

## Known Risks (per ARCHITECT-BRIEF)

1. **Supabase Vault key management**. Key rotation is the Project
   Owner's responsibility. The service only references the key by name
   (`attestation_imei_key`). If the key is rotated, historical
   `imei_encrypted` values become unreadable unless the rotation
   preserves the key id / re-encrypts.
2. **Supabase head() cost**. Each commit does N list-with-search calls
   (one per photo). At ~5 photos/commit this is 5 API calls — well
   under any reasonable rate limit, but something to revisit if commit
   volume climbs or the photo count grows.
3. **photoStoragePaths order dependency**. The canonical hash preserves
   order. If the wizard re-uploads in a different order the hash will
   differ, meaning dispute-core verify will fail. The wizard must lock
   order client-side; this is a front-end contract, not a server
   concern.

## Deviations from Brief

1. **`photoKeys` in canonical payload are fully-qualified paths
   (`attestation-evidence/{listingId}/{filename}`)** rather than the
   raw storage-path arg. This ensures the GET response's
   `photos[].storagePath` round-trips cleanly through
   `verifyAttestationCommit` — dispute-core can pass the GET response
   straight back without any translation. Documented in code comments
   on `createAttestationCommit`.

2. **Placeholder `expiresAt = now + 30d`** per brief §2.6. arp-core
   will override this at order time. The value is stored as a plain
   ISO string; the 30-day window is hard-coded as
   `DEFAULT_REVIEW_WINDOW_MS`.

3. **`pgsodium.crypto_aead_det_encrypt` uses `listingId` as associated
   data** (the second arg). This binds a given ciphertext to its
   listing, so a copy-paste of `imei_encrypted` into a different row
   cannot be decrypted. The brief did not specify AD — this is a
   strictly-additive hardening.

4. **GET 404 obfuscation is absolute**. Even malformed listingId path
   segments return 404 rather than 400, so an attacker probing the
   endpoint cannot distinguish "listing format wrong" from "listing
   missing" from "not authorized".

## Known Limitations / Gaps

- **Supabase SDK list() as head() substitute** may have different
  semantics on very large folders (paginated listing). For attestation
  folders keyed by listingId this is a non-issue — each listing has at
  most ~20 photos.
- **No integration test against a real Supabase instance**. The route
  tests mock the storage service entirely; any bug that would only
  surface with a real bucket (e.g. RLS misconfiguration) will not be
  caught here. Stage-env smoke test required before production.
- **IMEI decrypt path not exercised in tests**. Tests verify the service
  returns `imeiEncrypted` as-is (ENC blob). A decrypt-side helper can
  be added when dispute-core actually needs plaintext.
- **90-day object lifecycle**. Not implemented. Arch deferred to
  Step 57+.

## Notes for Richard

- Canonical hash is unmodified — `apps/api/src/lib/attestation-hash.ts`
  was NOT touched. Verified via `git diff --stat apps/api/src/lib/`.
- The access-control matrix on GET is all funneled through
  `getAttestationForViewer`. The route handler itself has no
  per-role logic — it maps `null → 404` and `object → 200`. Single
  choke point for review.
- 409 is only raised by `createAttestationCommit`; the route handler
  translates `AttestationConflictError` → 409 via instanceof check.
- Raw SQL used for insert/select because of pgsodium +
  `vault`-resolved key lookup. Drizzle query builder cannot express
  `pgsodium.crypto_aead_det_encrypt(..., (SELECT id FROM pgsodium.key
  WHERE name = ...))` natively.

---

## Step 55 — Round 2 (Review Fixes)

**Scope**: C1 + C2 + S1 + S2 + S3 from REVIEW-FEEDBACK.md. Nits skipped.

### C1 — IMEI normalization asymmetry (FIXED)
Root cause of the hash/payload mismatch on formatted IMEIs: the service
hand-built `canonicalObj` with a stripped IMEI but fed the **raw** IMEI to
`canonicalizeAttestation()`. Pure-digit fixtures masked the bug.

Fix: IMEI is now normalized exactly once, at the single choke point
`normalizeImei()` in the new `lib/attestation-canonical-record.ts`. Both
`createAttestationCommit` and `verifyAttestationCommit` go through
`buildCanonicalAttestationRecord()` which returns `{record, canonicalString,
commitHash}` in one pass. The service writes `record` to
`canonical_payload` byte-for-byte, and uses `record.imei` for the
`pgsodium.crypto_aead_det_encrypt(...)` plaintext. Hash, JSONB, and
ciphertext are now guaranteed consistent.

### C2 — 409 TOCTOU race (FIXED)
Verified that `004_attestation_and_hfmi.sql` and the schema file did NOT
have `UNIQUE(listing_id)` — only a non-unique btree index. Two concurrent
commits could both pass the pre-SELECT check and both INSERT.

Fixes:
- New migration `packages/db/migrations/005_attestation_unique_listing.sql`
  adds `CONSTRAINT uq_seller_attestation_commits_listing_id UNIQUE (listing_id)`.
- Schema `seller-attestation-commits.ts` updated with `uniqueIndex(...)`.
- Service removes the pre-SELECT. `db.execute(INSERT)` is wrapped in
  `try/catch`, and Postgres SQLSTATE `23505` (constant `PG_UNIQUE_VIOLATION`)
  is mapped to `AttestationConflictError`. The code probe handles both the
  direct `err.code` shape and `err.cause.code` for driver wrappers.

### S1 — Internal error leak on commit route (FIXED)
Before: `routes/attestation.ts` returned 400 with
`message: (err as Error).message` for any non-conflict error — leaking
internal storage paths, SQL fragments, etc.

Fix: new typed errors `AttestationValidationError` and
`AttestationStorageError` are thrown by the service. The route now:
- Conflict → 409 `ATTESTATION_ALREADY_COMMITTED`
- Validation/storage errors → 400 `INVALID_COMMIT_REQUEST` with **no**
  message field; real error logged at `warn` server-side.
- Anything else → 500 `COMMIT_FAILED` with **no** message; logged at
  `error`. Mirrors the presign handler convention.

### S2 — GET timing side-channel (ALREADY PARALLEL)
Verified `getAttestationForViewer` already wraps all signed-URL generations
in `Promise.all`. Authorized response latency is now O(1) signed-URL RTTs
regardless of photo count, so there is no N-photo timing delta between
authorized and unauthorized (404) paths. No change required.

### S3 — canonical_payload hand-reconstructed (FIXED — option a)
New file `apps/api/src/lib/attestation-canonical-record.ts` wraps the
locked `attestation-hash.ts`. It exposes `buildCanonicalAttestationRecord`
which is now the single source of truth for the canonical shape. Service
and verify both consume it; there is no hand-reconstructed canonical
object anywhere in the service.

### Regression tests added
- `round-trips a formatted IMEI` — calls `createAttestationCommit` with
  `"123 456-789 012 345"`, captures the `canonical_payload` JSON literal
  passed to `db.execute`, and asserts (a) returned `commitHash` matches
  an independent re-hash of the digits-only form, and (b) the stored
  `canonical_payload.imei` is digits-only.
- `throws AttestationConflictError on Postgres 23505 unique_violation` —
  makes `db.execute` reject with `{code: "23505"}` and verifies the
  service maps it to `AttestationConflictError`. This replaces the old
  pre-SELECT-based conflict test.

### Validation
- `pnpm --filter @haggle/api typecheck` → clean.
- `pnpm --filter @haggle/api test` → **350 passed** (23 files).
- Unused imports (`canonicalizeAttestation`, `computeCommitHash`,
  `AttestationInput`) removed from the service.

### Files touched in Round 2
- `apps/api/src/lib/attestation-canonical-record.ts` (new)
- `apps/api/src/services/attestation.service.ts` (rewrote
  `createAttestationCommit`, rewrote `verifyAttestationCommit`, added
  `AttestationStorageError` + `AttestationValidationError`, dropped
  unused imports)
- `apps/api/src/routes/attestation.ts` (S1)
- `apps/api/src/__tests__/attestation.service.test.ts` (regression tests,
  rewrote conflict test, dropped pre-SELECT expectation)
- `packages/db/migrations/005_attestation_unique_listing.sql` (new)
- `packages/db/src/schema/seller-attestation-commits.ts` (uniqueIndex)
