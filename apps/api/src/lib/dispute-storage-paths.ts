/**
 * Supabase Storage path constants and helpers for the dispute evidence bucket.
 *
 * This is the Controlled Evidence upload path surface from
 * `docs/wip/dispute-start-api-design.md`: upload-url issues a Haggle-owned
 * object path + pending intent, and commit only accepts that same path.
 *
 * The bucket itself is provisioned manually by the Project Owner through
 * the Supabase dashboard — this file only encodes the naming conventions
 * that the API layer uses to build / validate / qualify paths.
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

export const ALLOWED_IMAGE_TYPES = ["image/jpeg", "image/png", "image/webp", "image/heic"] as const;

export const ALLOWED_VIDEO_TYPES = ["video/mp4", "video/quicktime", "video/webm"] as const;

export const ALLOWED_EVIDENCE_TYPES = [...ALLOWED_IMAGE_TYPES, ...ALLOWED_VIDEO_TYPES] as const;

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
    throw new Error("dispute-evidence: disputeId segment contains disallowed characters");
  }
  return raw;
}

/**
 * Build the canonical storage path for a dispute evidence file.
 * Format: `{disputeId}/{filename}`. Bucket name is NOT included — Supabase
 * SDK takes bucket separately.
 */
export function buildDisputeEvidencePath(disputeId: string, filename: string): string {
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
export function validateDisputeStoragePath(disputeId: string, submitted: string): string {
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
    throw new Error("dispute-evidence: storage path must be `{disputeId}/{filename}`");
  }
  const [pathDisputeId, filename] = parts;
  if (pathDisputeId !== disputeId) {
    throw new Error("dispute-evidence: storage path does not match disputeId");
  }
  sanitizeDisputeIdSegment(pathDisputeId);
  sanitizeDisputeFilename(filename);
  return stripped;
}

/**
 * Qualify an inner object path (`{disputeId}/{filename}`) with the private
 * bucket prefix. Upload intents and commit lookups store this form so the
 * client can echo `storage_path` without inventing a new location.
 */
export function qualifyDisputeEvidencePath(objectPath: string): string {
  if (typeof objectPath !== "string" || objectPath.length === 0) {
    throw new Error("dispute-evidence: object path required");
  }
  if (TRAVERSAL_RE.test(objectPath)) {
    throw new Error("dispute-evidence: storage path traversal rejected");
  }
  if (objectPath.startsWith(`${DISPUTE_EVIDENCE_BUCKET}/`)) {
    return objectPath;
  }
  const parts = objectPath.split("/");
  if (parts.length !== 2) {
    throw new Error("dispute-evidence: object path must be `{disputeId}/{filename}`");
  }
  sanitizeDisputeIdSegment(parts[0]!);
  sanitizeDisputeFilename(parts[1]!);
  return `${DISPUTE_EVIDENCE_BUCKET}/${objectPath}`;
}

