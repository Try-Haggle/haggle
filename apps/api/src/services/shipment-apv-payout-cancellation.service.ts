import { createHash, randomUUID } from "node:crypto";
import { type Database, sql } from "@haggle/db";
import { cancelExpiredShipmentApvPayoutOffsetInTransaction } from "./shipment-apv-payout-offset.service.js";

export interface ShipmentApvPayoutCancellationRequestRecord {
  id: string;
  client_request_id: string;
  payout_offset_id: string;
  settlement_release_id: string;
  requester_id: string;
  reason: string;
  status: "PENDING" | "APPROVED" | "REJECTED" | "EXPIRED";
  version: number;
  expires_at: string;
  approver_id?: string;
  decision_request_id?: string;
  decision_reason?: string;
  onchain_state?: string;
  decided_at?: string;
  created_at: string;
}

export interface ShipmentApvPayoutCancellationApprovalHealth {
  status: "healthy" | "attention";
  pendingRequests: number;
  expiringSoonRequests: number;
  oldestPendingAgeSeconds: number | null;
  recordedAt: string;
}

export interface ShipmentApvPayoutCancellationEventRecord {
  id: string;
  cancellation_request_id: string;
  event_type: "REQUESTED" | "APPROVED" | "REJECTED" | "EXPIRED";
  actor_id: string | null;
  request_version: number;
  metadata: Record<string, unknown>;
  previous_event_hash: string | null;
  event_hash: string | null;
  created_at: string;
}

export function canonicalShipmentApvCancellationAuditJson(value: unknown): string {
  if (value === undefined) return "null";
  if (value === null || typeof value !== "object") return JSON.stringify(value);
  if (value instanceof Date) return JSON.stringify(value.toISOString());
  if (Array.isArray(value))
    return `[${value.map(canonicalShipmentApvCancellationAuditJson).join(",")}]`;
  const record = value as Record<string, unknown>;
  return `{${Object.keys(record)
    .sort()
    .map(
      (key) => `${JSON.stringify(key)}:${canonicalShipmentApvCancellationAuditJson(record[key])}`,
    )
    .join(",")}}`;
}

function canonicalLifecycleEvent(
  event: ShipmentApvPayoutCancellationEventRecord,
  previousEventHash: string | null,
) {
  return {
    id: event.id,
    cancellation_request_id: event.cancellation_request_id,
    event_type: event.event_type,
    actor_id: event.actor_id,
    request_version: event.request_version,
    metadata: event.metadata,
    created_at: event.created_at,
    previous_event_hash: previousEventHash,
  };
}

export function buildShipmentApvCancellationEventHash(
  event: ShipmentApvPayoutCancellationEventRecord,
  previousEventHash: string | null,
) {
  return createHash("sha256")
    .update(
      canonicalShipmentApvCancellationAuditJson(canonicalLifecycleEvent(event, previousEventHash)),
    )
    .digest("hex");
}

function legacyShipmentApvCancellationEventAnchor(event: ShipmentApvPayoutCancellationEventRecord) {
  return createHash("sha256")
    .update(
      `legacy:${canonicalShipmentApvCancellationAuditJson(canonicalLifecycleEvent(event, null))}`,
    )
    .digest("hex");
}

export function verifyShipmentApvCancellationEventChain(
  events: ShipmentApvPayoutCancellationEventRecord[],
) {
  let valid = true;
  let legacyUnsealedEvents = 0;
  let previousEffectiveHash: string | null = null;
  for (const event of events) {
    const effectiveHash = event.event_hash ?? legacyShipmentApvCancellationEventAnchor(event);
    if (!event.event_hash) {
      legacyUnsealedEvents += 1;
    } else {
      if (
        event.event_hash !== buildShipmentApvCancellationEventHash(event, event.previous_event_hash)
      )
        valid = false;
      if (previousEffectiveHash !== event.previous_event_hash) valid = false;
    }
    previousEffectiveHash = effectiveHash;
  }
  return {
    valid,
    complete: legacyUnsealedEvents === 0,
    sealedEvents: events.length - legacyUnsealedEvents,
    legacyUnsealedEvents,
    headEventHash: previousEffectiveHash,
  };
}

