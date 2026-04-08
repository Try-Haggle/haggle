/**
 * Seller pre-ship attestation service.
 *
 * Responsibilities:
 *   - Commit a new attestation row (append-only, 409 on duplicate).
 *   - Read a committed attestation for an authorized viewer and return
 *     signed photo URLs.
 *   - Re-verify a submitted payload against the stored `commitHash` for
 *     dispute-core consumers.
 *
 * IMEI handling: at rest, the plaintext IMEI is encrypted with
 * pgsodium's deterministic AEAD using the Vault key named
 * `attestation_imei_key`. Neither the service nor the route ever logs
 * plaintext IMEIs — only `imei_encrypted` is returned from GET.
 */
import { sql } from "@haggle/db";
import type { Database } from "@haggle/db";
import { buildCanonicalAttestationRecord } from "../lib/attestation-canonical-record.js";
import {
  validateAttestationStoragePath,
  ATTESTATION_BUCKET,
} from "../lib/supabase-storage-paths.js";
import {
  attestationObjectExists,
  createAttestationViewUrl,
} from "./supabase-storage.service.js";

/** Name of the pgsodium/Vault key used for IMEI encryption. */
const IMEI_VAULT_KEY_NAME = "attestation_imei_key";

/** Postgres unique-violation SQLSTATE. */
const PG_UNIQUE_VIOLATION = "23505";

export class AttestationStorageError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "AttestationStorageError";
  }
}

export class AttestationValidationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "AttestationValidationError";
  }
}

/** Default review-period placeholder window (30 days). arp-core may override
 * this at order time with a trust-modulated window. */
const DEFAULT_REVIEW_WINDOW_MS = 30 * 24 * 60 * 60 * 1000;

export class AttestationConflictError extends Error {
  constructor(listingId: string) {
    super(`attestation: commit already exists for listing ${listingId}`);
    this.name = "AttestationConflictError";
  }
}

export class AttestationNotFoundError extends Error {
  constructor(listingId: string) {
    super(`attestation: no commit for listing ${listingId}`);
    this.name = "AttestationNotFoundError";
  }
}

export class AttestationForbiddenError extends Error {
  constructor() {
    super("attestation: caller not authorized");
    this.name = "AttestationForbiddenError";
  }
}

export interface CommitRequest {
  listingId: string;
  sellerId: string;
  imei: string;
  batteryHealthPct: number;
  findMyOff: boolean;
  /** Either `{listingId}/{filename}` or `attestation-evidence/{listingId}/{filename}`. */
  photoStoragePaths: string[];
}

export interface CommitResult {
  commitId: string;
  commitHash: string;
  committedAt: string;
}

/**
 * Insert a new attestation commit row. Caller is responsible for seller
 * authorization *before* calling — this service trusts `sellerId`.
 */
export async function createAttestationCommit(
  db: Database,
  req: CommitRequest,
): Promise<CommitResult> {
  // 1) Validate all storage paths and verify each exists in the bucket
  // (parallelized). Any invalid path → validation error; any missing
  // object → storage error. Both are distinct from duplicate commits.
  let normalizedPaths: string[];
  try {
    normalizedPaths = req.photoStoragePaths.map((p) =>
      validateAttestationStoragePath(req.listingId, p),
    );
  } catch (err) {
    throw new AttestationValidationError(
      `attestation: invalid storage path (${(err as Error).message})`,
    );
  }
  const existChecks = await Promise.all(
    normalizedPaths.map(async (path) => ({
      path,
      exists: await attestationObjectExists(path),
    })),
  );
  const missing = existChecks.find((c) => !c.exists);
  if (missing) {
    throw new AttestationStorageError(
      `attestation: photo not found in bucket: ${missing.path}`,
    );
  }

  // 2) Build canonical record + hash in a single pass via the helper.
  // This is the ONLY place the canonical shape is constructed — the
  // service never hand-reconstructs it. IMEI is normalized once here
  // and reused for hash input, JSONB storage, AND pgsodium plaintext.
  const fqPaths = normalizedPaths.map((p) => `${ATTESTATION_BUCKET}/${p}`);
  const committedAtIso = new Date().toISOString();
  const { record, commitHash } = buildCanonicalAttestationRecord({
    listingId: req.listingId,
    sellerId: req.sellerId,
    imei: req.imei,
    batteryHealthPct: req.batteryHealthPct,
    findMyOff: req.findMyOff,
    photoKeys: fqPaths,
    committedAt: committedAtIso,
  });

  // 3) Unconditional INSERT. Duplicate-commit is enforced by the
  // UNIQUE(listing_id) constraint (migration 005) — we catch 23505
  // and map to AttestationConflictError. This eliminates the TOCTOU
  // race the SELECT-then-INSERT pattern had.
  const expiresAt = new Date(Date.now() + DEFAULT_REVIEW_WINDOW_MS).toISOString();
  let inserted: unknown;
  try {
    inserted = await db.execute(sql`
      INSERT INTO seller_attestation_commits (
        listing_id,
        seller_id,
        imei_encrypted,
        battery_health_pct,
        find_my_off,
        photo_urls,
        commit_hash,
        canonical_payload,
        committed_at,
        expires_at
      ) VALUES (
        ${record.listingId},
        ${record.sellerId},
        encode(
          pgsodium.crypto_aead_det_encrypt(
            convert_to(${record.imei}, 'utf8'),
            convert_to(${record.listingId}, 'utf8'),
            (SELECT id FROM pgsodium.key WHERE name = ${IMEI_VAULT_KEY_NAME} LIMIT 1)
          ),
          'base64'
        ),
        ${record.batteryHealthPct},
        ${record.findMyOff},
        ${JSON.stringify(fqPaths)}::jsonb,
        ${commitHash},
        ${JSON.stringify(record)}::jsonb,
        ${committedAtIso},
        ${expiresAt}
      )
      RETURNING id, committed_at
    `);
  } catch (err) {
    // Postgres unique_violation on uq_seller_attestation_commits_listing_id.
    // Check both direct shape and any driver wrapper that exposes `.cause`.
    const code =
      (err as { code?: string }).code ??
      (err as { cause?: { code?: string } }).cause?.code;
    if (code === PG_UNIQUE_VIOLATION) {
      throw new AttestationConflictError(req.listingId);
    }
    throw err;
  }

  const rows = extractRows<Record<string, unknown>>(inserted);
  if (rows.length === 0) {
    throw new Error("attestation: insert returned no rows");
  }
  return {
    commitId: String(rows[0].id),
    commitHash,
    committedAt: committedAtIso,
  };
}