export function stripDisputeEvidenceBucket(storagePath: string): string {
  const stripped = storagePath.startsWith(`${DISPUTE_EVIDENCE_BUCKET}/`)
    ? storagePath.slice(DISPUTE_EVIDENCE_BUCKET.length + 1)
    : storagePath;
  if (TRAVERSAL_RE.test(stripped) || stripped.split("/").length !== 2) {
    throw new Error("dispute-evidence: stored object path is invalid");
  }
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

export function isAllowedEvidenceType(contentType: string): contentType is AllowedEvidenceType {
  return (ALLOWED_EVIDENCE_TYPES as readonly string[]).includes(contentType);
}

export function evidenceTypeFromContentType(contentType: string): "image" | "video" {
  if (isImageType(contentType)) return "image";
  if (isVideoType(contentType)) return "video";
  throw new Error("unsupported evidence content type");
}

export type EvidenceRemainingLimits = {
  remaining_images: number;
  remaining_videos: number;
  max_video_size_bytes: number;
  max_video_duration_sec: number;
};

/**
 * Remaining image/video slots and video size/duration caps for Controlled Evidence.
 * High-value orders (>= $500) get the larger video tier.
 */
export function computeEvidenceRemainingLimits(
  imageCount: number,
  videoCount: number,
  orderAmountCents: number,
): EvidenceRemainingLimits {
  const isHighValue = orderAmountCents >= EVIDENCE_LIMITS.high_value_threshold_cents;
  const videoLimits = isHighValue
    ? EVIDENCE_LIMITS.video_high_value
    : EVIDENCE_LIMITS.video_standard;

  return {
    remaining_images: Math.max(0, EVIDENCE_LIMITS.image.maxCount - imageCount),
    remaining_videos: Math.max(0, videoLimits.maxCount - videoCount),
    max_video_size_bytes: videoLimits.maxSizeBytes,
    max_video_duration_sec: videoLimits.maxDurationSec,
  };
}

export type ControlledEvidenceUploadGateFailure = {
  ok: false;
  error:
    | "UNSUPPORTED_CONTENT_TYPE"
    | "IMAGE_LIMIT_REACHED"
    | "VIDEO_LIMIT_REACHED"
    | "FILE_TOO_LARGE";
  message: string;
};

export type ControlledEvidenceUploadGateSuccess = {
  ok: true;
  evidenceType: "image" | "video";
  limits: EvidenceRemainingLimits;
};

/**
 * Mime / size / category gates for Controlled Evidence upload-url.
 * Authz (dispute parties) and no-PAN stay at the HTTP layer — this helper only
 * classifies allowlisted media and enforces count + byte caps.
 */
export function evaluateControlledEvidenceUploadGates(input: {
  contentType: string;
  fileSizeBytes: number;
  imageCount: number;
  videoCount: number;
  orderAmountCents: number;
}): ControlledEvidenceUploadGateSuccess | ControlledEvidenceUploadGateFailure {
  const { contentType, fileSizeBytes, imageCount, videoCount, orderAmountCents } = input;

  if (!isAllowedEvidenceType(contentType)) {
    return {
      ok: false,
      error: "UNSUPPORTED_CONTENT_TYPE",
      message: `Allowed: ${ALLOWED_EVIDENCE_TYPES.join(", ")}`,
    };
  }

  const evidenceType = evidenceTypeFromContentType(contentType);
  const limits = computeEvidenceRemainingLimits(imageCount, videoCount, orderAmountCents);

  if (evidenceType === "image") {
    if (limits.remaining_images <= 0) {
      return {
        ok: false,
        error: "IMAGE_LIMIT_REACHED",
        message: `Maximum ${EVIDENCE_LIMITS.image.maxCount} images allowed`,
      };
    }
    if (fileSizeBytes > EVIDENCE_LIMITS.image.maxSizeBytes) {
      return {
        ok: false,
        error: "FILE_TOO_LARGE",
        message: `Image max size: ${EVIDENCE_LIMITS.image.maxSizeBytes} bytes`,
      };
    }
  }

  if (evidenceType === "video") {
    if (limits.remaining_videos <= 0) {
      const isHighValue = orderAmountCents >= EVIDENCE_LIMITS.high_value_threshold_cents;
      const maxCount = isHighValue
        ? EVIDENCE_LIMITS.video_high_value.maxCount
        : EVIDENCE_LIMITS.video_standard.maxCount;
      return {
        ok: false,
        error: "VIDEO_LIMIT_REACHED",
        message: `Maximum ${maxCount} video(s) allowed for this transaction`,
      };
    }
    if (fileSizeBytes > limits.max_video_size_bytes) {
      return {
        ok: false,
        error: "FILE_TOO_LARGE",
        message: `Video max size: ${limits.max_video_size_bytes} bytes`,
      };
    }
  }

  return { ok: true, evidenceType, limits };
}