function mapLifecycleEvent(row: Record<string, unknown>): ShipmentApvPayoutCancellationEventRecord {
  return {
    id: String(row.id),
    cancellation_request_id: String(row.cancellation_request_id),
    event_type: String(row.event_type) as ShipmentApvPayoutCancellationEventRecord["event_type"],
    actor_id: row.actor_id ? String(row.actor_id) : null,
    request_version: Number(row.request_version),
    metadata:
      row.metadata && typeof row.metadata === "object" && !Array.isArray(row.metadata)
        ? (row.metadata as Record<string, unknown>)
        : {},
    previous_event_hash: row.previous_event_hash ? String(row.previous_event_hash) : null,
    event_hash: row.event_hash ? String(row.event_hash) : null,
    created_at: new Date(String(row.created_at)).toISOString(),
  };
}

async function appendLifecycleEvent(
  tx: Pick<Database, "execute">,
  input: {
    cancellationRequestId: string;
    eventType: ShipmentApvPayoutCancellationEventRecord["event_type"];
    actorId: string | null;
    requestVersion: number;
    metadata: Record<string, unknown>;
    createdAt: Date;
  },
) {
  const latestRows = (await tx.execute(sql`
    SELECT * FROM shipment_apv_payout_cancellation_events
     WHERE cancellation_request_id = ${input.cancellationRequestId}::uuid
     ORDER BY request_version DESC, created_at DESC, id DESC
     LIMIT 1
  `)) as unknown as Array<Record<string, unknown>>;
  const latest = latestRows[0] ? mapLifecycleEvent(latestRows[0]) : null;
  const previousEventHash = latest
    ? (latest.event_hash ?? legacyShipmentApvCancellationEventAnchor(latest))
    : null;
  const event: ShipmentApvPayoutCancellationEventRecord = {
    id: randomUUID(),
    cancellation_request_id: input.cancellationRequestId,
    event_type: input.eventType,
    actor_id: input.actorId,
    request_version: input.requestVersion,
    metadata: input.metadata,
    previous_event_hash: previousEventHash,
    event_hash: null,
    created_at: input.createdAt.toISOString(),
  };
  event.event_hash = buildShipmentApvCancellationEventHash(event, previousEventHash);
  await tx.execute(sql`
    INSERT INTO shipment_apv_payout_cancellation_events
      (id, cancellation_request_id, event_type, actor_id, request_version, metadata,
       previous_event_hash, event_hash, created_at)
    VALUES (${event.id}::uuid, ${event.cancellation_request_id}::uuid, ${event.event_type},
            ${event.actor_id}::uuid, ${event.request_version}, ${JSON.stringify(event.metadata)}::jsonb,
            ${event.previous_event_hash}, ${event.event_hash}, ${event.created_at}::timestamptz)
  `);
  return event;
}

interface PendingCancellationCursor {
  createdAt: string;
  id: string;
}

function decodePendingCancellationCursor(value: string): PendingCancellationCursor {
  try {
    const parsed = JSON.parse(
      Buffer.from(value, "base64url").toString("utf8"),
    ) as Partial<PendingCancellationCursor>;
    if (
      typeof parsed.createdAt !== "string" ||
      !Number.isFinite(Date.parse(parsed.createdAt)) ||
      typeof parsed.id !== "string" ||
      !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(parsed.id)
    ) {
      throw new Error("invalid cursor payload");
    }
    return { createdAt: new Date(parsed.createdAt).toISOString(), id: parsed.id };
  } catch {
    throw new Error("INVALID_APV_PAYOUT_CANCELLATION_CURSOR");
  }
}

function encodePendingCancellationCursor(cursor: PendingCancellationCursor): string {
  return Buffer.from(JSON.stringify(cursor), "utf8").toString("base64url");
}

