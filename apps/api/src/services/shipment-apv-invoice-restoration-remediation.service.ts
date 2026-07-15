import { createHash, randomUUID } from "node:crypto";
import { chmod, lstat, mkdir, readFile, rename } from "node:fs/promises";
import { basename, dirname, join, resolve, sep } from "node:path";
import { type Database, sql } from "@haggle/db";
import { resolveShipmentInvoiceDocumentRoot } from "./shipment-apv-invoice-document.service.js";

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
type IssueType = "SOURCE_MISSING" | "HASH_MISMATCH" | "DESTINATION_CONFLICT";

interface InternalCandidate {
  candidateId: string;
  restorationRequestId: string;
  issueType: IssueType;
  stagingKey: string;
  expectedSha256: string;
  expectedByteSize: number;
  observedSha256: string | null;
  observedByteSize: number | null;
  destinationSha256: string | null;
  destinationByteSize: number | null;
  originalDestinationExists: boolean;
}

export interface ShipmentApvInvoiceRestorationRemediationCandidate {
  candidateId: string;
  issueType: IssueType;
}

export interface ShipmentApvInvoiceRestorationRemediationRequest {
  id: string;
  client_request_id: string;
  candidate_fingerprint: string;
  issue_type: IssueType;
  requester_id: string;
  reason: string;
  status: "PENDING" | "APPLYING" | "APPROVED" | "REJECTED" | "EXPIRED";
  version: number;
  expires_at: string;
  approver_id?: string;
  decision_request_id?: string;
  decision?: "APPROVE" | "REJECT";
  decision_reason?: string;
  apply_error?: string;
  decided_at?: string;
  created_at: string;
}

function safePath(root: string, key: string) {
  const resolvedRoot = resolve(root);
  const candidate = resolve(resolvedRoot, key);
  if (!candidate.startsWith(`${resolvedRoot}${sep}`))
    throw new Error("APV_INVOICE_REMEDIATION_PATH_ESCAPE");
  return candidate;
}

async function hashRegularFile(path: string) {
  const metadata = await lstat(path);
  if (
    !metadata.isFile() ||
    metadata.isSymbolicLink() ||
    metadata.size < 1 ||
    metadata.size > 5 * 1024 * 1024
  ) {
    throw new Error("APV_INVOICE_REMEDIATION_INVALID_FILE");
  }
  const bytes = await readFile(path);
  return { sha256: createHash("sha256").update(bytes).digest("hex"), size: bytes.length };
}

function fingerprint(input: Omit<InternalCandidate, "candidateId">) {
  return createHash("sha256")
    .update(
      [
        input.restorationRequestId,
        input.issueType,
        input.expectedSha256,
        input.expectedByteSize,
        input.observedSha256 ?? "missing",
        input.observedByteSize ?? "missing",
        input.destinationSha256 ?? "missing",
        input.destinationByteSize ?? "missing",
        input.originalDestinationExists ? "destination" : "none",
      ].join(":"),
      "utf8",
    )
    .digest("hex");
}

async function inspectRow(
  root: string,
  row: Record<string, unknown>,
): Promise<InternalCandidate | null> {
  const restorationRequestId = String(row.restoration_request_id ?? row.id);
  const stagingKey = String(row.staging_key);
  const expectedSha256 = String(row.replacement_sha256);
  const expectedByteSize = Number(row.replacement_byte_size);
  let stagingPath: string;
  let originalDestinationPath: string;
  try {
    stagingPath = safePath(root, stagingKey);
    originalDestinationPath = safePath(
      root,
      join(".quarantine", restorationRequestId, `staged-${basename(stagingKey)}`),
    );
  } catch {
    return null;
  }
  let source: { sha256: string; size: number } | null = null;
  let destination: { sha256: string; size: number } | null = null;
  try {
    source = await hashRegularFile(stagingPath);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "ENOENT") return null;
  }
  try {
    destination = await hashRegularFile(originalDestinationPath);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "ENOENT") return null;
  }
  let issueType: IssueType | null = null;
  if (!source && !destination) issueType = "SOURCE_MISSING";
  else if (source && destination) issueType = "DESTINATION_CONFLICT";
  else if (source && (source.sha256 !== expectedSha256 || source.size !== expectedByteSize))
    issueType = "HASH_MISMATCH";
  if (!issueType) return null;
  const base = {
    restorationRequestId,
    issueType,
    stagingKey,
    expectedSha256,
    expectedByteSize,
    observedSha256: source?.sha256 ?? null,
    observedByteSize: source?.size ?? null,
    destinationSha256: destination?.sha256 ?? null,
    destinationByteSize: destination?.size ?? null,
    originalDestinationExists: Boolean(destination),
  };
  return { ...base, candidateId: fingerprint(base) };
}

async function internalCandidates(db: Pick<Database, "execute">, root: string) {
  const rows =
    (await db.execute(sql`SELECT id, staging_key, replacement_sha256, replacement_byte_size
    FROM shipment_apv_invoice_restoration_requests
    WHERE status IN ('REJECTED', 'EXPIRED') AND staging_status IN ('STAGED', 'MOVING')
    ORDER BY created_at ASC, id ASC LIMIT 1000`)) as unknown as Array<Record<string, unknown>>;
  const candidates = await Promise.all(rows.map((row) => inspectRow(root, row)));
  return candidates.filter((value): value is InternalCandidate => Boolean(value));
}

export async function listShipmentApvInvoiceRestorationRemediationCandidates(
  db: Database,
  storageRoot?: string,
) {
  const candidates = await internalCandidates(
    db,
    storageRoot ?? resolveShipmentInvoiceDocumentRoot(),
  );
  return {
    candidates: candidates.map((item) => ({
      candidateId: item.candidateId,
      issueType: item.issueType,
    })),
    truncated: candidates.length >= 1000,
  };
}

function mapRequest(row: Record<string, unknown>): ShipmentApvInvoiceRestorationRemediationRequest {
  return {
    id: String(row.id),
    client_request_id: String(row.client_request_id),
    candidate_fingerprint: String(row.candidate_fingerprint),
    issue_type: String(row.issue_type) as IssueType,
    requester_id: String(row.requester_id),
    reason: String(row.reason),
    status: String(row.status) as ShipmentApvInvoiceRestorationRemediationRequest["status"],
    version: Number(row.version),
    expires_at: new Date(String(row.expires_at)).toISOString(),
    approver_id: row.approver_id ? String(row.approver_id) : undefined,
    decision_request_id: row.decision_request_id ? String(row.decision_request_id) : undefined,
    decision: row.decision ? (String(row.decision) as "APPROVE" | "REJECT") : undefined,
    decision_reason: row.decision_reason ? String(row.decision_reason) : undefined,
    apply_error: row.apply_error ? String(row.apply_error) : undefined,
    decided_at: row.decided_at ? new Date(String(row.decided_at)).toISOString() : undefined,
    created_at: new Date(String(row.created_at)).toISOString(),
  };
}

function isUniqueViolation(error: unknown): boolean {
  if (!error || typeof error !== "object") return false;
  const value = error as { code?: unknown; cause?: unknown };
  return value.code === "23505" || isUniqueViolation(value.cause);
}

