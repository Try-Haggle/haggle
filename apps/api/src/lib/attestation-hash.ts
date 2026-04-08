import { createHash } from "node:crypto";

/**
 * Seller pre-ship attestation payload. This is the structured input that a
 * seller commits to when publishing a listing. The commit hash lives in
 * `seller_attestation_commits.commit_hash` and is later re-verified when
 * dispute-core panel members review evidence.
 *
 * IMPORTANT: adding, removing, or renaming fields is a BREAKING change that
 * invalidates every historical commit_hash. Bump a version constant and
 * handle both schemas side-by-side if the schema must evolve.
 */
export interface AttestationInput {
  listingId: string;
  sellerId: string;
  /** IMEI in plaintext — the hash binds the cleartext, not the ciphertext. */
  imei: string;
  batteryHealthPct: number;
  findMyOff: boolean;
  /** S3 object keys in the order the wizard uploaded them. Order matters. */
  photoKeys: string[];
  /** ISO-8601 UTC timestamp string. */
  committedAt: string;
}

/**
 * Schema version of the canonical form. Bump on any structural change.
 * Included in the canonical string so the hash function is self-identifying.
 */
export const ATTESTATION_CANONICAL_VERSION = "v1" as const;

/**
 * Produce a deterministic canonical string representation of an attestation.
 *
 * Guarantees:
 *   - Key order is fixed (not insertion order, not alphabetical-by-chance).
 *   - Whitespace is stripped (no pretty-printing).
 *   - Strings are trimmed, IMEI is normalized to digits only.
 *   - Photo key array order is preserved (semantically meaningful).
 *   - Booleans are serialized as `true`/`false`, numbers as integers when
 *     `batteryHealthPct` is an integer value.
 *
 * The returned string is stable byte-for-byte across platforms and Node
 * versions, as long as the input is identical.
 */
export function canonicalizeAttestation(input: AttestationInput): string {
  // Validate up-front. Throw, do not silently coerce — a tampered input must
  // not produce a hash that collides with a clean one.
  if (!input.listingId) throw new Error("attestation: listingId required");
  if (!input.sellerId) throw new Error("attestation: sellerId required");
  if (!input.imei) throw new Error("attestation: imei required");
  if (!Array.isArray(input.photoKeys)) {
    throw new Error("attestation: photoKeys must be an array");
  }
  if (!input.committedAt) throw new Error("attestation: committedAt required");

  const battery = Number(input.batteryHealthPct);
  if (!Number.isFinite(battery) || !Number.isInteger(battery)) {
    throw new Error("attestation: batteryHealthPct must be an integer");
  }
  if (battery < 0 || battery > 100) {
    throw new Error("attestation: batteryHealthPct out of range");
  }

  // Strip non-digit chars from IMEI (wizard may include spaces/dashes).
  const imeiNormalized = input.imei.replace(/\D/g, "");
  if (imeiNormalized.length === 0) {
    throw new Error("attestation: imei must contain digits");
  }

  // Build an ordered tuple of [key, value] pairs. JSON.stringify over an
  // array of pairs bypasses object-key-order ambiguity entirely.
  const ordered: Array<[string, unknown]> = [
    ["version", ATTESTATION_CANONICAL_VERSION],
    ["listingId", input.listingId.trim()],
    ["sellerId", input.sellerId.trim()],
    ["imei", imeiNormalized],
    ["batteryHealthPct", battery],
    ["findMyOff", Boolean(input.findMyOff)],
    ["photoKeys", input.photoKeys.map((k) => String(k).trim())],
    ["committedAt", input.committedAt.trim()],
  ];

  return JSON.stringify(ordered);
}

/**
 * sha256 hex digest of a canonical attestation string. Use in conjunction
 * with `canonicalizeAttestation`:
 *
 *   const canonical = canonicalizeAttestation(input);
 *   const hash = computeCommitHash(canonical);
 */
export function computeCommitHash(canonical: string): string {
  return createHash("sha256").update(canonical, "utf8").digest("hex");
}
