import { createHash, randomUUID } from "node:crypto";
import { chmod, lstat, mkdir, readFile, rename, rm, writeFile } from "node:fs/promises";
import { basename, dirname, join, resolve, sep } from "node:path";
import { sql, type Database } from "@haggle/db";
import {
  resolveShipmentInvoiceDocumentRoot,
  type ShipmentInvoiceContentType,
  validateShipmentApvInvoiceDocumentBytes,
} from "./shipment-apv-invoice-document.service.js";

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

interface InternalRestorationCandidate {
  candidateId: string; documentId: string; integrityStatus: "MISSING" | "QUARANTINED";
  storageKey: string; expectedSha256: string; expectedByteSize: number; contentType: ShipmentInvoiceContentType;
}

export interface ShipmentApvInvoiceRestorationCandidate {
  candidateId: string;
  integrityStatus: "MISSING" | "QUARANTINED";
}

export interface ShipmentApvInvoiceRestorationRequest {
  id: string; client_request_id: string; candidate_fingerprint: string;
  source_integrity_status: "MISSING" | "QUARANTINED";
  replacement_sha256: string; replacement_byte_size: number; requester_id: string; reason: string;
  status: "PENDING" | "APPLYING" | "RESTORED" | "PRESERVED" | "REJECTED" | "EXPIRED";
  version: number; expires_at: string; approver_id?: string; decision_request_id?: string;
  decision?: "RESTORE" | "PRESERVE" | "REJECT"; decision_reason?: string; apply_error?: string;
  staging_status: "STAGED" | "MOVING" | "MOVED" | "CONSUMED" | "MISSING" | "CONFLICT_QUARANTINED";
  staging_disposed_at?: string; decided_at?: string; created_at: string;
}

function restorationFingerprint(input: {
  documentId: string; integrityStatus: string; expectedSha256: string; expectedByteSize: number; contentType: string;
}) {
  return createHash("sha256").update([
    input.documentId, input.integrityStatus, input.expectedSha256, input.expectedByteSize, input.contentType,
  ].join(":"), "utf8").digest("hex");
}

function internalCandidate(row: Record<string, unknown>): InternalRestorationCandidate {
  const base = { documentId: String(row.id), integrityStatus: String(row.integrity_status) as "MISSING" | "QUARANTINED",
    storageKey: String(row.storage_key), expectedSha256: String(row.sha256), expectedByteSize: Number(row.byte_size),
    contentType: String(row.content_type) as ShipmentInvoiceContentType };
  return { ...base, candidateId: restorationFingerprint(base) };
}

function publicCandidate(value: InternalRestorationCandidate): ShipmentApvInvoiceRestorationCandidate {
  return { candidateId: value.candidateId, integrityStatus: value.integrityStatus };
}

function mapRequest(row: Record<string, unknown>): ShipmentApvInvoiceRestorationRequest {
  return { id: String(row.id), client_request_id: String(row.client_request_id),
    candidate_fingerprint: String(row.candidate_fingerprint),
    source_integrity_status: String(row.source_integrity_status) as "MISSING" | "QUARANTINED",
    replacement_sha256: String(row.replacement_sha256), replacement_byte_size: Number(row.replacement_byte_size),
    requester_id: String(row.requester_id), reason: String(row.reason),
    status: String(row.status) as ShipmentApvInvoiceRestorationRequest["status"], version: Number(row.version),
    expires_at: new Date(String(row.expires_at)).toISOString(),
    approver_id: row.approver_id ? String(row.approver_id) : undefined,
    decision_request_id: row.decision_request_id ? String(row.decision_request_id) : undefined,
    decision: row.decision ? String(row.decision) as ShipmentApvInvoiceRestorationRequest["decision"] : undefined,
    decision_reason: row.decision_reason ? String(row.decision_reason) : undefined,
    apply_error: row.apply_error ? String(row.apply_error) : undefined,
    staging_status: String(row.staging_status ?? "STAGED") as ShipmentApvInvoiceRestorationRequest["staging_status"],
    staging_disposed_at: row.staging_disposed_at ? new Date(String(row.staging_disposed_at)).toISOString() : undefined,
    decided_at: row.decided_at ? new Date(String(row.decided_at)).toISOString() : undefined,
    created_at: new Date(String(row.created_at)).toISOString() };
}

