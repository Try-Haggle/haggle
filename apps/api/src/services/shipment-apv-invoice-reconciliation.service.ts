import { createHash, randomUUID } from "node:crypto";
import { chmod, lstat, mkdir, readdir, readFile, rename } from "node:fs/promises";
import { basename, join } from "node:path";
import { sql, type Database } from "@haggle/db";
import { resolveShipmentInvoiceDocumentRoot } from "./shipment-apv-invoice-document.service.js";

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const STORAGE_KEY_PATTERN = /^([0-9a-f-]{36})\/([0-9a-f]{64})\.(pdf|csv|json)$/;
const MAX_DOCUMENTS = 1000;
const MAX_FILESYSTEM_ENTRIES = 5000;
const MAX_HASH_BYTES = 100 * 1024 * 1024;

export type ShipmentApvInvoiceAnomalyType = "MISSING_FILE" | "SIZE_MISMATCH" | "HASH_MISMATCH" | "ORPHAN_FILE";

interface InternalCandidate {
  candidateId: string;
  anomalyType: ShipmentApvInvoiceAnomalyType;
  storageKey: string;
  documentId: string | null;
  expectedSha256: string | null;
  expectedByteSize: number | null;
}

export interface ShipmentApvInvoiceReconciliationCandidate {
  candidateId: string;
  anomalyType: ShipmentApvInvoiceAnomalyType;
  documentBound: boolean;
}

export interface ShipmentApvInvoiceReconciliationRequest {
  id: string;
  client_request_id: string;
  anomaly_type: ShipmentApvInvoiceAnomalyType;
  target_fingerprint: string;
  document_bound: boolean;
  requester_id: string;
  reason: string;
  status: "PENDING" | "APPLYING" | "APPROVED" | "REJECTED" | "EXPIRED";
  version: number;
  expires_at: string;
  approver_id?: string;
  decision_request_id?: string;
  decision_reason?: string;
  apply_error?: string;
  decided_at?: string;
  created_at: string;
}

type Executor = Pick<Database, "execute">;

function fingerprint(candidate: Omit<InternalCandidate, "candidateId">) {
  return createHash("sha256").update([
    candidate.anomalyType, candidate.storageKey, candidate.documentId ?? "orphan",
    candidate.expectedSha256 ?? "none", String(candidate.expectedByteSize ?? "none"),
  ].join(":"), "utf8").digest("hex");
}

function candidate(input: Omit<InternalCandidate, "candidateId">): InternalCandidate {
  return { ...input, candidateId: fingerprint(input) };
}

function publicCandidate(value: InternalCandidate): ShipmentApvInvoiceReconciliationCandidate {
  return { candidateId: value.candidateId, anomalyType: value.anomalyType, documentBound: Boolean(value.documentId) };
}

function mapRequest(row: Record<string, unknown>): ShipmentApvInvoiceReconciliationRequest {
  return {
    id: String(row.id), client_request_id: String(row.client_request_id),
    anomaly_type: String(row.anomaly_type) as ShipmentApvInvoiceAnomalyType,
    target_fingerprint: String(row.target_fingerprint), document_bound: Boolean(row.document_id),
    requester_id: String(row.requester_id), reason: String(row.reason),
    status: String(row.status) as ShipmentApvInvoiceReconciliationRequest["status"], version: Number(row.version),
    expires_at: new Date(String(row.expires_at)).toISOString(),
    approver_id: row.approver_id ? String(row.approver_id) : undefined,
    decision_request_id: row.decision_request_id ? String(row.decision_request_id) : undefined,
    decision_reason: row.decision_reason ? String(row.decision_reason) : undefined,
    apply_error: row.apply_error ? String(row.apply_error) : undefined,
    decided_at: row.decided_at ? new Date(String(row.decided_at)).toISOString() : undefined,
    created_at: new Date(String(row.created_at)).toISOString(),
  };
}

function isUniqueViolation(error: unknown): boolean {
  if (!error || typeof error !== "object") return false;
  const candidateError = error as { code?: unknown; cause?: unknown };
  return candidateError.code === "23505" || isUniqueViolation(candidateError.cause);
}

