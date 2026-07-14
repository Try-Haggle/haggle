import { afterEach, describe, expect, it, vi } from "vitest";
import type { Database } from "@haggle/db";
import { runConditionalSettlementPreflightAlert } from "../jobs/conditional-settlement-preflight-alert.js";
import {
  findLatestDeliveredConditionalSettlementPreflightIncident,
  sendConditionalSettlementPreflightAlert,
} from "../services/conditional-settlement-preflight-alert.service.js";
import { claimWebhookEvent, completeWebhookEvent, failWebhookEvent } from "../services/webhook-event-claim.service.js";

vi.mock("../services/conditional-settlement-preflight-alert.service.js", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../services/conditional-settlement-preflight-alert.service.js")>()),
  findLatestDeliveredConditionalSettlementPreflightIncident: vi.fn(),
  sendConditionalSettlementPreflightAlert: vi.fn(),
}));
vi.mock("../services/webhook-event-claim.service.js", () => ({ claimWebhookEvent: vi.fn(), completeWebhookEvent: vi.fn(),
  failWebhookEvent: vi.fn(), webhookPayloadSha256: vi.fn(() => "a".repeat(64)),
  getWebhookEventClaimLeaseSeconds: vi.fn(() => 60) }));

const config = { url: "https://ops.example/alerts", secret: "preflight-alert-secret", timeoutMs: 5000,
  cooldownMinutes: 15, allowInsecureHttp: false, allowPrivateNetwork: false };
const env = { HAGGLE_X402_MODE: "real", HAGGLE_X402_NETWORK: "base-sepolia",
  HAGGLE_BASE_RPC_URL: "https://rpc.example", HAGGLE_CONDITIONAL_SETTLEMENT_ADDRESS: `0x${"11".repeat(20)}`,
  HAGGLE_X402_USDC_ASSET_ADDRESS: `0x${"22".repeat(20)}`, HAGGLE_ROUTER_RELAYER_PRIVATE_KEY: `0x${"33".repeat(32)}`,
  HAGGLE_X402_FEE_WALLET: `0x${"44".repeat(20)}` } as const;
const originalEnv = Object.fromEntries(Object.keys(env).map((key) => [key, process.env[key]]));
const probe = { status: "ready" as const, ready: true,
  checks: { rpc_reachable: true, chain_id_match: true, settlement_bytecode: true, usdc_bytecode: true, signer_matches: true, usdc_allowed: true },
  blocked_by: [], expected_chain_id: 84532, observed_chain_id: 84532, settlement_bytecode_bytes: 4, usdc_bytecode_bytes: 4,
  error_code: null, checked_at: "2026-07-12T20:00:00.000Z", duration_ms: 10 };
const acquired = { outcome: "acquired" as const, source: "x", eventId: `health_${"b".repeat(64)}`,
  claimId: "11111111-1111-4111-8111-111111111111", attemptCount: 1 };

afterEach(() => {
  for (const [key, value] of Object.entries(originalEnv)) value === undefined ? delete process.env[key] : process.env[key] = value;
  vi.clearAllMocks();
});

