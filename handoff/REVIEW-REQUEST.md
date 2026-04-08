# Review Request — Step 55 (Attestation Commit Backend)

**Builder:** Bob
**Date:** 2026-04-08
**Ready for Review:** YES

## Scope

Server-side attestation flow per `ARCHITECT-BRIEF.md` Step 55: three
REST endpoints + Supabase Storage wiring + verify() hook for
dispute-core reuse. Infrastructure (bucket, Vault key) was already
provisioned by Arch; this change is code-only.

## Files Created

- `apps/api/src/lib/supabase-storage-paths.ts` (L1-110)
  Bucket name constant, TTLs, and strict sanitizers for filename /
  listingId path segments; canonical path builder and
  traversal-safe validator.

- `apps/api/src/services/supabase-storage.service.ts` (L1-115)
  Lazy Supabase client + `createAttestationUploadUrl`,
  `attestationObjectExists` (list-as-head emulation), and
  `createAttestationViewUrl` (10-min signed download).

- `apps/api/src/services/attestation.service.ts` (L1-380)
  Core attestation service. `createAttestationCommit` (with 409
  duplicate guard, storage existence check, canonicalize + hash,
  pgsodium AEAD encryption of IMEI via Vault key
  `attestation_imei_key`). `getAttestationForViewer` enforces the
  seller/buyer/admin access matrix with 404 obfuscation.
  `verifyAttestationCommit` is the dispute-core reuse hook — returns
  `{found, match, storedHash, computedHash, divergence?}`.

- `apps/api/src/routes/attestation.ts` (L1-155)
  Three endpoints wired via `requireAuth`: presigned-upload, commit,
  and read. All use existing error-response conventions.

- `apps/api/src/__tests__/attestation.service.test.ts` (L1-260) — 14 tests
  covering happy path, 409 conflict, missing photo, path mismatch,
  hash verify match/mismatch/order-swap/not-found, and the full
  3-tier access control matrix.

- `apps/api/src/__tests__/attestation.routes.test.ts` (L1-255) — 15 tests
  covering all three endpoints: 401 unauth, 400 invalid, 403 non-seller,
  404 missing listing, 404 unauthorized-or-missing (GET), 409 duplicate,
  200/201 happy paths.

## Files Modified

- `apps/api/src/server.ts` — imported and registered
  `registerAttestationRoutes` after admin routes (+2 lines).
- `apps/api/src/__tests__/setup.ts` — added
  `sellerAttestationCommits: {}` to the `@haggle/db` mock (+1 line).

## Files NOT Touched (confirmed)

- `apps/api/src/lib/attestation-hash.ts` — canonical hash util unchanged.
- `packages/shared/**` — no changes.
- `packages/db/**` core — no changes (only the existing
  `seller_attestation_commits` schema is referenced via raw SQL, not
  modified).
- Any existing route file.

## Validation

```
pnpm --filter @haggle/api typecheck     # clean, 0 errors
pnpm --filter @haggle/api test          # 349 passed (0 failing)
```

- Previous baseline: 263 tests
- New tests added this step: 29 (14 service + 15 routes)
- Remaining increment is from other Step-54 / in-flight work already
  on the branch before this step.

## Key Review Points (Richard)

1. **Access control on `GET /api/attestation/:listingId`** — is the
   404-obfuscation watertight? The route handler maps
   `null → 404`; the service funnels seller/buyer/admin checks through
   one function. Please verify there's no path that returns a
   distinguishable response when a commit exists but the caller isn't
   authorized.

2. **`attestation-hash.ts` unmodified** — verify via
   `git diff --stat apps/api/src/lib/attestation-hash.ts` (should be
   empty).

3. **Supabase SDK patterns** — `createSignedUploadUrl`,
   `createSignedUrl`, and `list()`-as-head. Does this match the
   convention already used elsewhere (I found no other attestation
   storage usage in `apps/api`, but please confirm).

