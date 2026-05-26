import { createHash, createHmac } from "node:crypto";
import type { DisputeCase } from "@haggle/dispute-core";
import {
  disputeModuleWebhookOutbox,
  eq,
  sql,
  type Database,
} from "@haggle/db";
import { assertDisputeModuleOutboundUrl } from "./dispute-module-outbound-url.service.js";

export type DisputeModuleWebhookEventType =
  | "dispute.case.created"
  | "dispute.case.escalated"
  | "dispute.case.updated"
  | "dispute.settlement.instruction";

export interface DisputeModuleWebhookEnvelope<TData = unknown> {
  id: string;
  type: DisputeModuleWebhookEventType;
  created_at: string;
  platform_id: string;
  external_order_id: string;
  dispute_id: string;
  data: TData;
}

export interface DisputeModuleWebhookConfig {
  url: string;
  secret: string;
  timeoutMs?: number;
  allowInsecureHttp?: boolean;
  allowPrivateNetwork?: boolean;
}

export interface DisputeModuleWebhookDeliveryResult {
  status: "skipped" | "delivered" | "failed";
  eventId?: string;
  httpStatus?: number;
  error?: string;
  outboxStatus?: DisputeModuleWebhookOutboxRecord["status"];
}

export interface DisputeModuleWebhookOutboxRecord {
  id: string;
  eventId: string;
  platformId: string;
  externalOrderId: string;
  disputeId: string;
  eventType: DisputeModuleWebhookEventType;
  payload: DisputeModuleWebhookEnvelope;
  status: "PENDING" | "PROCESSING" | "DELIVERED" | "FAILED" | "DEAD_LETTER";
  attemptCount: number;
  nextAttemptAt: Date;
  lastError: string | null;
  deliveredAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
}

export interface DisputeModuleWebhookOutboxDispatchResult {
  claimed: number;
  delivered: number;
  failed: number;
  skipped: number;
  deadLettered: number;
  deadLetterEvents: Array<{
    eventId: string;
    platformId: string;
    disputeId: string;
    attemptCount: number;
  }>;
}

const DEFAULT_MAX_DELIVERY_ATTEMPTS = 10;

function configuredMaxDeliveryAttempts(): number {
  const raw = Number(process.env.DISPUTE_MODULE_WEBHOOK_MAX_ATTEMPTS);
  if (!Number.isFinite(raw) || raw <= 0) return DEFAULT_MAX_DELIVERY_ATTEMPTS;
  return Math.min(Math.floor(raw), 100);
}

export function createDisputeModuleWebhookEventId(
  type: DisputeModuleWebhookEventType,
  disputeId: string,
  dedupeKey = "",
): string {
  return `evt_${createHash("sha256").update(`${type}:${disputeId}:${dedupeKey}`).digest("hex").slice(0, 32)}`;
}

export function buildDisputeModuleWebhookEnvelope(
  params: {
    type: DisputeModuleWebhookEventType;
    platformId: string;
    externalOrderId: string;
    dispute: DisputeCase;
    data?: Record<string, unknown>;
    dedupeKey?: string;
    now?: Date;
  },
): DisputeModuleWebhookEnvelope {
  return {
    id: createDisputeModuleWebhookEventId(params.type, params.dispute.id, params.dedupeKey),
    type: params.type,
    created_at: (params.now ?? new Date()).toISOString(),
    platform_id: params.platformId,
    external_order_id: params.externalOrderId,
    dispute_id: params.dispute.id,
    data: params.data ?? {
      dispute: params.dispute,
    },
  };
}

export function signDisputeModuleWebhookPayload(params: {
  secret: string;
  timestamp: string;
  eventId: string;
  rawBody: string | Buffer;
}): string {
  if (params.secret.length < 16) {
    throw new Error("webhook secret must be at least 16 characters");
  }
  const bodyHash = createHash("sha256").update(params.rawBody).digest("hex");
  const payload = `${params.timestamp}.${params.eventId}.${bodyHash}`;
  return `sha256=${createHmac("sha256", params.secret).update(payload).digest("hex")}`;
}

