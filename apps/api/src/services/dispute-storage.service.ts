/**
 * Thin wrapper around the Supabase Storage JS client for the dispute
 * evidence bucket.
 *
 * The underlying bucket (`dispute-evidence`) is provisioned by the
 * Project Owner in the Supabase dashboard with privacy = Private. This
 * service only issues signed upload URLs, existence checks, and signed
 * view URLs against that bucket.
 *
 * Credentials are read from `SUPABASE_URL` and `SUPABASE_SERVICE_ROLE_KEY`
 * at module import time. Missing credentials raise at first call — not at
 * import — so the rest of the API can still boot in local dev without
 * Supabase set up.
 */
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import {
  DISPUTE_EVIDENCE_BUCKET,
  DISPUTE_UPLOAD_URL_TTL_SECONDS,
  DISPUTE_VIEW_URL_TTL_SECONDS,
} from "../lib/dispute-storage-paths.js";

let _client: SupabaseClient | null = null;

function getClient(): SupabaseClient {
  if (_client) return _client;
  const url = process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) {
    throw new Error(
      "dispute-storage: SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY must be set",
    );
  }
  _client = createClient(url, key, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
  return _client;
}

/**
 * Test-only hook — allows tests to inject a mock Supabase client without
 * touching the real env vars. Reset to `null` in afterEach if used.
 */
export function _setDisputeStorageClientForTest(
  client: SupabaseClient | null,
): void {
  _client = client;
}

export interface PresignedUploadResult {
  uploadUrl: string;
  storagePath: string;
  token: string;
  expiresIn: number;
}

/**
 * Create a signed upload URL for a dispute evidence file. The returned
 * `storagePath` is the fully-qualified `bucket/path` form that the client
 * echoes back to the commit endpoint.
 */
export async function createDisputeUploadUrl(
  objectPath: string,
): Promise<PresignedUploadResult> {
  const client = getClient();
  const { data, error } = await client.storage
    .from(DISPUTE_EVIDENCE_BUCKET)
    .createSignedUploadUrl(objectPath);
  if (error || !data) {
    throw new Error(
      `dispute-storage: failed to create signed upload url: ${error?.message ?? "unknown"}`,
    );
  }
  return {
    uploadUrl: data.signedUrl,
    storagePath: `${DISPUTE_EVIDENCE_BUCKET}/${objectPath}`,
    token: data.token,
    expiresIn: DISPUTE_UPLOAD_URL_TTL_SECONDS,
  };
}

/**
 * Head-check an object: returns `true` if the object exists in the bucket,
 * `false` otherwise. Supabase JS does not expose a native `head()` — we use
 * a prefix `list()` on the parent folder filtered by the exact basename.
 */
export async function disputeEvidenceExists(
  objectPath: string,
): Promise<boolean> {
  const client = getClient();
  const slash = objectPath.lastIndexOf("/");
  if (slash < 0) return false;
  const folder = objectPath.slice(0, slash);
  const filename = objectPath.slice(slash + 1);
  const { data, error } = await client.storage
    .from(DISPUTE_EVIDENCE_BUCKET)
    .list(folder, { search: filename, limit: 1 });
  if (error) {
    throw new Error(`dispute-storage: list failed: ${error.message}`);
  }
  if (!Array.isArray(data)) return false;
  return data.some((entry) => entry?.name === filename);
}

/**
 * Create a signed download URL for dispute evidence. Used by the
 * GET /disputes/:id/evidence/:evidenceId/view endpoint so dispute parties
 * and reviewers can view committed evidence.
 */
export async function createDisputeViewUrl(
  objectPath: string,
): Promise<string> {
  const client = getClient();
  const { data, error } = await client.storage
    .from(DISPUTE_EVIDENCE_BUCKET)
    .createSignedUrl(objectPath, DISPUTE_VIEW_URL_TTL_SECONDS);
  if (error || !data) {
    throw new Error(
      `dispute-storage: failed to create signed view url: ${error?.message ?? "unknown"}`,
    );
  }
  return data.signedUrl;
}