async function appendEvent(
  tx: Pick<Database, "execute">,
  input: {
    requestId: string;
    eventType: "REQUESTED" | "APPLYING" | "APPROVED" | "REJECTED" | "EXPIRED";
    actorId: string | null;
    version: number;
    now: Date;
    metadata?: Record<string, unknown>;
  },
) {
  await tx.execute(sql`INSERT INTO shipment_apv_invoice_restoration_remediation_events
    (id, request_id, event_type, actor_id, request_version, metadata, created_at)
    VALUES (${randomUUID()}::uuid, ${input.requestId}::uuid, ${input.eventType}, ${input.actorId}::uuid,
      ${input.version}, ${JSON.stringify(input.metadata ?? {})}::jsonb, ${input.now.toISOString()}::timestamptz)`);
}

export async function requestShipmentApvInvoiceRestorationRemediation(
  db: Database,
  input: {
    clientRequestId: string;
    candidateId: string;
    requesterId: string;
    reason: string;
    storageRoot?: string;
    now?: Date;
  },
) {
  if (
    !UUID_PATTERN.test(input.clientRequestId) ||
    !UUID_PATTERN.test(input.requesterId) ||
    !/^[0-9a-f]{64}$/.test(input.candidateId) ||
    input.reason.trim().length < 12 ||
    input.reason.length > 500
  ) {
    return { outcome: "invalid_request" } as const;
  }
  const now = input.now ?? new Date();
  const candidates = await internalCandidates(
    db,
    input.storageRoot ?? resolveShipmentInvoiceDocumentRoot(),
  );
  const candidate = candidates.find((item) => item.candidateId === input.candidateId);
  if (!candidate) return { outcome: "candidate_not_found" } as const;
  try {
    return await db.transaction(async (tx) => {
      await tx.execute(
        sql`SELECT pg_advisory_xact_lock(hashtextextended(${`apv-invoice-remediation:${input.clientRequestId}`}, 0))`,
      );
      const existingRows =
        (await tx.execute(sql`SELECT * FROM shipment_apv_invoice_restoration_remediation_requests
        WHERE client_request_id = ${input.clientRequestId}::uuid FOR UPDATE`)) as unknown as Array<
          Record<string, unknown>
        >;
      if (existingRows[0]) {
        const existing = mapRequest(existingRows[0]);
        if (
          existing.candidate_fingerprint !== input.candidateId ||
          existing.requester_id !== input.requesterId ||
          existing.reason !== input.reason.trim()
        )
          return { outcome: "request_conflict" } as const;
        return { outcome: "duplicate", request: existing } as const;
      }
      const rows =
        (await tx.execute(sql`INSERT INTO shipment_apv_invoice_restoration_remediation_requests
        (id, client_request_id, candidate_fingerprint, restoration_request_id, issue_type,
         observed_sha256, observed_byte_size, requester_id, reason, status, version, expires_at, created_at, updated_at)
        VALUES (${input.clientRequestId}::uuid, ${input.clientRequestId}::uuid, ${candidate.candidateId},
          ${candidate.restorationRequestId}::uuid, ${candidate.issueType}, ${candidate.observedSha256},
          ${candidate.observedByteSize}, ${input.requesterId}::uuid, ${input.reason.trim()}, 'PENDING', 0,
          ${now.toISOString()}::timestamptz + interval '30 minutes', ${now.toISOString()}::timestamptz,
          ${now.toISOString()}::timestamptz) RETURNING *`)) as unknown as Array<
          Record<string, unknown>
        >;
      const request = mapRequest(rows[0]!);
      await appendEvent(tx, {
        requestId: request.id,
        eventType: "REQUESTED",
        actorId: input.requesterId,
        version: 0,
        now,
        metadata: { issue_type: candidate.issueType, candidate_fingerprint: candidate.candidateId },
      });
      await tx.execute(sql`INSERT INTO admin_action_log (actor_id, action_type, target_type, target_id, payload, created_at)
        VALUES (${input.requesterId}::uuid, 'shipment.apv_invoice_restoration_remediation_request',
          'shipment_apv_invoice_restoration_remediation_request', ${request.id},
          jsonb_build_object('issue_type', ${candidate.issueType}::text,
            'candidate_fingerprint', ${candidate.candidateId}::text), ${now.toISOString()}::timestamptz)`);
      return { outcome: "requested", request } as const;
    });
  } catch (error) {
    if (isUniqueViolation(error)) return { outcome: "pending_conflict" } as const;
    throw error;
  }
}

interface JoinedRow extends Record<string, unknown> {
  restoration_request_id: string;
  staging_key: string;
}

