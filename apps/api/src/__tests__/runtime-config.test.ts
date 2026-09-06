import { generateKeyPairSync } from "node:crypto";
import { afterEach, describe, expect, it } from "vitest";
import { getRuntimeConfig, isCorsOriginAllowed } from "../config/runtime.js";

const originalEnv = {
  DATABASE_URL: process.env.DATABASE_URL,
  DEEPSEEK_API_KEY: process.env.DEEPSEEK_API_KEY,
  CANARY_SECRET: process.env.CANARY_SECRET,
  HAGGLE_CORS_ORIGINS: process.env.HAGGLE_CORS_ORIGINS,
  NODE_ENV: process.env.NODE_ENV,
  SUPABASE_JWT_SECRET: process.env.SUPABASE_JWT_SECRET,
  HNP_REQUIRE_SIGNATURE: process.env.HNP_REQUIRE_SIGNATURE,
  HNP_TRUSTED_JWKS: process.env.HNP_TRUSTED_JWKS,
  VERCEL_ENV: process.env.VERCEL_ENV,
  DISPUTE_EVIDENCE_SCANNER_URL: process.env.DISPUTE_EVIDENCE_SCANNER_URL,
  DISPUTE_EVIDENCE_SCANNER_TOKEN: process.env.DISPUTE_EVIDENCE_SCANNER_TOKEN,
  DISPUTE_EVIDENCE_SCANNER_TIMEOUT_MS: process.env.DISPUTE_EVIDENCE_SCANNER_TIMEOUT_MS,
  DISPUTE_EVIDENCE_SCANNER_ALLOW_INSECURE_HTTP:
    process.env.DISPUTE_EVIDENCE_SCANNER_ALLOW_INSECURE_HTTP,
  DISPUTE_EVIDENCE_SCANNER_ALLOW_PRIVATE_NETWORK:
    process.env.DISPUTE_EVIDENCE_SCANNER_ALLOW_PRIVATE_NETWORK,
  DISPUTE_EVIDENCE_SCANNER_CIRCUIT_FAILURE_THRESHOLD:
    process.env.DISPUTE_EVIDENCE_SCANNER_CIRCUIT_FAILURE_THRESHOLD,
  DISPUTE_EVIDENCE_SCANNER_CIRCUIT_OPEN_SECONDS:
    process.env.DISPUTE_EVIDENCE_SCANNER_CIRCUIT_OPEN_SECONDS,
  DISPUTE_EVIDENCE_SCANNER_PERMIT_LEASE_SECONDS:
    process.env.DISPUTE_EVIDENCE_SCANNER_PERMIT_LEASE_SECONDS,
  DISPUTE_EVIDENCE_SCANNER_MAX_CONCURRENT: process.env.DISPUTE_EVIDENCE_SCANNER_MAX_CONCURRENT,
  ENABLE_DISPUTE_EVIDENCE_SCAN_RETRY_JOB: process.env.ENABLE_DISPUTE_EVIDENCE_SCAN_RETRY_JOB,
  DISPUTE_EVIDENCE_SCAN_RETRY_BATCH_SIZE: process.env.DISPUTE_EVIDENCE_SCAN_RETRY_BATCH_SIZE,
  DISPUTE_EVIDENCE_SCAN_RETRY_MAX_ATTEMPTS: process.env.DISPUTE_EVIDENCE_SCAN_RETRY_MAX_ATTEMPTS,
  DISPUTE_EVIDENCE_SCAN_RETRY_LEASE_SECONDS: process.env.DISPUTE_EVIDENCE_SCAN_RETRY_LEASE_SECONDS,
  DISPUTE_EVIDENCE_SCAN_RETRY_BASE_BACKOFF_SECONDS:
    process.env.DISPUTE_EVIDENCE_SCAN_RETRY_BASE_BACKOFF_SECONDS,
  DISPUTE_EVIDENCE_SCAN_RETRY_MAX_BACKOFF_SECONDS:
    process.env.DISPUTE_EVIDENCE_SCAN_RETRY_MAX_BACKOFF_SECONDS,
  ENABLE_DISPUTE_EVIDENCE_SCAN_RETRY_ALERT_JOB:
    process.env.ENABLE_DISPUTE_EVIDENCE_SCAN_RETRY_ALERT_JOB,
  DISPUTE_EVIDENCE_SCAN_RETRY_ALERT_URL: process.env.DISPUTE_EVIDENCE_SCAN_RETRY_ALERT_URL,
  DISPUTE_EVIDENCE_SCAN_RETRY_ALERT_SECRET: process.env.DISPUTE_EVIDENCE_SCAN_RETRY_ALERT_SECRET,
  DISPUTE_EVIDENCE_SCAN_RETRY_ALERT_PREVIOUS_SECRETS:
    process.env.DISPUTE_EVIDENCE_SCAN_RETRY_ALERT_PREVIOUS_SECRETS,
  DISPUTE_EVIDENCE_SCAN_RETRY_ALERT_ALLOW_INSECURE_HTTP:
    process.env.DISPUTE_EVIDENCE_SCAN_RETRY_ALERT_ALLOW_INSECURE_HTTP,
  DISPUTE_EVIDENCE_SCAN_RETRY_ALERT_ALLOW_PRIVATE_NETWORK:
    process.env.DISPUTE_EVIDENCE_SCAN_RETRY_ALERT_ALLOW_PRIVATE_NETWORK,
  ENABLE_CRON: process.env.ENABLE_CRON,
  ENABLE_WEBHOOK_CLAIM_HEALTH_ALERT_JOB: process.env.ENABLE_WEBHOOK_CLAIM_HEALTH_ALERT_JOB,
  WEBHOOK_CLAIM_ALERT_URL: process.env.WEBHOOK_CLAIM_ALERT_URL,
  WEBHOOK_CLAIM_ALERT_SECRET: process.env.WEBHOOK_CLAIM_ALERT_SECRET,
  WEBHOOK_CLAIM_ALERT_PREVIOUS_SECRETS: process.env.WEBHOOK_CLAIM_ALERT_PREVIOUS_SECRETS,
  WEBHOOK_CLAIM_ALERT_ALLOW_INSECURE_HTTP: process.env.WEBHOOK_CLAIM_ALERT_ALLOW_INSECURE_HTTP,
  WEBHOOK_CLAIM_ALERT_ALLOW_PRIVATE_NETWORK: process.env.WEBHOOK_CLAIM_ALERT_ALLOW_PRIVATE_NETWORK,
  ENABLE_SHIPMENT_APV_PAYOUT_ALERT_JOB: process.env.ENABLE_SHIPMENT_APV_PAYOUT_ALERT_JOB,
  ENABLE_SHIPMENT_APV_INVOICE_RESTORATION_MAINTENANCE_JOB:
    process.env.ENABLE_SHIPMENT_APV_INVOICE_RESTORATION_MAINTENANCE_JOB,
  SHIPMENT_APV_INVOICE_RESTORATION_MAINTENANCE_ACTOR_ID:
    process.env.SHIPMENT_APV_INVOICE_RESTORATION_MAINTENANCE_ACTOR_ID,
  SHIPMENT_APV_INVOICE_RESTORATION_MAINTENANCE_LIMIT:
    process.env.SHIPMENT_APV_INVOICE_RESTORATION_MAINTENANCE_LIMIT,
  ENABLE_SHIPMENT_APV_INVOICE_RESTORATION_REMEDIATION_EXPIRY_JOB:
    process.env.ENABLE_SHIPMENT_APV_INVOICE_RESTORATION_REMEDIATION_EXPIRY_JOB,
  SHIPMENT_APV_INVOICE_RESTORATION_REMEDIATION_EXPIRY_LIMIT:
    process.env.SHIPMENT_APV_INVOICE_RESTORATION_REMEDIATION_EXPIRY_LIMIT,
  ENABLE_SHIPMENT_APV_REMEDIATION_CURSOR_RETENTION_JOB:
    process.env.ENABLE_SHIPMENT_APV_REMEDIATION_CURSOR_RETENTION_JOB,
  SHIPMENT_APV_REMEDIATION_CURSOR_RETENTION_DAYS:
    process.env.SHIPMENT_APV_REMEDIATION_CURSOR_RETENTION_DAYS,
  SHIPMENT_APV_REMEDIATION_CURSOR_RETENTION_LIMIT:
    process.env.SHIPMENT_APV_REMEDIATION_CURSOR_RETENTION_LIMIT,
  SHIPMENT_APV_PAYOUT_ALERT_URL: process.env.SHIPMENT_APV_PAYOUT_ALERT_URL,
  SHIPMENT_APV_PAYOUT_ALERT_SECRET: process.env.SHIPMENT_APV_PAYOUT_ALERT_SECRET,
  SHIPMENT_APV_PAYOUT_ALERT_ALLOW_INSECURE_HTTP:
    process.env.SHIPMENT_APV_PAYOUT_ALERT_ALLOW_INSECURE_HTTP,
  SHIPMENT_APV_PAYOUT_ALERT_ALLOW_PRIVATE_NETWORK:
    process.env.SHIPMENT_APV_PAYOUT_ALERT_ALLOW_PRIVATE_NETWORK,
  ENABLE_SHIPMENT_APV_CANCELLATION_AUDIT_ARCHIVE_JOB:
    process.env.ENABLE_SHIPMENT_APV_CANCELLATION_AUDIT_ARCHIVE_JOB,
  HAGGLE_AUDIT_ARCHIVE_URL: process.env.HAGGLE_AUDIT_ARCHIVE_URL,
  HAGGLE_AUDIT_ARCHIVE_ALLOW_INSECURE_HTTP: process.env.HAGGLE_AUDIT_ARCHIVE_ALLOW_INSECURE_HTTP,
  HAGGLE_AUDIT_ARCHIVE_ALLOW_PRIVATE_NETWORK:
    process.env.HAGGLE_AUDIT_ARCHIVE_ALLOW_PRIVATE_NETWORK,
  ENABLE_SHIPMENT_APV_CANCELLATION_AUDIT_ARCHIVE_ALERT_JOB:
    process.env.ENABLE_SHIPMENT_APV_CANCELLATION_AUDIT_ARCHIVE_ALERT_JOB,
  HAGGLE_AUDIT_ARCHIVE_ALERT_URL: process.env.HAGGLE_AUDIT_ARCHIVE_ALERT_URL,
  HAGGLE_AUDIT_ARCHIVE_ALERT_SECRET: process.env.HAGGLE_AUDIT_ARCHIVE_ALERT_SECRET,
  HAGGLE_AUDIT_ARCHIVE_ALERT_ALLOW_INSECURE_HTTP:
    process.env.HAGGLE_AUDIT_ARCHIVE_ALERT_ALLOW_INSECURE_HTTP,
  HAGGLE_AUDIT_ARCHIVE_ALERT_ALLOW_PRIVATE_NETWORK:
    process.env.HAGGLE_AUDIT_ARCHIVE_ALERT_ALLOW_PRIVATE_NETWORK,
  ENABLE_DISPUTE_SIMILARITY_REVIEW_ALERT_JOB:
    process.env.ENABLE_DISPUTE_SIMILARITY_REVIEW_ALERT_JOB,
  DISPUTE_SIMILARITY_REVIEW_ALERT_URL: process.env.DISPUTE_SIMILARITY_REVIEW_ALERT_URL,
  DISPUTE_SIMILARITY_REVIEW_ALERT_SECRET: process.env.DISPUTE_SIMILARITY_REVIEW_ALERT_SECRET,
  DISPUTE_SIMILARITY_REVIEW_ALERT_ALLOW_INSECURE_HTTP:
    process.env.DISPUTE_SIMILARITY_REVIEW_ALERT_ALLOW_INSECURE_HTTP,
  DISPUTE_SIMILARITY_REVIEW_ALERT_ALLOW_PRIVATE_NETWORK:
    process.env.DISPUTE_SIMILARITY_REVIEW_ALERT_ALLOW_PRIVATE_NETWORK,
  ENABLE_DISPUTE_SIMILARITY_REVIEW_EXPIRY_JOB:
    process.env.ENABLE_DISPUTE_SIMILARITY_REVIEW_EXPIRY_JOB,
  ENABLE_DISPUTE_SIMILARITY_REVIEW_AUDIT_ARCHIVE_JOB:
    process.env.ENABLE_DISPUTE_SIMILARITY_REVIEW_AUDIT_ARCHIVE_JOB,
  DISPUTE_AUDIT_SIGNING_PRIVATE_KEY_BASE64: process.env.DISPUTE_AUDIT_SIGNING_PRIVATE_KEY_BASE64,
  ENABLE_DISPUTE_SIMILARITY_REVIEW_AUDIT_ARCHIVE_ALERT_JOB:
    process.env.ENABLE_DISPUTE_SIMILARITY_REVIEW_AUDIT_ARCHIVE_ALERT_JOB,
  DISPUTE_SIMILARITY_REVIEW_AUDIT_ARCHIVE_ALERT_URL:
    process.env.DISPUTE_SIMILARITY_REVIEW_AUDIT_ARCHIVE_ALERT_URL,
  DISPUTE_SIMILARITY_REVIEW_AUDIT_ARCHIVE_ALERT_SECRET:
    process.env.DISPUTE_SIMILARITY_REVIEW_AUDIT_ARCHIVE_ALERT_SECRET,
  DISPUTE_SIMILARITY_REVIEW_AUDIT_ARCHIVE_ALERT_ALLOW_INSECURE_HTTP:
    process.env.DISPUTE_SIMILARITY_REVIEW_AUDIT_ARCHIVE_ALERT_ALLOW_INSECURE_HTTP,
  DISPUTE_SIMILARITY_REVIEW_AUDIT_ARCHIVE_ALERT_ALLOW_PRIVATE_NETWORK:
    process.env.DISPUTE_SIMILARITY_REVIEW_AUDIT_ARCHIVE_ALERT_ALLOW_PRIVATE_NETWORK,
  ENABLE_DISPUTE_AI_AUDIT_ARCHIVE_JOB: process.env.ENABLE_DISPUTE_AI_AUDIT_ARCHIVE_JOB,
  DISPUTE_AUDIT_CURRENT_KEY_NOT_BEFORE: process.env.DISPUTE_AUDIT_CURRENT_KEY_NOT_BEFORE,
  DISPUTE_AUDIT_CURRENT_KEY_NOT_AFTER: process.env.DISPUTE_AUDIT_CURRENT_KEY_NOT_AFTER,
  DISPUTE_AUDIT_TRUSTED_PUBLIC_KEYS_JSON: process.env.DISPUTE_AUDIT_TRUSTED_PUBLIC_KEYS_JSON,
  ENABLE_DISPUTE_AI_AUDIT_ARCHIVE_ALERT_JOB: process.env.ENABLE_DISPUTE_AI_AUDIT_ARCHIVE_ALERT_JOB,
  DISPUTE_AI_AUDIT_ARCHIVE_ALERT_URL: process.env.DISPUTE_AI_AUDIT_ARCHIVE_ALERT_URL,
  DISPUTE_AI_AUDIT_ARCHIVE_ALERT_SECRET: process.env.DISPUTE_AI_AUDIT_ARCHIVE_ALERT_SECRET,
  DISPUTE_AI_AUDIT_ARCHIVE_ALERT_ALLOW_INSECURE_HTTP:
    process.env.DISPUTE_AI_AUDIT_ARCHIVE_ALERT_ALLOW_INSECURE_HTTP,
  DISPUTE_AI_AUDIT_ARCHIVE_ALERT_ALLOW_PRIVATE_NETWORK:
    process.env.DISPUTE_AI_AUDIT_ARCHIVE_ALERT_ALLOW_PRIVATE_NETWORK,
  ENABLE_CONDITIONAL_SETTLEMENT_PREFLIGHT_ALERT_JOB:
    process.env.ENABLE_CONDITIONAL_SETTLEMENT_PREFLIGHT_ALERT_JOB,
  CONDITIONAL_SETTLEMENT_PREFLIGHT_ALERT_URL:
    process.env.CONDITIONAL_SETTLEMENT_PREFLIGHT_ALERT_URL,
  CONDITIONAL_SETTLEMENT_PREFLIGHT_ALERT_SECRET:
    process.env.CONDITIONAL_SETTLEMENT_PREFLIGHT_ALERT_SECRET,
  CONDITIONAL_SETTLEMENT_PREFLIGHT_ALERT_ALLOW_INSECURE_HTTP:
    process.env.CONDITIONAL_SETTLEMENT_PREFLIGHT_ALERT_ALLOW_INSECURE_HTTP,
  CONDITIONAL_SETTLEMENT_PREFLIGHT_ALERT_ALLOW_PRIVATE_NETWORK:
    process.env.CONDITIONAL_SETTLEMENT_PREFLIGHT_ALERT_ALLOW_PRIVATE_NETWORK,
  CONDITIONAL_SETTLEMENT_PREFLIGHT_ALERT_TIMEOUT_MS:
    process.env.CONDITIONAL_SETTLEMENT_PREFLIGHT_ALERT_TIMEOUT_MS,
  ENABLE_CONDITIONAL_SETTLEMENT_FINALITY_ALERT_JOB:
    process.env.ENABLE_CONDITIONAL_SETTLEMENT_FINALITY_ALERT_JOB,
  CONDITIONAL_SETTLEMENT_FINALITY_ALERT_URL: process.env.CONDITIONAL_SETTLEMENT_FINALITY_ALERT_URL,
  CONDITIONAL_SETTLEMENT_FINALITY_ALERT_SECRET:
    process.env.CONDITIONAL_SETTLEMENT_FINALITY_ALERT_SECRET,
  CONDITIONAL_SETTLEMENT_FINALITY_ALERT_PREVIOUS_SECRETS:
    process.env.CONDITIONAL_SETTLEMENT_FINALITY_ALERT_PREVIOUS_SECRETS,
  CONDITIONAL_SETTLEMENT_FINALITY_ALERT_ALLOW_INSECURE_HTTP:
    process.env.CONDITIONAL_SETTLEMENT_FINALITY_ALERT_ALLOW_INSECURE_HTTP,
  CONDITIONAL_SETTLEMENT_FINALITY_ALERT_ALLOW_PRIVATE_NETWORK:
    process.env.CONDITIONAL_SETTLEMENT_FINALITY_ALERT_ALLOW_PRIVATE_NETWORK,
  CONDITIONAL_SETTLEMENT_FINALITY_ALERT_TIMEOUT_MS:
    process.env.CONDITIONAL_SETTLEMENT_FINALITY_ALERT_TIMEOUT_MS,
  WEBHOOK_EVENT_CLAIM_LEASE_SECONDS: process.env.WEBHOOK_EVENT_CLAIM_LEASE_SECONDS,
  GUEST_BUYER_CLAIM_POP_SECRET: process.env.GUEST_BUYER_CLAIM_POP_SECRET,
  HAGGLE_ENV: process.env.HAGGLE_ENV,
};

