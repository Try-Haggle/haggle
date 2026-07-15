import { describe, expect, it, vi } from "vitest";
import {
  buildModuleHeaders,
  buildSigningPayload,
  type HaggleDisputeApiError,
  HaggleDisputeClient,
  type HaggleDisputeResponseValidationError,
  type HaggleDisputeValidationError,
  HaggleDisputeWebhookVerificationError,
  type ModuleDisputeCaseInput,
  redactModuleHeaders,
  type SettlementInstructionWebhookData,
  signDisputeWebhookPayload,
  signModuleRequest,
  validateModuleDisputeCaseInput,
  validateModuleDisputeEscalationInput,
  validateModuleDisputePreviewResponse,
  validateModuleDisputeStatusInput,
  validateSettlementInstruction,
  validateSettlementInstructionWebhookData,
  verifyDisputeWebhook,
} from "../index.js";

const input: ModuleDisputeCaseInput = {
  transaction: {
    platform_id: "platform_1",
    external_order_id: "order_123",
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
};

const settlement: SettlementInstructionWebhookData = {
  dispute_id: "dsp_1",
  status: "PARTIAL_REFUND",
  tier: 2,
  outcome: "partial_refund",
  refund_amount_minor: 10_000,
  resolved_at: "2026-05-05T00:00:00.000Z",
  settlement_instruction: {
    action: "refund_buyer",
    outcome: "partial_refund",
    amount_minor: 10_000,
    currency: "USD",
  },
};

describe("HaggleDisputeClient", () => {
  it("builds the same module signing payload shape as the API expects", () => {
    const body = JSON.stringify(input);
    expect(
      buildSigningPayload({
        timestamp: "2026-05-05T00:00:00.000Z",
        method: "post",
        path: "/modules/disputes/v1/cases",
        body,
      }),
    ).toMatch(/^2026-05-05T00:00:00.000Z\.POST\.\/modules\/disputes\/v1\/cases\.[0-9a-f]{64}$/);

    expect(
      signModuleRequest({
        secret: "sdk-secret-with-length",
        timestamp: "2026-05-05T00:00:00.000Z",
        method: "POST",
        path: "/modules/disputes/v1/cases",
        body,
      }),
    ).toMatch(/^sha256=[0-9a-f]{64}$/);
  });

  it("builds module auth headers for custom HTTP clients", () => {
    const headers = buildModuleHeaders({
      platformId: "platform_1",
      secret: "sdk-secret-with-length",
      timestamp: "2026-05-05T00:00:00.000Z",
      method: "POST",
      path: "modules/disputes/v1/cases",
      body: JSON.stringify(input),
      idempotencyKey: "open:order_123",
    });

    expect(headers).toMatchObject({
      "content-type": "application/json",
      "x-haggle-module-platform-id": "platform_1",
      "x-haggle-module-timestamp": "2026-05-05T00:00:00.000Z",
      "x-haggle-idempotency-key": "open:order_123",
      "x-haggle-module-signature": expect.stringMatching(/^sha256=[0-9a-f]{64}$/),
    });
  });

  it("sends signed preview requests with caller-provided idempotency keys", async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(
        JSON.stringify({
          ok: true,
          platform_id: "platform_1",
          idempotency_key: "idem_sdk_123",
          opened_by: "buyer",
          external_order_id: "order_123",
          costs: [
            { tier: 1, cost_cents: 300, reviewer_count: null, escalation_period_hours: 24 },
            { tier: 2, cost_cents: 1200, reviewer_count: 3, escalation_period_hours: 24 },
            { tier: 3, cost_cents: 3000, reviewer_count: 5, escalation_period_hours: 24 },
          ],
          config: {
            use_shared_pool: true,
            reviewer_share: 0.7,
            platform_share: 0.3,
          },
        }),
      ),
    );
    const client = new HaggleDisputeClient({
      baseUrl: "https://api.haggle.test/",
      platformId: "platform_1",
      secret: "sdk-secret-with-length",
      fetch: fetchMock,
      now: () => new Date("2026-05-05T00:00:00.000Z"),
    });

    const result = await client.previewCase(input, { idempotencyKey: "idem_sdk_123" });

    expect(result.opened_by).toBe("buyer");
    expect(fetchMock).toHaveBeenCalledWith(
      "https://api.haggle.test/modules/disputes/v1/cases/preview",
      expect.objectContaining({
        method: "POST",
        redirect: "error",
        signal: expect.any(AbortSignal),
        headers: expect.objectContaining({
          "content-type": "application/json",
          "x-haggle-module-platform-id": "platform_1",
          "x-haggle-module-timestamp": "2026-05-05T00:00:00.000Z",
          "x-haggle-idempotency-key": "idem_sdk_123",
          "x-haggle-module-signature": expect.stringMatching(/^sha256=[0-9a-f]{64}$/),
        }),
        body: JSON.stringify(input),
      }),
    );
  });

  it("sends signed escalation preview requests", async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(
        JSON.stringify({
          ok: true,
          platform_id: "platform_1",
          dispute_id: "dsp_1",
          external_order_id: "order_123",
          requested_by: "buyer",
          previous_tier: 1,
          new_tier: 2,
          cost: { tier: 2, cost_cents: 1200, reviewer_count: 5, escalation_period_hours: 24 },
          seller_deposit_requirement: {
            amount_cents: 50_000,
            deadline_hours: 48,
            status: "PENDING",
          },
        }),
      ),
    );
    const client = new HaggleDisputeClient({
      baseUrl: "https://api.haggle.test/",
      platformId: "platform_1",
      secret: "sdk-secret-with-length",
      fetch: fetchMock,
      now: () => new Date("2026-05-05T00:00:00.000Z"),
    });

    const result = await client.previewEscalation(
      "dsp_1",
      {
        external_order_id: "order_123",
        requester_actor_id: "buyer_1",
        reason: "Escalate to reviewer panel.",
      },
      { idempotencyKey: "preview-esc:order_123" },
    );

    expect(result.new_tier).toBe(2);
    expect(fetchMock).toHaveBeenCalledWith(
      "https://api.haggle.test/modules/disputes/v1/cases/dsp_1/escalations/preview",
      expect.objectContaining({
        method: "POST",
        redirect: "error",
        headers: expect.objectContaining({
          "x-haggle-idempotency-key": "preview-esc:order_123",
          "x-haggle-module-signature": expect.stringMatching(/^sha256=[0-9a-f]{64}$/),
        }),
        body: JSON.stringify({
          external_order_id: "order_123",
          requester_actor_id: "buyer_1",
          reason: "Escalate to reviewer panel.",
        }),
      }),
    );
  });

  it("sends signed escalation create and status requests", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            ok: true,
            platform_id: "platform_1",
            dispute_id: "dsp_1",
            external_order_id: "order_123",
            requested_by: "buyer",
            previous_tier: 1,
            new_tier: 2,
            cost: { tier: 2, cost_cents: 1200, reviewer_count: 5, escalation_period_hours: 24 },
            seller_deposit_requirement: {
              amount_cents: 50_000,
              deadline_hours: 48,
              status: "PENDING",
            },
            dispute: {
              id: "dsp_1",
              order_id: "ord_1",
              reason_code: "ITEM_NOT_AS_DESCRIBED",
              status: "UNDER_REVIEW",
              opened_by: "buyer",
              opened_at: "2026-05-05T00:00:00.000Z",
              evidence: [],
            },
            idempotency_key: "esc:order_123:t2",
            idempotent: false,
          }),
        ),
      )
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            ok: true,
            platform_id: "platform_1",
            dispute_id: "dsp_1",
            external_order_id: "order_123",
            status: "UNDER_REVIEW",
            tier: 2,
            current_tier_cost: {
              tier: 2,
              cost_cents: 1200,
              reviewer_count: 5,
              escalation_period_hours: 24,
            },
            current_seller_deposit_requirement: {
              amount_cents: 50_000,
              deadline_hours: 48,
              status: "PENDING",
            },
            escalation_history: [{ from_tier: 1, to_tier: 2 }],
            resolution: null,
          }),
        ),
      );
    const client = new HaggleDisputeClient({
      baseUrl: "https://api.haggle.test",
      platformId: "platform_1",
      secret: "sdk-secret-with-length",
      fetch: fetchMock,
    });

    const escalation = await client.createEscalation(
      "dsp_1",
      {
        external_order_id: "order_123",
        requester_actor_id: "buyer_1",
      },
      { idempotencyKey: "esc:order_123:t2" },
    );
    const status = await client.getCaseStatus(
      "dsp_1",
      {
        external_order_id: "order_123",
      },
      { idempotencyKey: "status:order_123" },
    );

    expect(escalation.dispute.status).toBe("UNDER_REVIEW");
    expect(status.tier).toBe(2);
    expect(fetchMock).toHaveBeenNthCalledWith(
      1,
      "https://api.haggle.test/modules/disputes/v1/cases/dsp_1/escalations",
      expect.objectContaining({ method: "POST" }),
    );
    expect(fetchMock).toHaveBeenNthCalledWith(
      2,
      "https://api.haggle.test/modules/disputes/v1/cases/dsp_1/status",
      expect.objectContaining({ method: "POST" }),
    );
  });

  it("rejects preview responses that do not match the request context", async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(
        JSON.stringify({
          ok: true,
          platform_id: "platform_2",
          idempotency_key: "idem_sdk_123",
          opened_by: "buyer",
          external_order_id: "order_123",
          costs: [
            { tier: 1, cost_cents: 300, reviewer_count: null, escalation_period_hours: 24 },
            { tier: 2, cost_cents: 1200, reviewer_count: 3, escalation_period_hours: 24 },
            { tier: 3, cost_cents: 3000, reviewer_count: 5, escalation_period_hours: 24 },
          ],
          config: {
            use_shared_pool: true,
            reviewer_share: 0.7,
            platform_share: 0.3,
          },
        }),
      ),
    );
    const client = new HaggleDisputeClient({
      baseUrl: "https://api.haggle.test",
      platformId: "platform_1",
      secret: "sdk-secret-with-length",
      fetch: fetchMock,
    });

    await expect(
      client.previewCase(input, { idempotencyKey: "idem_sdk_123" }),
    ).rejects.toMatchObject({
      name: "HaggleDisputeResponseValidationError",
      code: "HAGGLE_DISPUTE_RESPONSE_VALIDATION_ERROR",
      issues: expect.arrayContaining([expect.objectContaining({ path: "platform_id" })]),
    } satisfies Partial<HaggleDisputeResponseValidationError>);
  });

  it("reports malformed preview response issues", () => {
    expect(
      validateModuleDisputePreviewResponse(
        {
          ok: true,
          platform_id: "platform_1",
          idempotency_key: "idem_sdk_123",
          opened_by: "buyer",
          external_order_id: "order_123",
          costs: [{ tier: 4, cost_cents: -1, reviewer_count: 0, escalation_period_hours: -1 }],
          config: {
            use_shared_pool: "yes",
            reviewer_share: -0.1,
            platform_share: 1.3,
          },
        },
        {
          platformId: "platform_1",
          externalOrderId: "order_123",
          idempotencyKey: "idem_sdk_123",
        },
      ),
    ).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ path: "costs.0.tier" }),
        expect.objectContaining({ path: "costs.0.cost_cents" }),
        expect.objectContaining({ path: "costs.0.reviewer_count" }),
        expect.objectContaining({ path: "costs.0.escalation_period_hours" }),
        expect.objectContaining({ path: "config.use_shared_pool" }),
        expect.objectContaining({ path: "config.reviewer_share" }),
        expect.objectContaining({ path: "config.platform_share" }),
      ]),
    );
  });

  it("requires HTTPS by default and allows explicit insecure local development", () => {
    expect(
      () =>
        new HaggleDisputeClient({
          baseUrl: "http://api.haggle.test",
          platformId: "platform_1",
          secret: "sdk-secret-with-length",
        }),
    ).toThrow("baseUrl must use HTTPS unless allowInsecureHttp is true");

    expect(
      () =>
        new HaggleDisputeClient({
          baseUrl: "http://localhost:8787",
          platformId: "platform_1",
          secret: "sdk-secret-with-length",
          allowInsecureHttp: true,
        }),
    ).not.toThrow();
  });

  it("rejects base URLs with credentials, query strings, or fragments", () => {
    const baseOptions = {
      platformId: "platform_1",
      secret: "sdk-secret-with-length",
    };

    expect(
      () =>
        new HaggleDisputeClient({
          ...baseOptions,
          baseUrl: "https://user:pass@api.haggle.test",
        }),
    ).toThrow("baseUrl must not include credentials");

    expect(
      () =>
        new HaggleDisputeClient({
          ...baseOptions,
          baseUrl: "https://api.haggle.test?token=abc",
        }),
    ).toThrow("baseUrl must not include query strings or fragments");

    expect(
      () =>
        new HaggleDisputeClient({
          ...baseOptions,
          baseUrl: "https://api.haggle.test#module",
        }),
    ).toThrow("baseUrl must not include query strings or fragments");
  });

  it("redacts module signatures before logging headers", () => {
    const headers = buildModuleHeaders({
      platformId: "platform_1",
      secret: "sdk-secret-with-length",
      timestamp: "2026-05-05T00:00:00.000Z",
      method: "POST",
      path: "/modules/disputes/v1/cases",
      body: JSON.stringify(input),
      idempotencyKey: "open:order_123",
    });

    expect(redactModuleHeaders(headers)).toMatchObject({
      "x-haggle-module-platform-id": "platform_1",
      "x-haggle-module-signature": "sha256=<redacted>",
    });
  });

  it("wraps timed out requests without exposing signed headers", async () => {
    const fetchMock = vi.fn(
      (_url: string, init?: RequestInit) =>
        new Promise((_resolve, reject) => {
          init?.signal?.addEventListener("abort", () =>
            reject(new DOMException("aborted", "AbortError")),
          );
        }),
    );
    const client = new HaggleDisputeClient({
      baseUrl: "https://api.haggle.test",
      platformId: "platform_1",
      secret: "sdk-secret-with-length",
      fetch: fetchMock as typeof fetch,
      timeoutMs: 1,
    });

    await expect(
      client.createCase(input, { idempotencyKey: "open:order_123" }),
    ).rejects.toMatchObject({
      name: "HaggleDisputeApiError",
      status: 0,
      code: "HAGGLE_DISPUTE_REQUEST_TIMEOUT",
    } satisfies Partial<HaggleDisputeApiError>);
  });

  it("validates module dispute inputs before signing requests", async () => {
    const fetchMock = vi.fn();
    const client = new HaggleDisputeClient({
      baseUrl: "https://api.haggle.test",
      platformId: "platform_1",
      secret: "sdk-secret-with-length",
      fetch: fetchMock,
    });

    await expect(
      client.createCase(
        {
          ...input,
          transaction: {
            ...input.transaction,
            platform_id: "platform_2",
          },
        },
        { idempotencyKey: "open:order_123" },
      ),
    ).rejects.toMatchObject({
      name: "HaggleDisputeValidationError",
      code: "HAGGLE_DISPUTE_VALIDATION_ERROR",
      issues: expect.arrayContaining([
        expect.objectContaining({ path: "transaction.platform_id" }),
      ]),
    } satisfies Partial<HaggleDisputeValidationError>);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("reports multiple unsafe input issues without sending requests", () => {
    const invalid = {
      transaction: {
        platform_id: "platform_1",
        external_order_id: "order_123",
        buyer_actor_id: "actor_1",
        seller_actor_id: "actor_1",
        amount_minor: 0,
        currency: "usd",
        status: "UNKNOWN",
      },
      request: {
        requester_actor_id: "intruder",
        reason_code: "UNSUPPORTED",
        summary: "",
      },
    };

    expect(validateModuleDisputeCaseInput(invalid, { platformId: "platform_1" })).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ path: "transaction.seller_actor_id" }),
        expect.objectContaining({ path: "transaction.amount_minor" }),
        expect.objectContaining({ path: "transaction.currency" }),
        expect.objectContaining({ path: "transaction.status" }),
        expect.objectContaining({ path: "request.requester_actor_id" }),
        expect.objectContaining({ path: "request.reason_code" }),
        expect.objectContaining({ path: "request.summary" }),
      ]),
    );
  });

  it("validates escalation inputs before signing", async () => {
    const fetchMock = vi.fn();
    const client = new HaggleDisputeClient({
      baseUrl: "https://api.haggle.test",
      platformId: "platform_1",
      secret: "sdk-secret-with-length",
      fetch: fetchMock,
    });

    await expect(
      client.createEscalation(
        "dsp_1",
        {
          external_order_id: "",
          requester_actor_id: "",
          to_tier: 4 as never,
        },
        { idempotencyKey: "esc:order_123:t2" },
      ),
    ).rejects.toMatchObject({
      name: "HaggleDisputeValidationError",
      issues: expect.arrayContaining([
        expect.objectContaining({ path: "external_order_id" }),
        expect.objectContaining({ path: "requester_actor_id" }),
        expect.objectContaining({ path: "to_tier" }),
      ]),
    });
    expect(fetchMock).not.toHaveBeenCalled();

    expect(
      validateModuleDisputeEscalationInput({
        external_order_id: "order_123",
        requester_actor_id: "buyer_1",
        to_tier: 2,
      }),
    ).toEqual([]);
  });

  it("validates status inputs before signing", async () => {
    const fetchMock = vi.fn();
    const client = new HaggleDisputeClient({
      baseUrl: "https://api.haggle.test",
      platformId: "platform_1",
      secret: "sdk-secret-with-length",
      fetch: fetchMock,
    });

    await expect(
      client.getCaseStatus("dsp_1", undefined as never, {
        idempotencyKey: "status:order_123",
      }),
    ).rejects.toMatchObject({
      name: "HaggleDisputeValidationError",
      issues: [expect.objectContaining({ path: "input" })],
    });
    expect(fetchMock).not.toHaveBeenCalled();
    expect(validateModuleDisputeStatusInput({ external_order_id: "order_123" })).toEqual([]);
  });

  it("rejects non-serializable module inputs before signing", async () => {
    const fetchMock = vi.fn();
    const client = new HaggleDisputeClient({
      baseUrl: "https://api.haggle.test",
      platformId: "platform_1",
      secret: "sdk-secret-with-length",
      fetch: fetchMock,
    });
    const circular = {
      ...input,
      transaction: {
        ...input.transaction,
        metadata: {},
      },
    } as ModuleDisputeCaseInput;
    (circular.transaction.metadata as Record<string, unknown>).self = circular;

    await expect(
      client.previewCase(circular, { idempotencyKey: "preview:order_123" }),
    ).rejects.toMatchObject({
      name: "HaggleDisputeValidationError",
      issues: expect.arrayContaining([
        expect.objectContaining({ path: "input", message: "must be JSON serializable" }),
      ]),
    });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("wraps API error responses with status, code, and body", async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(
        JSON.stringify({
          error: "IDEMPOTENCY_KEY_REUSED",
          message: "key was already used",
        }),
        {
          status: 409,
          headers: { "x-request-id": "req_123" },
        },
      ),
    );
    const client = new HaggleDisputeClient({
      baseUrl: "https://api.haggle.test",
      platformId: "platform_1",
      secret: "sdk-secret-with-length",
      fetch: fetchMock,
    });

    await expect(
      client.createCase(input, { idempotencyKey: "idem_sdk_123" }),
    ).rejects.toMatchObject({
      name: "HaggleDisputeApiError",
      status: 409,
      code: "IDEMPOTENCY_KEY_REUSED",
      requestId: "req_123",
    } satisfies Partial<HaggleDisputeApiError>);
  });

  it("rejects create responses with mismatched idempotency keys", async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(
        JSON.stringify({
          ok: true,
          dispute: {
            id: "dsp_1",
            order_id: "ord_1",
            reason_code: "ITEM_NOT_AS_DESCRIBED",
            status: "OPEN",
            opened_by: "buyer",
            opened_at: "2026-05-05T00:00:00.000Z",
            evidence: [],
          },
          platform_id: "platform_1",
          external_order_id: "order_123",
          idempotency_key: "different_key",
          idempotent: false,
        }),
      ),
    );
    const client = new HaggleDisputeClient({
      baseUrl: "https://api.haggle.test",
      platformId: "platform_1",
      secret: "sdk-secret-with-length",
      fetch: fetchMock,
    });

    await expect(
      client.createCase(input, { idempotencyKey: "open:order_123" }),
    ).rejects.toMatchObject({
      name: "HaggleDisputeResponseValidationError",
      issues: expect.arrayContaining([expect.objectContaining({ path: "idempotency_key" })]),
    });
  });

  it("rejects weak secrets and invalid idempotency keys before sending", async () => {
    expect(
      () =>
        new HaggleDisputeClient({
          baseUrl: "https://api.haggle.test",
          platformId: "platform_1",
          secret: "short",
        }),
    ).toThrow("secret must be at least 16 characters");

    const fetchMock = vi.fn();
    const client = new HaggleDisputeClient({
      baseUrl: "https://api.haggle.test",
      platformId: "platform_1",
      secret: "sdk-secret-with-length",
      fetch: fetchMock,
    });

    await expect(client.createCase(input, { idempotencyKey: "bad" })).rejects.toThrow(
      "idempotencyKey must be 8-128 URL-safe characters",
    );
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("verifies signed dispute webhook envelopes from raw bodies", () => {
    const rawBody = JSON.stringify({
      id: "evt_123",
      type: "dispute.settlement.instruction",
      created_at: "2026-05-05T00:00:00.000Z",
      platform_id: "platform_1",
      external_order_id: "order_123",
      dispute_id: "dsp_1",
      data: settlement,
    });
    const timestamp = "2026-05-05T00:00:00.000Z";
    const signature = signDisputeWebhookPayload({
      secret: "webhook-secret-with-length",
      timestamp,
      eventId: "evt_123",
      rawBody,
    });

    const event = verifyDisputeWebhook<SettlementInstructionWebhookData>({
      rawBody,
      secret: "webhook-secret-with-length",
      timestamp,
      signature,
      eventId: "evt_123",
      platformId: "platform_1",
      nowMs: Date.parse(timestamp),
    });

    expect(event.id).toBe("evt_123");
    expect(event.data.outcome).toBe("partial_refund");
    expect(event.data.settlement_instruction.action).toBe("refund_buyer");
  });

  it("rejects tampered or stale dispute webhooks", () => {
    const rawBody = JSON.stringify({
      id: "evt_123",
      type: "dispute.case.updated",
      created_at: "2026-05-05T00:00:00.000Z",
      platform_id: "platform_1",
      external_order_id: "order_123",
      dispute_id: "dsp_1",
      data: { status: "OPEN" },
    });
    const timestamp = "2026-05-05T00:00:00.000Z";
    const signature = signDisputeWebhookPayload({
      secret: "webhook-secret-with-length",
      timestamp,
      eventId: "evt_123",
      rawBody,
    });

    expect(() =>
      verifyDisputeWebhook({
        rawBody: rawBody.replace("OPEN", "CLOSED"),
        secret: "webhook-secret-with-length",
        timestamp,
        signature,
        eventId: "evt_123",
        nowMs: Date.parse(timestamp),
      }),
    ).toThrow(HaggleDisputeWebhookVerificationError);

    try {
      verifyDisputeWebhook({
        rawBody,
        secret: "webhook-secret-with-length",
        timestamp,
        signature,
        eventId: "evt_123",
        nowMs: Date.parse("2026-05-05T00:10:01.000Z"),
      });
      throw new Error("expected stale webhook to throw");
    } catch (error) {
      expect(error).toMatchObject({
        code: "HAGGLE_WEBHOOK_TIMESTAMP_OUT_OF_RANGE",
      });
    }
  });

  it("validates settlement instruction consistency with the webhook envelope", () => {
    expect(validateSettlementInstruction(settlement.settlement_instruction)).toEqual([]);
    expect(
      validateSettlementInstructionWebhookData(settlement, {
        disputeId: "dsp_1",
      }),
    ).toEqual([]);

    expect(
      validateSettlementInstructionWebhookData(
        {
          ...settlement,
          refund_amount_minor: -1,
          settlement_instruction: {
            ...settlement.settlement_instruction,
            action: "bad",
            amount_minor: -1,
          },
        },
        {
          disputeId: "dsp_1",
        },
      ),
    ).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ path: "data.refund_amount_minor" }),
        expect.objectContaining({ path: "data.settlement_instruction.action" }),
        expect.objectContaining({ path: "data.settlement_instruction.amount_minor" }),
      ]),
    );
  });
});
