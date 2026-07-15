import { createHash } from "node:crypto";
import Fastify, { type FastifyInstance } from "fastify";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { registerDisputeModuleRoutes } from "../routes/dispute-modules.js";
import { signDisputeModulePayload } from "../services/dispute-module-auth.service.js";

const secret = "module-route-secret-with-length";

function body(overrides: Record<string, unknown> = {}) {
  return {
    transaction: {
      platform_id: "platform_1",
      external_order_id: "order_ext_1",
      buyer_actor_id: "buyer_1",
      seller_actor_id: "seller_1",
      amount_minor: 50_000,
      currency: "USD",
      status: "DELIVERED",
    },
    request: {
      requester_actor_id: "buyer_1",
      reason_code: "ITEM_NOT_AS_DESCRIBED",
      summary: "Battery condition was materially different.",
      client_request_id: "client_1",
    },
    ...overrides,
  };
}

function headers(
  rawBody: Buffer,
  overrides: Record<string, string> = {},
  path = "/modules/disputes/v1/cases/preview",
) {
  const timestamp = new Date().toISOString();
  return {
    "content-type": "application/json",
    "x-haggle-module-platform-id": "platform_1",
    "x-haggle-module-timestamp": timestamp,
    "x-haggle-idempotency-key": "idem_route_123",
    "x-haggle-module-signature": signDisputeModulePayload({
      secret,
      timestamp,
      method: "POST",
      path,
      rawBody,
    }),
    ...overrides,
  };
}

