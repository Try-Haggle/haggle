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
