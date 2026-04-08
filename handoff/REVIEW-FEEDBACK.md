# Review Feedback — Step 55 (Attestation Commit Backend)

## Round 2 — Verdict: **CLEAR**

**Reviewer**: Richard
**Date**: 2026-04-08 (Round 2)
**Ready for Builder**: YES

### C1 — IMEI normalization asymmetry — FIXED
- `apps/api/src/lib/attestation-canonical-record.ts:55-57` — single `normalizeImei()` (digits-only).
- `:66-98` — `buildCanonicalAttestationRecord()` normalizes once, passes to `canonicalizeAttestation()`, hashes, and returns `{record, canonicalString, commitHash}` as one unit. Record and hash-input are the same object — cannot drift.
- `attestation.service.ts:129-137` — used in `createAttestationCommit`.
- `attestation.service.ts:420-428` — used in `verifyAttestationCommit` symmetrically.
- Regression test at `attestation.service.test.ts:157-216` commits `"123 456-789 012 345"`, asserts `result.commitHash` equals the reference hash computed from `"123456789012345"`, and captures the JSONB param to assert `canonical_payload.imei === "123456789012345"`. Round-trip proven.
- `ATTESTATION_CANONICAL_VERSION` is re-exported from the untouched `attestation-hash.ts:30` — helper imports it rather than hard-coding `"v1"`.

### C2 — 409 TOCTOU race — FIXED
- `packages/db/migrations/005_attestation_unique_listing.sql:11-13` — adds `UNIQUE (listing_id)` via `uq_seller_attestation_commits_listing_id`.
- `packages/db/src/schema/seller-attestation-commits.ts:52-54` — schema updated with `uniqueIndex` mirroring the migration.
- `attestation.service.ts:139-189` — pre-SELECT removed, unconditional INSERT, catch block inspects **both** `err.code` AND `err.cause?.code` (line 182-184) before mapping 23505 → `AttestationConflictError`. Non-23505 errors re-thrown.
- `PG_UNIQUE_VIOLATION = "23505"` constant at `:32`.
- Regression test at `attestation.service.test.ts:135-155` rejects the INSERT with `{code: "23505"}` and asserts `AttestationConflictError` is thrown.

### S1 — Internal error leak — FIXED
- `attestation.service.ts:34-46` — new `AttestationStorageError` / `AttestationValidationError` typed errors.
- `:101-121` — validation and storage failures wrapped in typed errors (no raw messages surfaced to the route).
- `routes/attestation.ts:130-147` — three-branch dispatch: `AttestationConflictError` → 409 (code only), `AttestationValidationError | AttestationStorageError` → 400 `INVALID_COMMIT_REQUEST` (code only, `request.log.warn` for server-side), everything else → 500 `COMMIT_FAILED` (code only, `request.log.error`). No `err.message` leaks to the client.

### S3 — Hand-constructed canonical records — FIXED
- Grepped `attestation.service.ts` for manual `canonicalObj` / literal `version: "v1"` patterns — none remain. The only site that constructs the canonical shape is the helper at `lib/attestation-canonical-record.ts`, used twice (commit + verify).

### Locked files — STILL UNTOUCHED
- `git diff --stat apps/api/src/lib/attestation-hash.ts` → empty. Confirmed. ✓

### Round 1 items intentionally not addressed
- S2 (GET timing side-channel): Bob notes the code was already parallel via `Promise.all` at `:354-362` — confirmed, this is the best fix short of a constant-time pad. Accepted.
- Nits N1-N4: out of scope for Round 2 per Bob's note. Log them to BUILD-LOG for a future pass; not blocking.

### Summary
All four Round-1 blockers land cleanly. The canonical-record helper is a good structural fix — it makes a C1-class divergence impossible to reintroduce by construction. The 23505 catch handles both raw-driver and wrapped-error shapes, which closes the realistic Drizzle-vs-postgres.js code-path concern. Typed errors in the route give us stable error codes without leaking internals. Tests exercise both regressions directly.

Step 55 is clear. Ship it.

— Richard

---

## Round 1 — Verdict: NEEDS FIXES (historical)