async function appendEvent(tx: Executor, input: {
  requestId: string; eventType: "REQUESTED" | "APPLYING" | "APPROVED" | "REJECTED" | "EXPIRED";
  actorId: string | null; version: number; metadata?: Record<string, unknown>; now: Date;
}) {
  await tx.execute(sql`INSERT INTO shipment_apv_invoice_reconciliation_events
    (id, request_id, event_type, actor_id, request_version, metadata, created_at)
    VALUES (${randomUUID()}::uuid, ${input.requestId}::uuid, ${input.eventType}, ${input.actorId}::uuid,
      ${input.version}, ${JSON.stringify(input.metadata ?? {})}::jsonb, ${input.now.toISOString()}::timestamptz)`);
}

async function discoverInternal(db: Executor, storageRoot: string) {
  const countRows = await db.execute(sql`SELECT count(*) AS count FROM shipment_apv_invoice_documents
    WHERE integrity_status = 'ACTIVE'`) as unknown as Array<{ count: string | number }>;
  const total = Number(countRows[0]?.count ?? 0);
  const rows = await db.execute(sql`SELECT id, storage_key, byte_size, sha256
    FROM shipment_apv_invoice_documents WHERE integrity_status = 'ACTIVE'
    ORDER BY created_at ASC LIMIT ${MAX_DOCUMENTS}`) as unknown as Array<{
      id: string; storage_key: string; byte_size: number | string; sha256: string;
    }>;
  let scanTruncated = total > rows.length;
  let checkedBytes = 0;
  const candidates: InternalCandidate[] = [];
  const expectedKeys = new Set<string>();
  for (const row of rows) {
    if (!STORAGE_KEY_PATTERN.test(row.storage_key)) continue;
    expectedKeys.add(row.storage_key);
    const base = { storageKey: row.storage_key, documentId: String(row.id),
      expectedSha256: row.sha256, expectedByteSize: Number(row.byte_size) };
    try {
      const metadata = await lstat(join(storageRoot, row.storage_key));
      if (!metadata.isFile() || metadata.isSymbolicLink()) continue;
      if (metadata.size !== base.expectedByteSize) {
        candidates.push(candidate({ ...base, anomalyType: "SIZE_MISMATCH" }));
        continue;
      }
      if (checkedBytes + metadata.size > MAX_HASH_BYTES) { scanTruncated = true; continue; }
      const bytes = await readFile(join(storageRoot, row.storage_key));
      checkedBytes += bytes.length;
      if (createHash("sha256").update(bytes).digest("hex") !== row.sha256) {
        candidates.push(candidate({ ...base, anomalyType: "HASH_MISMATCH" }));
      }
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") {
        candidates.push(candidate({ ...base, anomalyType: "MISSING_FILE" }));
      }
    }
  }
  let filesystemEntries = 0;
  try {
    const directories = await readdir(storageRoot, { withFileTypes: true });
    for (const directory of directories) {
      if (directory.name === ".quarantine" || directory.name === ".restoration") continue;
      filesystemEntries += 1;
      if (filesystemEntries > MAX_FILESYSTEM_ENTRIES) { scanTruncated = true; break; }
      if (!directory.isDirectory() || directory.isSymbolicLink() || !UUID_PATTERN.test(directory.name)) continue;
      const files = await readdir(join(storageRoot, directory.name), { withFileTypes: true });
      for (const file of files) {
        filesystemEntries += 1;
        if (filesystemEntries > MAX_FILESYSTEM_ENTRIES) { scanTruncated = true; break; }
        const storageKey = `${directory.name}/${file.name}`;
        if (!file.isFile() || file.isSymbolicLink() || !STORAGE_KEY_PATTERN.test(storageKey)) continue;
        if (!scanTruncated && !expectedKeys.has(storageKey)) {
          candidates.push(candidate({ anomalyType: "ORPHAN_FILE", storageKey,
            documentId: null, expectedSha256: null, expectedByteSize: null }));
        }
      }
      if (filesystemEntries > MAX_FILESYSTEM_ENTRIES) break;
    }
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
  }
  return { candidates, scanTruncated, checkedDocuments: rows.length, totalDocuments: total };
}