function mapRequest(row: Record<string, unknown>): ShipmentApvPayoutCancellationRequestRecord {
  return {
    id: String(row.id),
    client_request_id: String(row.client_request_id),
    payout_offset_id: String(row.payout_offset_id),
    settlement_release_id: String(row.settlement_release_id),
    requester_id: String(row.requester_id),
    reason: String(row.reason),
    status: String(row.status) as ShipmentApvPayoutCancellationRequestRecord["status"],
    version: Number(row.version),
    expires_at: new Date(String(row.expires_at)).toISOString(),
    approver_id: row.approver_id ? String(row.approver_id) : undefined,
    decision_request_id: row.decision_request_id ? String(row.decision_request_id) : undefined,
    decision_reason: row.decision_reason ? String(row.decision_reason) : undefined,
    onchain_state: row.onchain_state ? String(row.onchain_state) : undefined,
    decided_at: row.decided_at ? new Date(String(row.decided_at)).toISOString() : undefined,
    created_at: new Date(String(row.created_at)).toISOString(),
  };
}

function isUniqueViolation(error: unknown): boolean {
  if (!error || typeof error !== "object") return false;
  const candidate = error as { code?: unknown; cause?: unknown };
  return candidate.code === "23505" || isUniqueViolation(candidate.cause);
}

async function expirePendingRequests(
  tx: Pick<Database, "execute">,
  nowIso: string,
  payoutOffsetId?: string,
) {
  const expiredRows = (await tx.execute(sql`
    UPDATE shipment_apv_payout_cancellation_requests
       SET status = 'EXPIRED', decision_reason = 'Approval window expired',
           decided_at = ${nowIso}::timestamptz, updated_at = ${nowIso}::timestamptz, version = version + 1
     WHERE status = 'PENDING' AND expires_at <= ${nowIso}::timestamptz
       ${payoutOffsetId ? sql`AND payout_offset_id = ${payoutOffsetId}::uuid` : sql``}
    RETURNING id, version, expires_at
  `)) as unknown as Array<Record<string, unknown>>;
  for (const expired of expiredRows) {
    await appendLifecycleEvent(tx, {
      cancellationRequestId: String(expired.id),
      eventType: "EXPIRED",
      actorId: null,
      requestVersion: Number(expired.version),
      metadata: {
        expired_at: new Date(String(expired.expires_at)).toISOString(),
        reason: "Approval window expired",
      },
      createdAt: new Date(nowIso),
    });
  }
}

export async function requestShipmentApvPayoutCancellation(
  db: Database,
  input: {
    clientRequestId: string;
    payoutOffsetId: string;
    settlementReleaseId: string;
    requesterId: string;
    reason: string;
    now?: Date;
  },
) {
  if (input.reason.trim().length < 12 || input.reason.length > 500)
    return { outcome: "invalid_reason" } as const;
  const now = input.now ?? new Date();
  const nowIso = now.toISOString();
  try {
    return await db.transaction(async (tx) => {
      const existingRows = (await tx.execute(sql`
        SELECT * FROM shipment_apv_payout_cancellation_requests
         WHERE client_request_id = ${input.clientRequestId}::uuid FOR UPDATE
      `)) as unknown as Array<Record<string, unknown>>;
      if (existingRows[0]) {
        const existing = mapRequest(existingRows[0]);
        return existing.payout_offset_id === input.payoutOffsetId &&
          existing.settlement_release_id === input.settlementReleaseId &&
          existing.requester_id === input.requesterId &&
          existing.reason === input.reason.trim()
          ? ({ outcome: "duplicate", request: existing } as const)
          : ({ outcome: "request_conflict" } as const);
      }
      await expirePendingRequests(tx, nowIso, input.payoutOffsetId);
      const offsetRows = (await tx.execute(sql`
        SELECT * FROM shipment_apv_payout_offsets
         WHERE id = ${input.payoutOffsetId}::uuid AND settlement_release_id = ${input.settlementReleaseId}::uuid
         FOR UPDATE
      `)) as unknown as Array<Record<string, unknown>>;
      const offset = offsetRows[0];
      if (!offset) return { outcome: "not_found" } as const;
      if (offset.status !== "RESERVED") return { outcome: "invalid_state" } as const;
      const expiry = new Date(String(offset.signature_deadline ?? offset.reservation_expires_at));
      if (!Number.isFinite(expiry.getTime()) || now.getTime() <= expiry.getTime())
        return { outcome: "not_expired" } as const;
      const rows = (await tx.execute(sql`
        INSERT INTO shipment_apv_payout_cancellation_requests
          (client_request_id, payout_offset_id, settlement_release_id, requester_id, reason,
           status, version, expires_at, created_at, updated_at)
        VALUES (${input.clientRequestId}::uuid, ${input.payoutOffsetId}::uuid, ${input.settlementReleaseId}::uuid,
                ${input.requesterId}::uuid, ${input.reason.trim()}, 'PENDING', 0,
                ${nowIso}::timestamptz + interval '30 minutes', ${nowIso}::timestamptz, ${nowIso}::timestamptz)
        RETURNING *
      `)) as unknown as Array<Record<string, unknown>>;
      const request = mapRequest(rows[0]!);
      await tx.execute(sql`
        INSERT INTO admin_action_log (actor_id, action_type, target_type, target_id, payload, created_at)
        VALUES (${input.requesterId}::uuid, 'shipment.apv_payout_cancellation_request',
                'shipment_apv_payout_cancellation_request', ${request.id},
                jsonb_build_object('payout_offset_id', ${input.payoutOffsetId}::text,
                                   'settlement_release_id', ${input.settlementReleaseId}::text,
                                   'reason', ${input.reason.trim()}::text), ${nowIso}::timestamptz)
      `);
      await appendLifecycleEvent(tx, {
        cancellationRequestId: request.id,
        eventType: "REQUESTED",
        actorId: input.requesterId,
        requestVersion: request.version,
        metadata: { payout_offset_id: input.payoutOffsetId },
        createdAt: now,
      });
      return { outcome: "requested", request } as const;
    });
  } catch (error) {
    if (isUniqueViolation(error)) return { outcome: "pending_conflict" } as const;
    throw error;
  }
}

