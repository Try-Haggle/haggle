/**
 * F2 — per-evidence content hash + anchor status (UI "Anchored" badge foundation).
 *
 * On upload/confirm we stamp `content_hash` + `anchor_status=HASHED`.
 * Resolve-time DisputeRegistry anchoring stays separate (apps/api chain path).
 * Real on-chain TX / PENDING_CHAIN→ANCHORED persistence is follow-up;
 * helpers below validate transitions without submitting chain TX.
 *
 * `dispute_evidence` is append-only: status is fixed at insert for this ticket.
 */

import { createHash } from "node:crypto";

export const EVIDENCE_CONTENT_HASH_SCHEMA = "haggle.dispute-evidence.content.v1" as const;

export const EVIDENCE_ANCHOR_STATUSES = ["HASHED", "PENDING_CHAIN", "ANCHORED"] as const;
export type EvidenceAnchorStatus = (typeof EVIDENCE_ANCHOR_STATUSES)[number];

export interface EvidenceHashAnchorMetadata {
  content_hash: string;
  anchor_status: EvidenceAnchorStatus;
}

const SHA256_HEX = /^[0-9a-f]{64}$/;

const ADVANCE: Record<EvidenceAnchorStatus, readonly EvidenceAnchorStatus[]> = {
  HASHED: ["PENDING_CHAIN"],
  PENDING_CHAIN: ["ANCHORED"],
  ANCHORED: [],
};

function assertSha256Hex(value: string, label: string): string {
  if (!SHA256_HEX.test(value)) {
    throw new Error(`${label} must be a 64-char lowercase sha256 hex digest`);
  }
  return value;
}

/** SHA-256 of raw evidence bytes (matches malware-scan / camera binding digests). */
export function hashEvidenceBytes(bytes: Uint8Array | ArrayBuffer): string {
  const view = bytes instanceof ArrayBuffer ? new Uint8Array(bytes) : bytes;
  return createHash("sha256").update(view).digest("hex");
}

/**
 * Deterministic hash for non-byte evidence (text / tracking / payment_proof / other).
 * Canonical form is versioned so schema evolution does not silently collide.
 */
export function hashEvidenceTextPayload(input: {
  type: string;
  text?: string | null;
  uri?: string | null;
}): string {
  if (!input.type) throw new Error("evidence type required for content hash");
  const canonical = [
    EVIDENCE_CONTENT_HASH_SCHEMA,
    input.type,
    input.text ?? "",
    input.uri ?? "",
  ].join("\n");
  return createHash("sha256").update(canonical, "utf8").digest("hex");
}

/** Stamp HASHED metadata from an already-computed content hash (upload/confirm). */
export function initialEvidenceHashAnchor(contentHash: string): EvidenceHashAnchorMetadata {
  return {
    content_hash: assertSha256Hex(contentHash, "content_hash"),
    anchor_status: "HASHED",
  };
}

/**
 * Build HASHED metadata for confirm/add.
 * Prefer raw bytes when present (file commit); otherwise text payload.
 */
export function buildEvidenceHashAnchor(input: {
  type: string;
  text?: string | null;
  uri?: string | null;
  bytes?: Uint8Array | ArrayBuffer | null;
  /** Prefer scan / capture digest when already verified equal to bytes. */
  knownContentHash?: string | null;
}): EvidenceHashAnchorMetadata {
  if (input.knownContentHash) {
    return initialEvidenceHashAnchor(input.knownContentHash);
  }
  if (input.bytes != null) {
    return initialEvidenceHashAnchor(hashEvidenceBytes(input.bytes));
  }
  return initialEvidenceHashAnchor(
    hashEvidenceTextPayload({ type: input.type, text: input.text, uri: input.uri }),
  );
}

/** Tamper check: recompute digest of bytes and compare to stored content_hash. */
export function verifyEvidenceContentHash(
  storedContentHash: string,
  bytes: Uint8Array | ArrayBuffer,
): { ok: true } | { ok: false; expected: string; actual: string } {
  const expected = assertSha256Hex(storedContentHash, "content_hash");
  const actual = hashEvidenceBytes(bytes);
  if (expected === actual) return { ok: true };
  return { ok: false, expected, actual };
}

export function isEvidenceAnchorStatus(value: unknown): value is EvidenceAnchorStatus {
  return (
    typeof value === "string" && (EVIDENCE_ANCHOR_STATUSES as readonly string[]).includes(value)
  );
}

/** In-memory transition rules for follow-up chain submit (no persistence/TX here). */
export function canAdvanceEvidenceAnchorStatus(
  from: EvidenceAnchorStatus,
  to: EvidenceAnchorStatus,
): boolean {
  return ADVANCE[from].includes(to);
}

export function advanceEvidenceAnchorStatus(
  from: EvidenceAnchorStatus,
  to: EvidenceAnchorStatus,
): EvidenceAnchorStatus {
  if (!canAdvanceEvidenceAnchorStatus(from, to)) {
    throw new Error(`invalid evidence anchor_status transition: ${from} -> ${to}`);
  }
  return to;
}