export async function discoverShipmentApvInvoiceReconciliationCandidates(
  db: Database, options: { storageRoot?: string } = {},
) {
  const result = await discoverInternal(db, options.storageRoot ?? resolveShipmentInvoiceDocumentRoot());
  return { candidates: result.candidates.map(publicCandidate), scanTruncated: result.scanTruncated,
    checkedDocuments: result.checkedDocuments, totalDocuments: result.totalDocuments };
}

export async function requestShipmentApvInvoiceReconciliation(
  db: Database,
  input: { clientRequestId: string; candidateId: string; requesterId: string; reason: string;
    storageRoot?: string; now?: Date },
) {
  if (!UUID_PATTERN.test(input.clientRequestId) || !UUID_PATTERN.test(input.requesterId)
    || !/^[0-9a-f]{64}$/.test(input.candidateId)
    || input.reason.trim().length < 12 || input.reason.length > 500) return { outcome: "invalid_request" } as const;
  const root = input.storageRoot ?? resolveShipmentInvoiceDocumentRoot();
  const discovery = await discoverInternal(db, root);
  if (discovery.scanTruncated) return { outcome: "scan_truncated" } as const;
  const target = discovery.candidates.find((item) => item.candidateId === input.candidateId);
  if (!target) return { outcome: "candidate_not_found" } as const;
  const now = input.now ?? new Date();
  try {
    return await db.transaction(async (tx) => {
      const existingRows = await tx.execute(sql`SELECT * FROM shipment_apv_invoice_reconciliation_requests
        WHERE client_request_id = ${input.clientRequestId}::uuid FOR UPDATE`) as unknown as Array<Record<string, unknown>>;
      if (existingRows[0]) {
        const existing = mapRequest(existingRows[0]);
        return existing.target_fingerprint === target.candidateId && existing.requester_id === input.requesterId
          && existing.reason === input.reason.trim()
          ? { outcome: "duplicate", request: existing } as const : { outcome: "request_conflict" } as const;
      }
      const expiredRows = await tx.execute(sql`UPDATE shipment_apv_invoice_reconciliation_requests
        SET status = 'EXPIRED', decision_reason = 'Approval window expired', decided_at = ${now.toISOString()}::timestamptz,
            updated_at = ${now.toISOString()}::timestamptz, version = version + 1
        WHERE target_fingerprint = ${target.candidateId} AND status = 'PENDING' AND expires_at <= ${now.toISOString()}::timestamptz
        RETURNING id, version`) as unknown as Array<{ id: string; version: number }>;
      for (const expired of expiredRows) await appendEvent(tx, { requestId: expired.id, eventType: "EXPIRED",
        actorId: null, version: Number(expired.version), now });
      const rows = await tx.execute(sql`INSERT INTO shipment_apv_invoice_reconciliation_requests
        (client_request_id, anomaly_type, target_fingerprint, storage_key, document_id, expected_sha256,
         expected_byte_size, requester_id, reason, status, version, expires_at, created_at, updated_at)
        VALUES (${input.clientRequestId}::uuid, ${target.anomalyType}, ${target.candidateId}, ${target.storageKey},
          ${target.documentId}::uuid, ${target.expectedSha256}, ${target.expectedByteSize}, ${input.requesterId}::uuid,
          ${input.reason.trim()}, 'PENDING', 0, ${now.toISOString()}::timestamptz + interval '30 minutes',
          ${now.toISOString()}::timestamptz, ${now.toISOString()}::timestamptz) RETURNING *`) as unknown as Array<Record<string, unknown>>;
      const request = mapRequest(rows[0]!);
      await appendEvent(tx, { requestId: request.id, eventType: "REQUESTED", actorId: input.requesterId,
        version: request.version, metadata: { anomaly_type: request.anomaly_type,
          target_fingerprint: request.target_fingerprint }, now });
      await tx.execute(sql`INSERT INTO admin_action_log
        (actor_id, action_type, target_type, target_id, payload, created_at)
        VALUES (${input.requesterId}::uuid, 'shipment.apv_invoice_reconciliation_request',
          'shipment_apv_invoice_reconciliation_request', ${request.id},
          jsonb_build_object('anomaly_type', ${request.anomaly_type}::text,
            'target_fingerprint', ${request.target_fingerprint}::text), ${now.toISOString()}::timestamptz)`);
      return { outcome: "requested", request } as const;
    });
  } catch (error) {
    if (isUniqueViolation(error)) return { outcome: "pending_conflict" } as const;
    throw error;
  }
}