export async function decideShipmentApvPayoutCancellation(
  db: Database,
  input: {
    requestId: string;
    payoutOffsetId: string;
    settlementReleaseId: string;
    decisionRequestId: string;
    approverId: string;
    decision: "APPROVE" | "REJECT";
    reason: string;
    expectedVersion: number;
    onchainState: "FUNDED" | "RELEASED" | "REFUNDED" | "DISPUTED" | "NONE";
    now?: Date;
  },
) {
  if (input.reason.trim().length < 12 || input.reason.length > 500)
    return { outcome: "invalid_reason" } as const;
  const now = input.now ?? new Date();
  const nowIso = now.toISOString();
  try {
    return await db.transaction(async (tx) => {
      const rows = (await tx.execute(sql`
      SELECT * FROM shipment_apv_payout_cancellation_requests WHERE id = ${input.requestId}::uuid FOR UPDATE
    `)) as unknown as Array<Record<string, unknown>>;
      const row = rows[0];
      if (!row) return { outcome: "not_found" } as const;
      const existing = mapRequest(row);
      if (
        existing.payout_offset_id !== input.payoutOffsetId ||
        existing.settlement_release_id !== input.settlementReleaseId
      ) {
        return { outcome: "request_conflict" } as const;
      }
      if (existing.status !== "PENDING") {
        const expectedStatus = input.decision === "APPROVE" ? "APPROVED" : "REJECTED";
        return existing.decision_request_id === input.decisionRequestId &&
          existing.approver_id === input.approverId &&
          existing.status === expectedStatus
          ? ({ outcome: "duplicate", request: existing } as const)
          : ({ outcome: "invalid_state" } as const);
      }
      if (existing.requester_id === input.approverId)
        return { outcome: "self_approval_forbidden" } as const;
      if (existing.version !== input.expectedVersion)
        return { outcome: "version_conflict" } as const;
      if (now.getTime() >= new Date(existing.expires_at).getTime()) {
        const expiredRows = (await tx.execute(sql`
        UPDATE shipment_apv_payout_cancellation_requests
           SET status = 'EXPIRED', decision_request_id = ${input.decisionRequestId}::uuid,
               decision_reason = 'Approval window expired', decided_at = ${nowIso}::timestamptz,
               updated_at = ${nowIso}::timestamptz, version = version + 1
         WHERE id = ${input.requestId}::uuid AND status = 'PENDING'
        RETURNING *
      `)) as unknown as Array<Record<string, unknown>>;
        const expired = mapRequest(expiredRows[0]!);
        await appendLifecycleEvent(tx, {
          cancellationRequestId: expired.id,
          eventType: "EXPIRED",
          actorId: null,
          requestVersion: expired.version,
          metadata: { expired_at: expired.expires_at, reason: "Approval window expired" },
          createdAt: now,
        });
        return { outcome: "expired", request: expired } as const;
      }
      if (input.decision === "APPROVE") {
        const cancellation = await cancelExpiredShipmentApvPayoutOffsetInTransaction(tx, {
          settlementReleaseId: existing.settlement_release_id,
          payoutOffsetId: existing.payout_offset_id,
          actorId: input.approverId,
          reason: existing.reason,
          onchainState: input.onchainState,
          approvalRequestId: existing.id,
          now,
        });
        if (cancellation.outcome !== "cancelled" && cancellation.outcome !== "duplicate") {
          return { outcome: cancellation.outcome } as const;
        }
      }
      const status = input.decision === "APPROVE" ? "APPROVED" : "REJECTED";
      const updatedRows = (await tx.execute(sql`
      UPDATE shipment_apv_payout_cancellation_requests
         SET status = ${status}, approver_id = ${input.approverId}::uuid,
             decision_request_id = ${input.decisionRequestId}::uuid, decision_reason = ${input.reason.trim()},
             onchain_state = ${input.onchainState}, decided_at = ${nowIso}::timestamptz,
             updated_at = ${nowIso}::timestamptz, version = version + 1
       WHERE id = ${input.requestId}::uuid AND status = 'PENDING' AND version = ${input.expectedVersion}
      RETURNING *
    `)) as unknown as Array<Record<string, unknown>>;
      if (!updatedRows[0]) return { outcome: "version_conflict" } as const;
      await tx.execute(sql`
      INSERT INTO admin_action_log (actor_id, action_type, target_type, target_id, payload, created_at)
      VALUES (${input.approverId}::uuid, 'shipment.apv_payout_cancellation_decision',
              'shipment_apv_payout_cancellation_request', ${existing.id},
              jsonb_build_object('decision', ${input.decision}::text,
                                 'payout_offset_id', ${existing.payout_offset_id}::text,
                                 'settlement_release_id', ${existing.settlement_release_id}::text,
                                 'onchain_state', ${input.onchainState}::text,
                                 'reason', ${input.reason.trim()}::text), ${nowIso}::timestamptz)
    `);
      await appendLifecycleEvent(tx, {
        cancellationRequestId: existing.id,
        eventType: status,
        actorId: input.approverId,
        requestVersion: Number(updatedRows[0].version),
        metadata: {
          decision_request_id: input.decisionRequestId,
          onchain_state: input.onchainState,
        },
        createdAt: now,
      });
      return {
        outcome: input.decision === "APPROVE" ? "approved" : "rejected",
        request: mapRequest(updatedRows[0]),
      } as const;
    });
  } catch (error) {
    if (isUniqueViolation(error)) return { outcome: "decision_conflict" } as const;
    throw error;
  }
}

