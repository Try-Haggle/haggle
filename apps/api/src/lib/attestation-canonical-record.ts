/**
 * Canonical attestation record builder.
 *
 * `attestation-hash.ts` is locked — it returns only the canonical string.
 * But the service needs the same *structured* record persisted as
 * `canonical_payload` JSONB so that dispute-core can re-hash it at review
 * time and prove it matches `commit_hash`.
 *
 * This helper wraps `canonicalizeAttestation()`: it normalizes the IMEI
 * once (the same normalization the hash util does), builds the JSONB
 * record, calls the locked canonicalizer, hashes the result, and returns
 * everything in a single call. The service must use this exclusively —
 * never hand-reconstruct the canonical record.
 *
 * If `attestation-hash.ts` ever changes its normalization rules, update
 * this helper in lock-step, bump `CANONICAL_VERSION`, and add a migration
 * to re-hash historical rows.
 */
import {
  canonicalizeAttestation,
  computeCommitHash,
  ATTESTATION_CANONICAL_VERSION,
  type AttestationInput,
} from "./attestation-hash.js";

/** Mirror of the locked `ATTESTATION_CANONICAL_VERSION` — kept in sync. */
export const CANONICAL_VERSION = ATTESTATION_CANONICAL_VERSION;

export interface CanonicalAttestationRecord {
  version: typeof CANONICAL_VERSION;
  listingId: string;
  sellerId: string;
  /** Digits-only normalized IMEI. Matches `attestation-hash.ts` rule. */
  imei: string;
  batteryHealthPct: number;
  findMyOff: boolean;
  photoKeys: string[];
  committedAt: string;
}

export interface BuiltCanonical {
  /** Plain-JSON record — write this straight to `canonical_payload`. */
  record: CanonicalAttestationRecord;
  /** Canonical string returned by the locked hash util. */
  canonicalString: string;
  /** sha256 hex of the canonical string. */
  commitHash: string;
}

/**
 * Normalize IMEI identically to `attestation-hash.ts:canonicalizeAttestation`
 * (digits-only). Exported so callers (e.g. verify) can use the same rule
 * without duplicating regex logic.
 */
export function normalizeImei(raw: string): string {
  return String(raw).replace(/\D/g, "");
}

/**
 * Build the canonical record + string + hash in one pass.
 *
 * The caller provides the raw wizard inputs; this helper applies all the
 * normalization rules once and guarantees the record, string, and hash
 * are byte-for-byte in agreement.
 */
export function buildCanonicalAttestationRecord(
  input: AttestationInput,
): BuiltCanonical {
  const normalizedImei = normalizeImei(input.imei);

  // Build the AttestationInput that will be canonicalized. Pass the
  // normalized IMEI so the hash util does not need to re-strip it (it
  // will strip again — the operation is idempotent).
  const hashInput: AttestationInput = {
    listingId: input.listingId.trim(),
    sellerId: input.sellerId.trim(),
    imei: normalizedImei,
    batteryHealthPct: input.batteryHealthPct,
    findMyOff: Boolean(input.findMyOff),
    photoKeys: input.photoKeys.map((k) => String(k).trim()),
    committedAt: input.committedAt.trim(),
  };

  const canonicalString = canonicalizeAttestation(hashInput);
  const commitHash = computeCommitHash(canonicalString);

  const record: CanonicalAttestationRecord = {
    version: CANONICAL_VERSION,
    listingId: hashInput.listingId,
    sellerId: hashInput.sellerId,
    imei: hashInput.imei,
    batteryHealthPct: hashInput.batteryHealthPct,
    findMyOff: hashInput.findMyOff,
    photoKeys: hashInput.photoKeys,
    committedAt: hashInput.committedAt,
  };

  return { record, canonicalString, commitHash };
}