export async function decideShipmentApvInvoiceRestorationRemediation(
  db: Database,
  input: {
    requestId: string;
    decisionRequestId: string;
    approverId: string;
    decision: "APPROVE" | "REJECT";
    reason: string;
    expectedVersion: number;
    storageRoot?: string;
    now?: Date;
  },
) {
  if (
    ![input.requestId, input.decisionRequestId, input.approverId].every((value) =>
      UUID_PATTERN.test(value),
    ) ||
    input.reason.trim().length < 12 ||
    input.reason.length > 500 ||
    input.expectedVersion < 0
  ) {
    return { outcome: "invalid_request" } as const;
  }
  const now = input.now ?? new Date();
  const root = input.storageRoot ?? resolveShipmentInvoiceDocumentRoot();
  let claimed: JoinedRow | null = null;
  try {
    const claim = await db.transaction(async (tx) => {
      const rows = (await tx.execute(sql`SELECT remediation.*, restoration.staging_key,
          restoration.replacement_sha256, restoration.replacement_byte_size
        FROM shipment_apv_invoice_restoration_remediation_requests remediation
        JOIN shipment_apv_invoice_restoration_requests restoration ON restoration.id = remediation.restoration_request_id
        WHERE remediation.id = ${input.requestId}::uuid FOR UPDATE OF remediation`)) as unknown as JoinedRow[];
      const row = rows[0];
      if (!row) return { outcome: "not_found" } as const;
      const request = mapRequest(row);
      const terminal = input.decision === "APPROVE" ? "APPROVED" : "REJECTED";
      if (
        request.status === terminal &&
        request.decision_request_id === input.decisionRequestId &&
        request.approver_id === input.approverId
      )
        return { outcome: "duplicate", request } as const;
      if (request.status === "APPLYING") {
        if (
          input.decision !== "APPROVE" ||
          request.decision_request_id !== input.decisionRequestId ||
          request.approver_id !== input.approverId
        )
          return { outcome: "invalid_state" } as const;
        claimed = row;
        return { outcome: "resume" } as const;
      }
      if (request.status !== "PENDING") return { outcome: "invalid_state" } as const;
      if (request.requester_id === input.approverId)
        return { outcome: "self_approval_forbidden" } as const;
      if (request.version !== input.expectedVersion)
        return { outcome: "version_conflict" } as const;
      if (now.getTime() >= new Date(request.expires_at).getTime()) {
        const expiredRows =
          (await tx.execute(sql`UPDATE shipment_apv_invoice_restoration_remediation_requests
          SET status='EXPIRED', decision_reason='Approval window expired', decided_at=${now.toISOString()}::timestamptz,
              updated_at=${now.toISOString()}::timestamptz, version=version+1
          WHERE id=${input.requestId}::uuid AND status='PENDING' RETURNING *`)) as unknown as Array<
            Record<string, unknown>
          >;
        const expired = mapRequest(expiredRows[0]!);
        await appendEvent(tx, {
          requestId: expired.id,
          eventType: "EXPIRED",
          actorId: null,
          version: expired.version,
          now,
        });
        return { outcome: "expired", request: expired } as const;
      }
      if (input.decision === "REJECT") {
        const rejectedRows =
          (await tx.execute(sql`UPDATE shipment_apv_invoice_restoration_remediation_requests
          SET status='REJECTED', approver_id=${input.approverId}::uuid, decision_request_id=${input.decisionRequestId}::uuid,
              decision='REJECT', decision_reason=${input.reason.trim()}, decided_at=${now.toISOString()}::timestamptz,
              updated_at=${now.toISOString()}::timestamptz, version=version+1
          WHERE id=${input.requestId}::uuid AND status='PENDING' RETURNING *`)) as unknown as Array<
            Record<string, unknown>
          >;
        const rejected = mapRequest(rejectedRows[0]!);
        await appendEvent(tx, {
          requestId: rejected.id,
          eventType: "REJECTED",
          actorId: input.approverId,
          version: rejected.version,
          now,
        });
        await tx.execute(sql`INSERT INTO admin_action_log (actor_id, action_type, target_type, target_id, payload, created_at)
          VALUES (${input.approverId}::uuid, 'shipment.apv_invoice_restoration_remediation_decision',
            'shipment_apv_invoice_restoration_remediation_request', ${rejected.id},
            jsonb_build_object('decision','REJECT','issue_type',${request.issue_type}::text),
            ${now.toISOString()}::timestamptz)`);
        return { outcome: "rejected", request: rejected } as const;
      }
      const applyingRows =
        (await tx.execute(sql`UPDATE shipment_apv_invoice_restoration_remediation_requests
        SET status='APPLYING', approver_id=${input.approverId}::uuid, decision_request_id=${input.decisionRequestId}::uuid,
            decision='APPROVE', decision_reason=${input.reason.trim()}, apply_error=NULL,
            updated_at=${now.toISOString()}::timestamptz, version=version+1
        WHERE id=${input.requestId}::uuid AND status='PENDING' AND version=${input.expectedVersion} RETURNING *`)) as unknown as JoinedRow[];
      if (!applyingRows[0]) return { outcome: "version_conflict" } as const;
      claimed = { ...row, ...applyingRows[0] };
      await appendEvent(tx, {
        requestId: input.requestId,
        eventType: "APPLYING",
        actorId: input.approverId,
        version: Number(applyingRows[0].version),
        now,
        metadata: { issue_type: request.issue_type },
      });
      return { outcome: "claimed" } as const;
    });
    if ("request" in claim || !["claimed", "resume"].includes(claim.outcome)) return claim;
    const row = claimed!;
    const issueType = String(row.issue_type) as IssueType;
    if (claim.outcome === "claimed") {
      const currentCandidate = await inspectRow(root, row);
      if (!currentCandidate || currentCandidate.candidateId !== String(row.candidate_fingerprint)) {
        await db.execute(sql`UPDATE shipment_apv_invoice_restoration_remediation_requests
          SET apply_error='APV_INVOICE_REMEDIATION_CANDIDATE_CHANGED', updated_at=${new Date().toISOString()}::timestamptz
          WHERE id=${input.requestId}::uuid AND status='APPLYING'`);
        return { outcome: "candidate_changed" } as const;
      }
    }
    const stagingPath = safePath(root, String(row.staging_key));
    const remediationPath = safePath(
      root,
      join(".quarantine", input.requestId, `conflict-${basename(String(row.staging_key))}`),
    );
    if (issueType === "SOURCE_MISSING") {
      try {
        await lstat(stagingPath);
        return { outcome: "candidate_changed" } as const;
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
      }
    } else {
      let source: { sha256: string; size: number } | null = null;
      let destination: { sha256: string; size: number } | null = null;
      try {
        source = await hashRegularFile(stagingPath);
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
      }
      try {
        destination = await hashRegularFile(remediationPath);
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
      }
      const expectedObserved = (value: { sha256: string; size: number } | null) =>
        Boolean(
          value &&
            value.sha256 === String(row.observed_sha256) &&
            value.size === Number(row.observed_byte_size),
        );
      if (
        (source && !expectedObserved(source)) ||
        (destination && !expectedObserved(destination)) ||
        (source && destination)
      ) {
        return { outcome: "candidate_changed" } as const;
      }
      if (!source && !destination) return { outcome: "candidate_changed" } as const;
      if (source) {
        await mkdir(dirname(remediationPath), { recursive: true, mode: 0o700 });
        await chmod(dirname(remediationPath), 0o700);
        await rename(stagingPath, remediationPath);
      }
    }
    return await db.transaction(async (tx) => {
      const remediationRows =
        (await tx.execute(sql`SELECT * FROM shipment_apv_invoice_restoration_remediation_requests
        WHERE id=${input.requestId}::uuid FOR UPDATE`)) as unknown as Array<
          Record<string, unknown>
        >;
      const current = remediationRows[0];
      if (
        current?.status !== "APPLYING" ||
        current.decision_request_id !== input.decisionRequestId ||
        current.approver_id !== input.approverId
      )
        throw new Error("APV_INVOICE_REMEDIATION_APPLY_STATE_LOST");
      const stagingStatus = issueType === "SOURCE_MISSING" ? "MISSING" : "CONFLICT_QUARANTINED";
      const restorationRows = (await tx.execute(sql`UPDATE shipment_apv_invoice_restoration_requests
        SET staging_status=${stagingStatus}, staging_disposed_at=${now.toISOString()}::timestamptz,
            updated_at=${now.toISOString()}::timestamptz, version=version+1
        WHERE id=${String(current.restoration_request_id)}::uuid AND status IN ('REJECTED','EXPIRED')
          AND staging_status IN ('STAGED','MOVING') RETURNING version`)) as unknown as Array<
        Record<string, unknown>
      >;
      if (!restorationRows[0]) throw new Error("APV_INVOICE_REMEDIATION_RESTORATION_STATE_CHANGED");
      await tx.execute(sql`INSERT INTO shipment_apv_invoice_restoration_events
        (id, request_id, event_type, actor_id, request_version, metadata, created_at)
        VALUES (${randomUUID()}::uuid, ${String(current.restoration_request_id)}::uuid, 'STAGING_REMEDIATED',
          ${input.approverId}::uuid, ${Number(restorationRows[0].version)},
          jsonb_build_object('issue_type', ${issueType}::text, 'disposition', ${stagingStatus}::text),
          ${now.toISOString()}::timestamptz)`);
      const approvedRows =
        (await tx.execute(sql`UPDATE shipment_apv_invoice_restoration_remediation_requests
        SET status='APPROVED', apply_error=NULL, decided_at=${now.toISOString()}::timestamptz,
            updated_at=${now.toISOString()}::timestamptz, version=version+1
        WHERE id=${input.requestId}::uuid AND status='APPLYING' RETURNING *`)) as unknown as Array<
          Record<string, unknown>
        >;
      const approved = mapRequest(approvedRows[0]!);
      await appendEvent(tx, {
        requestId: approved.id,
        eventType: "APPROVED",
        actorId: input.approverId,
        version: approved.version,
        now,
        metadata: { issue_type: issueType, disposition: stagingStatus },
      });
      await tx.execute(sql`INSERT INTO admin_action_log (actor_id, action_type, target_type, target_id, payload, created_at)
        VALUES (${input.approverId}::uuid, 'shipment.apv_invoice_restoration_remediation_decision',
          'shipment_apv_invoice_restoration_remediation_request', ${approved.id},
          jsonb_build_object('decision','APPROVE','issue_type',${issueType}::text,'disposition',${stagingStatus}::text),
          ${now.toISOString()}::timestamptz)`);
      return { outcome: "approved", request: approved } as const;
    });
  } catch (error) {
    if (isUniqueViolation(error)) return { outcome: "decision_conflict" } as const;
    if (claimed) {
      await db.execute(sql`UPDATE shipment_apv_invoice_restoration_remediation_requests
        SET apply_error='APV_INVOICE_REMEDIATION_APPLY_FAILED', updated_at=${new Date().toISOString()}::timestamptz
        WHERE id=${input.requestId}::uuid AND status='APPLYING'`);
      return { outcome: "apply_failed" } as const;
    }
    throw error;
  }
}