export function resolveDisputeModuleWebhookConfigFromEnv(
  platformId: string,
): DisputeModuleWebhookConfig | null {
  const raw = process.env.DISPUTE_MODULE_PLATFORM_WEBHOOKS;
  if (!raw) return null;
  try {
    const parsed = JSON.parse(raw) as Record<string, unknown>;
    const config = parsed[platformId];
    if (!config || typeof config !== "object" || Array.isArray(config)) return null;
    const record = config as Record<string, unknown>;
    if (typeof record.url !== "string" || typeof record.secret !== "string") return null;
    return {
      url: record.url,
      secret: record.secret,
      timeoutMs: typeof record.timeout_ms === "number" ? record.timeout_ms : undefined,
      allowInsecureHttp: record.allow_insecure_http === true,
      allowPrivateNetwork: record.allow_private_network === true,
    };
  } catch {
    return null;
  }
}

export async function deliverDisputeModuleWebhook(
  envelope: DisputeModuleWebhookEnvelope,
  config: DisputeModuleWebhookConfig | null,
  options: {
    fetchImpl?: typeof fetch;
    now?: Date;
  } = {},
): Promise<DisputeModuleWebhookDeliveryResult> {
  if (!config) {
    return { status: "skipped", eventId: envelope.id };
  }

  assertDisputeModuleOutboundUrl(config.url, {
    label: "webhook",
    allowInsecureHttp: config.allowInsecureHttp ?? false,
    allowPrivateNetwork: config.allowPrivateNetwork ?? false,
  });
  const rawBody = JSON.stringify(envelope);
  const timestamp = (options.now ?? new Date()).toISOString();
  const signature = signDisputeModuleWebhookPayload({
    secret: config.secret,
    timestamp,
    eventId: envelope.id,
    rawBody,
  });

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), config.timeoutMs ?? 10_000);
  try {
    const response = await (options.fetchImpl ?? fetch)(config.url, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-haggle-webhook-id": envelope.id,
        "x-haggle-webhook-timestamp": timestamp,
        "x-haggle-webhook-signature": signature,
      },
      body: rawBody,
      redirect: "error",
      signal: controller.signal,
    });
    return {
      status: response.ok ? "delivered" : "failed",
      eventId: envelope.id,
      httpStatus: response.status,
    };
  } catch (error) {
    return {
      status: "failed",
      eventId: envelope.id,
      error: error instanceof Error ? error.message : String(error),
    };
  } finally {
    clearTimeout(timeout);
  }
}

export async function createDisputeModuleWebhookOutboxRecord(
  db: Database,
  envelope: DisputeModuleWebhookEnvelope,
): Promise<DisputeModuleWebhookOutboxRecord> {
  const [row] = await db
    .insert(disputeModuleWebhookOutbox)
    .values({
      eventId: envelope.id,
      platformId: envelope.platform_id,
      externalOrderId: envelope.external_order_id,
      disputeId: envelope.dispute_id,
      eventType: envelope.type,
      payload: envelope as unknown as Record<string, unknown>,
      status: "PENDING",
      nextAttemptAt: new Date(),
    })
    .returning();

  return row as unknown as DisputeModuleWebhookOutboxRecord;
}

export async function markDisputeModuleWebhookOutboxDelivered(
  db: Database,
  eventId: string,
  attemptCount: number,
): Promise<void> {
  await db
    .update(disputeModuleWebhookOutbox)
    .set({
      status: "DELIVERED",
      attemptCount: Math.max(1, attemptCount),
      lastError: null,
      deliveredAt: new Date(),
      updatedAt: new Date(),
    })
    .where(eq(disputeModuleWebhookOutbox.eventId, eventId));
}

export async function markDisputeModuleWebhookOutboxFailed(
  db: Database,
  eventId: string,
  error: string,
  attemptCount: number,
): Promise<"FAILED" | "DEAD_LETTER"> {
  const cappedAttempts = Math.max(1, attemptCount);
  const exhausted = cappedAttempts >= configuredMaxDeliveryAttempts();
  const nextStatus = exhausted ? "DEAD_LETTER" : "FAILED";
  const retryDelayMs = Math.min(60 * 60 * 1000, 2 ** Math.min(cappedAttempts, 10) * 1000);
  await db
    .update(disputeModuleWebhookOutbox)
    .set({
      status: nextStatus,
      attemptCount: cappedAttempts,
      lastError: error.slice(0, 1000),
      nextAttemptAt: new Date(Date.now() + retryDelayMs),
      updatedAt: new Date(),
    })
    .where(eq(disputeModuleWebhookOutbox.eventId, eventId));
  return nextStatus;
}

