import { afterEach, describe, expect, it, vi } from "vitest";
import {
  buildDisputeModuleWebhookDeadLetterAlertPayload,
  resolveDisputeModuleWebhookDeadLetterAlertConfigFromEnv,
  sendDisputeModuleWebhookDeadLetterAlert,
  signDisputeModuleWebhookDeadLetterAlertPayload,
  type DisputeModuleWebhookDeadLetterAlertPayload,
} from "../services/dispute-module-webhook-alert.service.js";
import type { DisputeModuleWebhookOutboxDispatchResult } from "../services/dispute-module-webhook.service.js";

const dispatchResult: DisputeModuleWebhookOutboxDispatchResult = {
  claimed: 2,
  delivered: 0,
  failed: 1,
  skipped: 1,
  deadLettered: 1,
  deadLetterEvents: [
    {
      eventId: "evt_dead",
      platformId: "platform_1",
      disputeId: "11111111-1111-5111-9111-111111111111",
      attemptCount: 10,
    },
  ],
};

describe("dispute module webhook dead-letter alerts", () => {
  const originalUrl = process.env.DISPUTE_MODULE_WEBHOOK_DEAD_LETTER_ALERT_URL;
  const originalSecret = process.env.DISPUTE_MODULE_WEBHOOK_DEAD_LETTER_ALERT_SECRET;
  const originalTimeout = process.env.DISPUTE_MODULE_WEBHOOK_DEAD_LETTER_ALERT_TIMEOUT_MS;
  const originalAllowHttp = process.env.DISPUTE_MODULE_WEBHOOK_DEAD_LETTER_ALERT_ALLOW_INSECURE_HTTP;
  const originalAllowPrivate = process.env.DISPUTE_MODULE_WEBHOOK_DEAD_LETTER_ALERT_ALLOW_PRIVATE_NETWORK;

  afterEach(() => {
    if (originalUrl === undefined) delete process.env.DISPUTE_MODULE_WEBHOOK_DEAD_LETTER_ALERT_URL;
    else process.env.DISPUTE_MODULE_WEBHOOK_DEAD_LETTER_ALERT_URL = originalUrl;
    if (originalSecret === undefined) delete process.env.DISPUTE_MODULE_WEBHOOK_DEAD_LETTER_ALERT_SECRET;
    else process.env.DISPUTE_MODULE_WEBHOOK_DEAD_LETTER_ALERT_SECRET = originalSecret;
    if (originalTimeout === undefined) delete process.env.DISPUTE_MODULE_WEBHOOK_DEAD_LETTER_ALERT_TIMEOUT_MS;
    else process.env.DISPUTE_MODULE_WEBHOOK_DEAD_LETTER_ALERT_TIMEOUT_MS = originalTimeout;
    if (originalAllowHttp === undefined) delete process.env.DISPUTE_MODULE_WEBHOOK_DEAD_LETTER_ALERT_ALLOW_INSECURE_HTTP;
    else process.env.DISPUTE_MODULE_WEBHOOK_DEAD_LETTER_ALERT_ALLOW_INSECURE_HTTP = originalAllowHttp;
    if (originalAllowPrivate === undefined) delete process.env.DISPUTE_MODULE_WEBHOOK_DEAD_LETTER_ALERT_ALLOW_PRIVATE_NETWORK;
    else process.env.DISPUTE_MODULE_WEBHOOK_DEAD_LETTER_ALERT_ALLOW_PRIVATE_NETWORK = originalAllowPrivate;
  });

  it("builds a minimal dead-letter alert payload without webhook bodies or secrets", () => {
    const payload = buildDisputeModuleWebhookDeadLetterAlertPayload(
      dispatchResult,
      new Date("2026-05-05T00:00:00.000Z"),
    );

    expect(payload).toEqual({
      type: "dispute_module_webhook.dead_letter",
      created_at: "2026-05-05T00:00:00.000Z",
      summary: {
        claimed: 2,
        delivered: 0,
        failed: 1,
        skipped: 1,
        deadLettered: 1,
      },
      events: dispatchResult.deadLetterEvents,
    } satisfies DisputeModuleWebhookDeadLetterAlertPayload);
    expect(JSON.stringify(payload)).not.toContain("secret");
    expect(JSON.stringify(payload)).not.toContain("data");
  });

  it("resolves alert config from env", () => {
    process.env.DISPUTE_MODULE_WEBHOOK_DEAD_LETTER_ALERT_URL = "https://ops.example/alerts";
    process.env.DISPUTE_MODULE_WEBHOOK_DEAD_LETTER_ALERT_SECRET = "ops-alert-secret-with-length";
    process.env.DISPUTE_MODULE_WEBHOOK_DEAD_LETTER_ALERT_TIMEOUT_MS = "2500";
    process.env.DISPUTE_MODULE_WEBHOOK_DEAD_LETTER_ALERT_ALLOW_PRIVATE_NETWORK = "true";

    expect(resolveDisputeModuleWebhookDeadLetterAlertConfigFromEnv()).toMatchObject({
      url: "https://ops.example/alerts",
      secret: "ops-alert-secret-with-length",
      timeoutMs: 2500,
      allowPrivateNetwork: true,
    });
  });

  it("signs alert payloads", () => {
    const signature = signDisputeModuleWebhookDeadLetterAlertPayload({
      secret: "ops-alert-secret-with-length",
      timestamp: "2026-05-05T00:00:00.000Z",
      rawBody: JSON.stringify({ ok: true }),
    });

    expect(signature).toMatch(/^sha256=[0-9a-f]{64}$/);
  });

  it("sends signed dead-letter alerts", async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response("ok", { status: 200 }));

    const result = await sendDisputeModuleWebhookDeadLetterAlert(dispatchResult, {
      config: {
        url: "https://ops.example/alerts",
        secret: "ops-alert-secret-with-length",
      },
      fetchImpl: fetchMock,
      now: new Date("2026-05-05T00:00:00.000Z"),
    });

    expect(result).toMatchObject({ status: "delivered", httpStatus: 200 });
    expect(fetchMock).toHaveBeenCalledWith(
      "https://ops.example/alerts",
      expect.objectContaining({
        method: "POST",
        redirect: "error",
        headers: expect.objectContaining({
          "content-type": "application/json",
          "x-haggle-alert-type": "dispute_module_webhook.dead_letter",
          "x-haggle-alert-timestamp": "2026-05-05T00:00:00.000Z",
          "x-haggle-alert-signature": expect.stringMatching(/^sha256=[0-9a-f]{64}$/),
        }),
        body: expect.stringContaining("evt_dead"),
        signal: expect.any(AbortSignal),
      }),
    );
  });

  it("skips when there are no new dead-letter rows", async () => {
    const result = await sendDisputeModuleWebhookDeadLetterAlert({
      ...dispatchResult,
      deadLettered: 0,
      deadLetterEvents: [],
    }, {
      config: {
        url: "https://ops.example/alerts",
      },
    });

    expect(result).toEqual({ status: "skipped" });
  });

  it("rejects insecure alert URLs unless explicitly allowed", async () => {
    await expect(sendDisputeModuleWebhookDeadLetterAlert(dispatchResult, {
      config: {
        url: "http://ops.example/alerts",
      },
    })).rejects.toThrow("alert url must use HTTPS unless allow_insecure_http is true");
  });

  it("rejects localhost and private network alert URLs by default", async () => {
    await expect(sendDisputeModuleWebhookDeadLetterAlert(dispatchResult, {
      config: {
        url: "https://127.0.0.1/alerts",
      },
    })).rejects.toThrow("alert url must not target localhost or private network hosts");

    await expect(sendDisputeModuleWebhookDeadLetterAlert(dispatchResult, {
      config: {
        url: "https://localhost/alerts",
      },
    })).rejects.toThrow("alert url must not target localhost or private network hosts");
  });
});