4. **pgsodium usage** — the raw SQL subquery
   `(SELECT id FROM pgsodium.key WHERE name = 'attestation_imei_key')`
   assumes Project Owner created the key via the Vault UI and it's
   visible to the service-role client. If there's a wrapper function
   or a preferred lookup path, let me know.

5. **`photoKeys` in canonical payload are fully-qualified bucket paths**
   — a small deviation from the brief; documented in BUILD-LOG under
   Deviations. Purpose: the GET response's `photos[].storagePath`
   round-trips cleanly into `verifyAttestationCommit` without
   translation. If you'd rather store inner paths, I can flip it.

## Open Questions

- None. The brief was clear enough to land in one pass.

## Known Risks (logged in BUILD-LOG)

1. Supabase Vault key rotation is out-of-band — service only
   references by name.
2. N list()-as-head calls per commit (~5 for 5 photos) — fine at
   current scale.
3. `photoKeys` order is hash-sensitive — wizard must lock order
   client-side.

---

## Round 2 — Review Fix Submission

Richard's Round 1 verdict was NEEDS FIXES. All Critical + Should Fix
items are addressed below; Nits skipped per scope.

### Critical
- **C1 IMEI normalization asymmetry** — FIXED. IMEI is normalized once
  via `normalizeImei()` in the new `lib/attestation-canonical-record.ts`
  and reused for hash input, `canonical_payload` JSONB, and pgsodium
  plaintext. `buildCanonicalAttestationRecord()` returns
  `{record, canonicalString, commitHash}` in a single call so the three
  can no longer drift. Regression test: formatted IMEI
  `"123 456-789 012 345"` round-trip verified.
- **C2 409 TOCTOU race** — FIXED. Confirmed migration 004 and the schema
  had no `UNIQUE(listing_id)`. New migration 005 adds the constraint;
  schema updated with `uniqueIndex`. Service removes the pre-SELECT
  and does an unconditional INSERT, catching Postgres `23505` via the
  new `PG_UNIQUE_VIOLATION` constant and mapping it to
  `AttestationConflictError`. Regression test simulates a 23505 and
  asserts the error mapping.

### Should Fix
- **S1 Internal error leak** — FIXED. Commit route no longer forwards
  `(err as Error).message`. Validation/storage failures → 400
  `INVALID_COMMIT_REQUEST` (no message); infra failures → 500
  `COMMIT_FAILED` (no message); both logged server-side. Typed errors
  `AttestationValidationError` / `AttestationStorageError` added in the
  service for instanceof dispatch. Matches the presign handler pattern.
- **S2 GET timing side-channel** — VERIFIED ALREADY PARALLEL.
  `getAttestationForViewer` wraps all `createAttestationViewUrl` calls
  in `Promise.all`; authorized latency is a single RTT regardless of
  photo count. No change needed.
- **S3 canonical_payload hand-reconstructed** — FIXED via option (a).
  New `lib/attestation-canonical-record.ts` wraps the locked
  `attestation-hash.ts` and is now the **only** place the canonical
  record shape is constructed. `attestation-hash.ts` untouched.

### Validation
- `pnpm --filter @haggle/api typecheck` → clean.
- `pnpm --filter @haggle/api test` → **350 passed** (23 files; Round 1
  had 349, +1 new IMEI round-trip regression test; the old conflict
  test was rewritten in place as the 23505 regression test).

### New / modified files (Round 2)
- `apps/api/src/lib/attestation-canonical-record.ts` (new)
- `apps/api/src/services/attestation.service.ts`
- `apps/api/src/routes/attestation.ts`
- `apps/api/src/__tests__/attestation.service.test.ts`
- `packages/db/migrations/005_attestation_unique_listing.sql` (new)
- `packages/db/src/schema/seller-attestation-commits.ts`
- `handoff/BUILD-LOG.md` (Round 2 entry appended)

Ready for re-review.