function stableJson(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map((item) => stableJson(item)).join(",")}]`;
  if (value && typeof value === "object") {
    const record = value as Record<string, unknown>;
    return `{${Object.keys(record)
      .sort()
      .filter((key) => record[key] !== undefined)
      .map((key) => `${JSON.stringify(key)}:${stableJson(record[key])}`)
      .join(",")}}`;
  }
  return JSON.stringify(value);
}

function requestFingerprint(value: unknown): string {
  return `sha256:${createHash("sha256").update(stableJson(value)).digest("hex")}`;
}

function disputeRow(overrides: Record<string, unknown> = {}) {
  return {
    id: "11111111-1111-5111-9111-111111111111",
    orderId: "22222222-2222-5222-9222-222222222222",
    reasonCode: "ITEM_NOT_AS_DESCRIBED",
    status: "OPEN",
    openedBy: "buyer",
    openedAt: new Date("2026-05-05T00:00:00.000Z"),
    metadata: {
      source: "dispute_module_api",
      tier: 1,
      platform_id: "platform_1",
      external_order_id: "order_ext_1",
      transaction_snapshot: body().transaction,
      idempotency_key: "idem_route_123",
    },
    ...overrides,
  };
}

function escalationBody(overrides: Record<string, unknown> = {}) {
  return {
    external_order_id: "order_ext_1",
    requester_actor_id: "buyer_1",
    reason: "I want a reviewer panel to inspect the evidence.",
    client_request_id: "esc_1",
    ...overrides,
  };
}

function dbForModuleRoute(
  options: {
    activeDispute?: ReturnType<typeof disputeRow>;
    idempotencyRecord?: Record<string, unknown>;
    insertError?: Error;
  } = {},
) {
  const disputeCaseFindFirst = vi.fn();
  if (options.activeDispute) {
    disputeCaseFindFirst
      .mockResolvedValueOnce(options.activeDispute)
      .mockResolvedValueOnce(options.activeDispute);
  } else {
    disputeCaseFindFirst.mockResolvedValue(null);
  }

  const insertValues = vi.fn((value: Record<string, unknown> | Record<string, unknown>[]) => ({
    returning: vi.fn(async () => {
      if (options.insertError) throw options.insertError;
      if (Array.isArray(value)) return [];
      if ("eventId" in value) {
        return [
          {
            id: "outbox_1",
            eventId: value.eventId,
            platformId: value.platformId,
            externalOrderId: value.externalOrderId,
            disputeId: value.disputeId,
            eventType: value.eventType,
            payload: value.payload,
            status: value.status ?? "PENDING",
            attemptCount: 0,
            nextAttemptAt: value.nextAttemptAt ?? new Date("2026-05-05T00:00:00.000Z"),
            lastError: null,
            deliveredAt: null,
            createdAt: new Date("2026-05-05T00:00:00.000Z"),
            updatedAt: new Date("2026-05-05T00:00:00.000Z"),
          },
        ];
      }
      return [
        disputeRow({
          id: value.id,
          orderId: value.orderId,
          reasonCode: value.reasonCode,
          status: value.status,
          openedBy: value.openedBy,
          openedAt: value.openedAt,
          metadata: value.metadata,
        }),
      ];
    }),
  }));

  const db = {
    query: {
      disputeCases: { findFirst: disputeCaseFindFirst },
      disputeEvidence: { findMany: vi.fn().mockResolvedValue([]) },
      disputeModuleIdempotencyKeys: {
        findFirst: vi.fn().mockResolvedValue(options.idempotencyRecord ?? null),
      },
      disputeResolutions: { findFirst: vi.fn().mockResolvedValue(null) },
    },
    insert: vi.fn(() => ({
      values: insertValues,
    })),
    update: vi.fn().mockReturnValue({
      set: vi.fn().mockReturnValue({
        where: vi.fn().mockResolvedValue([]),
      }),
    }),
  };

  return { db, disputeCaseFindFirst, insertValues };
}

describe("dispute module routes", () => {
  let app: FastifyInstance;
  const originalSecrets = process.env.DISPUTE_MODULE_PLATFORM_SECRETS;
  const originalWebhooks = process.env.DISPUTE_MODULE_PLATFORM_WEBHOOKS;

  beforeEach(async () => {
    process.env.DISPUTE_MODULE_PLATFORM_SECRETS = JSON.stringify({ platform_1: secret });
    delete process.env.DISPUTE_MODULE_PLATFORM_CONFIGS;
    delete process.env.DISPUTE_MODULE_PLATFORM_WEBHOOKS;
    app = Fastify();
    app.addContentTypeParser("application/json", { parseAs: "buffer" }, (request, raw, done) => {
      (request as unknown as { rawBody: Buffer }).rawBody = raw as Buffer;
      done(null, JSON.parse((raw as Buffer).toString("utf8")));
    });
    registerDisputeModuleRoutes(app, {} as never);
    await app.ready();
  });

  afterEach(async () => {
    if (originalSecrets === undefined) {
      delete process.env.DISPUTE_MODULE_PLATFORM_SECRETS;
    } else {
      process.env.DISPUTE_MODULE_PLATFORM_SECRETS = originalSecrets;
    }
    if (originalWebhooks === undefined) {
      delete process.env.DISPUTE_MODULE_PLATFORM_WEBHOOKS;
    } else {
      process.env.DISPUTE_MODULE_PLATFORM_WEBHOOKS = originalWebhooks;
    }
    delete process.env.DISPUTE_MODULE_PLATFORM_CONFIGS;
    await app.close();
  });

  it("returns a signed dispute preview for a platform transaction", async () => {
    const rawBody = Buffer.from(JSON.stringify(body()));
    const res = await app.inject({
      method: "POST",
      url: "/modules/disputes/v1/cases/preview",
      headers: headers(rawBody),
      payload: rawBody,
    });

    expect(res.statusCode).toBe(200);
    expect(res.json()).toMatchObject({
      ok: true,
      platform_id: "platform_1",
      idempotency_key: "idem_route_123",
      opened_by: "buyer",
      external_order_id: "order_ext_1",
    });
    expect(res.json().costs).toHaveLength(3);
  });

  it("uses server-side platform config rather than request config", async () => {
    process.env.DISPUTE_MODULE_PLATFORM_CONFIGS = JSON.stringify({
      platform_1: {
        tier2_rate: 0.008,
        tier2_min_cents: 5000,
        reviewer_share: 0.6,
        platform_share: 0.4,
      },
    });
    const rawBody = Buffer.from(JSON.stringify(body()));
    const res = await app.inject({
      method: "POST",
      url: "/modules/disputes/v1/cases/preview",
      headers: headers(rawBody),
      payload: rawBody,
    });

    expect(res.statusCode).toBe(200);
    const tier2 = res.json().costs.find((cost: { tier: number }) => cost.tier === 2);
    expect(tier2.cost_cents).toBe(5000);
    expect(res.json().config).toMatchObject({
      reviewer_share: 0.6,
      platform_share: 0.4,
    });
  });

  it("rejects client-supplied module config", async () => {
    const rawBody = Buffer.from(
      JSON.stringify(
        body({
          config: {
            tier2_rate: 0.001,
            tier2_min_cents: 1,
          },
        }),
      ),
    );
    const res = await app.inject({
      method: "POST",
      url: "/modules/disputes/v1/cases/preview",
      headers: headers(rawBody),
      payload: rawBody,
    });

    expect(res.statusCode).toBe(400);
    expect(res.json().error).toBe("INVALID_MODULE_REQUEST");
  });

  it("rejects invalid server-side platform config instead of falling back to defaults", async () => {
    process.env.DISPUTE_MODULE_PLATFORM_CONFIGS = JSON.stringify({
      platform_1: {
        reviewer_share: 0.8,
        platform_share: 0.8,
      },
    });
    const rawBody = Buffer.from(JSON.stringify(body()));
    const res = await app.inject({
      method: "POST",
      url: "/modules/disputes/v1/cases/preview",
      headers: headers(rawBody),
      payload: rawBody,
    });

    expect(res.statusCode).toBe(500);
    expect(res.json().error).toBe("INVALID_MODULE_PLATFORM_CONFIG");
  });

  it("rejects module case creation when server-side platform config is invalid", async () => {
    process.env.DISPUTE_MODULE_PLATFORM_CONFIGS = JSON.stringify({
      platform_1: {
        tier2_min_cents: -1,
      },
    });
    const { db } = dbForModuleRoute();
    const localApp = Fastify();
    localApp.addContentTypeParser(
      "application/json",
      { parseAs: "buffer" },
      (request, raw, done) => {
        (request as unknown as { rawBody: Buffer }).rawBody = raw as Buffer;
        done(null, JSON.parse((raw as Buffer).toString("utf8")));
      },
    );
    registerDisputeModuleRoutes(localApp, db as never);
    await localApp.ready();

    const rawBody = Buffer.from(JSON.stringify(body()));
    const res = await localApp.inject({
      method: "POST",
      url: "/modules/disputes/v1/cases",
      headers: headers(rawBody, {}, "/modules/disputes/v1/cases"),
      payload: rawBody,
    });

    expect(res.statusCode).toBe(500);
    expect(res.json().error).toBe("INVALID_MODULE_PLATFORM_CONFIG");

    await localApp.close();
  });

  it("rejects unsigned module requests", async () => {
    const rawBody = Buffer.from(JSON.stringify(body()));
    const res = await app.inject({
      method: "POST",
      url: "/modules/disputes/v1/cases/preview",
      headers: {
        "content-type": "application/json",
      },
      payload: rawBody,
    });

    expect(res.statusCode).toBe(401);
    expect(res.json().error).toBe("MISSING_MODULE_AUTH");
  });

  it("rejects platform id mismatch between signature and transaction", async () => {
    const rawBody = Buffer.from(
      JSON.stringify(
        body({
          transaction: {
            ...body().transaction,
            platform_id: "platform_2",
          },
        }),
      ),
    );
    const res = await app.inject({
      method: "POST",
      url: "/modules/disputes/v1/cases/preview",
      headers: headers(rawBody),
      payload: rawBody,
    });

    expect(res.statusCode).toBe(403);
    expect(res.json().error).toBe("PLATFORM_MISMATCH");
  });

  it("creates a signed module dispute case with derived role and persisted snapshot", async () => {
    const { db, insertValues } = dbForModuleRoute();
    const localApp = Fastify();
    localApp.addContentTypeParser(
      "application/json",
      { parseAs: "buffer" },
      (request, raw, done) => {
        (request as unknown as { rawBody: Buffer }).rawBody = raw as Buffer;
        done(null, JSON.parse((raw as Buffer).toString("utf8")));
      },
    );
    registerDisputeModuleRoutes(localApp, db as never);
    await localApp.ready();

    const rawBody = Buffer.from(JSON.stringify(body()));
    const res = await localApp.inject({
      method: "POST",
      url: "/modules/disputes/v1/cases",
      headers: headers(rawBody, {}, "/modules/disputes/v1/cases"),
      payload: rawBody,
    });

    expect(res.statusCode).toBe(201);
    expect(res.json()).toMatchObject({
      ok: true,
      platform_id: "platform_1",
      external_order_id: "order_ext_1",
      idempotency_key: "idem_route_123",
      idempotent: false,
      dispute: {
        opened_by: "buyer",
        metadata: {
          source: "dispute_module_api",
          tier: 1,
          platform_id: "platform_1",
          external_order_id: "order_ext_1",
          idempotency_key: "idem_route_123",
          request_fingerprint: expect.stringMatching(/^sha256:[0-9a-f]{64}$/),
        },
      },
    });
    expect(res.json().dispute.order_id).toMatch(/^[0-9a-f-]{36}$/);
    expect(insertValues).toHaveBeenCalledWith(
      expect.objectContaining({
        openedBy: "buyer",
        metadata: expect.objectContaining({
          transaction_snapshot: expect.objectContaining({ external_order_id: "order_ext_1" }),
        }),
      }),
    );
    expect(insertValues).toHaveBeenCalledWith(
      expect.objectContaining({
        platformId: "platform_1",
        idempotencyKey: "idem_route_123",
        requestFingerprint: expect.stringMatching(/^sha256:[0-9a-f]{64}$/),
      }),
    );
    expect(insertValues).toHaveBeenCalledWith(
      expect.objectContaining({
        eventId: expect.stringMatching(/^evt_[0-9a-f]{32}$/),
        platformId: "platform_1",
        externalOrderId: "order_ext_1",
        eventType: "dispute.case.created",
        payload: expect.objectContaining({
          type: "dispute.case.created",
          platform_id: "platform_1",
          external_order_id: "order_ext_1",
        }),
      }),
    );

    await localApp.close();
  });

  it("rejects reused module idempotency keys with a different request fingerprint", async () => {
    const { db, insertValues } = dbForModuleRoute({
      idempotencyRecord: {
        id: "idem_1",
        platformId: "platform_1",
        idempotencyKey: "idem_route_123",
        requestFingerprint:
          "sha256:0000000000000000000000000000000000000000000000000000000000000000",
        disputeId: "11111111-1111-5111-9111-111111111111",
        createdAt: new Date("2026-05-05T00:00:00.000Z"),
      },
    });
    const localApp = Fastify();
    localApp.addContentTypeParser(
      "application/json",
      { parseAs: "buffer" },
      (request, raw, done) => {
        (request as unknown as { rawBody: Buffer }).rawBody = raw as Buffer;
        done(null, JSON.parse((raw as Buffer).toString("utf8")));
      },
    );
    registerDisputeModuleRoutes(localApp, db as never);
    await localApp.ready();

    const rawBody = Buffer.from(
      JSON.stringify(
        body({
          transaction: {
            ...body().transaction,
            external_order_id: "order_ext_2",
          },
        }),
      ),
    );
    const res = await localApp.inject({
      method: "POST",
      url: "/modules/disputes/v1/cases",
      headers: headers(rawBody, {}, "/modules/disputes/v1/cases"),
      payload: rawBody,
    });

    expect(res.statusCode).toBe(409);
    expect(res.json().error).toBe("IDEMPOTENCY_KEY_REUSED");
    expect(insertValues).not.toHaveBeenCalled();

    await localApp.close();
  });

  it("replays a module case create when the active dispute has the same idempotency key", async () => {
    process.env.DISPUTE_MODULE_PLATFORM_CONFIGS = JSON.stringify({
      platform_1: {
        reviewer_share: 0.8,
        platform_share: 0.8,
      },
    });
    const requestBody = body();
    const fingerprint = requestFingerprint(requestBody);
    const { db } = dbForModuleRoute({
      idempotencyRecord: {
        id: "idem_1",
        platformId: "platform_1",
        idempotencyKey: "idem_route_123",
        requestFingerprint: fingerprint,
        disputeId: "11111111-1111-5111-9111-111111111111",
        createdAt: new Date("2026-05-05T00:00:00.000Z"),
      },
      activeDispute: disputeRow({
        metadata: {
          source: "dispute_module_api",
          idempotency_key: "idem_route_123",
          request_fingerprint: fingerprint,
        },
      }),
    });
    const localApp = Fastify();
    localApp.addContentTypeParser(
      "application/json",
      { parseAs: "buffer" },
      (request, raw, done) => {
        (request as unknown as { rawBody: Buffer }).rawBody = raw as Buffer;
        done(null, JSON.parse((raw as Buffer).toString("utf8")));
      },
    );
    registerDisputeModuleRoutes(localApp, db as never);
    await localApp.ready();

    const rawBody = Buffer.from(JSON.stringify(requestBody));
    const res = await localApp.inject({
      method: "POST",
      url: "/modules/disputes/v1/cases",
      headers: headers(rawBody, {}, "/modules/disputes/v1/cases"),
      payload: rawBody,
    });

    expect(res.statusCode).toBe(200);
    expect(res.json()).toMatchObject({
      ok: true,
      idempotent: true,
      dispute: { id: "11111111-1111-5111-9111-111111111111" },
    });

    await localApp.close();
  });

  it("rejects module case create when another active dispute exists for the platform order", async () => {
    const { db } = dbForModuleRoute({
      activeDispute: disputeRow({
        metadata: {
          source: "dispute_module_api",
          idempotency_key: "other_idem_key",
        },
      }),
    });
    const localApp = Fastify();
    localApp.addContentTypeParser(
      "application/json",
      { parseAs: "buffer" },
      (request, raw, done) => {
        (request as unknown as { rawBody: Buffer }).rawBody = raw as Buffer;
        done(null, JSON.parse((raw as Buffer).toString("utf8")));
      },
    );
    registerDisputeModuleRoutes(localApp, db as never);
    await localApp.ready();

    const rawBody = Buffer.from(JSON.stringify(body()));
    const res = await localApp.inject({
      method: "POST",
      url: "/modules/disputes/v1/cases",
      headers: headers(rawBody, {}, "/modules/disputes/v1/cases"),
      payload: rawBody,
    });

    expect(res.statusCode).toBe(409);
    expect(res.json().error).toBe("ACTIVE_MODULE_DISPUTE_EXISTS");

    await localApp.close();
  });

  it("previews signed module escalation from T1 to T2", async () => {
    const { db } = dbForModuleRoute({ activeDispute: disputeRow() });
    const localApp = Fastify();
    localApp.addContentTypeParser(
      "application/json",
      { parseAs: "buffer" },
      (request, raw, done) => {
        (request as unknown as { rawBody: Buffer }).rawBody = raw as Buffer;
        done(null, JSON.parse((raw as Buffer).toString("utf8")));
      },
    );
    registerDisputeModuleRoutes(localApp, db as never);
    await localApp.ready();

    const path =
      "/modules/disputes/v1/cases/11111111-1111-5111-9111-111111111111/escalations/preview";
    const rawBody = Buffer.from(JSON.stringify(escalationBody()));
    const res = await localApp.inject({
      method: "POST",
      url: path,
      headers: headers(rawBody, {}, path),
      payload: rawBody,
    });

    expect(res.statusCode).toBe(200);
    expect(res.json()).toMatchObject({
      ok: true,
      platform_id: "platform_1",
      dispute_id: "11111111-1111-5111-9111-111111111111",
      external_order_id: "order_ext_1",
      requested_by: "buyer",
      previous_tier: 1,
      new_tier: 2,
      cost: {
        tier: 2,
        cost_cents: 1_200,
        reviewer_count: 5,
      },
      seller_deposit_requirement: {
        amount_cents: 50_000,
        deadline_hours: 48,
        status: "PENDING",
      },
    });

    await localApp.close();
  });

  it("creates signed module escalation and stores server-computed tier economics", async () => {
    const { db, insertValues } = dbForModuleRoute({ activeDispute: disputeRow() });
    const localApp = Fastify();
    localApp.addContentTypeParser(
      "application/json",
      { parseAs: "buffer" },
      (request, raw, done) => {
        (request as unknown as { rawBody: Buffer }).rawBody = raw as Buffer;
        done(null, JSON.parse((raw as Buffer).toString("utf8")));
      },
    );
    registerDisputeModuleRoutes(localApp, db as never);
    await localApp.ready();

    const path = "/modules/disputes/v1/cases/11111111-1111-5111-9111-111111111111/escalations";
    const rawBody = Buffer.from(JSON.stringify(escalationBody()));
    const res = await localApp.inject({
      method: "POST",
      url: path,
      headers: headers(rawBody, {}, path),
      payload: rawBody,
    });

    expect(res.statusCode).toBe(201);
    expect(res.json()).toMatchObject({
      ok: true,
      previous_tier: 1,
      new_tier: 2,
      dispute: {
        status: "UNDER_REVIEW",
        metadata: {
          tier: 2,
          escalated_by_actor_id: "buyer_1",
          escalated_by_role: "buyer",
          current_tier_cost: {
            tier: 2,
            cost_cents: 1_200,
          },
          current_seller_deposit_requirement: {
            amount_cents: 50_000,
            deadline_hours: 48,
          },
        },
      },
    });
    expect(insertValues).toHaveBeenCalledWith(
      expect.objectContaining({
        platformId: "platform_1",
        idempotencyKey: "idem_route_123",
        requestFingerprint: expect.stringMatching(/^sha256:[0-9a-f]{64}$/),
        disputeId: "11111111-1111-5111-9111-111111111111",
      }),
    );
    expect(insertValues).toHaveBeenCalledWith(
      expect.objectContaining({
        eventId: expect.stringMatching(/^evt_[0-9a-f]{32}$/),
        platformId: "platform_1",
        externalOrderId: "order_ext_1",
        eventType: "dispute.case.escalated",
        payload: expect.objectContaining({
          type: "dispute.case.escalated",
          platform_id: "platform_1",
          external_order_id: "order_ext_1",
          data: expect.objectContaining({
            previous_tier: 1,
            new_tier: 2,
            requested_by_role: "buyer",
            cost: expect.objectContaining({ tier: 2, cost_cents: 1_200 }),
            seller_deposit_requirement: expect.objectContaining({ amount_cents: 50_000 }),
          }),
        }),
      }),
    );

    await localApp.close();
  });

  it("rejects module escalation that skips a tier", async () => {
    const { db } = dbForModuleRoute({ activeDispute: disputeRow() });
    const localApp = Fastify();
    localApp.addContentTypeParser(
      "application/json",
      { parseAs: "buffer" },
      (request, raw, done) => {
        (request as unknown as { rawBody: Buffer }).rawBody = raw as Buffer;
        done(null, JSON.parse((raw as Buffer).toString("utf8")));
      },
    );
    registerDisputeModuleRoutes(localApp, db as never);
    await localApp.ready();

    const path = "/modules/disputes/v1/cases/11111111-1111-5111-9111-111111111111/escalations";
    const rawBody = Buffer.from(JSON.stringify(escalationBody({ to_tier: 3 })));
    const res = await localApp.inject({
      method: "POST",
      url: path,
      headers: headers(rawBody, {}, path),
      payload: rawBody,
    });

    expect(res.statusCode).toBe(409);
    expect(res.json().error).toBe("TIER_NOT_ADVANCING");

    await localApp.close();
  });

  it("rejects module escalation by a non-party actor", async () => {
    const { db } = dbForModuleRoute({ activeDispute: disputeRow() });
    const localApp = Fastify();
    localApp.addContentTypeParser(
      "application/json",
      { parseAs: "buffer" },
      (request, raw, done) => {
        (request as unknown as { rawBody: Buffer }).rawBody = raw as Buffer;
        done(null, JSON.parse((raw as Buffer).toString("utf8")));
      },
    );
    registerDisputeModuleRoutes(localApp, db as never);
    await localApp.ready();

    const path = "/modules/disputes/v1/cases/11111111-1111-5111-9111-111111111111/escalations";
    const rawBody = Buffer.from(JSON.stringify(escalationBody({ requester_actor_id: "stranger" })));
    const res = await localApp.inject({
      method: "POST",
      url: path,
      headers: headers(rawBody, {}, path),
      payload: rawBody,
    });

    expect(res.statusCode).toBe(403);
    expect(res.json().error).toBe("FORBIDDEN");

    await localApp.close();
  });

  it("returns signed module case status with current tier economics", async () => {
    const { db } = dbForModuleRoute({
      activeDispute: disputeRow({
        status: "UNDER_REVIEW",
        metadata: {
          ...disputeRow().metadata,
          tier: 2,
          current_tier_cost: {
            tier: 2,
            cost_cents: 1_200,
            reviewer_count: 5,
          },
          current_seller_deposit_requirement: {
            amount_cents: 50_000,
            deadline_hours: 48,
            status: "PENDING",
          },
          escalation_history: [{ from_tier: 1, to_tier: 2 }],
        },
      }),
    });
    const localApp = Fastify();
    localApp.addContentTypeParser(
      "application/json",
      { parseAs: "buffer" },
      (request, raw, done) => {
        (request as unknown as { rawBody: Buffer }).rawBody = raw as Buffer;
        done(null, JSON.parse((raw as Buffer).toString("utf8")));
      },
    );
    registerDisputeModuleRoutes(localApp, db as never);
    await localApp.ready();

    const path = "/modules/disputes/v1/cases/11111111-1111-5111-9111-111111111111/status";
    const rawBody = Buffer.from(JSON.stringify({ external_order_id: "order_ext_1" }));
    const res = await localApp.inject({
      method: "POST",
      url: path,
      headers: headers(rawBody, {}, path),
      payload: rawBody,
    });

    expect(res.statusCode).toBe(200);
    expect(res.json()).toMatchObject({
      ok: true,
      platform_id: "platform_1",
      dispute_id: "11111111-1111-5111-9111-111111111111",
      external_order_id: "order_ext_1",
      status: "UNDER_REVIEW",
      tier: 2,
      current_tier_cost: {
        tier: 2,
        cost_cents: 1_200,
      },
      current_seller_deposit_requirement: {
        amount_cents: 50_000,
        deadline_hours: 48,
      },
      escalation_history: [{ from_tier: 1, to_tier: 2 }],
    });

    await localApp.close();
  });
});