function isUniqueViolation(error: unknown): boolean {
  if (!error || typeof error !== "object") return false;
  const candidate = error as { code?: unknown; cause?: unknown };
  return candidate.code === "23505" || isUniqueViolation(candidate.cause);
}

async function appendEvent(tx: Pick<Database, "execute">, input: {
  requestId: string; eventType: "REQUESTED" | "APPLYING" | "RESTORED" | "PRESERVED" | "REJECTED" | "EXPIRED" | "STAGING_PRESERVED";
  actorId: string | null; version: number; metadata?: Record<string, unknown>; now: Date;
}) {
  await tx.execute(sql`INSERT INTO shipment_apv_invoice_restoration_events
    (id, request_id, event_type, actor_id, request_version, metadata, created_at)
    VALUES (${randomUUID()}::uuid, ${input.requestId}::uuid, ${input.eventType}, ${input.actorId}::uuid,
      ${input.version}, ${JSON.stringify(input.metadata ?? {})}::jsonb, ${input.now.toISOString()}::timestamptz)`);
}

async function listInternalCandidates(db: Pick<Database, "execute">) {
  const rows = await db.execute(sql`SELECT id, integrity_status, storage_key, sha256, byte_size, content_type
    FROM shipment_apv_invoice_documents WHERE integrity_status IN ('MISSING', 'QUARANTINED')
    ORDER BY integrity_updated_at ASC NULLS FIRST, created_at ASC LIMIT 1000`) as unknown as Array<Record<string, unknown>>;
  return rows.map(internalCandidate);
}

export async function listShipmentApvInvoiceRestorationCandidates(db: Database) {
  const candidates = await listInternalCandidates(db);
  return { candidates: candidates.map(publicCandidate), truncated: candidates.length >= 1000 };
}