export async function listPendingShipmentApvInvoiceRestorationRemediations(db: Database) {
  const rows =
    (await db.execute(sql`SELECT * FROM shipment_apv_invoice_restoration_remediation_requests
    WHERE status IN ('PENDING','APPLYING') ORDER BY created_at ASC,id ASC LIMIT 100`)) as unknown as Array<
      Record<string, unknown>
    >;
  return rows.map(mapRequest);
}

export interface ShipmentApvInvoiceRestorationRemediationRecoveryItem {
  requestId: string;
  decisionRequestId: string;
  issueType: IssueType;
  version: number;
  stalledForSeconds: number;
  applyErrorCode:
    | "APV_INVOICE_REMEDIATION_CANDIDATE_CHANGED"
    | "APV_INVOICE_REMEDIATION_APPLY_FAILED"
    | null;
  updatedAt: string;
  acknowledged: boolean;
  incidentConnected: boolean;
  acknowledgedAt: string | null;
  incidentConnectedAt: string | null;
}

interface ShipmentApvInvoiceRestorationRemediationRecoveryCursor {
  asOf: string;
  updatedAt: string;
  id: string;
}

const REMEDIATION_RECOVERY_CURSOR_MAX_AGE_MS = 15 * 60_000;
const REMEDIATION_RECOVERY_CURSOR_CLOCK_SKEW_MS = 30_000;
export type ShipmentApvInvoiceRestorationRemediationRecoveryCursorRejectionReason =
  | "EXPIRED"
  | "INVALID";

export async function recordShipmentApvInvoiceRestorationRemediationRecoveryCursorRejection(
  db: Pick<Database, "execute">,
  input: {
    reason: ShipmentApvInvoiceRestorationRemediationRecoveryCursorRejectionReason;
    now?: Date;
  },
) {
  const now = input.now ?? new Date();
  await db.execute(sql`INSERT INTO shipment_apv_remediation_recovery_cursor_metrics
      (bucket_start, reason, rejection_count, last_seen_at)
    VALUES (date_trunc('hour', ${now.toISOString()}::timestamptz), ${input.reason}, 1,
      ${now.toISOString()}::timestamptz)
    ON CONFLICT (bucket_start, reason) DO UPDATE SET
      rejection_count = shipment_apv_remediation_recovery_cursor_metrics.rejection_count + 1,
      last_seen_at = GREATEST(
        shipment_apv_remediation_recovery_cursor_metrics.last_seen_at,
        EXCLUDED.last_seen_at)`);
}

export async function getShipmentApvInvoiceRestorationRemediationRecoveryCursorHealth(
  db: Pick<Database, "execute">,
  now = new Date(),
) {
  const rows = await db.execute(sql`SELECT
      least(coalesce(sum(rejection_count) FILTER (WHERE reason='EXPIRED'), 0), 2147483647)::int AS expired,
      least(coalesce(sum(rejection_count) FILTER (WHERE reason='INVALID'), 0), 2147483647)::int AS invalid,
      max(last_seen_at) AS last_seen_at
    FROM shipment_apv_remediation_recovery_cursor_metrics
    WHERE bucket_start >= date_trunc('hour', ${now.toISOString()}::timestamptz) - interval '23 hours'`);
  const row = rows[0] as Record<string, unknown> | undefined;
  const expired = Number(row?.expired ?? 0);
  const invalid = Number(row?.invalid ?? 0);
  return {
    windowHours: 24,
    expired,
    invalid,
    total: expired + invalid,
    lastSeenAt: row?.last_seen_at ? new Date(String(row.last_seen_at)).toISOString() : null,
    recordedAt: now.toISOString(),
  };
}

export async function maintainShipmentApvInvoiceRestorationRemediationRecoveryCursorMetrics(
  db: Pick<Database, "execute">,
  input: { retentionDays: number; limit: number; dryRun: boolean; now?: Date },
) {
  const now = input.now ?? new Date();
  const retentionDays =
    Number.isInteger(input.retentionDays) && input.retentionDays >= 7 && input.retentionDays <= 365
      ? input.retentionDays
      : 30;
  const limit =
    Number.isInteger(input.limit) && input.limit >= 1 && input.limit <= 1000 ? input.limit : 1000;
  const dryRun = input.dryRun === true;
  const cutoff = new Date(now.getTime() - retentionDays * 24 * 60 * 60_000);
  const resultRows = dryRun
    ? await db.execute(sql`SELECT reason
        FROM shipment_apv_remediation_recovery_cursor_metrics
        WHERE bucket_start < ${cutoff.toISOString()}::timestamptz
        ORDER BY bucket_start ASC, reason ASC
        LIMIT ${limit + 1}`)
    : await db.execute(sql`WITH candidates AS (
          SELECT bucket_start, reason
          FROM shipment_apv_remediation_recovery_cursor_metrics
          WHERE bucket_start < ${cutoff.toISOString()}::timestamptz
          ORDER BY bucket_start ASC, reason ASC
          FOR UPDATE SKIP LOCKED
          LIMIT ${limit}
        )
        DELETE FROM shipment_apv_remediation_recovery_cursor_metrics metric
        USING candidates
        WHERE metric.bucket_start=candidates.bucket_start AND metric.reason=candidates.reason
        RETURNING metric.reason`);
  const rows = (resultRows as unknown as Array<Record<string, unknown>>).slice(0, limit);
  const expiredBuckets = rows.filter((row) => row.reason === "EXPIRED").length;
  const invalidBuckets = rows.filter((row) => row.reason === "INVALID").length;
  return {
    dryRun,
    retentionDays,
    limit,
    eligibleBuckets: dryRun ? rows.length : undefined,
    deletedBuckets: dryRun ? undefined : rows.length,
    expiredBuckets,
    invalidBuckets,
    truncated: dryRun ? resultRows.length > limit : rows.length === limit,
    cutoffAt: cutoff.toISOString(),
    recordedAt: now.toISOString(),
  };
}