interface InternalRequestRow extends Record<string, unknown> {
  storage_key: string;
  document_id: string | null;
  expected_sha256: string | null;
  expected_byte_size: number | null;
}

export async function decideShipmentApvInvoiceReconciliation(
  db: Database,
  input: { requestId: string; decisionRequestId: string; approverId: string; decision: "APPROVE" | "REJECT";
    reason: string; expectedVersion: number; storageRoot?: string; now?: Date },
) {
  if (![input.requestId, input.decisionRequestId, input.approverId].every((value) => UUID_PATTERN.test(value))
    || input.reason.trim().length < 12 || input.reason.length > 500 || input.expectedVersion < 0) {
    return { outcome: "invalid_request" } as const;
  }
  const now = input.now ?? new Date();
  const root = input.storageRoot ?? resolveShipmentInvoiceDocumentRoot();
  let claimed: InternalRequestRow | null = null;
  try {
    const claim = await db.transaction(async (tx) => {
      const rows = await tx.execute(sql`SELECT * FROM shipment_apv_invoice_reconciliation_requests
        WHERE id = ${input.requestId}::uuid FOR UPDATE`) as unknown as InternalRequestRow[];
      const row = rows[0];
      if (!row) return { outcome: "not_found" } as const;
      const request = mapRequest(row);
      const expectedStatus = input.decision === "APPROVE" ? "APPROVED" : "REJECTED";
      if (request.status === expectedStatus && request.decision_request_id === input.decisionRequestId
        && request.approver_id === input.approverId) return { outcome: "duplicate", request } as const;
      if (request.status === "APPLYING") {
        if (request.decision_request_id !== input.decisionRequestId || request.approver_id !== input.approverId
          || input.decision !== "APPROVE") return { outcome: "invalid_state" } as const;
        claimed = row;
        return { outcome: "resume" } as const;
      }
      if (request.status !== "PENDING") return { outcome: "invalid_state" } as const;
      if (request.requester_id === input.approverId) return { outcome: "self_approval_forbidden" } as const;
      if (request.version !== input.expectedVersion) return { outcome: "version_conflict" } as const;
      if (now.getTime() >= new Date(request.expires_at).getTime()) {
        const expiredRows = await tx.execute(sql`UPDATE shipment_apv_invoice_reconciliation_requests
          SET status = 'EXPIRED', decision_reason = 'Approval window expired', decided_at = ${now.toISOString()}::timestamptz,
              updated_at = ${now.toISOString()}::timestamptz, version = version + 1
          WHERE id = ${input.requestId}::uuid AND status = 'PENDING' RETURNING *`) as unknown as InternalRequestRow[];
        const expired = mapRequest(expiredRows[0]!);
        await appendEvent(tx, { requestId: expired.id, eventType: "EXPIRED", actorId: null,
          version: expired.version, now });
        return { outcome: "expired", request: expired } as const;
      }
      if (input.decision === "REJECT") {
        const updatedRows = await tx.execute(sql`UPDATE shipment_apv_invoice_reconciliation_requests
          SET status = 'REJECTED', approver_id = ${input.approverId}::uuid,
              decision_request_id = ${input.decisionRequestId}::uuid, decision_reason = ${input.reason.trim()},
              decided_at = ${now.toISOString()}::timestamptz, updated_at = ${now.toISOString()}::timestamptz,
              version = version + 1 WHERE id = ${input.requestId}::uuid AND status = 'PENDING'
          RETURNING *`) as unknown as InternalRequestRow[];
        const rejected = mapRequest(updatedRows[0]!);
        await appendEvent(tx, { requestId: rejected.id, eventType: "REJECTED", actorId: input.approverId,
          version: rejected.version, metadata: { reason: input.reason.trim() }, now });
        await tx.execute(sql`INSERT INTO admin_action_log
          (actor_id, action_type, target_type, target_id, payload, created_at)
          VALUES (${input.approverId}::uuid, 'shipment.apv_invoice_reconciliation_decision',
            'shipment_apv_invoice_reconciliation_request', ${rejected.id},
            jsonb_build_object('decision', 'REJECT', 'anomaly_type', ${rejected.anomaly_type}::text,
              'target_fingerprint', ${rejected.target_fingerprint}::text), ${now.toISOString()}::timestamptz)`);
        return { outcome: "rejected", request: rejected } as const;
      }
      const discovery = await discoverInternal(tx, root);
      if (discovery.scanTruncated || !discovery.candidates.some((item) => item.candidateId === request.target_fingerprint)) {
        return { outcome: "candidate_changed" } as const;
      }
      const applyingRows = await tx.execute(sql`UPDATE shipment_apv_invoice_reconciliation_requests
        SET status = 'APPLYING', approver_id = ${input.approverId}::uuid,
            decision_request_id = ${input.decisionRequestId}::uuid, decision_reason = ${input.reason.trim()},
            apply_error = NULL, updated_at = ${now.toISOString()}::timestamptz, version = version + 1
        WHERE id = ${input.requestId}::uuid AND status = 'PENDING' AND version = ${input.expectedVersion}
        RETURNING *`) as unknown as InternalRequestRow[];
      if (!applyingRows[0]) return { outcome: "version_conflict" } as const;
      claimed = applyingRows[0];
      await appendEvent(tx, { requestId: input.requestId, eventType: "APPLYING", actorId: input.approverId,
        version: Number(applyingRows[0].version), metadata: { anomaly_type: request.anomaly_type }, now });
      return { outcome: "claimed" } as const;
    });
    if ("request" in claim || !["claimed", "resume"].includes(claim.outcome)) return claim;
    const row = claimed!;
    const anomalyType = String(row.anomaly_type) as ShipmentApvInvoiceAnomalyType;
    const sourcePath = join(root, row.storage_key);
    const quarantineDir = join(root, ".quarantine", input.requestId);
    const quarantinePath = join(quarantineDir, basename(row.storage_key));
    if (anomalyType === "MISSING_FILE") {
      try {
        await lstat(sourcePath);
        throw new Error("APV_INVOICE_RECONCILIATION_CANDIDATE_CHANGED");
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
      }
    } else {
      await mkdir(quarantineDir, { recursive: true, mode: 0o700 });
      await chmod(quarantineDir, 0o700);
      let sourceExists = false;
      let quarantineExists = false;
      try { sourceExists = (await lstat(sourcePath)).isFile(); } catch (error) {
        if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
      }
      try { quarantineExists = (await lstat(quarantinePath)).isFile(); } catch (error) {
        if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
      }
      if (sourceExists && !quarantineExists) await rename(sourcePath, quarantinePath);
      else if (!sourceExists && !quarantineExists) throw new Error("APV_INVOICE_RECONCILIATION_SOURCE_MISSING");
      else if (sourceExists && quarantineExists) throw new Error("APV_INVOICE_RECONCILIATION_DESTINATION_CONFLICT");
    }
    return await db.transaction(async (tx) => {
      const rows = await tx.execute(sql`SELECT * FROM shipment_apv_invoice_reconciliation_requests
        WHERE id = ${input.requestId}::uuid FOR UPDATE`) as unknown as InternalRequestRow[];
      const current = rows[0];
      if (!current || current.status !== "APPLYING" || current.decision_request_id !== input.decisionRequestId
        || current.approver_id !== input.approverId) return { outcome: "apply_state_lost" } as const;
      if (current.document_id) {
        const documentRows = await tx.execute(sql`UPDATE shipment_apv_invoice_documents
          SET integrity_status = ${anomalyType === "MISSING_FILE" ? "MISSING" : "QUARANTINED"},
              integrity_note = ${input.reason.trim()}, integrity_updated_at = ${now.toISOString()}::timestamptz
          WHERE id = ${current.document_id}::uuid AND integrity_status = 'ACTIVE' RETURNING id`) as unknown as unknown[];
        if (documentRows.length !== 1) throw new Error("APV_INVOICE_RECONCILIATION_DOCUMENT_STATE_CHANGED");
      }
      const updatedRows = await tx.execute(sql`UPDATE shipment_apv_invoice_reconciliation_requests
        SET status = 'APPROVED', apply_error = NULL, decided_at = ${now.toISOString()}::timestamptz,
            updated_at = ${now.toISOString()}::timestamptz, version = version + 1
        WHERE id = ${input.requestId}::uuid AND status = 'APPLYING' RETURNING *`) as unknown as InternalRequestRow[];
      const approved = mapRequest(updatedRows[0]!);
      await appendEvent(tx, { requestId: approved.id, eventType: "APPROVED", actorId: input.approverId,
        version: approved.version, metadata: { anomaly_type: approved.anomaly_type, quarantined: anomalyType !== "MISSING_FILE" }, now });
      await tx.execute(sql`INSERT INTO admin_action_log
        (actor_id, action_type, target_type, target_id, payload, created_at)
        VALUES (${input.approverId}::uuid, 'shipment.apv_invoice_reconciliation_decision',
          'shipment_apv_invoice_reconciliation_request', ${approved.id},
          jsonb_build_object('decision', 'APPROVE', 'anomaly_type', ${approved.anomaly_type}::text,
            'target_fingerprint', ${approved.target_fingerprint}::text), ${now.toISOString()}::timestamptz)`);
      return { outcome: "approved", request: approved } as const;
    });
  } catch (error) {
    if (isUniqueViolation(error)) return { outcome: "decision_conflict" } as const;
    if (claimed) {
      await db.execute(sql`UPDATE shipment_apv_invoice_reconciliation_requests
        SET apply_error = 'APV_INVOICE_RECONCILIATION_APPLY_FAILED',
        updated_at = ${new Date().toISOString()}::timestamptz WHERE id = ${input.requestId}::uuid AND status = 'APPLYING'`);
      return { outcome: "apply_failed" } as const;
    }
    throw error;
  }
}

