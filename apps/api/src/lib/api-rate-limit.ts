import { createHmac } from "node:crypto";
import { isProductionRuntime } from "../config/runtime.js";

export const API_GLOBAL_RATE_LIMIT = 100;
export const API_GLOBAL_RATE_LIMIT_WINDOW_SECONDS = 60;
export const API_RATE_LIMIT_HMAC_DOMAIN = "haggle.api-rate-limit.v1";

export type ApiRateLimitConfig =
  | { mode: "local" }
  | { mode: "postgres"; hmacSecret: string };

function distributedModeRequired(): boolean {
  const haggleEnv = process.env.HAGGLE_ENV?.trim().toLowerCase();
  return isProductionRuntime()
    || haggleEnv === "staging"
    || haggleEnv === "production";
}

function validateHmacSecret(secret: string | undefined): string {
  const value = secret?.trim() ?? "";
  const byteLength = Buffer.byteLength(value, "utf8");
  if (byteLength < 32 || byteLength > 512) {
    throw new Error(
      "[CONFIG] HAGGLE_API_RATE_LIMIT_HMAC_SECRET must be 32 to 512 bytes "
      + "when PostgreSQL rate limiting is enabled.",
    );
  }
  return value;
}

export function resolveApiRateLimitConfigFromEnv(): ApiRateLimitConfig {
  const distributedRequired = distributedModeRequired();
  const rawMode = process.env.HAGGLE_API_RATE_LIMIT_MODE?.trim().toLowerCase();
  const mode = rawMode || (distributedRequired ? "postgres" : "local");

  if (mode !== "local" && mode !== "postgres") {
    throw new Error(
      "[CONFIG] HAGGLE_API_RATE_LIMIT_MODE must be local or postgres.",
    );
  }
  if (distributedRequired && mode !== "postgres") {
    throw new Error(
      "[CONFIG] HAGGLE_API_RATE_LIMIT_MODE=postgres is required in staging "
      + "and production.",
    );
  }
  if (mode === "local") return { mode };
  return {
    mode,
    hmacSecret: validateHmacSecret(
      process.env.HAGGLE_API_RATE_LIMIT_HMAC_SECRET,
    ),
  };
}

export function hashApiRateLimitIdentity(input: {
  scope: string;
  identity: string;
  hmacSecret: string;
}): string {
  if (!/^[a-z0-9:_-]{1,64}$/i.test(input.scope)) {
    throw new Error("INVALID_API_RATE_LIMIT_SCOPE");
  }
  if (!input.identity || Buffer.byteLength(input.identity, "utf8") > 512) {
    throw new Error("INVALID_API_RATE_LIMIT_IDENTITY");
  }
  return createHmac("sha256", input.hmacSecret)
    .update(API_RATE_LIMIT_HMAC_DOMAIN)
    .update("\0")
    .update(input.scope)
    .update("\0")
    .update(input.identity)
    .digest("hex");
}

export function getApiRateLimitPolicyStatus() {
  const config = resolveApiRateLimitConfigFromEnv();
  return {
    mode: config.mode,
    distributed: config.mode === "postgres",
    storage: config.mode === "postgres" ? "postgresql" : "process_memory",
    algorithm: config.mode === "postgres" ? "fixed_window" : "sliding_window",
    keyProtection: config.mode === "postgres" ? "hmac_sha256" : "memory_only",
    maxRequests: API_GLOBAL_RATE_LIMIT,
    windowSeconds: API_GLOBAL_RATE_LIMIT_WINDOW_SECONDS,
    failClosedOnStoreError: config.mode === "postgres",
    healthExempt: true,
    retention: {
      scheduled: config.mode === "postgres"
        && process.env.ENABLE_CRON === "true",
      intervalSeconds: 3_600,
      retentionHours: 24,
      batchSize: 1_000,
      runOnStart: true,
    },
    containsSecret: false,
    containsIdentifiers: false,
  } as const;
}
