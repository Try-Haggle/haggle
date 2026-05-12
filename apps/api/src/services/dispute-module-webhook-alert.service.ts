import { createHash, createHmac } from "node:crypto";
import type { DisputeModuleWebhookOutboxDispatchResult } from "./dispute-module-webhook.service.js";
import { assertDisputeModuleOutboundUrl } from "./dispute-module-outbound-url.service.js";

export interface DisputeModuleWebhookDeadLetterAlertConfig {
  url: string;
  secret?: string;
  timeoutMs?: number;
  allowInsecureHttp?: boolean;
  allowPrivateNetwork?: boolean;
}

export interface DisputeModuleWebhookDeadLetterAlertResult {
  status: "skipped" | "delivered" | "failed";
  httpStatus?: number;
  error?: string;
}

export interface DisputeModuleWebhookDeadLetterAlertPayload {
  type: "dispute_module_webhook.dead_letter";
  created_at: string;
  summary: Pick<
    DisputeModuleWebhookOutboxDispatchResult,
    "claimed" | "delivered" | "failed" | "skipped" | "deadLettered"
  >;
  events: DisputeModuleWebhookOutboxDispatchResult["deadLetterEvents"];
}

export function resolveDisputeModuleWebhookDeadLetterAlertConfigFromEnv():
  | DisputeModuleWebhookDeadLetterAlertConfig
  | null {
  const url = process.env.DISPUTE_MODULE_WEBHOOK_DEAD_LETTER_ALERT_URL;
  if (!url) return null;
  return {
    url,
    secret: process.env.DISPUTE_MODULE_WEBHOOK_DEAD_LETTER_ALERT_SECRET,
    timeoutMs: Number.isFinite(Number(process.env.DISPUTE_MODULE_WEBHOOK_DEAD_LETTER_ALERT_TIMEOUT_MS))
      ? Number(process.env.DISPUTE_MODULE_WEBHOOK_DEAD_LETTER_ALERT_TIMEOUT_MS)
      : undefined,
    allowInsecureHttp: process.env.DISPUTE_MODULE_WEBHOOK_DEAD_LETTER_ALERT_ALLOW_INSECURE_HTTP === "true",
    allowPrivateNetwork: process.env.DISPUTE_MODULE_WEBHOOK_DEAD_LETTER_ALERT_ALLOW_PRIVATE_NETWORK === "true",
  };
}

export function signDisputeModuleWebhookDeadLetterAlertPayload(params: {
  secret: string;
  timestamp: string;
  rawBody: string | Buffer;
}): string {
  if (params.secret.length < 16) {
    throw new Error("alert secret must be at least 16 characters");
  }
  const bodyHash = createHash("sha256").update(params.rawBody).digest("hex");
  const payload = `${params.timestamp}.${bodyHash}`;
  return `sha256=${createHmac("sha256", params.secret).update(payload).digest("hex")}`;
}

export function buildDisputeModuleWebhookDeadLetterAlertPayload(
  result: DisputeModuleWebhookOutboxDispatchResult,
  now = new Date(),
): DisputeModuleWebhookDeadLetterAlertPayload {
  return {
    type: "dispute_module_webhook.dead_letter",
    created_at: now.toISOString(),
    summary: {
      claimed: result.claimed,
      delivered: result.delivered,
      failed: result.failed,
      skipped: result.skipped,
      deadLettered: result.deadLettered,
    },
    events: result.deadLetterEvents,
  };
}

export async function sendDisputeModuleWebhookDeadLetterAlert(
  result: DisputeModuleWebhookOutboxDispatchResult,
  options: {
    config?: DisputeModuleWebhookDeadLetterAlertConfig | null;
    fetchImpl?: typeof fetch;
    now?: Date;
  } = {},
): Promise<DisputeModuleWebhookDeadLetterAlertResult> {
  if (result.deadLettered <= 0) {
    return { status: "skipped" };
  }
  const config = options.config === undefined
    ? resolveDisputeModuleWebhookDeadLetterAlertConfigFromEnv()
    : options.config;
  if (!config) {
    return { status: "skipped" };
  }

  assertDisputeModuleOutboundUrl(config.url, {
    label: "alert",
    allowInsecureHttp: config.allowInsecureHttp ?? false,
    allowPrivateNetwork: config.allowPrivateNetwork ?? false,
  });
  const now = options.now ?? new Date();
  const rawBody = JSON.stringify(buildDisputeModuleWebhookDeadLetterAlertPayload(result, now));
  const headers: Record<string, string> = {
    "content-type": "application/json",
    "x-haggle-alert-type": "dispute_module_webhook.dead_letter",
    "x-haggle-alert-timestamp": now.toISOString(),
  };
  if (config.secret) {
    headers["x-haggle-alert-signature"] = signDisputeModuleWebhookDeadLetterAlertPayload({
      secret: config.secret,
      timestamp: headers["x-haggle-alert-timestamp"],
      rawBody,
    });
  }

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), config.timeoutMs ?? 5000);
  try {
    const response = await (options.fetchImpl ?? fetch)(config.url, {
      method: "POST",
      headers,
      body: rawBody,
      redirect: "error",
      signal: controller.signal,
    });
    return {
      status: response.ok ? "delivered" : "failed",
      httpStatus: response.status,
    };
  } catch (error) {
    return {
      status: "failed",
      error: error instanceof Error ? error.message : String(error),
    };
  } finally {
    clearTimeout(timeout);
  }
}