export interface StoredCommit {
  id: string;
  listingId: string;
  sellerId: string;
  imeiEncrypted: string;
  batteryHealthPct: number;
  findMyOff: boolean;
  photoUrls: string[];
  commitHash: string;
  canonicalPayload: Record<string, unknown>;
  committedAt: string;
  expiresAt: string;
}

/**
 * Load a stored commit row from the database. Does NOT decrypt the IMEI —
 * callers that need plaintext must explicitly call `decryptCommitImei`.
 */
export async function loadCommitByListing(
  db: Database,
  listingId: string,
): Promise<StoredCommit | null> {
  const res = await db.execute(sql`
    SELECT
      id,
      listing_id         AS "listingId",
      seller_id          AS "sellerId",
      imei_encrypted     AS "imeiEncrypted",
      battery_health_pct AS "batteryHealthPct",
      find_my_off        AS "findMyOff",
      photo_urls         AS "photoUrls",
      commit_hash        AS "commitHash",
      canonical_payload  AS "canonicalPayload",
      committed_at       AS "committedAt",
      expires_at         AS "expiresAt"
    FROM seller_attestation_commits
    WHERE listing_id = ${listingId}
    LIMIT 1
  `);
  const rows = extractRows(res);
  if (rows.length === 0) return null;
  const row = rows[0] as unknown as Record<string, unknown>;
  return {
    id: String(row.id),
    listingId: String(row.listingId),
    sellerId: String(row.sellerId),
    imeiEncrypted: String(row.imeiEncrypted),
    batteryHealthPct: Number(row.batteryHealthPct),
    findMyOff: Boolean(row.findMyOff),
    photoUrls: Array.isArray(row.photoUrls) ? (row.photoUrls as string[]) : [],
    commitHash: String(row.commitHash),
    canonicalPayload: (row.canonicalPayload as Record<string, unknown>) ?? {},
    committedAt:
      row.committedAt instanceof Date
        ? row.committedAt.toISOString()
        : String(row.committedAt),
    expiresAt:
      row.expiresAt instanceof Date
        ? row.expiresAt.toISOString()
        : String(row.expiresAt),
  };
}

/**
 * Resolve the seller uuid for a listing by walking
 * listings_published.draft_id → listing_drafts.user_id.
 */
export async function getListingSellerId(
  db: Database,
  listingId: string,
): Promise<string | null> {
  const res = await db.execute(sql`
    SELECT ld.user_id AS "sellerId"
    FROM listings_published lp
    JOIN listing_drafts ld ON ld.id = lp.draft_id
    WHERE lp.id = ${listingId}
    LIMIT 1
  `);
  const rows = extractRows(res);
  if (rows.length === 0) return null;
  const sellerId = (rows[0] as Record<string, unknown>).sellerId;
  return sellerId ? String(sellerId) : null;
}

/**
 * Resolve the buyer uuid for a listing by looking up the commerce order.
 * Returns null if no order exists yet.
 */
export async function getListingBuyerId(
  db: Database,
  listingId: string,
): Promise<string | null> {
  const res = await db.execute(sql`
    SELECT buyer_id AS "buyerId"
    FROM commerce_orders
    WHERE listing_id = ${listingId}
    ORDER BY created_at DESC
    LIMIT 1
  `);
  const rows = extractRows(res);
  if (rows.length === 0) return null;
  const buyerId = (rows[0] as Record<string, unknown>).buyerId;
  return buyerId ? String(buyerId) : null;
}