function decodeRemediationRecoveryCursor(
  value: string,
): ShipmentApvInvoiceRestorationRemediationRecoveryCursor {
  try {
    if (value.length < 1 || value.length > 512 || !/^[A-Za-z0-9_-]+$/.test(value)) {
      throw new Error("invalid cursor encoding");
    }
    const decoded = Buffer.from(value, "base64url").toString("utf8");
    if (Buffer.byteLength(decoded, "utf8") > 256) throw new Error("cursor payload too large");
    const parsed = JSON.parse(decoded) as Record<string, unknown>;
    const keys = Object.keys(parsed).sort();
    if (
      keys.join(",") !== "asOf,id,updatedAt" ||
      typeof parsed.asOf !== "string" ||
      typeof parsed.updatedAt !== "string" ||
      typeof parsed.id !== "string" ||
      !UUID_PATTERN.test(parsed.id) ||
      !Number.isFinite(Date.parse(parsed.asOf)) ||
      !Number.isFinite(Date.parse(parsed.updatedAt))
    ) {
      throw new Error("invalid cursor payload");
    }
    const asOf = new Date(parsed.asOf).toISOString();
    const updatedAt = new Date(parsed.updatedAt).toISOString();
    if (updatedAt > asOf) throw new Error("invalid cursor order");
    return { asOf, updatedAt, id: parsed.id };
  } catch {
    throw new Error("INVALID_APV_INVOICE_RESTORATION_REMEDIATION_RECOVERY_CURSOR");
  }
}

function encodeRemediationRecoveryCursor(
  cursor: ShipmentApvInvoiceRestorationRemediationRecoveryCursor,
): string {
  return Buffer.from(JSON.stringify(cursor), "utf8").toString("base64url");
}

export async function listStaleShipmentApvInvoiceRestorationRemediationRecoveries(
  db: Pick<Database, "execute">,
  input: { approverId: string; now?: Date; limit?: number; cursor?: string },
) {
  const cursor = input.cursor ? decodeRemediationRecoveryCursor(input.cursor) : null;
  const requestedAt = input.now ?? new Date();
  if (cursor) {
    const cursorAgeMs = requestedAt.getTime() - new Date(cursor.asOf).getTime();
    if (cursorAgeMs > REMEDIATION_RECOVERY_CURSOR_MAX_AGE_MS) {
      throw new Error("INVALID_APV_INVOICE_RESTORATION_REMEDIATION_RECOVERY_CURSOR_EXPIRED");
    }
    if (cursorAgeMs < -REMEDIATION_RECOVERY_CURSOR_CLOCK_SKEW_MS) {
      throw new Error("INVALID_APV_INVOICE_RESTORATION_REMEDIATION_RECOVERY_CURSOR");
    }
  }
  const now = cursor ? new Date(cursor.asOf) : requestedAt;
  if (!UUID_PATTERN.test(input.approverId)) {
    return { items: [], truncated: false, nextCursor: null, recordedAt: now.toISOString() };
  }
  const limit =
    Number.isInteger(input.limit) && input.limit! >= 1 && input.limit! <= 100 ? input.limit! : 20;
  const cursorClause = cursor
    ? sql`AND (
      remediation.updated_at > ${cursor.updatedAt}::timestamptz
      OR (remediation.updated_at = ${cursor.updatedAt}::timestamptz AND remediation.id > ${cursor.id}::uuid)
    )`
    : sql``;
  const rows = (await db.execute(sql`SELECT remediation.id, remediation.decision_request_id,
      remediation.issue_type, remediation.version, remediation.updated_at,
      CASE WHEN apply_error IN ('APV_INVOICE_REMEDIATION_CANDIDATE_CHANGED',
        'APV_INVOICE_REMEDIATION_APPLY_FAILED') THEN apply_error ELSE NULL END AS apply_error,
      EXISTS (SELECT 1 FROM shipment_apv_invoice_restoration_remediation_acknowledgments acknowledgment
        WHERE acknowledgment.remediation_request_id=remediation.id
          AND acknowledgment.checker_id=remediation.approver_id
          AND acknowledgment.request_version=remediation.version
          AND acknowledgment.action='ACKNOWLEDGED') AS acknowledged,
      EXISTS (SELECT 1 FROM shipment_apv_invoice_restoration_remediation_acknowledgments acknowledgment
        WHERE acknowledgment.remediation_request_id=remediation.id
          AND acknowledgment.checker_id=remediation.approver_id
          AND acknowledgment.request_version=remediation.version
          AND acknowledgment.action='INCIDENT_LINKED') AS incident_connected,
      (SELECT MAX(created_at) FROM shipment_apv_invoice_restoration_remediation_acknowledgments acknowledgment
        WHERE acknowledgment.remediation_request_id=remediation.id
          AND acknowledgment.checker_id=remediation.approver_id
          AND acknowledgment.request_version=remediation.version
          AND acknowledgment.action='ACKNOWLEDGED') AS acknowledged_at,
      (SELECT MAX(created_at) FROM shipment_apv_invoice_restoration_remediation_acknowledgments acknowledgment
        WHERE acknowledgment.remediation_request_id=remediation.id
          AND acknowledgment.checker_id=remediation.approver_id
          AND acknowledgment.request_version=remediation.version
          AND acknowledgment.action='INCIDENT_LINKED') AS incident_connected_at
    FROM shipment_apv_invoice_restoration_remediation_requests remediation
    WHERE remediation.status='APPLYING' AND remediation.approver_id=${input.approverId}::uuid
      AND remediation.decision_request_id IS NOT NULL
      AND remediation.updated_at <= ${now.toISOString()}::timestamptz - interval '5 minutes'
      ${cursorClause}
    ORDER BY remediation.updated_at ASC,remediation.id ASC LIMIT ${limit + 1}`)) as unknown as Array<
    Record<string, unknown>
  >;
  const hasMore = rows.length > limit;
  const pageRows = hasMore ? rows.slice(0, limit) : rows;
  const items = pageRows.map(
    (row): ShipmentApvInvoiceRestorationRemediationRecoveryItem => ({
      requestId: String(row.id),
      decisionRequestId: String(row.decision_request_id),
      issueType: String(row.issue_type) as IssueType,
      version: Number(row.version),
      stalledForSeconds: Math.max(
        300,
        Math.floor((now.getTime() - new Date(String(row.updated_at)).getTime()) / 1000),
      ),
      applyErrorCode: row.apply_error
        ? (String(
            row.apply_error,
          ) as ShipmentApvInvoiceRestorationRemediationRecoveryItem["applyErrorCode"])
        : null,
      updatedAt: new Date(String(row.updated_at)).toISOString(),
      acknowledged: row.acknowledged === true,
      incidentConnected: row.incident_connected === true,
      acknowledgedAt: row.acknowledged_at
        ? new Date(String(row.acknowledged_at)).toISOString()
        : null,
      incidentConnectedAt: row.incident_connected_at
        ? new Date(String(row.incident_connected_at)).toISOString()
        : null,
    }),
  );
  const last = items.at(-1);
  return {
    items,
    truncated: hasMore,
    nextCursor:
      hasMore && last
        ? encodeRemediationRecoveryCursor({
            asOf: now.toISOString(),
            updatedAt: last.updatedAt,
            id: last.requestId,
          })
        : null,
    recordedAt: now.toISOString(),
  };
}

