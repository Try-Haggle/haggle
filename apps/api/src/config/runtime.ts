import { validateTrustedHnpJwks } from "../services/hnp-jwks.service.js";

const VALID_NODE_ENVS = new Set(["development", "test", "production"]);

function readRequiredEnv(name: string): string {
  const value = process.env[name]?.trim();
  if (!value) {
    throw new Error(`[CONFIG] ${name} is required. Set ${name} before starting the API server.`);
  }
  return value;
}

export function getNodeEnv(): "development" | "test" | "production" {
  const nodeEnv = readRequiredEnv("NODE_ENV");
  if (!VALID_NODE_ENVS.has(nodeEnv)) {
    throw new Error(
      `[CONFIG] NODE_ENV must be one of development, test, or production. Received: ${nodeEnv}`,
    );
  }
  return nodeEnv as "development" | "test" | "production";
}

export function isProductionRuntime(): boolean {
  return getNodeEnv() === "production" || process.env.VERCEL_ENV === "production";
}

function parseCorsOrigins(rawOrigins: string | undefined): Set<string> {
  const origins = new Set([
    "https://chatgpt.com",
    "https://chat.openai.com",
    "https://tryhaggle.ai",
  ]);

  for (const rawOrigin of rawOrigins?.split(",") ?? []) {
    const origin = rawOrigin.trim().replace(/\/$/, "");
    if (origin) origins.add(origin);
  }

  return origins;
}

export interface RuntimeConfig {
  databaseUrl: string;
  isProduction: boolean;
  corsAllowedOrigins: Set<string>;
}

export function getRuntimeConfig(): RuntimeConfig {
  const isProduction = isProductionRuntime();
  const databaseUrl = readRequiredEnv("DATABASE_URL");

  if (isProduction) {
    readRequiredEnv("SUPABASE_JWT_SECRET");
    const hnpRequireSignature = process.env.HNP_REQUIRE_SIGNATURE?.trim().toLowerCase();
    const trustedJwks = process.env.HNP_TRUSTED_JWKS?.trim();
    if (hnpRequireSignature === "true" && !trustedJwks) {
      throw new Error("[CONFIG] HNP_TRUSTED_JWKS is required when HNP_REQUIRE_SIGNATURE=true.");
    }
    if (hnpRequireSignature !== "false" && trustedJwks) {
      const validation = validateTrustedHnpJwks(trustedJwks);
      if (!validation.ok) {
        throw new Error(
          `[CONFIG] HNP_TRUSTED_JWKS must be a valid JWKS with at least one supported public key: ${validation.reason}`,
        );
      }
    }
  }

  return {
    databaseUrl,
    isProduction,
    corsAllowedOrigins: parseCorsOrigins(process.env.HAGGLE_CORS_ORIGINS),
  };
}

export function isCorsOriginAllowed(
  origin: string | undefined,
  config: Pick<RuntimeConfig, "isProduction" | "corsAllowedOrigins">,
): boolean {
  if (!origin) return true;

  if (origin === "null") {
    return !config.isProduction;
  }

  let normalizedOrigin: string;
  try {
    const parsed = new URL(origin);
    normalizedOrigin = parsed.origin;
  } catch {
    return false;
  }

  if (config.corsAllowedOrigins.has(normalizedOrigin)) return true;

  if (!config.isProduction && /^http:\/\/localhost:\d+$/.test(normalizedOrigin)) {
    return true;
  }

  return false;
}