export async function listPendingShipmentApvInvoiceReconciliations(db: Database) {
  const rows = await db.execute(sql`SELECT * FROM shipment_apv_invoice_reconciliation_requests
    WHERE status IN ('PENDING', 'APPLYING') ORDER BY created_at ASC, id ASC LIMIT 100`) as unknown as Array<Record<string, unknown>>;
  return rows.map(mapRequest);
}

export async function getShipmentApvInvoiceReconciliationTimeline(db: Database, requestId: string) {
  if (!UUID_PATTERN.test(requestId)) return null;
  const requestRows = await db.execute(sql`SELECT * FROM shipment_apv_invoice_reconciliation_requests
    WHERE id = ${requestId}::uuid LIMIT 1`) as unknown as Array<Record<string, unknown>>;
  if (!requestRows[0]) return null;
  const events = await db.execute(sql`SELECT id, event_type, actor_id, request_version, metadata, created_at
    FROM shipment_apv_invoice_reconciliation_events WHERE request_id = ${requestId}::uuid
    ORDER BY request_version ASC, created_at ASC, id ASC`) as unknown as Array<Record<string, unknown>>;
  return { request: mapRequest(requestRows[0]), events: events.map((row) => ({
    id: String(row.id), event_type: String(row.event_type), actor_id: row.actor_id ? String(row.actor_id) : null,
    request_version: Number(row.request_version), metadata: row.metadata ?? {},
    created_at: new Date(String(row.created_at)).toISOString(),
  })) };
}

export async function deleteShipmentApvInvoiceReconciliationFixtureRows(db: Database, requestIds: string[]) {
  if (!requestIds.length) return { events: 0, requests: 0 };
  const ids = sql.join(requestIds.map((id) => sql`${id}::uuid`), sql`, `);
  const events = await db.execute(sql`DELETE FROM shipment_apv_invoice_reconciliation_events
    WHERE request_id = ANY(ARRAY[${ids}]) RETURNING id`) as unknown as unknown[];
  const requests = await db.execute(sql`DELETE FROM shipment_apv_invoice_reconciliation_requests
    WHERE id = ANY(ARRAY[${ids}]) RETURNING id`) as unknown as unknown[];
  return { events: events.length, requests: requests.length };
}