export type ViewerRole = "seller" | "buyer" | "admin";

export interface AttestationViewResult {
  commitId: string;
  listingId: string;
  sellerId: string;
  imeiEncrypted: string;
  batteryHealthPct: number;
  findMyOff: boolean;
  photos: Array<{ storagePath: string; viewUrl: string }>;
  commitHash: string;
  committedAt: string;
  expiresAt: string;
  viewerRole: ViewerRole;
}

/**
 * Read a commit for a given caller. Enforces the access control matrix:
 *   - seller of the listing  → full view
 *   - buyer of the listing    → full view
 *   - admin                    → full view
 *   - anyone else              → 404 (hide existence)
 *
 * Returns `null` when the caller is not authorized OR when no commit
 * exists. Callers must surface this as a 404.
 */
export async function getAttestationForViewer(
  db: Database,
  listingId: string,
  caller: { id: string; role?: string },
): Promise<AttestationViewResult | null> {
  const commit = await loadCommitByListing(db, listingId);
  if (!commit) return null;

  let viewerRole: ViewerRole | null = null;
  if (caller.role === "admin") {
    viewerRole = "admin";
  } else if (commit.sellerId === caller.id) {
    viewerRole = "seller";
  } else {
    const buyerId = await getListingBuyerId(db, listingId);
    if (buyerId && buyerId === caller.id) {
      viewerRole = "buyer";
    }
  }
  if (!viewerRole) return null; // 404 obfuscation

  const photos = await Promise.all(
    commit.photoUrls.map(async (fqPath) => {
      const innerPath = fqPath.startsWith(`${ATTESTATION_BUCKET}/`)
        ? fqPath.slice(ATTESTATION_BUCKET.length + 1)
        : fqPath;
      const viewUrl = await createAttestationViewUrl(innerPath);
      return { storagePath: fqPath, viewUrl };
    }),
  );

  return {
    commitId: commit.id,
    listingId: commit.listingId,
    sellerId: commit.sellerId,
    imeiEncrypted: commit.imeiEncrypted,
    batteryHealthPct: commit.batteryHealthPct,
    findMyOff: commit.findMyOff,
    photos,
    commitHash: commit.commitHash,
    committedAt: commit.committedAt,
    expiresAt: commit.expiresAt,
    viewerRole,
  };
}

export interface VerifyResult {
  match: boolean;
  storedHash: string;
  computedHash: string;
  divergence?: string[];
}

export interface VerifyPayload {
  sellerId: string;
  imei: string;
  batteryHealthPct: number;
  findMyOff: boolean;
  photoStoragePaths: string[];
  committedAt: string;
}

/**
 * Re-hash a submitted attestation payload and compare against the stored
 * commit hash. Used by dispute-core at evidence-review time to prove the
 * photos/metadata shown to the DS panel match what the seller committed
 * to before shipping.
 *
 * `divergence` lists canonical-payload field names whose values differ —
 * this is a convenience for reviewers and is computed opportunistically
 * from the stored `canonical_payload` JSON blob when present.
 */
export async function verifyAttestationCommit(
  db: Database,
  listingId: string,
  submitted: VerifyPayload,
): Promise<VerifyResult & { found: boolean }> {
  const commit = await loadCommitByListing(db, listingId);
  if (!commit) {
    return {
      found: false,
      match: false,
      storedHash: "",
      computedHash: "",
    };
  }

  const { record, commitHash: computedHash } = buildCanonicalAttestationRecord({
    listingId,
    sellerId: submitted.sellerId,
    imei: submitted.imei,
    batteryHealthPct: submitted.batteryHealthPct,
    findMyOff: submitted.findMyOff,
    photoKeys: submitted.photoStoragePaths,
    committedAt: submitted.committedAt,
  });
  const match = computedHash === commit.commitHash;

  let divergence: string[] | undefined;
  if (!match) {
    divergence = diffCanonical(
      commit.canonicalPayload,
      record as unknown as Record<string, unknown>,
    );
  }

  return {
    found: true,
    match,
    storedHash: commit.commitHash,
    computedHash,
    divergence,
  };
}

function diffCanonical(
  stored: Record<string, unknown>,
  submitted: Record<string, unknown>,
): string[] {
  const fields = new Set([...Object.keys(stored), ...Object.keys(submitted)]);
  const out: string[] = [];
  for (const f of fields) {
    if (JSON.stringify(stored[f]) !== JSON.stringify(submitted[f])) {
      out.push(f);
    }
  }
  return out;
}

/**
 * Drizzle's `db.execute()` returns different shapes depending on the
 * underlying driver (postgres.js vs pg). Normalize to an array of rows.
 */
function extractRows<T = unknown>(res: unknown): T[] {
  if (Array.isArray(res)) return res as T[];
  if (res && typeof res === "object" && Array.isArray((res as { rows?: unknown[] }).rows)) {
    return (res as { rows: T[] }).rows;
  }
  return [];
}