export async function requestShipmentApvInvoiceRestoration(db: Database, input: {
  clientRequestId: string; candidateId: string; requesterId: string; reason: string;
  contentType: ShipmentInvoiceContentType; bytes: Buffer; storageRoot?: string; now?: Date;
}) {
  if (!UUID_PATTERN.test(input.clientRequestId) || !UUID_PATTERN.test(input.requesterId)
    || !/^[0-9a-f]{64}$/.test(input.candidateId)
    || input.reason.trim().length < 12 || input.reason.length > 500
    || !validateShipmentApvInvoiceDocumentBytes(input.bytes, input.contentType)) return { outcome: "invalid_request" } as const;
  const sha256 = createHash("sha256").update(input.bytes).digest("hex");
  const now = input.now ?? new Date();
  const root = input.storageRoot ?? resolveShipmentInvoiceDocumentRoot();
  let stagedPath: string | null = null;
  try {
    return await db.transaction(async (tx) => {
      await tx.execute(sql`SELECT pg_advisory_xact_lock(hashtextextended(${`apv-invoice-restore:${input.clientRequestId}`}, 0))`);
      const existingRows = await tx.execute(sql`SELECT * FROM shipment_apv_invoice_restoration_requests
        WHERE client_request_id = ${input.clientRequestId}::uuid FOR UPDATE`) as unknown as Array<Record<string, unknown>>;
      if (existingRows[0]) {
        const existing = mapRequest(existingRows[0]);
        if (existing.candidate_fingerprint !== input.candidateId || existing.requester_id !== input.requesterId
          || existing.reason !== input.reason.trim() || existing.replacement_sha256 !== sha256) {
          return { outcome: "request_conflict" } as const;
        }
        const existingPath = join(root, String(existingRows[0].staging_key));
        try {
          const bytes = await readFile(existingPath);
          if (!bytes.equals(input.bytes)) return { outcome: "staging_conflict" } as const;
        } catch (error) {
          if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
          await mkdir(dirname(existingPath), { recursive: true, mode: 0o700 });
          await chmod(dirname(existingPath), 0o700);
          await writeFile(existingPath, input.bytes, { flag: "wx", mode: 0o600 });
        }
        return { outcome: "duplicate", request: existing } as const;
      }
      const candidates = await listInternalCandidates(tx);
      const target = candidates.find((item) => item.candidateId === input.candidateId);
      if (!target) return { outcome: "candidate_not_found" } as const;
      if (target.contentType !== input.contentType || target.expectedSha256 !== sha256
        || target.expectedByteSize !== input.bytes.length) return { outcome: "replacement_mismatch" } as const;
      const requestId = input.clientRequestId;
      const extension = input.contentType === "application/pdf" ? "pdf" : input.contentType === "text/csv" ? "csv" : "json";
      const stagingKey = `.restoration/${requestId}/${sha256}.${extension}`;
      stagedPath = join(root, stagingKey);
      await mkdir(dirname(stagedPath), { recursive: true, mode: 0o700 });
      await chmod(dirname(stagedPath), 0o700);
      try {
        await writeFile(stagedPath, input.bytes, { flag: "wx", mode: 0o600 });
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code !== "EEXIST") throw error;
        const existingBytes = await readFile(stagedPath);
        if (!existingBytes.equals(input.bytes)) throw new Error("APV_INVOICE_RESTORATION_STAGING_CONFLICT");
      }
      const rows = await tx.execute(sql`INSERT INTO shipment_apv_invoice_restoration_requests
        (id, client_request_id, candidate_fingerprint, document_id, source_integrity_status,
         expected_sha256, expected_byte_size, content_type, staging_key, replacement_sha256,
         replacement_byte_size, requester_id, reason, status, version, expires_at, created_at, updated_at)
        VALUES (${requestId}::uuid, ${input.clientRequestId}::uuid, ${target.candidateId}, ${target.documentId}::uuid,
          ${target.integrityStatus}, ${target.expectedSha256}, ${target.expectedByteSize}, ${target.contentType},
          ${stagingKey}, ${sha256}, ${input.bytes.length}, ${input.requesterId}::uuid, ${input.reason.trim()},
          'PENDING', 0, ${now.toISOString()}::timestamptz + interval '30 minutes',
          ${now.toISOString()}::timestamptz, ${now.toISOString()}::timestamptz) RETURNING *`) as unknown as Array<Record<string, unknown>>;
      const request = mapRequest(rows[0]!);
      await appendEvent(tx, { requestId, eventType: "REQUESTED", actorId: input.requesterId,
        version: 0, metadata: { source_integrity_status: target.integrityStatus,
          candidate_fingerprint: target.candidateId, replacement_sha256: sha256 }, now });
      await tx.execute(sql`INSERT INTO admin_action_log
        (actor_id, action_type, target_type, target_id, payload, created_at)
        VALUES (${input.requesterId}::uuid, 'shipment.apv_invoice_restoration_request',
          'shipment_apv_invoice_restoration_request', ${requestId},
          jsonb_build_object('source_integrity_status', ${target.integrityStatus}::text,
            'candidate_fingerprint', ${target.candidateId}::text,
            'replacement_sha256', ${sha256}::text), ${now.toISOString()}::timestamptz)`);
      return { outcome: "requested", request } as const;
    });
  } catch (error) {
    if (isUniqueViolation(error)) {
      if (stagedPath) await rm(stagedPath, { force: true });
      return { outcome: "pending_conflict" } as const;
    }
    throw error;
  }
}

interface InternalRequestRow extends Record<string, unknown> {
  document_id: string; staging_key: string; storage_key?: string;
}

async function fileHash(path: string, maxBytes = 5 * 1024 * 1024) {
  const metadata = await lstat(path);
  if (!metadata.isFile() || metadata.isSymbolicLink()) throw new Error("APV_INVOICE_RESTORE_NOT_REGULAR_FILE");
  if (metadata.size < 1 || metadata.size > maxBytes) throw new Error("APV_INVOICE_RESTORE_FILE_SIZE_OUT_OF_RANGE");
  const bytes = await readFile(path);
  return { sha256: createHash("sha256").update(bytes).digest("hex"), size: bytes.length };
}