**Reviewer**: Richard
**Date**: 2026-04-08
**Verdict**: **NEEDS FIXES**
**Ready for Builder**: NO

---

## Must Fix

### C1 — IMEI hash/payload asymmetry (audit-trail corruption)
- **File**: `apps/api/src/services/attestation.service.ts:114-139`
- **What is wrong**: `canonicalizeAttestation()` is called with `input.imei = req.imei` (unmodified, line 117). The hash is computed over the raw IMEI the caller sent. But the `canonical_payload` JSONB written to the database at line 134 stores `imei: input.imei.replace(/\D/g, "")` — the *stripped* form. The bytes that were hashed and the bytes stored in `canonical_payload` are not the same object.

  Consequence: if a client ever submits an IMEI with a space, dash, or any non-digit, the **stored `canonical_payload` no longer represents the bytes that produced `commit_hash`**. Any auditor, dispute-core consumer, or future migration that re-hashes `canonical_payload` will get a hash that does not match `commit_hash`. The audit trail — the entire point of this feature — is broken on the first formatted IMEI.

  Tests pass today only because every fixture uses the pure-digit IMEI `"123456789012345"` where the strip is a no-op.

  Same asymmetry exists in `verifyAttestationCommit` at lines 403-412 vs 421: hash uses `submitted.imei` raw, divergence-diff uses stripped.

- **How to fix**: Normalize once at the boundary. At the top of `createAttestationCommit`:
  ```ts
  const normalizedImei = req.imei.replace(/\D/g, "");
  ```
  Pass `normalizedImei` as `input.imei` to `canonicalizeAttestation`, as the `canonicalObj.imei` field, and as the `convert_to(...)` argument to pgsodium. Do the same at the top of `verifyAttestationCommit`. Then every downstream artifact — hash, canonical_payload JSONB, ciphertext, diff — agrees byte-for-byte.

  Add one test: formatted IMEI `"123 456-789 012 345"` commits successfully, and the stored `canonical_payload.imei` hashes (via `canonicalizeAttestation`) back to the stored `commit_hash`.

### C2 — 409 duplicate-commit TOCTOU race
- **File**: `apps/api/src/services/attestation.service.ts:85-93`
- **What is wrong**: The "already committed?" check is a `SELECT ... LIMIT 1` followed by an unconditional `INSERT`. Two concurrent requests from the same seller for the same listing can both pass the SELECT and both INSERT, producing two attestation rows for one listing — silently breaking the append-only invariant the brief calls out ("append-only" in ARCHITECT-BRIEF §API Surface, endpoint 2). `seller_attestation_commits` may or may not have `UNIQUE (listing_id)`; Bob did not verify this, and the code does not catch a unique-violation error if one is raised.
- **How to fix**: Either
  - (preferred) confirm the schema has `UNIQUE (listing_id)` on `seller_attestation_commits`, drop the pre-SELECT, wrap the INSERT in try/catch, and translate Postgres error code `23505` into `AttestationConflictError`; or
  - if the schema lacks the constraint, escalate to Arch — that is a migration, not an app-level fix.

  Add a test that simulates a unique-violation error from `db.execute` during the INSERT and asserts `AttestationConflictError` is thrown.
- **Why this blocks**: silent duplicate commits defeat the canonical-hash audit trail and are exploitable by a racing seller who wants to commit a "clean" attestation and a "degraded" attestation side-by-side.

---

## Should Fix

### S1 — Commit route leaks internal error messages as 400
- **File**: `apps/api/src/routes/attestation.ts:128-137`
- **What is wrong**: Any non-`AttestationConflictError` throw is returned as `400 { error: "COMMIT_FAILED", message: (err as Error).message }`. That means:
  - `attestation: photo not found in bucket: {listingId}/front.jpg` — leaks the internal storage path shape to the client.
  - Supabase network errors, pgsodium key-missing errors, DB constraint violations — all surface their raw `.message` to whoever called the API.
