/**
 * Supabase Storage path constants and helpers for the dispute evidence bucket.
 *
 * The bucket itself is provisioned manually by the Project Owner through
 * the Supabase dashboard — this file only encodes the naming conventions
 * that the API layer uses to build / validate paths.
 */

/** Supabase Storage bucket that holds dispute evidence files. Private. */
export const DISPUTE_EVIDENCE_BUCKET = "dispute-evidence" as const;

/** Signed upload URL lifetime, in seconds. */
export const DISPUTE_UPLOAD_URL_TTL_SECONDS = 600;

/** Signed view URL lifetime, in seconds (1 hour — reviewers need time). */
export const DISPUTE_VIEW_URL_TTL_SECONDS = 3600;

// ---------------------------------------------------------------------------
// MIME type allowlists
// ---------------------------------------------------------------------------

export const ALLOWED_IMAGE_TYPES = [
  "image/jpeg",
  "image/png",
  "image/webp",
  "image/heic",
] as const;

export const ALLOWED_VIDEO_TYPES = [
  "video/mp4",
  "video/quicktime",
  "video/webm",
] as const;

export const ALLOWED_EVIDENCE_TYPES = [
  ...ALLOWED_IMAGE_TYPES,
  ...ALLOWED_VIDEO_TYPES,
] as const;

export type AllowedEvidenceType = (typeof ALLOWED_EVIDENCE_TYPES)[number];

// ---------------------------------------------------------------------------
// Upload limits by evidence type and transaction value
// ---------------------------------------------------------------------------

export const EVIDENCE_LIMITS = {
  image: { maxSizeBytes: 10 * 1024 * 1024, maxCount: 5 },
  video_standard: {
    maxSizeBytes: 50 * 1024 * 1024,
    maxCount: 1,
    maxDurationSec: 30,
  },
  video_high_value: {
    maxSizeBytes: 200 * 1024 * 1024,
    maxCount: 2,
    maxDurationSec: 120,
  },
  high_value_threshold_cents: 50_000, // $500
} as const;

// ---------------------------------------------------------------------------
// Filename / path helpers — mirror attestation patterns
// ---------------------------------------------------------------------------

/**
 * Allowed filename character set: alphanumerics plus `.`, `_`, `-`.
 * Anything else is a rejection — no path separators, no unicode.
 */
const FILENAME_RE = /^[A-Za-z0-9._-]+$/;

/** Reject paths that attempt traversal even if the filename passes. */
const TRAVERSAL_RE = /(^|\/)\.\.(\/|$)/;

/**
 * Validate a filename coming from the client. Throws on any reject.
 *
 * Rules:
 *   - alphanumerics + `.` `_` `-` only
 *   - must contain at least one non-`.` character
 *   - no leading dot (hidden files)
 *   - length 1..128
 */
export function sanitizeDisputeFilename(raw: string): string {
  if (typeof raw !== "string") {
    throw new Error("dispute-evidence: filename must be a string");
  }
  const trimmed = raw.trim();
  if (trimmed.length === 0 || trimmed.length > 128) {
    throw new Error("dispute-evidence: filename length out of range");
  }
  if (trimmed.startsWith(".")) {
    throw new Error("dispute-evidence: filename cannot start with a dot");
  }
  if (!FILENAME_RE.test(trimmed)) {
    throw new Error("dispute-evidence: filename contains disallowed characters");
  }
  if (trimmed.replace(/\./g, "").length === 0) {
    throw new Error("dispute-evidence: filename must contain non-dot characters");
  }
  return trimmed;
}

/**
 * Validate a dispute UUID used as a path segment. Conservative charset to
 * defeat path traversal — DB layer rejects invalid UUIDs downstream.
 */
function sanitizeDisputeIdSegment(raw: string): string {
  if (typeof raw !== "string" || raw.length === 0 || raw.length > 64) {
    throw new Error("dispute-evidence: disputeId segment invalid");
  }
  if (!/^[A-Za-z0-9-]+$/.test(raw)) {
    throw new Error(
      "dispute-evidence: disputeId segment contains disallowed characters",
    );
  }
  return raw;
}

/**
 * Build the canonical storage path for a dispute evidence file.
 * Format: `{disputeId}/{filename}`. Bucket name is NOT included — Supabase
 * SDK takes bucket separately.
 */
export function buildDisputeEvidencePath(
  disputeId: string,
  filename: string,
): string {
  const did = sanitizeDisputeIdSegment(disputeId);
  const fname = sanitizeDisputeFilename(filename);
  return `${did}/${fname}`;
}

/**
 * Validate that a storage path submitted at commit time is well-formed and
 * belongs to the given dispute. Returns the normalized inner object path
 * (without bucket prefix). Accepts either `{disputeId}/{filename}` or the
 * fully-qualified `dispute-evidence/{disputeId}/{filename}` shape.
 */
export function validateDisputeStoragePath(
  disputeId: string,
  submitted: string,
): string {
  if (typeof submitted !== "string" || submitted.length === 0) {
    throw new Error("dispute-evidence: storage path required");
  }
  if (TRAVERSAL_RE.test(submitted)) {
    throw new Error("dispute-evidence: storage path traversal rejected");
  }
  const stripped = submitted.startsWith(`${DISPUTE_EVIDENCE_BUCKET}/`)
    ? submitted.slice(DISPUTE_EVIDENCE_BUCKET.length + 1)
    : submitted;
  const parts = stripped.split("/");
  if (parts.length !== 2) {
    throw new Error(
      "dispute-evidence: storage path must be `{disputeId}/{filename}`",
    );
  }
  const [pathDisputeId, filename] = parts;
  if (pathDisputeId !== disputeId) {
    throw new Error("dispute-evidence: storage path does not match disputeId");
  }
  sanitizeDisputeIdSegment(pathDisputeId);
  sanitizeDisputeFilename(filename);
  return stripped;
}

// ---------------------------------------------------------------------------
// Content-type classification helpers
// ---------------------------------------------------------------------------

export function isImageType(
  contentType: string,
): contentType is (typeof ALLOWED_IMAGE_TYPES)[number] {
  return (ALLOWED_IMAGE_TYPES as readonly string[]).includes(contentType);
}

export function isVideoType(
  contentType: string,
): contentType is (typeof ALLOWED_VIDEO_TYPES)[number] {
  return (ALLOWED_VIDEO_TYPES as readonly string[]).includes(contentType);
}

export function isAllowedEvidenceType(
  contentType: string,
): contentType is AllowedEvidenceType {
  return (ALLOWED_EVIDENCE_TYPES as readonly string[]).includes(contentType);
}