type RecoveryAction = "ACKNOWLEDGED" | "INCIDENT_LINKED";

export interface ShipmentApvInvoiceRestorationRemediationAcknowledgment {
  id: string;
  action: RecoveryAction;
  requestVersion: number;
  incidentReferenceBound: boolean;
  createdAt: string;
}

function mapAcknowledgment(
  row: Record<string, unknown>,
): ShipmentApvInvoiceRestorationRemediationAcknowledgment {
  return {
    id: String(row.id),
    action: String(row.action) as RecoveryAction,
    requestVersion: Number(row.request_version),
    incidentReferenceBound: Boolean(row.incident_reference_hash),
    createdAt: new Date(String(row.created_at)).toISOString(),
  };
}

export async function recordShipmentApvInvoiceRestorationRemediationAcknowledgment(
  db: Database,
  input: {
    requestId: string;
    clientRequestId: string;
    decisionRequestId: string;
    checkerId: string;
    action: RecoveryAction;
    expectedVersion: number;
    incidentReference?: string;
    now?: Date;
  },
) {
  const incidentReference = input.incidentReference?.trim();
  const incidentReferenceValid =
    input.action === "INCIDENT_LINKED"
      ? Boolean(
          incidentReference &&
            incidentReference.length >= 4 &&
            incidentReference.length <= 128 &&
            /^[\x20-\x7e]+$/.test(incidentReference),
        )
      : incidentReference === undefined;
  if (
    ![input.requestId, input.clientRequestId, input.decisionRequestId, input.checkerId].every(
      (value) => UUID_PATTERN.test(value),
    ) ||
    !["ACKNOWLEDGED", "INCIDENT_LINKED"].includes(input.action) ||
    !Number.isInteger(input.expectedVersion) ||
    input.expectedVersion < 1 ||
    !incidentReferenceValid
  ) {
    return { outcome: "invalid_request" } as const;
  }
  const now = input.now ?? new Date();
  const incidentReferenceHash = incidentReference
    ? createHash("sha256").update(incidentReference, "utf8").digest("hex")
    : null;
  try {
    return await db.transaction(async (tx) => {
      await tx.execute(sql`SELECT pg_advisory_xact_lock(hashtextextended(
        ${`apv-invoice-remediation-ack:${input.clientRequestId}`}, 0))`);
      const replayRows = (await tx.execute(sql`SELECT *
        FROM shipment_apv_invoice_restoration_remediation_acknowledgments
        WHERE client_request_id=${input.clientRequestId}::uuid FOR UPDATE`)) as unknown as Array<
        Record<string, unknown>
      >;
      if (replayRows[0]) {
        const replay = replayRows[0];
        if (
          String(replay.remediation_request_id) !== input.requestId ||
          String(replay.checker_id) !== input.checkerId ||
          String(replay.decision_request_id) !== input.decisionRequestId ||
          Number(replay.request_version) !== input.expectedVersion ||
          String(replay.action) !== input.action ||
          (replay.incident_reference_hash ? String(replay.incident_reference_hash) : null) !==
            incidentReferenceHash
        ) {
          return { outcome: "request_conflict" } as const;
        }
        return { outcome: "duplicate", acknowledgment: mapAcknowledgment(replay) } as const;
      }
      const remediationRows =
        (await tx.execute(sql`SELECT id,status,approver_id,decision_request_id,version,updated_at
        FROM shipment_apv_invoice_restoration_remediation_requests
        WHERE id=${input.requestId}::uuid FOR UPDATE`)) as unknown as Array<
          Record<string, unknown>
        >;
      const remediation = remediationRows[0];
      if (!remediation) return { outcome: "not_found" } as const;
      if (
        String(remediation.status) !== "APPLYING" ||
        String(remediation.approver_id) !== input.checkerId ||
        String(remediation.decision_request_id) !== input.decisionRequestId ||
        Number(remediation.version) !== input.expectedVersion
      )
        return { outcome: "invalid_state" } as const;
      if (new Date(String(remediation.updated_at)).getTime() > now.getTime() - 60 * 60_000) {
        return { outcome: "not_stale_enough" } as const;
      }
      if (input.action === "INCIDENT_LINKED") {
        const acknowledgmentRows = (await tx.execute(sql`SELECT 1
          FROM shipment_apv_invoice_restoration_remediation_acknowledgments
          WHERE remediation_request_id=${input.requestId}::uuid AND checker_id=${input.checkerId}::uuid
            AND decision_request_id=${input.decisionRequestId}::uuid
            AND request_version=${input.expectedVersion} AND action='ACKNOWLEDGED'
          LIMIT 1`)) as unknown as Array<Record<string, unknown>>;
        if (!acknowledgmentRows[0]) return { outcome: "acknowledgment_required" } as const;
      }
      const existingRows = (await tx.execute(sql`SELECT *
        FROM shipment_apv_invoice_restoration_remediation_acknowledgments
        WHERE remediation_request_id=${input.requestId}::uuid AND checker_id=${input.checkerId}::uuid
          AND request_version=${input.expectedVersion} AND action=${input.action}
        FOR UPDATE`)) as unknown as Array<Record<string, unknown>>;
      if (existingRows[0]) {
        const existingHash = existingRows[0].incident_reference_hash
          ? String(existingRows[0].incident_reference_hash)
          : null;
        if (existingHash !== incidentReferenceHash)
          return { outcome: "incident_conflict" } as const;
        return {
          outcome: "already_recorded",
          acknowledgment: mapAcknowledgment(existingRows[0]),
        } as const;
      }
      const rows =
        (await tx.execute(sql`INSERT INTO shipment_apv_invoice_restoration_remediation_acknowledgments
        (id,client_request_id,remediation_request_id,checker_id,decision_request_id,request_version,
          action,incident_reference_hash,created_at)
        VALUES (${randomUUID()}::uuid,${input.clientRequestId}::uuid,${input.requestId}::uuid,
          ${input.checkerId}::uuid,${input.decisionRequestId}::uuid,${input.expectedVersion},
          ${input.action},${incidentReferenceHash},${now.toISOString()}::timestamptz) RETURNING *`)) as unknown as Array<
          Record<string, unknown>
        >;
      await tx.execute(sql`INSERT INTO admin_action_log
        (actor_id,action_type,target_type,target_id,payload,created_at)
        VALUES (${input.checkerId}::uuid,'shipment.apv_invoice_restoration_remediation_recovery_ack',
          'shipment_apv_invoice_restoration_remediation_request',${input.requestId},
          jsonb_build_object('action',${input.action}::text,'request_version',${input.expectedVersion}::integer,
            'incident_reference_bound',${Boolean(incidentReferenceHash)}::boolean),
          ${now.toISOString()}::timestamptz)`);
      return { outcome: "recorded", acknowledgment: mapAcknowledgment(rows[0]!) } as const;
    });
  } catch (error) {
    if (isUniqueViolation(error)) return { outcome: "action_conflict" } as const;
    throw error;
  }
}