- **Recommendation**: Split the catch into two branches. Validation-shaped errors (photo not found, path mismatch) → `400` with a stable error code and no `message`. Infrastructure errors → `500 { error: "COMMIT_FAILED" }` with the raw error sent only to `request.log.error`. The presign handler at lines 89-92 already follows this pattern — mirror it.

### S2 — GET 404 obfuscation has a timing side-channel
- **File**: `apps/api/src/services/attestation.service.ts:321-345`
- **What is wrong**: The authorized branch generates `N` signed view URLs via sequential `createAttestationViewUrl` calls (line 342, inside `Promise.all` but each call is an independent HTTPS round-trip to Supabase). An unauthorized or missing-row caller returns immediately. A patient attacker can distinguish "exists + I'm not authorized" from "doesn't exist" by measuring response latency. The brief explicitly requires 404 obfuscation.
- **Recommendation**: Not a blocker for MVP, but log it in BUILD-LOG under Known Risks so Arch can decide. If Arch wants it tightened, the cheap fix is a constant-time delay on the null branch (e.g. ~200ms) or pre-resolving the view URLs in parallel with the auth check so the happy path collapses.

### S3 — `canonical_payload` reconstructed by hand instead of derived from hash input
- **File**: `apps/api/src/services/attestation.service.ts:130-139`
- **What is wrong**: `canonicalObj` is built field-by-field in the service, separately from the `AttestationInput` passed to `canonicalizeAttestation`. That separation is exactly what enabled the C1 bug. `version: "v1"` is also hard-coded here and in the verify path at lines 417-426; it should be a shared constant.
- **Recommendation**: After fixing C1, build `canonicalObj` **from the same `input` object** that went into `canonicalizeAttestation` — either by keeping a parallel plain-object representation or by JSON-parsing the canonical string. Define a local `CANONICAL_VERSION = "v1"` constant at the top of the service and reference it in both places (do not modify `attestation-hash.ts` — just mirror the literal into a service-local constant).

---

## Nit

### N1 — Presign response includes `token` field not in the brief
- **File**: `apps/api/src/routes/attestation.ts:83-88`, `apps/api/src/services/supabase-storage.service.ts:47-76`
- **What is wrong**: ARCHITECT-BRIEF §API Surface endpoint 1 specifies `{ uploadUrl, storagePath, expiresIn }`. Bob adds `token`. Probably required by the Supabase upload flow on the client side, but it is drift from spec.
- **Recommendation**: Either drop `token` or add one line to BUILD-LOG Deviations explaining why the wizard needs it. I suspect it's the latter — Supabase signed uploads need the token alongside the URL — but it should be documented.

### N2 — `contentType` parsed but never used
- **File**: `apps/api/src/routes/attestation.ts:32-36`, consumed at line 58
- **What is wrong**: `presignSchema` requires `contentType`, but the handler never consults it. No MIME allowlist, not forwarded to Supabase. It exists only to satisfy validation.
- **Recommendation**: Replace `z.string().min(1)` with `z.enum(["image/jpeg","image/png","image/webp"])`. Two-line change, closes a missing allowlist the next security pass would flag anyway.

### N3 — Missing test: authorized-caller case with no buyer yet
- **File**: `apps/api/src/__tests__/attestation.service.test.ts:238-293`
- **What is wrong**: Access-control tests cover seller / buyer / admin / unrelated-caller-with-buyer / missing. Not covered: **stranger calls, commit exists, no order exists yet**. This is the default state for every listing between attestation-commit and first purchase — the most common production state — and it's the exact branch where `getListingBuyerId` returns `null`.
- **Recommendation**: Add a sixth test: `db` returns `[fixedCommitRow()]` on call 0, `[]` on call 1. Caller id is a stranger. Assert `res === null`.

### N4 — `validateAttestationStoragePath` sanitizes after comparison
- **File**: `apps/api/src/lib/supabase-storage-paths.ts:90-113`
- **What is wrong**: The function compares `pathListingId !== listingId` at line 108 before calling `sanitizeListingIdSegment` on either side at line 111. The `TRAVERSAL_RE` check at line 97 catches `..` already, so this is not exploitable as-is — defense in depth only.
- **Recommendation**: Call `sanitizeListingIdSegment(listingId)` once at the top, before the comparison. Fail closed on malformed `listingId` even if callers forgot to pre-sanitize.

