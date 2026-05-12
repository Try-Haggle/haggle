import { afterEach, describe, expect, it, vi } from "vitest";
import type { DisputeCase } from "@haggle/dispute-core";
import {
  buildDisputeModuleWebhookEnvelope,
  claimDueDisputeModuleWebhookOutboxRecords,
  createDisputeModuleWebhookOutboxRecord,
  deliverDisputeModuleWebhook,
  deliverDisputeModuleWebhookOutboxRecord,
  dispatchDueDisputeModuleWebhookOutbox,
  dispatchDisputeModuleCaseCreatedWebhook,
  listDeadLetterDisputeModuleWebhookOutboxRecords,
  resetDisputeModuleWebhookOutboxRecordForReplay,
  type DisputeModuleWebhookEnvelope,
  type DisputeModuleWebhookOutboxRecord,
  resolveDisputeModuleWebhookConfigFromEnv,
  signDisputeModuleWebhookPayload,
} from "../services/dispute-module-webhook.service.js";

const dispute: DisputeCase = {
  id: "11111111-1111-5111-9111-111111111111",
  order_id: "22222222-2222-5222-9222-222222222222",
  reason_code: "ITEM_NOT_AS_DESCRIBED",
  status: "OPEN",
  opened_by: "buyer",
  opened_at: "2026-05-05T00:00:00.000Z",
  evidence: [],
  metadata: {
    source: "dispute_module_api",
  },
};

function outboxRecord(
  envelope: DisputeModuleWebhookEnvelope,
  overrides: Partial<DisputeModuleWebhookOutboxRecord> = {},
): DisputeModuleWebhookOutboxRecord {
  return {
    id: "outbox_1",
    eventId: envelope.id,
    platformId: envelope.platform_id,
    externalOrderId: envelope.external_order_id,
    disputeId: envelope.dispute_id,
    eventType: envelope.type,
    payload: envelope,
    status: "PENDING",
    attemptCount: 0,
    nextAttemptAt: new Date("2026-05-05T00:00:00.000Z"),
    lastError: null,
    deliveredAt: null,
    createdAt: new Date("2026-05-05T00:00:00.000Z"),
    updatedAt: new Date("2026-05-05T00:00:00.000Z"),
    ...overrides,
  };
}

function dbWithInsertReturning(row: unknown) {
  const returning = vi.fn().mockResolvedValue([row]);
  const values = vi.fn().mockReturnValue({ returning });
  const insert = vi.fn().mockReturnValue({ values });
  return {
    db: { insert },
    insert,
    values,
    returning,
  };
}

function dbWithUpdate() {
  const where = vi.fn().mockResolvedValue([]);
  const set = vi.fn().mockReturnValue({ where });
  const update = vi.fn().mockReturnValue({ set });
  return {
    db: { update },
    update,
    set,
    where,
  };
}

function dbWithExecuteRowsAndUpdate(rows: Record<string, unknown>[]) {
  const updateDb = dbWithUpdate();
  const execute = vi.fn().mockResolvedValue({ rows });
  return {
    db: {
      execute,
      update: updateDb.update,
    },
    execute,
    set: updateDb.set,
  };
}

function outboxDbRow(record: DisputeModuleWebhookOutboxRecord): Record<string, unknown> {
  return {
    id: record.id,
    event_id: record.eventId,
    platform_id: record.platformId,
    external_order_id: record.externalOrderId,
    dispute_id: record.disputeId,
    event_type: record.eventType,
    payload: record.payload,
    status: record.status,
    attempt_count: record.attemptCount,
    next_attempt_at: record.nextAttemptAt,
    last_error: record.lastError,
    delivered_at: record.deliveredAt,
    created_at: record.createdAt,
    updated_at: record.updatedAt,
  };
}

