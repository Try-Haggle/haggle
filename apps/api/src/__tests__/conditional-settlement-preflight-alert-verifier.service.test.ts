import { afterEach, describe, expect, it } from "vitest";
import {
  getConditionalSettlementPreflightAlertReceiverPolicyStatus,
  resolveConditionalSettlementPreflightAlertReceiverSecretsFromEnv,
  verifyConditionalSettlementPreflightAlert,
} from "../services/conditional-settlement-preflight-alert-verifier.service.js";
import { signWebhookClaimAlertPayload } from "../services/webhook-claim-alert.service.js";

const secret = "cycle82-preflight-receiver-secret";
const timestamp = "2026-07-12T20:00:00.000Z";
const deliveryId = `health_${"a".repeat(64)}`;
function body(overrides: Record<string, unknown> = {}) {
  return JSON.stringify({
    type: "conditional_settlement_preflight.health",
    delivery_id: deliveryId,
    state: "firing",
    created_at: timestamp,
    severity: "critical",
    reasons: ["rpc_timeout"],
    health: { status: "unavailable", error_code: "RPC_TIMEOUT" },
    ...overrides,
  });
}

afterEach(() => {
  delete process.env.CONDITIONAL_SETTLEMENT_PREFLIGHT_ALERT_SECRET;
  delete process.env.CONDITIONAL_SETTLEMENT_PREFLIGHT_ALERT_PREVIOUS_SECRETS;
});

describe("conditional settlement preflight alert verifier", () => {
  it("verifies the exact raw body, timestamp, and delivery id", () => {
    const raw = body();
    expect(
      verifyConditionalSettlementPreflightAlert({
        rawBody: raw,
        timestamp,
        deliveryId,
        signature: signWebhookClaimAlertPayload(secret, timestamp, raw),
        secret,
        nowMs: Date.parse(timestamp),
      }),
    ).toMatchObject({ ok: true, deliveryId, state: "firing", severity: "critical" });
  });

  it("rejects stale, mismatched, and invalid state/severity combinations", () => {
    const raw = body();
    const signature = signWebhookClaimAlertPayload(secret, timestamp, raw);
    expect(
      verifyConditionalSettlementPreflightAlert({
        rawBody: raw,
        timestamp,
        deliveryId,
        signature,
        secret,
        nowMs: Date.parse(timestamp) + 300_001,
      }),
    ).toEqual({ ok: false, error: "ALERT_TIMESTAMP_OUT_OF_RANGE" });
    expect(
      verifyConditionalSettlementPreflightAlert({
        rawBody: raw,
        timestamp,
        deliveryId: `health_${"b".repeat(64)}`,
        signature,
        secret,
        nowMs: Date.parse(timestamp),
      }),
    ).toEqual({ ok: false, error: "ALERT_DELIVERY_ID_MISMATCH" });
    const invalid = body({ state: "recovered", severity: "critical" });
    expect(
      verifyConditionalSettlementPreflightAlert({
        rawBody: invalid,
        timestamp,
        deliveryId,
        signature: signWebhookClaimAlertPayload(secret, timestamp, invalid),
        secret,
        nowMs: Date.parse(timestamp),
      }),
    ).toEqual({ ok: false, error: "INVALID_ALERT_BODY" });
  });

  it("rejects tampering and accepts a previous secret during rotation", () => {
    const raw = body();
    expect(
      verifyConditionalSettlementPreflightAlert({
        rawBody: `${raw} `,
        timestamp,
        deliveryId,
        signature: signWebhookClaimAlertPayload(secret, timestamp, raw),
        secret,
        nowMs: Date.parse(timestamp),
      }),
    ).toEqual({ ok: false, error: "INVALID_ALERT_SIGNATURE" });
    expect(
      verifyConditionalSettlementPreflightAlert({
        rawBody: raw,
        timestamp,
        deliveryId,
        signature: signWebhookClaimAlertPayload(secret, timestamp, raw),
        secret: ["new-secret-long-enough", secret],
        nowMs: Date.parse(timestamp),
      }).ok,
    ).toBe(true);
  });

  it("deduplicates configured current and previous secrets without exposing them", () => {
    process.env.CONDITIONAL_SETTLEMENT_PREFLIGHT_ALERT_SECRET = secret;
    process.env.CONDITIONAL_SETTLEMENT_PREFLIGHT_ALERT_PREVIOUS_SECRETS = `short, ${secret}, old-secret-long-enough`;
    expect(resolveConditionalSettlementPreflightAlertReceiverSecretsFromEnv()).toHaveLength(2);
    expect(getConditionalSettlementPreflightAlertReceiverPolicyStatus()).toEqual({
      configured: true,
      acceptedSecretCount: 2,
      timestampToleranceSeconds: 300,
    });
  });
});