export async function decideShipmentApvInvoiceRestoration(db: Database, input: {
  requestId: string; decisionRequestId: string; approverId: string;
  decision: "RESTORE" | "PRESERVE" | "REJECT"; reason: string; expectedVersion: number;
  storageRoot?: string; now?: Date;
}) {
  if (![input.requestId, input.decisionRequestId, input.approverId].every((value) => UUID_PATTERN.test(value))
    || input.reason.trim().length < 12 || input.reason.length > 500 || input.expectedVersion < 0) {
    return { outcome: "invalid_request" } as const;
  }
  const now = input.now ?? new Date();
  const root = input.storageRoot ?? resolveShipmentInvoiceDocumentRoot();
  let claimed: InternalRequestRow | null = null;
  try {
    const claim = await db.transaction(async (tx) => {
      const rows = await tx.execute(sql`SELECT request.*, document.storage_key
        FROM shipment_apv_invoice_restoration_requests request
        JOIN shipment_apv_invoice_documents document ON document.id = request.document_id
        WHERE request.id = ${input.requestId}::uuid FOR UPDATE OF request`) as unknown as InternalRequestRow[];
      const row = rows[0];
      if (!row) return { outcome: "not_found" } as const;
      const request = mapRequest(row);
      const terminal = input.decision === "RESTORE" ? "RESTORED" : input.decision === "PRESERVE" ? "PRESERVED" : "REJECTED";
      if (request.status === terminal && request.decision_request_id === input.decisionRequestId
        && request.approver_id === input.approverId) return { outcome: "duplicate", request } as const;
      if (request.status === "APPLYING") {
        if (request.decision_request_id !== input.decisionRequestId || request.approver_id !== input.approverId
          || request.decision !== input.decision || input.decision === "REJECT") return { outcome: "invalid_state" } as const;
        claimed = row;
        return { outcome: "resume" } as const;
      }
      if (request.status !== "PENDING") return { outcome: "invalid_state" } as const;
      if (request.requester_id === input.approverId) return { outcome: "self_approval_forbidden" } as const;
      if (request.version !== input.expectedVersion) return { outcome: "version_conflict" } as const;
      if (now.getTime() >= new Date(request.expires_at).getTime()) {
        const expiredRows = await tx.execute(sql`UPDATE shipment_apv_invoice_restoration_requests
          SET status = 'EXPIRED', decision_reason = 'Approval window expired', decided_at = ${now.toISOString()}::timestamptz,
              updated_at = ${now.toISOString()}::timestamptz, version = version + 1
          WHERE id = ${input.requestId}::uuid AND status = 'PENDING' RETURNING *`) as unknown as Array<Record<string, unknown>>;
        const expired = mapRequest(expiredRows[0]!);
        await appendEvent(tx, { requestId: expired.id, eventType: "EXPIRED", actorId: null, version: expired.version, now });
        return { outcome: "expired", request: expired } as const;
      }
      if (input.decision === "REJECT") {
        const rejectedRows = await tx.execute(sql`UPDATE shipment_apv_invoice_restoration_requests
          SET status = 'REJECTED', approver_id = ${input.approverId}::uuid,
              decision_request_id = ${input.decisionRequestId}::uuid, decision = 'REJECT',
              decision_reason = ${input.reason.trim()}, decided_at = ${now.toISOString()}::timestamptz,
              updated_at = ${now.toISOString()}::timestamptz, version = version + 1
          WHERE id = ${input.requestId}::uuid AND status = 'PENDING' RETURNING *`) as unknown as Array<Record<string, unknown>>;
        const rejected = mapRequest(rejectedRows[0]!);
        await appendEvent(tx, { requestId: rejected.id, eventType: "REJECTED", actorId: input.approverId,
          version: rejected.version, metadata: { decision: "REJECT" }, now });
        await tx.execute(sql`INSERT INTO admin_action_log
          (actor_id, action_type, target_type, target_id, payload, created_at)
          VALUES (${input.approverId}::uuid, 'shipment.apv_invoice_restoration_decision',
            'shipment_apv_invoice_restoration_request', ${rejected.id},
            jsonb_build_object('decision', 'REJECT',
              'candidate_fingerprint', ${rejected.candidate_fingerprint}::text,
              'replacement_sha256', ${rejected.replacement_sha256}::text), ${now.toISOString()}::timestamptz)`);
        return { outcome: "rejected", request: rejected } as const;
      }
      const candidateRows = await tx.execute(sql`SELECT id, integrity_status, storage_key, sha256, byte_size, content_type
        FROM shipment_apv_invoice_documents WHERE id = ${row.document_id}::uuid FOR UPDATE`) as unknown as Array<Record<string, unknown>>;
      if (!candidateRows[0] || internalCandidate(candidateRows[0]).candidateId !== request.candidate_fingerprint) {
        return { outcome: "candidate_changed" } as const;
      }
      const applyingRows = await tx.execute(sql`UPDATE shipment_apv_invoice_restoration_requests
        SET status = 'APPLYING', approver_id = ${input.approverId}::uuid,
            decision_request_id = ${input.decisionRequestId}::uuid, decision = ${input.decision},
            decision_reason = ${input.reason.trim()}, apply_error = NULL,
            updated_at = ${now.toISOString()}::timestamptz, version = version + 1
        WHERE id = ${input.requestId}::uuid AND status = 'PENDING' AND version = ${input.expectedVersion}
        RETURNING *`) as unknown as InternalRequestRow[];
      if (!applyingRows[0]) return { outcome: "version_conflict" } as const;
      claimed = { ...row, ...applyingRows[0] };
      await appendEvent(tx, { requestId: input.requestId, eventType: "APPLYING", actorId: input.approverId,
        version: Number(applyingRows[0].version), metadata: { decision: input.decision }, now });
      return { outcome: "claimed" } as const;
    });
    if ("request" in claim || !["claimed", "resume"].includes(claim.outcome)) return claim;
    const row = claimed!;
    const stagingPath = join(root, String(row.staging_key));
    const storagePath = join(root, String(row.storage_key));
    const preservePath = join(root, ".quarantine", input.requestId, `replacement-${basename(String(row.storage_key))}`);
    const destination = input.decision === "RESTORE" ? storagePath : preservePath;
    await mkdir(dirname(destination), { recursive: true, mode: 0o700 });
    await chmod(dirname(destination), 0o700);
    let stagingExists = false;
    let destinationExists = false;
    try { stagingExists = (await fileHash(stagingPath)).sha256 === String(row.expected_sha256); } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
    }
    try {
      const destinationHash = await fileHash(destination);
      destinationExists = destinationHash.sha256 === String(row.expected_sha256)
        && destinationHash.size === Number(row.expected_byte_size);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
    }
    if (stagingExists && !destinationExists) await rename(stagingPath, destination);
    else if (!stagingExists && !destinationExists) throw new Error("APV_INVOICE_RESTORE_SOURCE_MISSING");
    else if (stagingExists && destinationExists) throw new Error("APV_INVOICE_RESTORE_DESTINATION_CONFLICT");
    return await db.transaction(async (tx) => {
      const rows = await tx.execute(sql`SELECT * FROM shipment_apv_invoice_restoration_requests
        WHERE id = ${input.requestId}::uuid FOR UPDATE`) as unknown as Array<Record<string, unknown>>;
      const current = rows[0];
      if (!current || current.status !== "APPLYING" || current.decision_request_id !== input.decisionRequestId
        || current.approver_id !== input.approverId) throw new Error("APV_INVOICE_RESTORE_APPLY_STATE_LOST");
      if (input.decision === "RESTORE") {
        const documentRows = await tx.execute(sql`UPDATE shipment_apv_invoice_documents
          SET integrity_status = 'ACTIVE', integrity_note = ${input.reason.trim()},
              integrity_updated_at = ${now.toISOString()}::timestamptz
          WHERE id = ${current.document_id}::uuid AND integrity_status = ${current.source_integrity_status}
          RETURNING id`) as unknown as unknown[];
        if (documentRows.length !== 1) throw new Error("APV_INVOICE_RESTORE_DOCUMENT_STATE_CHANGED");
      }
      const terminal = input.decision === "RESTORE" ? "RESTORED" : "PRESERVED";
      const updatedRows = await tx.execute(sql`UPDATE shipment_apv_invoice_restoration_requests
        SET status = ${terminal}, apply_error = NULL, decided_at = ${now.toISOString()}::timestamptz,
            staging_status = 'CONSUMED', staging_disposed_at = ${now.toISOString()}::timestamptz,
            updated_at = ${now.toISOString()}::timestamptz, version = version + 1
        WHERE id = ${input.requestId}::uuid AND status = 'APPLYING' RETURNING *`) as unknown as Array<Record<string, unknown>>;
      const completed = mapRequest(updatedRows[0]!);
      await appendEvent(tx, { requestId: completed.id, eventType: terminal, actorId: input.approverId,
        version: completed.version, metadata: { decision: input.decision, replacement_sha256: completed.replacement_sha256 }, now });
      await tx.execute(sql`INSERT INTO admin_action_log
        (actor_id, action_type, target_type, target_id, payload, created_at)
        VALUES (${input.approverId}::uuid, 'shipment.apv_invoice_restoration_decision',
          'shipment_apv_invoice_restoration_request', ${completed.id},
          jsonb_build_object('decision', ${input.decision}::text,
            'candidate_fingerprint', ${completed.candidate_fingerprint}::text,
            'replacement_sha256', ${completed.replacement_sha256}::text), ${now.toISOString()}::timestamptz)`);
      return { outcome: input.decision === "RESTORE" ? "restored" : "preserved", request: completed } as const;
    });
  } catch (error) {
    if (isUniqueViolation(error)) return { outcome: "decision_conflict" } as const;
    if (claimed) {
      await db.execute(sql`UPDATE shipment_apv_invoice_restoration_requests
        SET apply_error = 'APV_INVOICE_RESTORATION_APPLY_FAILED', updated_at = ${new Date().toISOString()}::timestamptz
        WHERE id = ${input.requestId}::uuid AND status = 'APPLYING'`);
      return { outcome: "apply_failed" } as const;
    }
    throw error;
  }
}