---

## Cleared

### Verified clean
- **`attestation-hash.ts` untouched**: `git diff --stat apps/api/src/lib/attestation-hash.ts` is empty on the working tree. Canonical hash utility is not modified. ✓
- **`requireAuth` on all 3 endpoints**: `routes/attestation.ts:50` (presign), `:99` (commit), `:144` (GET). ✓
- **Filename sanitization**: `sanitizeAttestationFilename` is tight — regex `/^[A-Za-z0-9._-]+$/`, no leading dot, length 1..128, no unicode, must contain non-dot chars. Separate `TRAVERSAL_RE` catches `..` segments. Path builder never concatenates raw user input into the bucket name. ✓
- **Storage-path validation**: `validateAttestationStoragePath` accepts both `{listingId}/{filename}` and `attestation-evidence/{listingId}/{filename}` shapes, rejects anything with ≠2 segments post-strip, and re-validates both segments against the sanitizers. ✓
- **Supabase SDK usage**: `createSignedUploadUrl`, `list()`-as-head, `createSignedUrl` are reasonable given this is the first attestation-storage code in the repo. Lazy client init with clear error at first call if env vars missing, test hook `_setSupabaseClientForTest` exposed cleanly. ✓
- **pgsodium / Vault usage**: `pgsodium.crypto_aead_det_encrypt(plaintext, aad=listingId, key_id)` with key resolved via `(SELECT id FROM pgsodium.key WHERE name = 'attestation_imei_key' LIMIT 1)`. AAD is bound to `listingId` as the brief requires (line 159). Plaintext IMEI is never returned from any service function; GET surfaces only `imeiEncrypted`. ✓ (subject to C1 fix — the encryption call is correct, but the plaintext fed into it must match the plaintext fed into the hash)
- **409 mapping in route**: `AttestationConflictError` → `409 ATTESTATION_ALREADY_COMMITTED` at routes:129-131. ✓ (the *raising* logic has C2 race — the mapping itself is fine)
- **404-obfuscation funnel**: All seller / buyer / admin / unauthorized cases flow through one `getAttestationForViewer` function that returns `null` for both "no row" and "not authorized". Route maps null → 404 without discriminating. Access-control matrix tests cover all four buckets. ✓ (modulo the timing side-channel in S2)
- **Route-level test coverage**: 15 tests spanning 401 unauth (×3 endpoints), 400 on invalid body / disallowed filename, 403 non-seller (×2), 404 missing listing, 409 duplicate, 201 commit happy, 200 presign happy, 404 unauthorized-or-missing GET, 404 malformed listingId segment, 200 authorized GET with view URL. ✓
- **Canonical hash input re-use at verify time**: `verifyAttestationCommit` reconstructs `AttestationInput` with the same field names and re-calls `canonicalizeAttestation` — the hash-match round-trip is correct on the raw-IMEI path (tests prove this). ✓ (again, modulo C1 on the payload-storage side)

---

## Summary

Two Must-Fix items block this step.

**C1** silently corrupts the audit trail the moment a seller submits an IMEI with a space or dash. The structure is right, but the normalization is applied in one place and not the other — a finishing error, not a design error. One-line fix plus a test.

**C2** is a race condition that defeats append-only under concurrent load. The right fix depends on whether the schema has a UNIQUE constraint on `listing_id`; Bob should check, and if it doesn't, escalate to Arch for a migration.

Everything else is tight: sanitization is real, the access-control funnel is clean, `requireAuth` is on every route, canonical hash is untouched, the dispute-core `verifyAttestationCommit` hook returns the shape the brief specified, and test coverage is broad.

Bob — fix C1 and C2, add the two missing tests (formatted IMEI round-trip, unique-violation path), address S1 inline (five minutes, mirror the presign pattern), and log S2/S3 to BUILD-LOG. Nits N1-N4 fit in the same cycle if you have the time. Re-submit and I will turn it around fast.

— Richard