export async function listPendingShipmentApvPayoutCancellations(
  db: Database,
  input: { limit?: number; cursor?: string; now?: Date } = {},
) {
  const limit = input.limit ?? 20;
  if (!Number.isInteger(limit) || limit < 1 || limit > 100) {
    throw new Error("INVALID_APV_PAYOUT_CANCELLATION_LIMIT");
  }
  const cursor = input.cursor ? decodePendingCancellationCursor(input.cursor) : null;
  const now = input.now ?? new Date();
  const nowIso = now.toISOString();
  return db.transaction(async (tx) => {
    await expirePendingRequests(tx, nowIso);
    const rows = (await tx.execute(sql`
      SELECT request.*, payout.order_id, payout.seller_id, payout.currency, payout.applied_offset_minor,
             payout.signature_deadline, payout.reservation_expires_at
        FROM shipment_apv_payout_cancellation_requests AS request
        JOIN shipment_apv_payout_offsets AS payout ON payout.id = request.payout_offset_id
       WHERE request.status = 'PENDING'
         ${cursor ? sql`AND (request.created_at, request.id) > (${cursor.createdAt}::timestamptz, ${cursor.id}::uuid)` : sql``}
       ORDER BY request.created_at ASC, request.id ASC
       LIMIT ${limit + 1}
    `)) as unknown as Array<Record<string, unknown>>;
    const hasMore = rows.length > limit;
    const pageRows = hasMore ? rows.slice(0, limit) : rows;
    const items = pageRows.map((row) => ({
      ...mapRequest(row),
      order_id: String(row.order_id),
      seller_id: String(row.seller_id),
      currency: String(row.currency),
      applied_offset_minor: Number(row.applied_offset_minor),
      signature_deadline: row.signature_deadline
        ? new Date(String(row.signature_deadline)).toISOString()
        : null,
    }));
    const last = items.at(-1);
    return {
      items,
      nextCursor:
        hasMore && last
          ? encodePendingCancellationCursor({ createdAt: last.created_at, id: last.id })
          : null,
      recordedAt: nowIso,
    };
  });
}

