import { afterEach, describe, expect, it, vi } from "vitest";
import {
  type ConditionalSettlementPreflightAlertSnapshot,
  evaluateConditionalSettlementPreflightAlert,
  getConditionalSettlementPreflightAlertPolicyStatus,
  resolveConditionalSettlementPreflightAlertConfigFromEnv,
  sendConditionalSettlementPreflightAlert,
} from "../services/conditional-settlement-preflight-alert.service.js";
import { signWebhookClaimAlertPayload } from "../services/webhook-claim-alert.service.js";

const readySnapshot: ConditionalSettlementPreflightAlertSnapshot = {
  status: "ready",
  ready: true,
  probe_skipped: false,
  config_blocked_by: [],
  checks: {
    rpc_reachable: true,
    chain_id_match: true,
    settlement_bytecode: true,
    usdc_bytecode: true,
    signer_matches: true,
    usdc_allowed: true,
  },
  blocked_by: [],
  expected_chain_id: 84532,
  observed_chain_id: 84532,
  settlement_bytecode_bytes: 4,
  usdc_bytecode_bytes: 4,
  error_code: null,
  checked_at: "2026-07-12T20:00:00.000Z",
  duration_ms: 10,
};
const envKeys = [
  "CONDITIONAL_SETTLEMENT_PREFLIGHT_ALERT_URL",
  "CONDITIONAL_SETTLEMENT_PREFLIGHT_ALERT_SECRET",
  "CONDITIONAL_SETTLEMENT_PREFLIGHT_ALERT_ALLOW_INSECURE_HTTP",
  "CONDITIONAL_SETTLEMENT_PREFLIGHT_ALERT_ALLOW_PRIVATE_NETWORK",
  "CONDITIONAL_SETTLEMENT_PREFLIGHT_ALERT_TIMEOUT_MS",
  "WEBHOOK_EVENT_CLAIM_LEASE_SECONDS",
] as const;
const originalEnv = Object.fromEntries(envKeys.map((key) => [key, process.env[key]]));

afterEach(() => {
  for (const key of envKeys) {
    if (originalEnv[key] === undefined) delete process.env[key];
    else process.env[key] = originalEnv[key];
  }
});