function rowsFromResult(result: unknown): Record<string, unknown>[] {
  if (Array.isArray(result)) return result as Record<string, unknown>[];
  if (result && typeof result === "object" && Array.isArray((result as { rows?: unknown[] }).rows)) {
    return (result as { rows: Record<string, unknown>[] }).rows;
  }
  return [];
}

function mapDisputeModuleWebhookOutboxRow(row: Record<string, unknown>): DisputeModuleWebhookOutboxRecord {
  return {
    id: String(row.id),
    eventId: String(row.event_id),
    platformId: String(row.platform_id),
    externalOrderId: String(row.external_order_id),
    disputeId: String(row.dispute_id),
    eventType: row.event_type as DisputeModuleWebhookEventType,
    payload: row.payload as DisputeModuleWebhookEnvelope,
    status: row.status as DisputeModuleWebhookOutboxRecord["status"],
    attemptCount: Number(row.attempt_count ?? 0),
    nextAttemptAt: new Date(String(row.next_attempt_at)),
    lastError: row.last_error === null || row.last_error === undefined ? null : String(row.last_error),
    deliveredAt: row.delivered_at === null || row.delivered_at === undefined
      ? null
      : new Date(String(row.delivered_at)),
    createdAt: new Date(String(row.created_at)),
    updatedAt: new Date(String(row.updated_at)),
  };
}

export async function claimDueDisputeModuleWebhookOutboxRecords(
  db: Database,
  options: {
    limit?: number;
    now?: Date;
    leaseMs?: number;
  } = {},
): Promise<DisputeModuleWebhookOutboxRecord[]> {
  const limit = Math.min(Math.max(options.limit ?? 25, 1), 100);
  const now = options.now ?? new Date();
  const leaseUntil = new Date(now.getTime() + (options.leaseMs ?? 2 * 60 * 1000));

  const result = await db.execute(sql`
    WITH claimed AS (
      SELECT id
      FROM dispute_module_webhook_outbox
      WHERE status IN ('PENDING', 'FAILED', 'PROCESSING')
        AND next_attempt_at <= ${now}
      ORDER BY next_attempt_at ASC, created_at ASC
      LIMIT ${limit}
      FOR UPDATE SKIP LOCKED
    )
    UPDATE dispute_module_webhook_outbox AS outbox
    SET
      status = 'PROCESSING',
      next_attempt_at = ${leaseUntil},
      updated_at = ${now}
    FROM claimed
    WHERE outbox.id = claimed.id
    RETURNING
      outbox.id,
      outbox.event_id,
      outbox.platform_id,
      outbox.external_order_id,
      outbox.dispute_id,
      outbox.event_type,
      outbox.payload,
      outbox.status,
      outbox.attempt_count,
      outbox.next_attempt_at,
      outbox.last_error,
      outbox.delivered_at,
      outbox.created_at,
      outbox.updated_at
  `);

  return rowsFromResult(result).map(mapDisputeModuleWebhookOutboxRow);
}

export async function listDeadLetterDisputeModuleWebhookOutboxRecords(
  db: Database,
  options: {
    limit?: number;
    offset?: number;
  } = {},
): Promise<DisputeModuleWebhookOutboxRecord[]> {
  const limit = Math.min(Math.max(options.limit ?? 50, 1), 200);
  const offset = Math.max(options.offset ?? 0, 0);
  const result = await db.execute(sql`
    SELECT
      id,
      event_id,
      platform_id,
      external_order_id,
      dispute_id,
      event_type,
      payload,
      status,
      attempt_count,
      next_attempt_at,
      last_error,
      delivered_at,
      created_at,
      updated_at
    FROM dispute_module_webhook_outbox
    WHERE status = 'DEAD_LETTER'
    ORDER BY updated_at DESC, created_at DESC
    LIMIT ${limit}
    OFFSET ${offset}
  `);

  return rowsFromResult(result).map(mapDisputeModuleWebhookOutboxRow);
}