function restorationPath(root: string, key: string) {
  const rootPath = resolve(root);
  const candidate = resolve(rootPath, key);
  if (!candidate.startsWith(`${rootPath}${sep}`)) throw new Error("APV_INVOICE_RESTORATION_PATH_ESCAPE");
  return candidate;
}

export interface ShipmentApvInvoiceRestorationStagingMaintenanceResult {
  mode: "dry_run" | "apply";
  scanned: number;
  eligible: number;
  expired: number;
  preserved: number;
  resumed: number;
  sourceMissing: number;
  conflicts: number;
  truncated: boolean;
}

export interface ShipmentApvInvoiceRestorationStagingHealth {
  status: "healthy" | "warning" | "critical";
  trackedStaging: number;
  pendingDisposition: number;
  staleMoving: number;
  missingSources: number;
  hashMismatches: number;
  invalidEntries: number;
  checkedBytes: number;
  scanTruncated: boolean;
  recordedAt: string;
}

export async function getShipmentApvInvoiceRestorationStagingHealth(db: Database, input: {
  storageRoot?: string; now?: Date; limit?: number; maxCheckedBytes?: number;
} = {}): Promise<ShipmentApvInvoiceRestorationStagingHealth> {
  const now = input.now ?? new Date();
  const limit = Math.min(Math.max(input.limit ?? 1000, 1), 1000);
  const maxCheckedBytes = Math.min(Math.max(input.maxCheckedBytes ?? 100 * 1024 * 1024, 1), 100 * 1024 * 1024);
  const root = input.storageRoot ?? resolveShipmentInvoiceDocumentRoot();
  const rows = await db.execute(sql`SELECT id, status, staging_status, staging_key, replacement_sha256,
      replacement_byte_size, expires_at, updated_at
    FROM shipment_apv_invoice_restoration_requests
    WHERE staging_status IN ('STAGED', 'MOVING')
    ORDER BY created_at ASC, id ASC LIMIT ${limit + 1}`) as unknown as InternalRequestRow[];
  const candidates = rows.slice(0, limit);
  let scanTruncated = rows.length > limit;
  let pendingDisposition = 0;
  let staleMoving = 0;
  let missingSources = 0;
  let hashMismatches = 0;
  let invalidEntries = 0;
  let checkedBytes = 0;
  for (const row of candidates) {
    if (["REJECTED", "EXPIRED"].includes(String(row.status))
      || (row.status === "PENDING" && new Date(String(row.expires_at)).getTime() <= now.getTime())) {
      pendingDisposition += 1;
    }
    if (row.staging_status === "MOVING"
      && new Date(String(row.updated_at)).getTime() <= now.getTime() - 5 * 60 * 1000) staleMoving += 1;
    if (checkedBytes + Number(row.replacement_byte_size) > maxCheckedBytes) {
      scanTruncated = true;
      continue;
    }
    let path: string;
    try { path = restorationPath(root, String(row.staging_key)); } catch {
      invalidEntries += 1;
      continue;
    }
    try {
      const metadata = await lstat(path);
      if (!metadata.isFile() || metadata.isSymbolicLink()) {
        invalidEntries += 1;
        continue;
      }
      if (checkedBytes + metadata.size > maxCheckedBytes) {
        scanTruncated = true;
        continue;
      }
      const source = await fileHash(path, metadata.size);
      checkedBytes += source.size;
      if (source.sha256 !== String(row.replacement_sha256)
        || source.size !== Number(row.replacement_byte_size)) hashMismatches += 1;
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") missingSources += 1;
      else invalidEntries += 1;
    }
  }
  const critical = missingSources > 0 || hashMismatches > 0 || invalidEntries > 0;
  const warning = pendingDisposition > 0 || staleMoving > 0 || scanTruncated;
  return { status: critical ? "critical" : warning ? "warning" : "healthy",
    trackedStaging: candidates.length, pendingDisposition, staleMoving, missingSources, hashMismatches,
    invalidEntries, checkedBytes, scanTruncated, recordedAt: now.toISOString() };
}