describe("dispute module webhook service", () => {
  const originalWebhooks = process.env.DISPUTE_MODULE_PLATFORM_WEBHOOKS;
  const originalMaxAttempts = process.env.DISPUTE_MODULE_WEBHOOK_MAX_ATTEMPTS;

  afterEach(() => {
    if (originalWebhooks === undefined) {
      delete process.env.DISPUTE_MODULE_PLATFORM_WEBHOOKS;
    } else {
      process.env.DISPUTE_MODULE_PLATFORM_WEBHOOKS = originalWebhooks;
    }
    if (originalMaxAttempts === undefined) {
      delete process.env.DISPUTE_MODULE_WEBHOOK_MAX_ATTEMPTS;
    } else {
      process.env.DISPUTE_MODULE_WEBHOOK_MAX_ATTEMPTS = originalMaxAttempts;
    }
  });

  it("builds deterministic case-created webhook envelopes", () => {
    const envelope = buildDisputeModuleWebhookEnvelope({
      type: "dispute.case.created",
      platformId: "platform_1",
      externalOrderId: "order_123",
      dispute,
      now: new Date("2026-05-05T00:00:00.000Z"),
    });

    expect(envelope).toMatchObject({
      id: expect.stringMatching(/^evt_[0-9a-f]{32}$/),
      type: "dispute.case.created",
      created_at: "2026-05-05T00:00:00.000Z",
      platform_id: "platform_1",
      external_order_id: "order_123",
      dispute_id: dispute.id,
      data: { dispute },
    });
  });

  it("builds distinct escalation webhook ids per tier", () => {
    const tier2 = buildDisputeModuleWebhookEnvelope({
      type: "dispute.case.escalated",
      platformId: "platform_1",
      externalOrderId: "order_123",
      dispute,
      data: { previous_tier: 1, new_tier: 2 },
      dedupeKey: "tier:2",
      now: new Date("2026-05-05T00:00:00.000Z"),
    });
    const tier3 = buildDisputeModuleWebhookEnvelope({
      type: "dispute.case.escalated",
      platformId: "platform_1",
      externalOrderId: "order_123",
      dispute,
      data: { previous_tier: 2, new_tier: 3 },
      dedupeKey: "tier:3",
      now: new Date("2026-05-05T00:00:00.000Z"),
    });

    expect(tier2.id).toMatch(/^evt_[0-9a-f]{32}$/);
    expect(tier3.id).toMatch(/^evt_[0-9a-f]{32}$/);
    expect(tier2.id).not.toBe(tier3.id);
    expect(tier2).toMatchObject({
      type: "dispute.case.escalated",
      data: { previous_tier: 1, new_tier: 2 },
    });
  });

  it("builds deterministic settlement instruction webhook envelopes", () => {
    const envelope = buildDisputeModuleWebhookEnvelope({
      type: "dispute.settlement.instruction",
      platformId: "platform_1",
      externalOrderId: "order_123",
      dispute: {
        ...dispute,
        status: "PARTIAL_REFUND",
      },
      data: {
        outcome: "partial_refund",
        settlement_instruction: {
          action: "refund_buyer",
          amount_minor: 2500,
          currency: "USD",
        },
      },
      dedupeKey: "resolution",
      now: new Date("2026-05-05T00:00:00.000Z"),
    });

    expect(envelope).toMatchObject({
      id: expect.stringMatching(/^evt_[0-9a-f]{32}$/),
      type: "dispute.settlement.instruction",
      platform_id: "platform_1",
      external_order_id: "order_123",
      data: {
        outcome: "partial_refund",
        settlement_instruction: {
          action: "refund_buyer",
          amount_minor: 2500,
          currency: "USD",
        },
      },
    });
  });

  it("signs webhook payloads with timestamp, event id, and raw body hash", () => {
    const signature = signDisputeModuleWebhookPayload({
      secret: "webhook-secret-with-length",
      timestamp: "2026-05-05T00:00:00.000Z",
      eventId: "evt_123",
      rawBody: JSON.stringify({ ok: true }),
    });

    expect(signature).toMatch(/^sha256=[0-9a-f]{64}$/);
  });

  it("resolves per-platform webhook config from env", () => {
    process.env.DISPUTE_MODULE_PLATFORM_WEBHOOKS = JSON.stringify({
      platform_1: {
        url: "https://platform.example/webhooks/haggle",
        secret: "webhook-secret-with-length",
        timeout_ms: 2500,
      },
    });

    expect(resolveDisputeModuleWebhookConfigFromEnv("platform_1")).toMatchObject({
      url: "https://platform.example/webhooks/haggle",
      secret: "webhook-secret-with-length",
      timeoutMs: 2500,
    });
    expect(resolveDisputeModuleWebhookConfigFromEnv("platform_2")).toBeNull();
  });

  it("delivers signed webhooks without following redirects", async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response("ok", { status: 200 }));
    const envelope = buildDisputeModuleWebhookEnvelope({
      type: "dispute.case.created",
      platformId: "platform_1",
      externalOrderId: "order_123",
      dispute,
      now: new Date("2026-05-05T00:00:00.000Z"),
    });

    const result = await deliverDisputeModuleWebhook(envelope, {
      url: "https://platform.example/webhooks/haggle",
      secret: "webhook-secret-with-length",
    }, {
      fetchImpl: fetchMock,
      now: new Date("2026-05-05T00:00:00.000Z"),
    });

    expect(result).toMatchObject({ status: "delivered", httpStatus: 200 });
    expect(fetchMock).toHaveBeenCalledWith(
      "https://platform.example/webhooks/haggle",
      expect.objectContaining({
        method: "POST",
        redirect: "error",
        headers: expect.objectContaining({
          "content-type": "application/json",
          "x-haggle-webhook-id": envelope.id,
          "x-haggle-webhook-timestamp": "2026-05-05T00:00:00.000Z",
          "x-haggle-webhook-signature": expect.stringMatching(/^sha256=[0-9a-f]{64}$/),
        }),
        body: JSON.stringify(envelope),
        signal: expect.any(AbortSignal),
      }),
    );
  });

  it("skips delivery when platform webhook config is absent", async () => {
    const envelope = buildDisputeModuleWebhookEnvelope({
      type: "dispute.case.created",
      platformId: "platform_1",
      externalOrderId: "order_123",
      dispute,
    });

    await expect(deliverDisputeModuleWebhook(envelope, null))
      .resolves.toMatchObject({ status: "skipped", eventId: envelope.id });
  });

  it("persists case-created webhooks in an outbox record", async () => {
    const envelope = buildDisputeModuleWebhookEnvelope({
      type: "dispute.case.created",
      platformId: "platform_1",
      externalOrderId: "order_123",
      dispute,
      now: new Date("2026-05-05T00:00:00.000Z"),
    });
    const { db, values } = dbWithInsertReturning(outboxRecord(envelope));

    const record = await createDisputeModuleWebhookOutboxRecord(db as never, envelope);

    expect(record).toMatchObject({
      eventId: envelope.id,
      platformId: "platform_1",
      externalOrderId: "order_123",
      payload: envelope,
    });
    expect(values).toHaveBeenCalledWith(expect.objectContaining({
      eventId: envelope.id,
      platformId: "platform_1",
      externalOrderId: "order_123",
      disputeId: dispute.id,
      eventType: "dispute.case.created",
      payload: envelope,
      status: "PENDING",
    }));
  });

  it("rejects insecure webhook URLs unless explicitly allowed", async () => {
    const envelope = buildDisputeModuleWebhookEnvelope({
      type: "dispute.case.created",
      platformId: "platform_1",
      externalOrderId: "order_123",
      dispute,
    });

    await expect(deliverDisputeModuleWebhook(envelope, {
      url: "http://platform.example/webhooks/haggle",
      secret: "webhook-secret-with-length",
    })).rejects.toThrow("webhook url must use HTTPS unless allow_insecure_http is true");
  });

  it("rejects localhost and private network webhook URLs by default", async () => {
    const envelope = buildDisputeModuleWebhookEnvelope({
      type: "dispute.case.created",
      platformId: "platform_1",
      externalOrderId: "order_123",
      dispute,
    });

    await expect(deliverDisputeModuleWebhook(envelope, {
      url: "https://169.254.169.254/latest/meta-data",
      secret: "webhook-secret-with-length",
    })).rejects.toThrow("webhook url must not target localhost or private network hosts");

    await expect(deliverDisputeModuleWebhook(envelope, {
      url: "https://[::1]/webhooks/haggle",
      secret: "webhook-secret-with-length",
    })).rejects.toThrow("webhook url must not target localhost or private network hosts");
  });

  it("allows private network webhook URLs only when explicitly configured", async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response("ok", { status: 200 }));
    const envelope = buildDisputeModuleWebhookEnvelope({
      type: "dispute.case.created",
      platformId: "platform_1",
      externalOrderId: "order_123",
      dispute,
    });

    await expect(deliverDisputeModuleWebhook(envelope, {
      url: "https://10.0.0.10/webhooks/haggle",
      secret: "webhook-secret-with-length",
      allowPrivateNetwork: true,
    }, {
      fetchImpl: fetchMock,
    })).resolves.toMatchObject({ status: "delivered", httpStatus: 200 });
  });

  it("dispatches case-created webhooks from env config", async () => {
    process.env.DISPUTE_MODULE_PLATFORM_WEBHOOKS = JSON.stringify({
      platform_1: {
        url: "https://platform.example/webhooks/haggle",
        secret: "webhook-secret-with-length",
      },
    });
    const fetchMock = vi.fn().mockResolvedValue(new Response("accepted", { status: 202 }));

    const result = await dispatchDisputeModuleCaseCreatedWebhook({
      platformId: "platform_1",
      externalOrderId: "order_123",
      dispute,
      fetchImpl: fetchMock,
    });

    expect(result).toMatchObject({ status: "delivered", httpStatus: 202 });
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("marks outbox records delivered after a successful delivery", async () => {
    process.env.DISPUTE_MODULE_PLATFORM_WEBHOOKS = JSON.stringify({
      platform_1: {
        url: "https://platform.example/webhooks/haggle",
        secret: "webhook-secret-with-length",
      },
    });
    const fetchMock = vi.fn().mockResolvedValue(new Response("accepted", { status: 202 }));
    const envelope = buildDisputeModuleWebhookEnvelope({
      type: "dispute.case.created",
      platformId: "platform_1",
      externalOrderId: "order_123",
      dispute,
    });
    const { db, set } = dbWithUpdate();

    const result = await deliverDisputeModuleWebhookOutboxRecord(
      db as never,
      outboxRecord(envelope),
      { fetchImpl: fetchMock },
    );

    expect(result).toMatchObject({ status: "delivered", httpStatus: 202 });
    expect(result.outboxStatus).toBe("DELIVERED");
    expect(set).toHaveBeenCalledWith(expect.objectContaining({
      status: "DELIVERED",
      attemptCount: 1,
      lastError: null,
      deliveredAt: expect.any(Date),
      updatedAt: expect.any(Date),
    }));
  });

  it("marks outbox records failed with retry metadata after an unsuccessful delivery", async () => {
    process.env.DISPUTE_MODULE_PLATFORM_WEBHOOKS = JSON.stringify({
      platform_1: {
        url: "https://platform.example/webhooks/haggle",
        secret: "webhook-secret-with-length",
      },
    });
    const fetchMock = vi.fn().mockResolvedValue(new Response("unavailable", { status: 503 }));
    const envelope = buildDisputeModuleWebhookEnvelope({
      type: "dispute.case.created",
      platformId: "platform_1",
      externalOrderId: "order_123",
      dispute,
    });
    const { db, set } = dbWithUpdate();

    const result = await deliverDisputeModuleWebhookOutboxRecord(
      db as never,
      outboxRecord(envelope, { attemptCount: 1 }),
      { fetchImpl: fetchMock },
    );

    expect(result).toMatchObject({ status: "failed", httpStatus: 503 });
    expect(result.outboxStatus).toBe("FAILED");
    expect(set).toHaveBeenCalledWith(expect.objectContaining({
      status: "FAILED",
      attemptCount: 2,
      lastError: "HTTP 503",
      nextAttemptAt: expect.any(Date),
      updatedAt: expect.any(Date),
    }));
  });

  it("moves failed outbox records to dead letter after the retry budget is exhausted", async () => {
    process.env.DISPUTE_MODULE_PLATFORM_WEBHOOKS = JSON.stringify({
      platform_1: {
        url: "https://platform.example/webhooks/haggle",
        secret: "webhook-secret-with-length",
      },
    });
    process.env.DISPUTE_MODULE_WEBHOOK_MAX_ATTEMPTS = "2";
    const fetchMock = vi.fn().mockResolvedValue(new Response("unavailable", { status: 503 }));
    const envelope = buildDisputeModuleWebhookEnvelope({
      type: "dispute.case.created",
      platformId: "platform_1",
      externalOrderId: "order_123",
      dispute,
    });
    const { db, set } = dbWithUpdate();

    const result = await deliverDisputeModuleWebhookOutboxRecord(
      db as never,
      outboxRecord(envelope, { attemptCount: 1 }),
      { fetchImpl: fetchMock },
    );

    expect(result).toMatchObject({ status: "failed", httpStatus: 503 });
    expect(result.outboxStatus).toBe("DEAD_LETTER");
    expect(set).toHaveBeenCalledWith(expect.objectContaining({
      status: "DEAD_LETTER",
      attemptCount: 2,
      lastError: "HTTP 503",
    }));
  });

  it("claims due outbox records with a processing lease", async () => {
    const envelope = buildDisputeModuleWebhookEnvelope({
      type: "dispute.case.created",
      platformId: "platform_1",
      externalOrderId: "order_123",
      dispute,
    });
    const row = outboxDbRow(outboxRecord(envelope, {
      status: "PROCESSING",
      nextAttemptAt: new Date("2026-05-05T00:02:00.000Z"),
    }));
    const { db, execute } = dbWithExecuteRowsAndUpdate([row]);

    const records = await claimDueDisputeModuleWebhookOutboxRecords(db as never, {
      limit: 10,
      now: new Date("2026-05-05T00:00:00.000Z"),
      leaseMs: 120_000,
    });

    expect(records).toHaveLength(1);
    expect(records[0]).toMatchObject({
      eventId: envelope.id,
      status: "PROCESSING",
      platformId: "platform_1",
    });
    expect(execute).toHaveBeenCalledTimes(1);
  });

  it("dispatches claimed due outbox records and records delivery outcomes", async () => {
    process.env.DISPUTE_MODULE_PLATFORM_WEBHOOKS = JSON.stringify({
      platform_1: {
        url: "https://platform.example/webhooks/haggle",
        secret: "webhook-secret-with-length",
      },
    });
    const envelope = buildDisputeModuleWebhookEnvelope({
      type: "dispute.case.created",
      platformId: "platform_1",
      externalOrderId: "order_123",
      dispute,
    });
    const record = outboxRecord(envelope, { status: "PROCESSING" });
    const { db, set } = dbWithExecuteRowsAndUpdate([outboxDbRow(record)]);
    const fetchMock = vi.fn().mockResolvedValue(new Response("ok", { status: 200 }));

    const result = await dispatchDueDisputeModuleWebhookOutbox(db as never, {
      fetchImpl: fetchMock,
      limit: 5,
      now: new Date("2026-05-05T00:00:00.000Z"),
    });

    expect(result).toEqual({
      claimed: 1,
      delivered: 1,
      failed: 0,
      skipped: 0,
      deadLettered: 0,
      deadLetterEvents: [],
    });
    expect(set).toHaveBeenCalledWith(expect.objectContaining({
      status: "DELIVERED",
      attemptCount: 1,
    }));
  });

  it("counts dead-lettered records during outbox dispatch", async () => {
    process.env.DISPUTE_MODULE_PLATFORM_WEBHOOKS = JSON.stringify({
      platform_1: {
        url: "https://platform.example/webhooks/haggle",
        secret: "webhook-secret-with-length",
      },
    });
    process.env.DISPUTE_MODULE_WEBHOOK_MAX_ATTEMPTS = "2";
    const envelope = buildDisputeModuleWebhookEnvelope({
      type: "dispute.case.created",
      platformId: "platform_1",
      externalOrderId: "order_123",
      dispute,
    });
    const record = outboxRecord(envelope, {
      status: "PROCESSING",
      attemptCount: 1,
    });
    const { db, set } = dbWithExecuteRowsAndUpdate([outboxDbRow(record)]);
    const fetchMock = vi.fn().mockResolvedValue(new Response("unavailable", { status: 503 }));

    const result = await dispatchDueDisputeModuleWebhookOutbox(db as never, {
      fetchImpl: fetchMock,
      limit: 5,
      now: new Date("2026-05-05T00:00:00.000Z"),
    });

    expect(result).toEqual({
      claimed: 1,
      delivered: 0,
      failed: 1,
      skipped: 0,
      deadLettered: 1,
      deadLetterEvents: [
        {
          eventId: envelope.id,
          platformId: "platform_1",
          disputeId: dispute.id,
          attemptCount: 2,
        },
      ],
    });
    expect(set).toHaveBeenCalledWith(expect.objectContaining({
      status: "DEAD_LETTER",
      attemptCount: 2,
    }));
  });

  it("marks claimed outbox records failed when platform config is missing", async () => {
    const envelope = buildDisputeModuleWebhookEnvelope({
      type: "dispute.case.created",
      platformId: "platform_1",
      externalOrderId: "order_123",
      dispute,
    });
    const { db, set } = dbWithUpdate();

    const result = await deliverDisputeModuleWebhookOutboxRecord(
      db as never,
      outboxRecord(envelope, { status: "PROCESSING", attemptCount: 2 }),
    );

    expect(result).toMatchObject({ status: "skipped", eventId: envelope.id });
    expect(result.outboxStatus).toBe("FAILED");
    expect(set).toHaveBeenCalledWith(expect.objectContaining({
      status: "FAILED",
      attemptCount: 3,
      lastError: "Missing webhook config for platform platform_1",
    }));
  });

  it("lists dead-letter outbox records for admin review", async () => {
    const envelope = buildDisputeModuleWebhookEnvelope({
      type: "dispute.case.created",
      platformId: "platform_1",
      externalOrderId: "order_123",
      dispute,
    });
    const record = outboxRecord(envelope, {
      status: "DEAD_LETTER",
      attemptCount: 10,
      lastError: "HTTP 503",
    });
    const { db, execute } = dbWithExecuteRowsAndUpdate([outboxDbRow(record)]);

    const records = await listDeadLetterDisputeModuleWebhookOutboxRecords(db as never, {
      limit: 25,
    });

    expect(records).toHaveLength(1);
    expect(records[0]).toMatchObject({
      eventId: envelope.id,
      status: "DEAD_LETTER",
      lastError: "HTTP 503",
    });
    expect(execute).toHaveBeenCalledTimes(1);
  });

  it("resets failed or dead-letter outbox records for admin replay", async () => {
    const envelope = buildDisputeModuleWebhookEnvelope({
      type: "dispute.case.created",
      platformId: "platform_1",
      externalOrderId: "order_123",
      dispute,
    });
    const record = outboxRecord(envelope, {
      status: "PENDING",
      attemptCount: 0,
      lastError: null,
      nextAttemptAt: new Date("2026-05-05T00:00:00.000Z"),
    });
    const { db, execute } = dbWithExecuteRowsAndUpdate([outboxDbRow(record)]);

    const replay = await resetDisputeModuleWebhookOutboxRecordForReplay(
      db as never,
      envelope.id,
      { now: new Date("2026-05-05T00:00:00.000Z") },
    );

    expect(replay).toMatchObject({
      eventId: envelope.id,
      status: "PENDING",
      attemptCount: 0,
      lastError: null,
    });
    expect(execute).toHaveBeenCalledTimes(1);
  });
});