describe("conditional settlement preflight alert", () => {
  it("classifies config and live failures without cascading an RPC error", () => {
    expect(
      evaluateConditionalSettlementPreflightAlert({
        ...readySnapshot,
        status: "blocked",
        ready: false,
        config_blocked_by: ["fee_wallet_address"],
        checks: { ...readySnapshot.checks, signer_matches: false },
      }),
    ).toMatchObject({
      severity: "critical",
      reasons: ["config_fee_wallet_address", "signer_mismatch"],
    });
    expect(
      evaluateConditionalSettlementPreflightAlert({
        ...readySnapshot,
        status: "unavailable",
        ready: false,
        error_code: "RPC_TIMEOUT",
        checks: {
          rpc_reachable: false,
          chain_id_match: false,
          settlement_bytecode: false,
          usdc_bytecode: false,
          signer_matches: false,
          usdc_allowed: false,
        },
      }),
    ).toEqual({ wouldAlert: true, severity: "critical", reasons: ["rpc_timeout"] });
  });

  it("distinguishes absent, partial, and invalid transport configuration", () => {
    delete process.env.CONDITIONAL_SETTLEMENT_PREFLIGHT_ALERT_URL;
    delete process.env.CONDITIONAL_SETTLEMENT_PREFLIGHT_ALERT_SECRET;
    expect(getConditionalSettlementPreflightAlertPolicyStatus()).toMatchObject({
      configured: false,
      configurationState: "not_configured",
    });
    process.env.CONDITIONAL_SETTLEMENT_PREFLIGHT_ALERT_URL = "https://ops.example/alerts";
    expect(getConditionalSettlementPreflightAlertPolicyStatus()).toMatchObject({
      configurationState: "partial",
    });
    process.env.CONDITIONAL_SETTLEMENT_PREFLIGHT_ALERT_SECRET = "alert-secret-long-enough";
    process.env.CONDITIONAL_SETTLEMENT_PREFLIGHT_ALERT_URL = "http://127.0.0.1:9999/alerts";
    expect(getConditionalSettlementPreflightAlertPolicyStatus()).toMatchObject({
      configured: false,
      configurationState: "invalid",
    });
    expect(() => resolveConditionalSettlementPreflightAlertConfigFromEnv()).toThrow();
  });

  it("sends a signed aggregate payload without endpoint, keys, addresses, or raw bytecode", async () => {
    const fetchImpl = vi.fn().mockResolvedValue({ ok: true, status: 202 });
    const config = {
      url: "https://ops.example/alerts",
      secret: "alert-secret-long-enough",
      timeoutMs: 5000,
      cooldownMinutes: 15,
      allowInsecureHttp: false,
      allowPrivateNetwork: false,
    };
    await expect(
      sendConditionalSettlementPreflightAlert(
        readySnapshot,
        { wouldAlert: true, severity: "critical", reasons: ["chain_id_mismatch"] },
        {
          config,
          deliveryId: `health_${"a".repeat(64)}`,
          fetchImpl,
          now: new Date("2026-07-12T20:00:00.000Z"),
        },
      ),
    ).resolves.toMatchObject({ status: "delivered", httpStatus: 202 });
    const [, request] = fetchImpl.mock.calls[0];
    const body = String(request.body);
    expect(request.headers["x-haggle-alert-signature"]).toBe(
      signWebhookClaimAlertPayload(config.secret, "2026-07-12T20:00:00.000Z", body),
    );
    expect(body).not.toContain(config.url);
    expect(body).not.toContain(config.secret);
    expect(body).not.toMatch(/0x[0-9a-f]{40,}/i);
    expect(body).not.toContain("60016000");
  });

  it("keeps alert timeout inside the claim lease safety margin", async () => {
    process.env.CONDITIONAL_SETTLEMENT_PREFLIGHT_ALERT_URL = "https://ops.example/alerts";
    process.env.CONDITIONAL_SETTLEMENT_PREFLIGHT_ALERT_SECRET = "alert-secret-long-enough";
    process.env.WEBHOOK_EVENT_CLAIM_LEASE_SECONDS = "15";
    process.env.CONDITIONAL_SETTLEMENT_PREFLIGHT_ALERT_TIMEOUT_MS = "10001";
    expect(getConditionalSettlementPreflightAlertPolicyStatus()).toMatchObject({
      configured: false,
      configurationState: "invalid",
      timeoutMs: 10001,
      claimLeaseSeconds: 15,
      maxSafeTimeoutMs: 10000,
      safetyMarginMs: 5000,
      timingSafe: false,
    });
    expect(() => resolveConditionalSettlementPreflightAlertConfigFromEnv()).toThrow(
      "timeout must be <= 10000ms",
    );
    const fetchImpl = vi.fn();
    await expect(
      sendConditionalSettlementPreflightAlert(
        readySnapshot,
        { wouldAlert: true, severity: "critical", reasons: ["rpc_timeout"] },
        {
          config: {
            url: "https://ops.example/alerts",
            secret: "alert-secret-long-enough",
            timeoutMs: 10001,
            cooldownMinutes: 15,
            allowInsecureHttp: false,
            allowPrivateNetwork: false,
          },
          deliveryId: `health_${"b".repeat(64)}`,
          fetchImpl,
        },
      ),
    ).rejects.toThrow("timeout must be <= 10000ms");
    expect(fetchImpl).not.toHaveBeenCalled();
    process.env.CONDITIONAL_SETTLEMENT_PREFLIGHT_ALERT_TIMEOUT_MS = "10000";
    expect(getConditionalSettlementPreflightAlertPolicyStatus()).toMatchObject({
      configured: true,
      timingSafe: true,
    });
    expect(resolveConditionalSettlementPreflightAlertConfigFromEnv()).toMatchObject({
      timeoutMs: 10000,
    });
    process.env.CONDITIONAL_SETTLEMENT_PREFLIGHT_ALERT_TIMEOUT_MS = "not-a-number";
    expect(getConditionalSettlementPreflightAlertPolicyStatus()).toMatchObject({
      configurationState: "invalid",
      timingSafe: false,
    });
  });
});
