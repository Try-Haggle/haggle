/**
 * Supabase Storage path constants and helpers for the seller attestation
 * evidence bucket.
 *
 * The bucket itself is provisioned manually by the Project Owner through
 * the Supabase dashboard — this file only encodes the naming conventions
 * that the API layer uses to build / validate paths.
 */

/** Supabase Storage bucket that holds seller attestation photos. Private. */
export const ATTESTATION_BUCKET = "attestation-evidence" as const;

/** Signed upload URL lifetime, in seconds. Matches Supabase default. */
export const ATTESTATION_UPLOAD_URL_TTL_SECONDS = 600;

/** Signed view URL lifetime, in seconds (10 minutes per brief). */
export const ATTESTATION_VIEW_URL_TTL_SECONDS = 600;

/**
 * Allowed filename character set: alphanumerics plus `.`, `_`, `-`.
 * Anything else is a rejection — no path separators, no unicode.
 */
const FILENAME_RE = /^[A-Za-z0-9._-]+$/;

/** Reject paths that attempt traversal even if the filename passes. */
const TRAVERSAL_RE = /(^|\/)\.\.(\/|$)/;

/**
 * Validate a filename coming from the wizard. Throws on any reject.
 *
 * Rules:
 *   - alphanumerics + `.` `_` `-` only
 *   - must contain at least one non-`.` character
 *   - no leading dot (hidden files)
 *   - length 1..128
 */
export function sanitizeAttestationFilename(raw: string): string {
  if (typeof raw !== "string") {
    throw new Error("attestation: filename must be a string");
  }
  const trimmed = raw.trim();
  if (trimmed.length === 0 || trimmed.length > 128) {
    throw new Error("attestation: filename length out of range");
  }
  if (trimmed.startsWith(".")) {
    throw new Error("attestation: filename cannot start with a dot");
  }
  if (!FILENAME_RE.test(trimmed)) {
    throw new Error("attestation: filename contains disallowed characters");
  }
  if (trimmed.replace(/\./g, "").length === 0) {
    throw new Error("attestation: filename must contain non-dot characters");
  }
  return trimmed;
}

/**
 * Validate a listing UUID used as a path segment. We don't do full UUID
 * validation here (the DB layer will reject bad ids later) — we only need
 * to defeat path traversal and enforce a conservative charset.
 */
export function sanitizeListingIdSegment(raw: string): string {
  if (typeof raw !== "string" || raw.length === 0 || raw.length > 64) {
    throw new Error("attestation: listingId segment invalid");
  }
  if (!/^[A-Za-z0-9-]+$/.test(raw)) {
    throw new Error("attestation: listingId segment contains disallowed characters");
  }
  return raw;
}

/**
 * Build the canonical storage path for a listing's evidence photo.
 * Format: `{listingId}/{filename}`. Bucket name is NOT included — Supabase
 * SDK takes bucket separately.
 */
export function buildAttestationObjectPath(listingId: string, filename: string): string {
  const lid = sanitizeListingIdSegment(listingId);
  const fname = sanitizeAttestationFilename(filename);
  return `${lid}/${fname}`;
}

/**
 * Validate that a storage path submitted at commit time is well-formed and
 * belongs to the given listing. Returns the normalized inner object path
 * (without bucket prefix). Accepts either `{listingId}/{filename}` or the
 * fully-qualified `attestation-evidence/{listingId}/{filename}` shape that
 * the presigned-upload response echoes back.
 */
export function validateAttestationStoragePath(
  listingId: string,
  submitted: string,
): string {
  if (typeof submitted !== "string" || submitted.length === 0) {
    throw new Error("attestation: storage path required");
  }
  if (TRAVERSAL_RE.test(submitted)) {
    throw new Error("attestation: storage path traversal rejected");
  }
  const stripped = submitted.startsWith(`${ATTESTATION_BUCKET}/`)
    ? submitted.slice(ATTESTATION_BUCKET.length + 1)
    : submitted;
  const parts = stripped.split("/");
  if (parts.length !== 2) {
    throw new Error("attestation: storage path must be `{listingId}/{filename}`");
  }
  const [pathListingId, filename] = parts;
  if (pathListingId !== listingId) {
    throw new Error("attestation: storage path does not match listingId");
  }
  sanitizeListingIdSegment(pathListingId);
  sanitizeAttestationFilename(filename);
  return stripped;
}