export async function maintainShipmentApvInvoiceRestorationStaging(db: Database, input: {
  mode: "dry_run" | "apply"; actorId: string; limit?: number; storageRoot?: string; now?: Date;
}): Promise<ShipmentApvInvoiceRestorationStagingMaintenanceResult | { outcome: "invalid_request" }> {
  const limit = input.limit ?? 100;
  if (!UUID_PATTERN.test(input.actorId) || !Number.isInteger(limit) || limit < 1 || limit > 1000) {
    return { outcome: "invalid_request" };
  }
  const now = input.now ?? new Date();
  const root = input.storageRoot ?? resolveShipmentInvoiceDocumentRoot();
  const rows = await db.execute(sql`SELECT * FROM shipment_apv_invoice_restoration_requests
    WHERE (staging_status = 'STAGED' OR (
      staging_status = 'MOVING' AND updated_at <= ${now.toISOString()}::timestamptz - interval '5 minutes'
    )) AND (
      status IN ('REJECTED', 'EXPIRED') OR (status = 'PENDING' AND expires_at <= ${now.toISOString()}::timestamptz)
    ) ORDER BY created_at ASC, id ASC LIMIT ${limit + 1}`) as unknown as InternalRequestRow[];
  const candidates = rows.slice(0, limit);
  const result: ShipmentApvInvoiceRestorationStagingMaintenanceResult = {
    mode: input.mode, scanned: candidates.length, eligible: candidates.length, expired: 0,
    preserved: 0, resumed: 0, sourceMissing: 0, conflicts: 0, truncated: rows.length > limit,
  };
  if (input.mode === "dry_run") return result;

  for (const candidate of candidates) {
    const claim = await db.transaction(async (tx) => {
      const lockedRows = await tx.execute(sql`SELECT * FROM shipment_apv_invoice_restoration_requests
        WHERE id = ${String(candidate.id)}::uuid FOR UPDATE`) as unknown as InternalRequestRow[];
      const row = lockedRows[0];
      if (!row || !["STAGED", "MOVING"].includes(String(row.staging_status))) return null;
      if (row.staging_status === "MOVING"
        && new Date(String(row.updated_at)).getTime() > now.getTime() - 5 * 60 * 1000) return null;
      if (row.status === "PENDING") {
        if (now.getTime() < new Date(String(row.expires_at)).getTime()) return null;
        const expiredRows = await tx.execute(sql`UPDATE shipment_apv_invoice_restoration_requests
          SET status = 'EXPIRED', decision_reason = 'Approval window expired',
              decided_at = ${now.toISOString()}::timestamptz, staging_status = 'MOVING',
              updated_at = ${now.toISOString()}::timestamptz, version = version + 1
          WHERE id = ${String(row.id)}::uuid AND status = 'PENDING' RETURNING *`) as unknown as InternalRequestRow[];
        if (!expiredRows[0]) return null;
        await appendEvent(tx, { requestId: String(row.id), eventType: "EXPIRED", actorId: null,
          version: Number(expiredRows[0].version), now });
        result.expired += 1;
        return expiredRows[0];
      }
      if (!["REJECTED", "EXPIRED"].includes(String(row.status))) return null;
      if (row.staging_status === "MOVING") result.resumed += 1;
      if (row.staging_status === "STAGED") {
        const movingRows = await tx.execute(sql`UPDATE shipment_apv_invoice_restoration_requests
          SET staging_status = 'MOVING', updated_at = ${now.toISOString()}::timestamptz
          WHERE id = ${String(row.id)}::uuid AND staging_status = 'STAGED' RETURNING *`) as unknown as InternalRequestRow[];
        return movingRows[0] ?? null;
      }
      return row;
    });
    if (!claim) continue;
    let stagingPath: string;
    let destinationPath: string;
    try {
      stagingPath = restorationPath(root, String(claim.staging_key));
      const destinationKey = join(".quarantine", String(claim.id), `staged-${basename(String(claim.staging_key))}`);
      destinationPath = restorationPath(root, destinationKey);
    } catch {
      result.conflicts += 1;
      continue;
    }
    await mkdir(dirname(destinationPath), { recursive: true, mode: 0o700 });
    await chmod(dirname(destinationPath), 0o700);
    let source: { sha256: string; size: number } | null = null;
    let destination: { sha256: string; size: number } | null = null;
    try { source = await fileHash(stagingPath); } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "ENOENT") {
        result.conflicts += 1;
        continue;
      }
    }
    try { destination = await fileHash(destinationPath); } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "ENOENT") {
        result.conflicts += 1;
        continue;
      }
    }
    const matches = (value: { sha256: string; size: number } | null) => Boolean(value
      && value.sha256 === String(claim.replacement_sha256) && value.size === Number(claim.replacement_byte_size));
    if ((source && !matches(source)) || (destination && !matches(destination)) || (source && destination)) {
      result.conflicts += 1;
      continue;
    }
    if (source) await rename(stagingPath, destinationPath);
    else if (!destination) {
      result.sourceMissing += 1;
      continue;
    }
    await db.transaction(async (tx) => {
      const movedRows = await tx.execute(sql`UPDATE shipment_apv_invoice_restoration_requests
        SET staging_status = 'MOVED', staging_disposed_at = ${now.toISOString()}::timestamptz,
            updated_at = ${now.toISOString()}::timestamptz, version = version + 1
        WHERE id = ${String(claim.id)}::uuid AND staging_status = 'MOVING' RETURNING *`) as unknown as InternalRequestRow[];
      if (!movedRows[0]) return;
      await appendEvent(tx, { requestId: String(claim.id), eventType: "STAGING_PRESERVED",
        actorId: input.actorId, version: Number(movedRows[0].version),
        metadata: { disposition: "QUARANTINE", replacement_sha256: String(claim.replacement_sha256) }, now });
      await tx.execute(sql`INSERT INTO admin_action_log
        (actor_id, action_type, target_type, target_id, payload, created_at)
        VALUES (${input.actorId}::uuid, 'shipment.apv_invoice_restoration_staging_preserve',
          'shipment_apv_invoice_restoration_request', ${String(claim.id)},
          jsonb_build_object('disposition', 'QUARANTINE', 'replacement_sha256', ${String(claim.replacement_sha256)}::text),
          ${now.toISOString()}::timestamptz)`);
      result.preserved += 1;
    });
  }
  return result;
}