describe("conditional settlement preflight alert job", () => {
  it("skips an unconfigured transport", async () => {
    delete process.env.CONDITIONAL_SETTLEMENT_PREFLIGHT_ALERT_URL;
    delete process.env.CONDITIONAL_SETTLEMENT_PREFLIGHT_ALERT_SECRET;
    await expect(runConditionalSettlementPreflightAlert({} as Database)).resolves.toMatchObject({ reason: "not_configured" });
  });

  it("delivers one firing alert and suppresses a duplicate cooldown claim", async () => {
    Object.assign(process.env, env);
    vi.mocked(claimWebhookEvent).mockResolvedValueOnce(acquired).mockResolvedValueOnce({ outcome: "duplicate", source: "x", eventId: acquired.eventId });
    vi.mocked(sendConditionalSettlementPreflightAlert).mockResolvedValueOnce({ status: "delivered", httpStatus: 200 });
    const runProbe = vi.fn().mockResolvedValue({ ...probe, status: "blocked", ready: false,
      checks: { ...probe.checks, signer_matches: false }, blocked_by: ["signer_matches"] });
    await expect(runConditionalSettlementPreflightAlert({} as Database, { config, runProbe })).resolves.toMatchObject({ status: "delivered" });
    await expect(runConditionalSettlementPreflightAlert({} as Database, { config, runProbe })).resolves.toMatchObject({ reason: "cooldown_or_in_progress" });
    expect(completeWebhookEvent).toHaveBeenCalledOnce();
  });

  it("delivers one recovery and leaves a failed delivery retryable", async () => {
    Object.assign(process.env, env);
    vi.mocked(findLatestDeliveredConditionalSettlementPreflightIncident).mockResolvedValue({ eventId: `health_${"c".repeat(64)}`, completedAt: probe.checked_at });
    vi.mocked(claimWebhookEvent).mockResolvedValueOnce(acquired).mockResolvedValueOnce({ ...acquired, eventId: `health_${"d".repeat(64)}` });
    vi.mocked(sendConditionalSettlementPreflightAlert).mockResolvedValueOnce({ status: "delivered", httpStatus: 200 })
      .mockResolvedValueOnce({ status: "failed", httpStatus: 503 });
    const runProbe = vi.fn().mockResolvedValue(probe);
    await expect(runConditionalSettlementPreflightAlert({} as Database, { config, runProbe })).resolves.toMatchObject({ status: "recovered" });
    const failingProbe = vi.fn().mockResolvedValue({ ...probe, status: "unavailable", ready: false, error_code: "RPC_TIMEOUT" });
    await expect(runConditionalSettlementPreflightAlert({} as Database, { config, runProbe: failingProbe })).resolves.toMatchObject({ status: "failed" });
    expect(failWebhookEvent).toHaveBeenCalledOnce();
  });

  it("uses an injected snapshot without reading or mutating global onchain configuration", async () => {
    const before = Object.fromEntries(Object.keys(env).map((key) => [key, process.env[key]]));
    const collectSnapshot = vi.fn().mockResolvedValue({ ...probe, status: "blocked", ready: false,
      probe_skipped: false, config_blocked_by: [], checks: { ...probe.checks, signer_matches: false },
      blocked_by: ["signer_matches"] });
    const runProbe = vi.fn().mockRejectedValue(new Error("must not run"));
    vi.mocked(claimWebhookEvent).mockResolvedValueOnce(acquired);
    vi.mocked(sendConditionalSettlementPreflightAlert).mockResolvedValueOnce({ status: "delivered", httpStatus: 200 });

    await expect(runConditionalSettlementPreflightAlert({} as Database, { config, collectSnapshot, runProbe }))
      .resolves.toMatchObject({ status: "delivered" });

    expect(collectSnapshot).toHaveBeenCalledOnce();
    expect(runProbe).not.toHaveBeenCalled();
    expect(Object.fromEntries(Object.keys(env).map((key) => [key, process.env[key]]))).toEqual(before);
  });

  it("distinguishes delivery retry backoff from a cooldown duplicate", async () => {
    const collectSnapshot = vi.fn().mockResolvedValue({ ...probe, status: "blocked", ready: false,
      probe_skipped: false, config_blocked_by: [], checks: { ...probe.checks, signer_matches: false },
      blocked_by: ["signer_matches"] });
    vi.mocked(claimWebhookEvent).mockResolvedValueOnce({ outcome: "retry_later", source: "x", eventId: acquired.eventId });

    await expect(runConditionalSettlementPreflightAlert({} as Database, { config, collectSnapshot }))
      .resolves.toMatchObject({ status: "skipped", reason: "delivery_retry_backoff" });
    expect(sendConditionalSettlementPreflightAlert).not.toHaveBeenCalled();
  });

  it("rejects an unsafe directly injected timeout before acquiring a DB claim", async () => {
    await expect(runConditionalSettlementPreflightAlert({} as Database, {
      config: { ...config, timeoutMs: 30_001 },
      collectSnapshot: vi.fn(),
    })).rejects.toThrow("timeout must be <= 30000ms");
    expect(claimWebhookEvent).not.toHaveBeenCalled();
    expect(sendConditionalSettlementPreflightAlert).not.toHaveBeenCalled();
  });
});