export interface ShipmentApvInvoiceRestorationRemediationHealth {
  status: "healthy" | "warning" | "critical";
  pendingRequests: number;
  applyingRequests: number;
  expiringSoonRequests: number;
  overduePendingRequests: number;
  staleApplyingRequests: number;
  staleApplyingOver15Minutes: number;
  staleApplyingOver60Minutes: number;
  unacknowledgedStaleOver60Minutes: number;
  incidentUnlinkedStaleOver60Minutes: number;
  acknowledgedStillApplyingOver30Minutes: number;
  incidentLinkedStillApplyingOver30Minutes: number;
  incidentLinkOverdueAfterAcknowledgment: number;
  oldestPendingAgeSeconds: number | null;
  oldestApplyingAgeSeconds: number | null;
  staleApplyingAgeBucket: "none" | "5m" | "15m" | "60m";
  recordedAt: string;
}

export async function getShipmentApvInvoiceRestorationRemediationHealth(
  db: Pick<Database, "execute">,
  now = new Date(),
): Promise<ShipmentApvInvoiceRestorationRemediationHealth> {
  const rows = (await db.execute(sql`SELECT
      COUNT(*) FILTER (WHERE remediation.status='PENDING')::int AS pending_requests,
      COUNT(*) FILTER (WHERE remediation.status='APPLYING')::int AS applying_requests,
      COUNT(*) FILTER (WHERE remediation.status='PENDING'
        AND remediation.expires_at > ${now.toISOString()}::timestamptz
        AND remediation.expires_at <= ${now.toISOString()}::timestamptz + interval '5 minutes')::int AS expiring_soon_requests,
      COUNT(*) FILTER (WHERE remediation.status='PENDING'
        AND remediation.expires_at <= ${now.toISOString()}::timestamptz)::int AS overdue_pending_requests,
      COUNT(*) FILTER (WHERE remediation.status='APPLYING'
        AND remediation.updated_at <= ${now.toISOString()}::timestamptz - interval '5 minutes')::int AS stale_applying_requests,
      COUNT(*) FILTER (WHERE remediation.status='APPLYING'
        AND remediation.updated_at <= ${now.toISOString()}::timestamptz - interval '15 minutes')::int AS stale_applying_over_15_minutes,
      COUNT(*) FILTER (WHERE remediation.status='APPLYING'
        AND remediation.updated_at <= ${now.toISOString()}::timestamptz - interval '60 minutes')::int AS stale_applying_over_60_minutes,
      COUNT(*) FILTER (WHERE remediation.status='APPLYING'
        AND remediation.updated_at <= ${now.toISOString()}::timestamptz - interval '60 minutes'
        AND NOT EXISTS (SELECT 1
          FROM shipment_apv_invoice_restoration_remediation_acknowledgments acknowledgment
          WHERE acknowledgment.remediation_request_id=remediation.id
            AND acknowledgment.checker_id=remediation.approver_id
            AND acknowledgment.decision_request_id=remediation.decision_request_id
            AND acknowledgment.request_version=remediation.version
            AND acknowledgment.action='ACKNOWLEDGED'))::int AS unacknowledged_stale_over_60_minutes,
      COUNT(*) FILTER (WHERE remediation.status='APPLYING'
        AND remediation.updated_at <= ${now.toISOString()}::timestamptz - interval '60 minutes'
        AND NOT EXISTS (SELECT 1
          FROM shipment_apv_invoice_restoration_remediation_acknowledgments acknowledgment
          WHERE acknowledgment.remediation_request_id=remediation.id
            AND acknowledgment.checker_id=remediation.approver_id
            AND acknowledgment.decision_request_id=remediation.decision_request_id
            AND acknowledgment.request_version=remediation.version
            AND acknowledgment.action='INCIDENT_LINKED'))::int AS incident_unlinked_stale_over_60_minutes,
      COUNT(*) FILTER (WHERE remediation.status='APPLYING'
        AND EXISTS (SELECT 1
          FROM shipment_apv_invoice_restoration_remediation_acknowledgments acknowledgment
          WHERE acknowledgment.remediation_request_id=remediation.id
            AND acknowledgment.checker_id=remediation.approver_id
            AND acknowledgment.decision_request_id=remediation.decision_request_id
            AND acknowledgment.request_version=remediation.version
            AND acknowledgment.action='ACKNOWLEDGED'
            AND acknowledgment.created_at <= ${now.toISOString()}::timestamptz - interval '30 minutes'))::int
        AS acknowledged_still_applying_over_30_minutes,
      COUNT(*) FILTER (WHERE remediation.status='APPLYING'
        AND EXISTS (SELECT 1
          FROM shipment_apv_invoice_restoration_remediation_acknowledgments acknowledgment
          WHERE acknowledgment.remediation_request_id=remediation.id
            AND acknowledgment.checker_id=remediation.approver_id
            AND acknowledgment.decision_request_id=remediation.decision_request_id
            AND acknowledgment.request_version=remediation.version
            AND acknowledgment.action='INCIDENT_LINKED'
            AND acknowledgment.created_at <= ${now.toISOString()}::timestamptz - interval '30 minutes'))::int
        AS incident_linked_still_applying_over_30_minutes,
      COUNT(*) FILTER (WHERE remediation.status='APPLYING'
        AND EXISTS (SELECT 1
          FROM shipment_apv_invoice_restoration_remediation_acknowledgments acknowledgment
          WHERE acknowledgment.remediation_request_id=remediation.id
            AND acknowledgment.checker_id=remediation.approver_id
            AND acknowledgment.decision_request_id=remediation.decision_request_id
            AND acknowledgment.request_version=remediation.version
            AND acknowledgment.action='ACKNOWLEDGED'
            AND acknowledgment.created_at <= ${now.toISOString()}::timestamptz - interval '15 minutes')
        AND NOT EXISTS (SELECT 1
          FROM shipment_apv_invoice_restoration_remediation_acknowledgments acknowledgment
          WHERE acknowledgment.remediation_request_id=remediation.id
            AND acknowledgment.checker_id=remediation.approver_id
            AND acknowledgment.decision_request_id=remediation.decision_request_id
            AND acknowledgment.request_version=remediation.version
            AND acknowledgment.action='INCIDENT_LINKED'))::int AS incident_link_overdue_after_acknowledgment,
      EXTRACT(EPOCH FROM (${now.toISOString()}::timestamptz - MIN(remediation.created_at)
        FILTER (WHERE remediation.status='PENDING')))::int AS oldest_pending_age_seconds,
      EXTRACT(EPOCH FROM (${now.toISOString()}::timestamptz - MIN(remediation.updated_at)
        FILTER (WHERE remediation.status='APPLYING')))::int AS oldest_applying_age_seconds
    FROM shipment_apv_invoice_restoration_remediation_requests remediation
    WHERE remediation.status IN ('PENDING','APPLYING')`)) as unknown as Array<
    Record<string, unknown>
  >;
  const row = rows[0] ?? {};
  const health = {
    pendingRequests: Number(row.pending_requests ?? 0),
    applyingRequests: Number(row.applying_requests ?? 0),
    expiringSoonRequests: Number(row.expiring_soon_requests ?? 0),
    overduePendingRequests: Number(row.overdue_pending_requests ?? 0),
    staleApplyingRequests: Number(row.stale_applying_requests ?? 0),
    staleApplyingOver15Minutes: Number(row.stale_applying_over_15_minutes ?? 0),
    staleApplyingOver60Minutes: Number(row.stale_applying_over_60_minutes ?? 0),
    unacknowledgedStaleOver60Minutes: Number(row.unacknowledged_stale_over_60_minutes ?? 0),
    incidentUnlinkedStaleOver60Minutes: Number(row.incident_unlinked_stale_over_60_minutes ?? 0),
    acknowledgedStillApplyingOver30Minutes: Number(
      row.acknowledged_still_applying_over_30_minutes ?? 0,
    ),
    incidentLinkedStillApplyingOver30Minutes: Number(
      row.incident_linked_still_applying_over_30_minutes ?? 0,
    ),
    incidentLinkOverdueAfterAcknowledgment: Number(
      row.incident_link_overdue_after_acknowledgment ?? 0,
    ),
    oldestPendingAgeSeconds:
      row.oldest_pending_age_seconds == null
        ? null
        : Math.max(0, Number(row.oldest_pending_age_seconds)),
    oldestApplyingAgeSeconds:
      row.oldest_applying_age_seconds == null
        ? null
        : Math.max(0, Number(row.oldest_applying_age_seconds)),
  };
  const staleApplyingAgeBucket =
    health.oldestApplyingAgeSeconds === null
      ? "none"
      : health.oldestApplyingAgeSeconds >= 60 * 60
        ? "60m"
        : health.oldestApplyingAgeSeconds >= 15 * 60
          ? "15m"
          : health.oldestApplyingAgeSeconds >= 5 * 60
            ? "5m"
            : "none";
  return {
    status:
      health.overduePendingRequests ||
      health.staleApplyingRequests ||
      health.unacknowledgedStaleOver60Minutes ||
      health.incidentUnlinkedStaleOver60Minutes ||
      health.acknowledgedStillApplyingOver30Minutes ||
      health.incidentLinkedStillApplyingOver30Minutes ||
      health.incidentLinkOverdueAfterAcknowledgment
        ? "critical"
        : health.expiringSoonRequests
          ? "warning"
          : "healthy",
    ...health,
    staleApplyingAgeBucket,
    recordedAt: now.toISOString(),
  };
}