const { publicKey } = generateKeyPairSync("rsa", { modulusLength: 2048 });
const { privateKey: disputeAuditPrivateKey } = generateKeyPairSync("ed25519");
const validDisputeAuditPrivateKeyBase64 = disputeAuditPrivateKey
  .export({ format: "der", type: "pkcs8" })
  .toString("base64");
const validTrustedJwks = JSON.stringify({
  keys: [{ ...publicKey.export({ format: "jwk" }), kid: "runtime-test-key", alg: "RS256" }],
});
const validGuestBuyerClaimPopSecret = "runtime-test-guest-buyer-claim-pop-secret!!";

afterEach(() => {
  for (const key of Object.keys(originalEnv) as Array<keyof typeof originalEnv>) {
    const value = originalEnv[key];
    if (value === undefined) {
      delete process.env[key];
    } else {
      process.env[key] = value;
    }
  }
});

describe("runtime config", () => {
  it("requires a strong canary secret whenever DeepSeek Advisor access is configured", () => {
    process.env.NODE_ENV = "development";
    process.env.DATABASE_URL = "postgres://test";
    process.env.DEEPSEEK_API_KEY = "deepseek-test-key";
    delete process.env.CANARY_SECRET;
    expect(() => getRuntimeConfig()).toThrow("Invalid Advisor canary configuration");

    process.env.CANARY_SECRET = "0123456789abcdef0123456789abcdef";
    expect(getRuntimeConfig().isProduction).toBe(false);
  });

  it("fails fast for partial or unsafe dispute evidence scanner settings", () => {
    process.env.NODE_ENV = "development";
    process.env.DATABASE_URL = "postgres://test";
    process.env.DISPUTE_EVIDENCE_SCANNER_URL = "https://scanner.example.test/v1/scan";
    delete process.env.DISPUTE_EVIDENCE_SCANNER_TOKEN;
    expect(() => getRuntimeConfig()).toThrow("Invalid dispute evidence scanner configuration");

    process.env.DISPUTE_EVIDENCE_SCANNER_TOKEN = "scanner-secret-123";
    expect(getRuntimeConfig().isProduction).toBe(false);

    process.env.DISPUTE_EVIDENCE_SCANNER_URL = "https://127.0.0.1/scan";
    expect(() => getRuntimeConfig()).toThrow(/private network/);

    delete process.env.DISPUTE_EVIDENCE_SCANNER_URL;
    delete process.env.DISPUTE_EVIDENCE_SCANNER_TOKEN;
    process.env.DISPUTE_EVIDENCE_SCANNER_ALLOW_PRIVATE_NETWORK = "true";
    expect(() => getRuntimeConfig()).toThrow(/overrides require/);
  });

  it("forbids dispute evidence scanner safety overrides in production", () => {
    process.env.NODE_ENV = "production";
    process.env.DATABASE_URL = "postgres://test";
    process.env.SUPABASE_JWT_SECRET = "test-secret";
    process.env.GUEST_BUYER_CLAIM_POP_SECRET = validGuestBuyerClaimPopSecret;
    process.env.DISPUTE_EVIDENCE_SCANNER_URL = "http://scanner.example.test/scan";
    process.env.DISPUTE_EVIDENCE_SCANNER_TOKEN = "scanner-secret-123";
    process.env.DISPUTE_EVIDENCE_SCANNER_ALLOW_INSECURE_HTTP = "true";
    expect(() => getRuntimeConfig()).toThrow(/forbidden in production/);
  });

  it("validates scanner circuit limits and timeout containment", () => {
    process.env.NODE_ENV = "development";
    process.env.DATABASE_URL = "postgres://test";
    process.env.DISPUTE_EVIDENCE_SCANNER_MAX_CONCURRENT = "0";
    expect(() => getRuntimeConfig()).toThrow(
      "Invalid dispute evidence scanner circuit configuration",
    );
    process.env.DISPUTE_EVIDENCE_SCANNER_MAX_CONCURRENT = "4";
    process.env.DISPUTE_EVIDENCE_SCANNER_URL = "https://scanner.example.test/v1/scan";
    process.env.DISPUTE_EVIDENCE_SCANNER_TOKEN = "scanner-secret-123";
    process.env.DISPUTE_EVIDENCE_SCANNER_TIMEOUT_MS = "30000";
    process.env.DISPUTE_EVIDENCE_SCANNER_PERMIT_LEASE_SECONDS = "30";
    expect(() => getRuntimeConfig()).toThrow(/permit lease must exceed/);
    process.env.DISPUTE_EVIDENCE_SCANNER_PERMIT_LEASE_SECONDS = "35";
    expect(getRuntimeConfig().isProduction).toBe(false);
  });

  it("requires cron and a configured scanner for scan retry workers", () => {
    process.env.NODE_ENV = "development";
    process.env.DATABASE_URL = "postgres://test";
    process.env.ENABLE_DISPUTE_EVIDENCE_SCAN_RETRY_JOB = "true";
    delete process.env.ENABLE_CRON;
    expect(() => getRuntimeConfig()).toThrow("ENABLE_CRON=true is required");
    process.env.ENABLE_CRON = "true";
    expect(() => getRuntimeConfig()).toThrow(/configured scanner is required/);
    process.env.DISPUTE_EVIDENCE_SCANNER_URL = "https://scanner.example.test/v1/scan";
    process.env.DISPUTE_EVIDENCE_SCANNER_TOKEN = "scanner-secret-123";
    expect(getRuntimeConfig().isProduction).toBe(false);
  });

  it("rejects scan retry leases that cannot contain the scanner timeout", () => {
    process.env.NODE_ENV = "development";
    process.env.DATABASE_URL = "postgres://test";
    process.env.ENABLE_CRON = "true";
    process.env.ENABLE_DISPUTE_EVIDENCE_SCAN_RETRY_JOB = "true";
    process.env.DISPUTE_EVIDENCE_SCANNER_URL = "https://scanner.example.test/v1/scan";
    process.env.DISPUTE_EVIDENCE_SCANNER_TOKEN = "scanner-secret-123";
    process.env.DISPUTE_EVIDENCE_SCANNER_TIMEOUT_MS = "30000";
    process.env.DISPUTE_EVIDENCE_SCAN_RETRY_LEASE_SECONDS = "30";
    expect(() => getRuntimeConfig()).toThrow(/exceed scanner timeout/);
    process.env.DISPUTE_EVIDENCE_SCAN_RETRY_LEASE_SECONDS = "35";
    process.env.DISPUTE_EVIDENCE_SCANNER_PERMIT_LEASE_SECONDS = "35";
    expect(getRuntimeConfig().isProduction).toBe(false);
  });

  it("requires a running retry worker and signed alert configuration", () => {
    process.env.NODE_ENV = "development";
    process.env.DATABASE_URL = "postgres://test";
    process.env.ENABLE_CRON = "true";
    process.env.ENABLE_DISPUTE_EVIDENCE_SCAN_RETRY_ALERT_JOB = "true";
    expect(() => getRuntimeConfig()).toThrow(
      "ENABLE_DISPUTE_EVIDENCE_SCAN_RETRY_JOB=true is required",
    );
    process.env.ENABLE_DISPUTE_EVIDENCE_SCAN_RETRY_JOB = "true";
    process.env.DISPUTE_EVIDENCE_SCANNER_URL = "https://scanner.example.test/v1/scan";
    process.env.DISPUTE_EVIDENCE_SCANNER_TOKEN = "scanner-secret-123";
    expect(() => getRuntimeConfig()).toThrow("an alert URL is required");
    process.env.DISPUTE_EVIDENCE_SCAN_RETRY_ALERT_URL = "https://ops.example/scan-retry";
    process.env.DISPUTE_EVIDENCE_SCAN_RETRY_ALERT_SECRET = "short";
    expect(() => getRuntimeConfig()).toThrow("16..128 characters");
    process.env.DISPUTE_EVIDENCE_SCAN_RETRY_ALERT_SECRET = "strong-scan-retry-alert-secret";
    expect(getRuntimeConfig().isProduction).toBe(false);
  });

  it("forbids scan retry alert network overrides in production", () => {
    process.env.NODE_ENV = "production";
    process.env.DATABASE_URL = "postgres://test";
    process.env.SUPABASE_JWT_SECRET = "test-secret";
    process.env.GUEST_BUYER_CLAIM_POP_SECRET = validGuestBuyerClaimPopSecret;
    process.env.ENABLE_CRON = "true";
    process.env.ENABLE_DISPUTE_EVIDENCE_SCAN_RETRY_JOB = "true";
    process.env.DISPUTE_EVIDENCE_SCANNER_URL = "https://scanner.example.test/v1/scan";
    process.env.DISPUTE_EVIDENCE_SCANNER_TOKEN = "scanner-secret-123";
    process.env.ENABLE_DISPUTE_EVIDENCE_SCAN_RETRY_ALERT_JOB = "true";
    process.env.DISPUTE_EVIDENCE_SCAN_RETRY_ALERT_URL = "https://ops.example/scan-retry";
    process.env.DISPUTE_EVIDENCE_SCAN_RETRY_ALERT_SECRET = "strong-scan-retry-alert-secret";
    process.env.DISPUTE_EVIDENCE_SCAN_RETRY_ALERT_ALLOW_PRIVATE_NETWORK = "true";
    expect(() => getRuntimeConfig()).toThrow("local network overrides are forbidden in production");
  });

  it("fails fast when conditional settlement preflight alerting is partial or cron is disabled", () => {
    process.env.NODE_ENV = "development";
    process.env.DATABASE_URL = "postgres://test";
    process.env.ENABLE_CONDITIONAL_SETTLEMENT_PREFLIGHT_ALERT_JOB = "true";
    delete process.env.ENABLE_CRON;
    expect(() => getRuntimeConfig()).toThrow("ENABLE_CRON=true");
    process.env.ENABLE_CRON = "true";
    delete process.env.CONDITIONAL_SETTLEMENT_PREFLIGHT_ALERT_URL;
    expect(() => getRuntimeConfig()).toThrow("CONDITIONAL_SETTLEMENT_PREFLIGHT_ALERT_URL");
    process.env.CONDITIONAL_SETTLEMENT_PREFLIGHT_ALERT_URL = "https://ops.example/alerts";
    process.env.CONDITIONAL_SETTLEMENT_PREFLIGHT_ALERT_SECRET = "short";
    expect(() => getRuntimeConfig()).toThrow("at least 16 characters");
  });

  it("forbids conditional settlement preflight alert network overrides in production", () => {
    process.env.NODE_ENV = "production";
    process.env.DATABASE_URL = "postgres://test";
    process.env.SUPABASE_JWT_SECRET = "test-secret";
    process.env.GUEST_BUYER_CLAIM_POP_SECRET = validGuestBuyerClaimPopSecret;
    process.env.ENABLE_CRON = "true";
    process.env.ENABLE_CONDITIONAL_SETTLEMENT_PREFLIGHT_ALERT_JOB = "true";
    process.env.CONDITIONAL_SETTLEMENT_PREFLIGHT_ALERT_URL = "https://ops.example/alerts";
    process.env.CONDITIONAL_SETTLEMENT_PREFLIGHT_ALERT_SECRET = "preflight-alert-secret";
    process.env.CONDITIONAL_SETTLEMENT_PREFLIGHT_ALERT_ALLOW_PRIVATE_NETWORK = "true";
    expect(() => getRuntimeConfig()).toThrow("network safety overrides are forbidden");
  });

  it("fails startup when preflight alert timeout can outlive its claim lease", () => {
    process.env.NODE_ENV = "development";
    process.env.DATABASE_URL = "postgres://test";
    process.env.ENABLE_CRON = "true";
    process.env.ENABLE_CONDITIONAL_SETTLEMENT_PREFLIGHT_ALERT_JOB = "true";
    process.env.CONDITIONAL_SETTLEMENT_PREFLIGHT_ALERT_URL = "https://ops.example/alerts";
    process.env.CONDITIONAL_SETTLEMENT_PREFLIGHT_ALERT_SECRET = "preflight-alert-secret";
    process.env.WEBHOOK_EVENT_CLAIM_LEASE_SECONDS = "15";
    process.env.CONDITIONAL_SETTLEMENT_PREFLIGHT_ALERT_TIMEOUT_MS = "10001";
    expect(() => getRuntimeConfig()).toThrow("timeout must be <= 10000ms");
    process.env.CONDITIONAL_SETTLEMENT_PREFLIGHT_ALERT_TIMEOUT_MS = "10000";
    expect(getRuntimeConfig().isProduction).toBe(false);
  });
  it("fails fast for partial or unsafe conditional settlement finality alerting", () => {
    process.env.NODE_ENV = "development";
    process.env.DATABASE_URL = "postgres://test";
    process.env.ENABLE_CONDITIONAL_SETTLEMENT_FINALITY_ALERT_JOB = "true";
    delete process.env.ENABLE_CRON;
    expect(() => getRuntimeConfig()).toThrow("ENABLE_CRON=true");
    process.env.ENABLE_CRON = "true";
    process.env.CONDITIONAL_SETTLEMENT_FINALITY_ALERT_URL = "https://ops.example/alerts";
    process.env.CONDITIONAL_SETTLEMENT_FINALITY_ALERT_SECRET = "short";
    expect(() => getRuntimeConfig()).toThrow("receiver secrets must be 16..128 characters");
    process.env.CONDITIONAL_SETTLEMENT_FINALITY_ALERT_SECRET = "finality-alert-secret";
    process.env.WEBHOOK_EVENT_CLAIM_LEASE_SECONDS = "15";
    process.env.CONDITIONAL_SETTLEMENT_FINALITY_ALERT_TIMEOUT_MS = "10001";
    expect(() => getRuntimeConfig()).toThrow("timeout must be <= 10000ms");
  });
  it("fails fast for invalid finality receiver secret rotation even when the sender job is disabled", () => {
    process.env.NODE_ENV = "development";
    process.env.DATABASE_URL = "postgres://test";
    delete process.env.ENABLE_CONDITIONAL_SETTLEMENT_FINALITY_ALERT_JOB;
    process.env.CONDITIONAL_SETTLEMENT_FINALITY_ALERT_SECRET = "finality-current-secret";
    process.env.CONDITIONAL_SETTLEMENT_FINALITY_ALERT_PREVIOUS_SECRETS = "short";
    expect(() => getRuntimeConfig()).toThrow("receiver secrets must be 16..128 characters");
    process.env.CONDITIONAL_SETTLEMENT_FINALITY_ALERT_PREVIOUS_SECRETS = [
      "previous-secret-01",
      "previous-secret-02",
      "previous-secret-03",
      "previous-secret-04",
    ].join(",");
    expect(() => getRuntimeConfig()).toThrow("accepts at most 4 secrets");
  });
  it("throws a clear error when DATABASE_URL is missing", () => {
    process.env.NODE_ENV = "production";
    delete process.env.DATABASE_URL;
    process.env.SUPABASE_JWT_SECRET = "secret";

    expect(() => getRuntimeConfig()).toThrow("[CONFIG] DATABASE_URL is required");
  });

  it("throws a clear error when NODE_ENV is missing", () => {
    delete process.env.NODE_ENV;
    process.env.DATABASE_URL = "postgresql://example";
    process.env.SUPABASE_JWT_SECRET = "secret";

    expect(() => getRuntimeConfig()).toThrow("[CONFIG] NODE_ENV is required");
  });

  it("requires SUPABASE_URL for default JWKS authentication in production", () => {
    process.env.NODE_ENV = "production";
    process.env.DATABASE_URL = "postgresql://example";
    delete process.env.SUPABASE_JWT_SECRET;

    expect(() => getRuntimeConfig()).toThrow("SUPABASE_URL is required for JWKS authentication");
  });

  it("does not block production startup when default HNP signatures lack JWKS", () => {
    process.env.NODE_ENV = "production";
    process.env.DATABASE_URL = "postgresql://example";
    process.env.SUPABASE_JWT_SECRET = "secret";
    process.env.GUEST_BUYER_CLAIM_POP_SECRET = validGuestBuyerClaimPopSecret;
    delete process.env.HNP_REQUIRE_SIGNATURE;
    delete process.env.HNP_TRUSTED_JWKS;

    expect(getRuntimeConfig().isProduction).toBe(true);
  });

  it("requires HNP_TRUSTED_JWKS in production when HNP signatures are explicitly required", () => {
    process.env.NODE_ENV = "production";
    process.env.DATABASE_URL = "postgresql://example";
    process.env.SUPABASE_JWT_SECRET = "secret";
    process.env.GUEST_BUYER_CLAIM_POP_SECRET = validGuestBuyerClaimPopSecret;
    process.env.HNP_REQUIRE_SIGNATURE = "true";
    delete process.env.HNP_TRUSTED_JWKS;

    expect(() => getRuntimeConfig()).toThrow("[CONFIG] HNP_TRUSTED_JWKS is required");
  });

  it("rejects malformed production HNP_TRUSTED_JWKS", () => {
    process.env.NODE_ENV = "production";
    process.env.DATABASE_URL = "postgresql://example";
    process.env.SUPABASE_JWT_SECRET = "secret";
    process.env.GUEST_BUYER_CLAIM_POP_SECRET = validGuestBuyerClaimPopSecret;
    delete process.env.HNP_REQUIRE_SIGNATURE;
    process.env.HNP_TRUSTED_JWKS = "{not-json";

    expect(() => getRuntimeConfig()).toThrow("[CONFIG] HNP_TRUSTED_JWKS must be a valid JWKS");
  });

  it("rejects production HNP_TRUSTED_JWKS without a usable public key", () => {
    process.env.NODE_ENV = "production";
    process.env.DATABASE_URL = "postgresql://example";
    process.env.SUPABASE_JWT_SECRET = "secret";
    process.env.GUEST_BUYER_CLAIM_POP_SECRET = validGuestBuyerClaimPopSecret;
    delete process.env.HNP_REQUIRE_SIGNATURE;
    process.env.HNP_TRUSTED_JWKS = JSON.stringify({ keys: [] });

    expect(() => getRuntimeConfig()).toThrow("[CONFIG] HNP_TRUSTED_JWKS must be a valid JWKS");
  });

  it("accepts production HNP_TRUSTED_JWKS with a usable public key", () => {
    process.env.NODE_ENV = "production";
    process.env.DATABASE_URL = "postgresql://example";
    process.env.SUPABASE_JWT_SECRET = "secret";
    process.env.GUEST_BUYER_CLAIM_POP_SECRET = validGuestBuyerClaimPopSecret;
    delete process.env.HNP_REQUIRE_SIGNATURE;
    process.env.HNP_TRUSTED_JWKS = validTrustedJwks;

    expect(getRuntimeConfig().isProduction).toBe(true);
  });

  it("requires GUEST_BUYER_CLAIM_POP_SECRET in production", () => {
    process.env.NODE_ENV = "production";
    process.env.DATABASE_URL = "postgresql://example";
    process.env.SUPABASE_JWT_SECRET = "secret";
    delete process.env.HAGGLE_ENV;
    delete process.env.GUEST_BUYER_CLAIM_POP_SECRET;

    expect(() => getRuntimeConfig()).toThrow(/GUEST_BUYER_CLAIM_POP_SECRET is required/);
  });

  it("requires GUEST_BUYER_CLAIM_POP_SECRET in staging", () => {
    process.env.NODE_ENV = "development";
    process.env.HAGGLE_ENV = "staging";
    process.env.DATABASE_URL = "postgresql://example";
    process.env.SUPABASE_JWT_SECRET = "secret";
    delete process.env.GUEST_BUYER_CLAIM_POP_SECRET;

    expect(() => getRuntimeConfig()).toThrow(/GUEST_BUYER_CLAIM_POP_SECRET is required/);
  });

  it("allows missing GUEST_BUYER_CLAIM_POP_SECRET outside staging and production", () => {
    process.env.NODE_ENV = "development";
    process.env.DATABASE_URL = "postgresql://example";
    delete process.env.HAGGLE_ENV;
    delete process.env.GUEST_BUYER_CLAIM_POP_SECRET;

    expect(getRuntimeConfig().isProduction).toBe(false);
  });

  it("rejects a short GUEST_BUYER_CLAIM_POP_SECRET", () => {
    process.env.NODE_ENV = "development";
    process.env.DATABASE_URL = "postgresql://example";
    process.env.GUEST_BUYER_CLAIM_POP_SECRET = "too-short";

    expect(() => getRuntimeConfig()).toThrow(
      /GUEST_BUYER_CLAIM_POP_SECRET must be 32 to 512 bytes/,
    );
  });

  it("requires the main cron runner when webhook claim alerts are enabled", () => {
    process.env.NODE_ENV = "development";
    process.env.DATABASE_URL = "postgresql://example";
    process.env.ENABLE_WEBHOOK_CLAIM_HEALTH_ALERT_JOB = "true";
    delete process.env.ENABLE_CRON;
    expect(() => getRuntimeConfig()).toThrow("ENABLE_CRON=true is required");
  });

  it("requires a signed HTTPS target when webhook claim alerts are enabled", () => {
    process.env.NODE_ENV = "development";
    process.env.DATABASE_URL = "postgresql://example";
    process.env.ENABLE_CRON = "true";
    process.env.ENABLE_WEBHOOK_CLAIM_HEALTH_ALERT_JOB = "true";
    delete process.env.WEBHOOK_CLAIM_ALERT_URL;
    expect(() => getRuntimeConfig()).toThrow("WEBHOOK_CLAIM_ALERT_URL is required");

    process.env.WEBHOOK_CLAIM_ALERT_URL = "https://ops.example/alerts";
    process.env.WEBHOOK_CLAIM_ALERT_SECRET = "short";
    expect(() => getRuntimeConfig()).toThrow("receiver secrets must be 16..128 characters");
  });
  it("fails fast for invalid webhook claim alert receiver rotation when the sender job is disabled", () => {
    process.env.NODE_ENV = "development";
    process.env.DATABASE_URL = "postgres://test";
    delete process.env.ENABLE_WEBHOOK_CLAIM_HEALTH_ALERT_JOB;
    process.env.WEBHOOK_CLAIM_ALERT_SECRET = "webhook-current-secret";
    process.env.WEBHOOK_CLAIM_ALERT_PREVIOUS_SECRETS = "short";
    expect(() => getRuntimeConfig()).toThrow("receiver secrets must be 16..128 characters");
  });

  it("accepts a complete webhook claim alert configuration", () => {
    process.env.NODE_ENV = "development";
    process.env.DATABASE_URL = "postgresql://example";
    process.env.ENABLE_CRON = "true";
    process.env.ENABLE_WEBHOOK_CLAIM_HEALTH_ALERT_JOB = "true";
    process.env.WEBHOOK_CLAIM_ALERT_URL = "https://ops.example/alerts";
    process.env.WEBHOOK_CLAIM_ALERT_SECRET = "ops-alert-secret-with-length";
    expect(getRuntimeConfig().isProduction).toBe(false);
  });

  it("forbids webhook alert network safety overrides in production", () => {
    process.env.NODE_ENV = "production";
    process.env.DATABASE_URL = "postgresql://example";
    process.env.SUPABASE_JWT_SECRET = "secret";
    process.env.GUEST_BUYER_CLAIM_POP_SECRET = validGuestBuyerClaimPopSecret;
    process.env.ENABLE_CRON = "true";
    process.env.ENABLE_WEBHOOK_CLAIM_HEALTH_ALERT_JOB = "true";
    process.env.WEBHOOK_CLAIM_ALERT_URL = "http://127.0.0.1/alerts";
    process.env.WEBHOOK_CLAIM_ALERT_SECRET = "ops-alert-secret-with-length";
    process.env.WEBHOOK_CLAIM_ALERT_ALLOW_INSECURE_HTTP = "true";
    process.env.WEBHOOK_CLAIM_ALERT_ALLOW_PRIVATE_NETWORK = "true";
    expect(() => getRuntimeConfig()).toThrow(
      "network safety overrides are forbidden in production",
    );
  });

  it("allows production startup without HNP_TRUSTED_JWKS only with explicit HNP signature override", () => {
    process.env.NODE_ENV = "production";
    process.env.DATABASE_URL = "postgresql://example";
    process.env.SUPABASE_JWT_SECRET = "secret";
    process.env.GUEST_BUYER_CLAIM_POP_SECRET = validGuestBuyerClaimPopSecret;
    process.env.HNP_REQUIRE_SIGNATURE = "false";
    delete process.env.HNP_TRUSTED_JWKS;

    expect(getRuntimeConfig().isProduction).toBe(true);
  });

  it("requires cron and a signed target for APV payout reservation alerts", () => {
    process.env.NODE_ENV = "development";
    process.env.DATABASE_URL = "postgresql://example";
    process.env.ENABLE_SHIPMENT_APV_PAYOUT_ALERT_JOB = "true";
    delete process.env.ENABLE_CRON;
    expect(() => getRuntimeConfig()).toThrow("ENABLE_CRON=true is required");
    process.env.ENABLE_CRON = "true";
    delete process.env.SHIPMENT_APV_PAYOUT_ALERT_URL;
    expect(() => getRuntimeConfig()).toThrow("SHIPMENT_APV_PAYOUT_ALERT_URL is required");
    process.env.SHIPMENT_APV_PAYOUT_ALERT_URL = "https://ops.example/alerts";
    process.env.SHIPMENT_APV_PAYOUT_ALERT_SECRET = "short";
    expect(() => getRuntimeConfig()).toThrow("secret must be at least 16 characters");
  });

  it("accepts a complete APV payout alert configuration", () => {
    process.env.NODE_ENV = "development";
    process.env.DATABASE_URL = "postgresql://example";
    process.env.ENABLE_CRON = "true";
    process.env.ENABLE_SHIPMENT_APV_PAYOUT_ALERT_JOB = "true";
    process.env.SHIPMENT_APV_PAYOUT_ALERT_URL = "https://ops.example/alerts";
    process.env.SHIPMENT_APV_PAYOUT_ALERT_SECRET = "ops-alert-secret-with-length";
    expect(getRuntimeConfig().isProduction).toBe(false);
  });

  it("fails fast when APV restoration maintenance lacks cron, actor, or a bounded limit", () => {
    process.env.NODE_ENV = "development";
    process.env.DATABASE_URL = "postgresql://example";
    process.env.ENABLE_SHIPMENT_APV_INVOICE_RESTORATION_MAINTENANCE_JOB = "true";
    delete process.env.ENABLE_CRON;
    expect(() => getRuntimeConfig()).toThrow("ENABLE_CRON=true is required");
    process.env.ENABLE_CRON = "true";
    delete process.env.SHIPMENT_APV_INVOICE_RESTORATION_MAINTENANCE_ACTOR_ID;
    expect(() => getRuntimeConfig()).toThrow("MAINTENANCE_ACTOR_ID must be a UUID");
    process.env.SHIPMENT_APV_INVOICE_RESTORATION_MAINTENANCE_ACTOR_ID =
      "99999999-9999-4999-8999-999999999999";
    process.env.SHIPMENT_APV_INVOICE_RESTORATION_MAINTENANCE_LIMIT = "1001";
    expect(() => getRuntimeConfig()).toThrow("MAINTENANCE_LIMIT must be an integer from 1 to 1000");
  });

  it("accepts complete APV restoration maintenance configuration", () => {
    process.env.NODE_ENV = "development";
    process.env.DATABASE_URL = "postgresql://example";
    process.env.ENABLE_CRON = "true";
    process.env.ENABLE_SHIPMENT_APV_INVOICE_RESTORATION_MAINTENANCE_JOB = "true";
    process.env.SHIPMENT_APV_INVOICE_RESTORATION_MAINTENANCE_ACTOR_ID =
      "99999999-9999-4999-8999-999999999999";
    process.env.SHIPMENT_APV_INVOICE_RESTORATION_MAINTENANCE_LIMIT = "100";
    expect(getRuntimeConfig().isProduction).toBe(false);
  });

  it("fails fast when APV restoration remediation expiry lacks cron or a bounded limit", () => {
    process.env.NODE_ENV = "development";
    process.env.DATABASE_URL = "postgresql://example";
    process.env.ENABLE_SHIPMENT_APV_INVOICE_RESTORATION_REMEDIATION_EXPIRY_JOB = "true";
    delete process.env.ENABLE_CRON;
    expect(() => getRuntimeConfig()).toThrow("ENABLE_CRON=true is required");
    process.env.ENABLE_CRON = "true";
    process.env.SHIPMENT_APV_INVOICE_RESTORATION_REMEDIATION_EXPIRY_LIMIT = "0";
    expect(() => getRuntimeConfig()).toThrow(
      "REMEDIATION_EXPIRY_LIMIT must be an integer from 1 to 1000",
    );
  });

  it("accepts complete APV restoration remediation expiry configuration", () => {
    process.env.NODE_ENV = "development";
    process.env.DATABASE_URL = "postgresql://example";
    process.env.ENABLE_CRON = "true";
    process.env.ENABLE_SHIPMENT_APV_INVOICE_RESTORATION_REMEDIATION_EXPIRY_JOB = "true";
    process.env.SHIPMENT_APV_INVOICE_RESTORATION_REMEDIATION_EXPIRY_LIMIT = "100";
    expect(getRuntimeConfig().isProduction).toBe(false);
  });

  it("fails fast when APV cursor retention lacks cron or bounded settings", () => {
    process.env.NODE_ENV = "development";
    process.env.DATABASE_URL = "postgresql://example";
    process.env.ENABLE_SHIPMENT_APV_REMEDIATION_CURSOR_RETENTION_JOB = "true";
    delete process.env.ENABLE_CRON;
    expect(() => getRuntimeConfig()).toThrow("ENABLE_CRON=true is required");
    process.env.ENABLE_CRON = "true";
    process.env.SHIPMENT_APV_REMEDIATION_CURSOR_RETENTION_DAYS = "6";
    expect(() => getRuntimeConfig()).toThrow(
      "CURSOR_RETENTION_DAYS must be an integer from 7 to 365",
    );
    process.env.SHIPMENT_APV_REMEDIATION_CURSOR_RETENTION_DAYS = "30";
    process.env.SHIPMENT_APV_REMEDIATION_CURSOR_RETENTION_LIMIT = "1001";
    expect(() => getRuntimeConfig()).toThrow(
      "CURSOR_RETENTION_LIMIT must be an integer from 1 to 1000",
    );
  });

  it("accepts complete APV cursor retention configuration", () => {
    process.env.NODE_ENV = "development";
    process.env.DATABASE_URL = "postgresql://example";
    process.env.ENABLE_CRON = "true";
    process.env.ENABLE_SHIPMENT_APV_REMEDIATION_CURSOR_RETENTION_JOB = "true";
    process.env.SHIPMENT_APV_REMEDIATION_CURSOR_RETENTION_DAYS = "30";
    process.env.SHIPMENT_APV_REMEDIATION_CURSOR_RETENTION_LIMIT = "1000";
    expect(getRuntimeConfig().isProduction).toBe(false);
  });

  it("requires cron and a signed target for similarity review SLA alerts", () => {
    process.env.NODE_ENV = "development";
    process.env.DATABASE_URL = "postgresql://example";
    process.env.ENABLE_DISPUTE_SIMILARITY_REVIEW_ALERT_JOB = "true";
    delete process.env.ENABLE_CRON;
    expect(() => getRuntimeConfig()).toThrow("ENABLE_CRON=true is required");
    process.env.ENABLE_CRON = "true";
    delete process.env.DISPUTE_SIMILARITY_REVIEW_ALERT_URL;
    expect(() => getRuntimeConfig()).toThrow("DISPUTE_SIMILARITY_REVIEW_ALERT_URL is required");
    process.env.DISPUTE_SIMILARITY_REVIEW_ALERT_URL = "https://ops.example/alerts";
    process.env.DISPUTE_SIMILARITY_REVIEW_ALERT_SECRET = "short";
    expect(() => getRuntimeConfig()).toThrow("secret must be at least 16 characters");
  });

  it("accepts a complete similarity review SLA alert configuration", () => {
    process.env.NODE_ENV = "development";
    process.env.DATABASE_URL = "postgresql://example";
    process.env.ENABLE_CRON = "true";
    process.env.ENABLE_DISPUTE_SIMILARITY_REVIEW_ALERT_JOB = "true";
    process.env.DISPUTE_SIMILARITY_REVIEW_ALERT_URL = "https://ops.example/alerts";
    process.env.DISPUTE_SIMILARITY_REVIEW_ALERT_SECRET = "ops-alert-secret-with-length";
    expect(getRuntimeConfig().isProduction).toBe(false);
  });

  it("requires the main cron runner when similarity review auto-expiry is enabled", () => {
    process.env.NODE_ENV = "development";
    process.env.DATABASE_URL = "postgresql://example";
    process.env.ENABLE_DISPUTE_SIMILARITY_REVIEW_EXPIRY_JOB = "true";
    delete process.env.ENABLE_CRON;
    expect(() => getRuntimeConfig()).toThrow("ENABLE_CRON=true is required");
    process.env.ENABLE_CRON = "true";
    expect(getRuntimeConfig().isProduction).toBe(false);
  });

  it("requires cron, WORM target, and signing key for similarity review audit archiving", () => {
    process.env.NODE_ENV = "development";
    process.env.DATABASE_URL = "postgresql://example";
    process.env.ENABLE_DISPUTE_SIMILARITY_REVIEW_AUDIT_ARCHIVE_JOB = "true";
    delete process.env.ENABLE_CRON;
    expect(() => getRuntimeConfig()).toThrow("ENABLE_CRON=true is required");
    process.env.ENABLE_CRON = "true";
    delete process.env.HAGGLE_AUDIT_ARCHIVE_URL;
    expect(() => getRuntimeConfig()).toThrow("HAGGLE_AUDIT_ARCHIVE_URL is required");
    process.env.HAGGLE_AUDIT_ARCHIVE_URL = "https://worm.example/audits";
    delete process.env.DISPUTE_AUDIT_SIGNING_PRIVATE_KEY_BASE64;
    expect(() => getRuntimeConfig()).toThrow(
      "DISPUTE_AUDIT_SIGNING_PRIVATE_KEY_BASE64 is required",
    );
  });

  it("requires cron and an HTTPS target for APV cancellation audit archiving", () => {
    process.env.NODE_ENV = "development";
    process.env.DATABASE_URL = "postgresql://example";
    process.env.ENABLE_SHIPMENT_APV_CANCELLATION_AUDIT_ARCHIVE_JOB = "true";
    delete process.env.ENABLE_CRON;
    expect(() => getRuntimeConfig()).toThrow("ENABLE_CRON=true is required");
    process.env.ENABLE_CRON = "true";
    delete process.env.HAGGLE_AUDIT_ARCHIVE_URL;
    expect(() => getRuntimeConfig()).toThrow("HAGGLE_AUDIT_ARCHIVE_URL is required");
    process.env.HAGGLE_AUDIT_ARCHIVE_URL = "http://archive.example/audits";
    expect(() => getRuntimeConfig()).toThrow("must use HTTPS");
  });

  it("accepts a complete APV cancellation audit archive configuration", () => {
    process.env.NODE_ENV = "development";
    process.env.DATABASE_URL = "postgresql://example";
    process.env.ENABLE_CRON = "true";
    process.env.ENABLE_SHIPMENT_APV_CANCELLATION_AUDIT_ARCHIVE_JOB = "true";
    process.env.HAGGLE_AUDIT_ARCHIVE_URL = "https://archive.example/audits";
    expect(getRuntimeConfig().isProduction).toBe(false);
  });

  it("requires cron and a signed target for APV audit archive alerts", () => {
    process.env.NODE_ENV = "development";
    process.env.DATABASE_URL = "postgresql://example";
    process.env.ENABLE_SHIPMENT_APV_CANCELLATION_AUDIT_ARCHIVE_ALERT_JOB = "true";
    delete process.env.ENABLE_CRON;
    expect(() => getRuntimeConfig()).toThrow("ENABLE_CRON=true is required");
    process.env.ENABLE_CRON = "true";
    delete process.env.HAGGLE_AUDIT_ARCHIVE_ALERT_URL;
    expect(() => getRuntimeConfig()).toThrow("HAGGLE_AUDIT_ARCHIVE_ALERT_URL is required");
    process.env.HAGGLE_AUDIT_ARCHIVE_ALERT_URL = "https://ops.example/alerts";
    process.env.HAGGLE_AUDIT_ARCHIVE_ALERT_SECRET = "short";
    expect(() => getRuntimeConfig()).toThrow("at least 16 characters");
  });

  it("accepts a complete APV audit archive alert configuration", () => {
    process.env.NODE_ENV = "development";
    process.env.DATABASE_URL = "postgresql://example";
    process.env.ENABLE_CRON = "true";
    process.env.ENABLE_SHIPMENT_APV_CANCELLATION_AUDIT_ARCHIVE_ALERT_JOB = "true";
    process.env.HAGGLE_AUDIT_ARCHIVE_ALERT_URL = "https://ops.example/alerts";
    process.env.HAGGLE_AUDIT_ARCHIVE_ALERT_SECRET = "archive-alert-secret-long";
    expect(getRuntimeConfig().isProduction).toBe(false);
  });

  it("requires cron and a signed target for similarity audit archive alerts", () => {
    process.env.NODE_ENV = "development";
    process.env.DATABASE_URL = "postgresql://example";
    process.env.ENABLE_DISPUTE_SIMILARITY_REVIEW_AUDIT_ARCHIVE_ALERT_JOB = "true";
    delete process.env.ENABLE_CRON;
    expect(() => getRuntimeConfig()).toThrow("ENABLE_CRON=true is required");
    process.env.ENABLE_CRON = "true";
    delete process.env.DISPUTE_SIMILARITY_REVIEW_AUDIT_ARCHIVE_ALERT_URL;
    expect(() => getRuntimeConfig()).toThrow(
      "DISPUTE_SIMILARITY_REVIEW_AUDIT_ARCHIVE_ALERT_URL is required",
    );
    process.env.DISPUTE_SIMILARITY_REVIEW_AUDIT_ARCHIVE_ALERT_URL = "https://ops.example/alerts";
    process.env.DISPUTE_SIMILARITY_REVIEW_AUDIT_ARCHIVE_ALERT_SECRET = "short";
    expect(() => getRuntimeConfig()).toThrow("at least 16 characters");
  });

  it("accepts complete similarity audit archive alert configuration", () => {
    process.env.NODE_ENV = "development";
    process.env.DATABASE_URL = "postgresql://example";
    process.env.ENABLE_CRON = "true";
    process.env.ENABLE_DISPUTE_SIMILARITY_REVIEW_AUDIT_ARCHIVE_ALERT_JOB = "true";
    process.env.DISPUTE_SIMILARITY_REVIEW_AUDIT_ARCHIVE_ALERT_URL = "https://ops.example/alerts";
    process.env.DISPUTE_SIMILARITY_REVIEW_AUDIT_ARCHIVE_ALERT_SECRET =
      "similarity-archive-alert-secret";
    expect(getRuntimeConfig().isProduction).toBe(false);
  });

  it("requires cron, WORM URL, and signing key for dispute AI audit archiving", () => {
    process.env.NODE_ENV = "development";
    process.env.DATABASE_URL = "postgresql://example";
    process.env.ENABLE_DISPUTE_AI_AUDIT_ARCHIVE_JOB = "true";
    delete process.env.ENABLE_CRON;
    expect(() => getRuntimeConfig()).toThrow("ENABLE_CRON=true is required");
    process.env.ENABLE_CRON = "true";
    delete process.env.HAGGLE_AUDIT_ARCHIVE_URL;
    expect(() => getRuntimeConfig()).toThrow("HAGGLE_AUDIT_ARCHIVE_URL is required");
    process.env.HAGGLE_AUDIT_ARCHIVE_URL = "https://archive.example/audits";
    delete process.env.DISPUTE_AUDIT_SIGNING_PRIVATE_KEY_BASE64;
    expect(() => getRuntimeConfig()).toThrow(
      "DISPUTE_AUDIT_SIGNING_PRIVATE_KEY_BASE64 is required",
    );
  });

  it("accepts complete dispute AI audit archive configuration", () => {
    process.env.NODE_ENV = "development";
    process.env.DATABASE_URL = "postgresql://example";
    process.env.ENABLE_CRON = "true";
    process.env.ENABLE_DISPUTE_AI_AUDIT_ARCHIVE_JOB = "true";
    process.env.HAGGLE_AUDIT_ARCHIVE_URL = "https://archive.example/audits";
    process.env.DISPUTE_AUDIT_SIGNING_PRIVATE_KEY_BASE64 = validDisputeAuditPrivateKeyBase64;
    expect(getRuntimeConfig().isProduction).toBe(false);
  });

  it("fails fast on an invalid dispute audit public key registry", () => {
    process.env.NODE_ENV = "development";
    process.env.DATABASE_URL = "postgresql://example";
    delete process.env.DISPUTE_AUDIT_SIGNING_PRIVATE_KEY_BASE64;
    process.env.DISPUTE_AUDIT_TRUSTED_PUBLIC_KEYS_JSON = "not-json";
    expect(() => getRuntimeConfig()).toThrow("Invalid dispute audit public key registry");
  });

  it("requires cron and a signed target for dispute AI audit archive alerts", () => {
    process.env.NODE_ENV = "development";
    process.env.DATABASE_URL = "postgresql://example";
    process.env.ENABLE_DISPUTE_AI_AUDIT_ARCHIVE_ALERT_JOB = "true";
    delete process.env.ENABLE_CRON;
    expect(() => getRuntimeConfig()).toThrow("ENABLE_CRON=true is required");
    process.env.ENABLE_CRON = "true";
    delete process.env.DISPUTE_AI_AUDIT_ARCHIVE_ALERT_URL;
    expect(() => getRuntimeConfig()).toThrow("DISPUTE_AI_AUDIT_ARCHIVE_ALERT_URL is required");
    process.env.DISPUTE_AI_AUDIT_ARCHIVE_ALERT_URL = "https://ops.example/alerts";
    process.env.DISPUTE_AI_AUDIT_ARCHIVE_ALERT_SECRET = "short";
    expect(() => getRuntimeConfig()).toThrow("at least 16 characters");
  });

  it("accepts complete dispute AI audit archive alert configuration", () => {
    process.env.NODE_ENV = "development";
    process.env.DATABASE_URL = "postgresql://example";
    process.env.ENABLE_CRON = "true";
    process.env.ENABLE_DISPUTE_AI_AUDIT_ARCHIVE_ALERT_JOB = "true";
    process.env.DISPUTE_AI_AUDIT_ARCHIVE_ALERT_URL = "https://ops.example/alerts";
    process.env.DISPUTE_AI_AUDIT_ARCHIVE_ALERT_SECRET = "ai-archive-alert-secret";
    expect(getRuntimeConfig().isProduction).toBe(false);
  });

  it("does not allow arbitrary Vercel preview origins", () => {
    const allowed = isCorsOriginAllowed("https://fork-preview.vercel.app", {
      isProduction: true,
      corsAllowedOrigins: new Set(["https://tryhaggle.ai"]),
    });

    expect(allowed).toBe(false);
  });

  it("allows explicitly configured preview origins", () => {
    const allowed = isCorsOriginAllowed("https://haggle-git-main.vercel.app", {
      isProduction: true,
      corsAllowedOrigins: new Set(["https://haggle-git-main.vercel.app"]),
    });

    expect(allowed).toBe(true);
  });

  it("allows localhost only outside production", () => {
    const config = {
      corsAllowedOrigins: new Set(["https://tryhaggle.ai"]),
    };

    expect(
      isCorsOriginAllowed("http://localhost:3000", {
        ...config,
        isProduction: false,
      }),
    ).toBe(true);
    expect(
      isCorsOriginAllowed("http://localhost:3000", {
        ...config,
        isProduction: true,
      }),
    ).toBe(false);
  });

  it("allows private LAN dashboard origins only outside production", () => {
    const config = {
      corsAllowedOrigins: new Set(["https://tryhaggle.ai"]),
    };

    expect(
      isCorsOriginAllowed("http://10.0.0.132:4177", {
        ...config,
        isProduction: false,
      }),
    ).toBe(true);
    expect(
      isCorsOriginAllowed("http://192.168.1.25:4177", {
        ...config,
        isProduction: false,
      }),
    ).toBe(true);
    expect(
      isCorsOriginAllowed("http://172.20.10.4:4177", {
        ...config,
        isProduction: false,
      }),
    ).toBe(true);
    expect(
      isCorsOriginAllowed("http://10.0.0.132:4177", {
        ...config,
        isProduction: true,
      }),
    ).toBe(false);
    expect(
      isCorsOriginAllowed("http://203.0.113.10:4177", {
        ...config,
        isProduction: false,
      }),
    ).toBe(false);
  });
});