export async function listPendingShipmentApvInvoiceRestorations(db: Database) {
  const rows = await db.execute(sql`SELECT * FROM shipment_apv_invoice_restoration_requests
    WHERE status IN ('PENDING', 'APPLYING') ORDER BY created_at ASC, id ASC LIMIT 100`) as unknown as Array<Record<string, unknown>>;
  return rows.map(mapRequest);
}

export async function getShipmentApvInvoiceRestorationTimeline(db: Database, requestId: string) {
  if (!UUID_PATTERN.test(requestId)) return null;
  const requestRows = await db.execute(sql`SELECT * FROM shipment_apv_invoice_restoration_requests
    WHERE id = ${requestId}::uuid LIMIT 1`) as unknown as Array<Record<string, unknown>>;
  if (!requestRows[0]) return null;
  const events = await db.execute(sql`SELECT id, event_type, actor_id, request_version, metadata, created_at
    FROM shipment_apv_invoice_restoration_events WHERE request_id = ${requestId}::uuid
    ORDER BY request_version ASC, created_at ASC, id ASC`) as unknown as Array<Record<string, unknown>>;
  return { request: mapRequest(requestRows[0]), events: events.map((row) => ({ id: String(row.id),
    event_type: String(row.event_type), actor_id: row.actor_id ? String(row.actor_id) : null,
    request_version: Number(row.request_version), metadata: row.metadata ?? {},
    created_at: new Date(String(row.created_at)).toISOString() })) };
}

export async function deleteShipmentApvInvoiceRestorationFixtureRows(db: Database, requestIds: string[]) {
  if (!requestIds.length) return { events: 0, requests: 0 };
  const ids = sql.join(requestIds.map((id) => sql`${id}::uuid`), sql`, `);
  const events = await db.execute(sql`DELETE FROM shipment_apv_invoice_restoration_events
    WHERE request_id = ANY(ARRAY[${ids}]) RETURNING id`) as unknown as unknown[];
  const requests = await db.execute(sql`DELETE FROM shipment_apv_invoice_restoration_requests
    WHERE id = ANY(ARRAY[${ids}]) RETURNING id`) as unknown as unknown[];
  return { events: events.length, requests: requests.length };
}