export async function expireShipmentApvInvoiceRestorationRemediations(
  db: Database,
  options: {
    now?: Date;
    limit?: number;
  } = {},
) {
  const now = options.now ?? new Date();
  const limit =
    Number.isInteger(options.limit) && options.limit! >= 1 && options.limit! <= 1000
      ? options.limit!
      : 100;
  return db.transaction(async (tx) => {
    const rows =
      (await tx.execute(sql`SELECT id FROM shipment_apv_invoice_restoration_remediation_requests
      WHERE status='PENDING' AND expires_at <= ${now.toISOString()}::timestamptz
      ORDER BY expires_at ASC,id ASC FOR UPDATE SKIP LOCKED LIMIT ${limit}`)) as unknown as Array<
        Record<string, unknown>
      >;
    for (const row of rows) {
      const updated =
        (await tx.execute(sql`UPDATE shipment_apv_invoice_restoration_remediation_requests
        SET status='EXPIRED', decision_reason='Approval window expired', decided_at=${now.toISOString()}::timestamptz,
            updated_at=${now.toISOString()}::timestamptz, version=version+1
        WHERE id=${String(row.id)}::uuid AND status='PENDING' RETURNING version`)) as unknown as Array<
          Record<string, unknown>
        >;
      if (updated[0])
        await appendEvent(tx, {
          requestId: String(row.id),
          eventType: "EXPIRED",
          actorId: null,
          version: Number(updated[0].version),
          now,
        });
    }
    return {
      scanned: rows.length,
      expired: rows.length,
      limit,
      truncated: rows.length === limit,
      recordedAt: now.toISOString(),
    };
  });
}

export async function getShipmentApvInvoiceRestorationRemediationTimeline(
  db: Database,
  requestId: string,
) {
  if (!UUID_PATTERN.test(requestId)) return null;
  const rows =
    (await db.execute(sql`SELECT * FROM shipment_apv_invoice_restoration_remediation_requests
    WHERE id=${requestId}::uuid LIMIT 1`)) as unknown as Array<Record<string, unknown>>;
  if (!rows[0]) return null;
  const events =
    (await db.execute(sql`SELECT id,event_type,actor_id,request_version,metadata,created_at
    FROM shipment_apv_invoice_restoration_remediation_events WHERE request_id=${requestId}::uuid
    ORDER BY request_version ASC,created_at ASC,id ASC`)) as unknown as Array<
      Record<string, unknown>
    >;
  return {
    request: mapRequest(rows[0]),
    events: events.map((row) => ({
      id: String(row.id),
      event_type: String(row.event_type),
      actor_id: row.actor_id ? String(row.actor_id) : null,
      request_version: Number(row.request_version),
      metadata: row.metadata ?? {},
      created_at: new Date(String(row.created_at)).toISOString(),
    })),
  };
}

export async function deleteShipmentApvInvoiceRestorationRemediationFixtureRows(
  db: Database,
  requestIds: string[],
) {
  if (!requestIds.length) return { acknowledgments: 0, events: 0, requests: 0 };
  const ids = sql.join(
    requestIds.map((id) => sql`${id}::uuid`),
    sql`, `,
  );
  const acknowledgments =
    (await db.execute(sql`DELETE FROM shipment_apv_invoice_restoration_remediation_acknowledgments
    WHERE remediation_request_id=ANY(ARRAY[${ids}]) RETURNING id`)) as unknown as unknown[];
  const events =
    (await db.execute(sql`DELETE FROM shipment_apv_invoice_restoration_remediation_events
    WHERE request_id=ANY(ARRAY[${ids}]) RETURNING id`)) as unknown as unknown[];
  const requests =
    (await db.execute(sql`DELETE FROM shipment_apv_invoice_restoration_remediation_requests
    WHERE id=ANY(ARRAY[${ids}]) RETURNING id`)) as unknown as unknown[];
  return {
    acknowledgments: acknowledgments.length,
    events: events.length,
    requests: requests.length,
  };
}