export async function resetDisputeModuleWebhookOutboxRecordForReplay(
  db: Database,
  eventId: string,
  options: {
    now?: Date;
  } = {},
): Promise<DisputeModuleWebhookOutboxRecord | null> {
  const now = options.now ?? new Date();
  const result = await db.execute(sql`
    UPDATE dispute_module_webhook_outbox
    SET
      status = 'PENDING',
      attempt_count = 0,
      next_attempt_at = ${now},
      last_error = NULL,
      delivered_at = NULL,
      updated_at = ${now}
    WHERE event_id = ${eventId}
      AND status IN ('FAILED', 'DEAD_LETTER')
    RETURNING
      id,
      event_id,
      platform_id,
      external_order_id,
      dispute_id,
      event_type,
      payload,
      status,
      attempt_count,
      next_attempt_at,
      last_error,
      delivered_at,
      created_at,
      updated_at
  `);
  const row = rowsFromResult(result)[0];
  return row ? mapDisputeModuleWebhookOutboxRow(row) : null;
}

export async function deliverDisputeModuleWebhookOutboxRecord(
  db: Database,
  record: DisputeModuleWebhookOutboxRecord,
  options: {
    fetchImpl?: typeof fetch;
  } = {},
): Promise<DisputeModuleWebhookDeliveryResult> {
  const config = resolveDisputeModuleWebhookConfigFromEnv(record.platformId);
  if (!config) {
    const outboxStatus = await markDisputeModuleWebhookOutboxFailed(
      db,
      record.eventId,
      `Missing webhook config for platform ${record.platformId}`,
      record.attemptCount + 1,
    );
    return { status: "skipped", eventId: record.eventId, outboxStatus };
  }

  const result = await deliverDisputeModuleWebhook(
    record.payload,
    config,
    { fetchImpl: options.fetchImpl },
  );

  if (result.status === "delivered") {
    await markDisputeModuleWebhookOutboxDelivered(db, record.eventId, record.attemptCount + 1);
    result.outboxStatus = "DELIVERED";
  } else if (result.status === "failed") {
    result.outboxStatus = await markDisputeModuleWebhookOutboxFailed(
      db,
      record.eventId,
      result.error ?? `HTTP ${result.httpStatus ?? "unknown"}`,
      record.attemptCount + 1,
    );
  }

  return result;
}

export async function dispatchDueDisputeModuleWebhookOutbox(
  db: Database,
  options: {
    limit?: number;
    leaseMs?: number;
    fetchImpl?: typeof fetch;
    now?: Date;
  } = {},
): Promise<DisputeModuleWebhookOutboxDispatchResult> {
  const records = await claimDueDisputeModuleWebhookOutboxRecords(db, {
    limit: options.limit,
    leaseMs: options.leaseMs,
    now: options.now,
  });
  const result: DisputeModuleWebhookOutboxDispatchResult = {
    claimed: records.length,
    delivered: 0,
    failed: 0,
    skipped: 0,
    deadLettered: 0,
    deadLetterEvents: [],
  };

  for (const record of records) {
    const delivery = await deliverDisputeModuleWebhookOutboxRecord(db, record, {
      fetchImpl: options.fetchImpl,
    });
    if (delivery.status === "delivered") result.delivered += 1;
    if (delivery.status === "failed") result.failed += 1;
    if (delivery.status === "skipped") result.skipped += 1;
    if (delivery.outboxStatus === "DEAD_LETTER") {
      result.deadLettered += 1;
      result.deadLetterEvents.push({
        eventId: record.eventId,
        platformId: record.platformId,
        disputeId: record.disputeId,
        attemptCount: record.attemptCount + 1,
      });
    }
  }

  return result;
}

export async function dispatchDisputeModuleCaseCreatedWebhook(
  params: {
    db?: Database;
    platformId: string;
    externalOrderId: string;
    dispute: DisputeCase;
    fetchImpl?: typeof fetch;
  },
): Promise<DisputeModuleWebhookDeliveryResult> {
  const envelope = buildDisputeModuleWebhookEnvelope({
    type: "dispute.case.created",
    platformId: params.platformId,
    externalOrderId: params.externalOrderId,
    dispute: params.dispute,
  });
  if (params.db) {
    const record = await createDisputeModuleWebhookOutboxRecord(params.db, envelope);
    return deliverDisputeModuleWebhookOutboxRecord(params.db, record, { fetchImpl: params.fetchImpl });
  }
  return deliverDisputeModuleWebhook(
    envelope,
    resolveDisputeModuleWebhookConfigFromEnv(params.platformId),
    { fetchImpl: params.fetchImpl },
  );
}