export async function getShipmentApvPayoutCancellationApprovalHealth(
  db: Database,
  now = new Date(),
): Promise<ShipmentApvPayoutCancellationApprovalHealth> {
  const nowIso = now.toISOString();
  return db.transaction(async (tx) => {
    await expirePendingRequests(tx, nowIso);
    const rows = (await tx.execute(sql`
      SELECT COUNT(*)::int AS pending_requests,
             COUNT(*) FILTER (WHERE expires_at <= ${nowIso}::timestamptz + interval '10 minutes')::int
               AS expiring_soon_requests,
             MAX(EXTRACT(EPOCH FROM (${nowIso}::timestamptz - created_at)))::int
               AS oldest_pending_age_seconds
        FROM shipment_apv_payout_cancellation_requests
       WHERE status = 'PENDING'
    `)) as unknown as Array<Record<string, unknown>>;
    const row = rows[0] ?? {};
    const pendingRequests = Number(row.pending_requests ?? 0);
    return {
      status: pendingRequests > 0 ? "attention" : "healthy",
      pendingRequests,
      expiringSoonRequests: Number(row.expiring_soon_requests ?? 0),
      oldestPendingAgeSeconds:
        row.oldest_pending_age_seconds === null || row.oldest_pending_age_seconds === undefined
          ? null
          : Number(row.oldest_pending_age_seconds),
      recordedAt: nowIso,
    };
  });
}

export async function getShipmentApvPayoutCancellationTimeline(db: Database, requestId: string) {
  return db.transaction(async (tx) => {
    const requestRows = (await tx.execute(sql`
      SELECT id, status, requester_id, approver_id, created_at, decided_at
        FROM shipment_apv_payout_cancellation_requests
       WHERE id = ${requestId}::uuid
    `)) as unknown as Array<Record<string, unknown>>;
    if (!requestRows[0]) return null;
    const rows = (await tx.execute(sql`
      SELECT id, cancellation_request_id, event_type, actor_id, request_version, metadata,
             previous_event_hash, event_hash, created_at
        FROM shipment_apv_payout_cancellation_events
       WHERE cancellation_request_id = ${requestId}::uuid
       ORDER BY request_version ASC, created_at ASC, id ASC
       LIMIT 10
    `)) as unknown as Array<Record<string, unknown>>;
    const request = requestRows[0];
    const events = rows.map(mapLifecycleEvent);
    return {
      request: {
        id: String(request.id),
        status: String(request.status),
        requester_id: String(request.requester_id),
        approver_id: request.approver_id ? String(request.approver_id) : null,
        created_at: new Date(String(request.created_at)).toISOString(),
        decided_at: request.decided_at ? new Date(String(request.decided_at)).toISOString() : null,
      },
      events,
      integrity: verifyShipmentApvCancellationEventChain(events),
    };
  });
}
