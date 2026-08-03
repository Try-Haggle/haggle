/**
 * Boot-time environment validation.
 *
 * Collects ALL missing/invalid required env vars and reports them at once,
 * instead of throwing on the first one (the old `readRequiredEnv` behaviour) or
 * — worse — letting the app boot and crash later when a code path first reads an
 * undefined value.
 *
 * No external dependency: a small declarative spec validated by hand, matching
 * the existing `config/runtime.ts` style.
 *
 * Which vars are required is deliberately conservative — payment/x402/Stripe
 * keys are mode-gated (mock vs real), so they are NOT blanket-required here.
 * Only vars the app genuinely cannot run without are enforced.
 */

import { BASE_SEPOLIA_CONTRACT_ADDRESSES } from "@haggle/contracts";
import { BASE_MAINNET_USDC_ADDRESS, BASE_SEPOLIA_HAGGLE_TEST_USDC_ADDRESS } from "@haggle/shared";
import { physicalShippingReadiness } from "../shipping/shipping-execution-mode.js";

type EnvScope = "always" | "production";

interface EnvRule {
  name: string;
  scope: EnvScope;
  /** Human hint shown when the var is missing/invalid. */
  hint: string;
  /** Optional format check, run only when a value is present. Return an error string if invalid. */
  validate?: (value: string) => string | null;
}

function isProductionRuntime(): boolean {
  return process.env.NODE_ENV === "production" || process.env.VERCEL_ENV === "production";
}

const VALID_NODE_ENVS = new Set(["development", "test", "production"]);

const ENV_RULES: EnvRule[] = [
  {
    name: "NODE_ENV",
    scope: "always",
    hint: "Set to development, test, or production.",
    validate: (v) =>
      VALID_NODE_ENVS.has(v) ? null : `must be one of development, test, production (got "${v}")`,
  },
  {
    name: "DATABASE_URL",
    scope: "always",
    hint: "Supabase pooler connection string (postgresql://...).",
    validate: (v) =>
      v.startsWith("postgres://") || v.startsWith("postgresql://")
        ? null
        : "must be a postgres connection string (postgres:// or postgresql://)",
  },
  // Auth — required to verify Supabase-issued JWTs in production.
  {
    name: "SUPABASE_JWT_SECRET",
    scope: "production",
    hint: "Supabase dashboard > Settings > API > JWT secret.",
  },
  // Storage — required for image uploads in production.
  {
    name: "SUPABASE_URL",
    scope: "production",
    hint: "https://<project-ref>.supabase.co",
    validate: (v) => (v.startsWith("https://") ? null : "must be an https:// URL"),
  },
  {
    name: "SUPABASE_SERVICE_ROLE_KEY",
    scope: "production",
    hint: "Supabase dashboard > Settings > API > service_role key.",
  },
];

/**
 * Validate required environment variables for the current runtime.
 * Throws a single aggregated error listing every problem found.
 */
export function validateEnv(): void {
  const inProduction = isProductionRuntime();
  const problems: string[] = [];

  for (const rule of ENV_RULES) {
    if (rule.scope === "production" && !inProduction) continue;

    const value = process.env[rule.name]?.trim();
    if (!value) {
      problems.push(`  • ${rule.name}: required — ${rule.hint}`);
      continue;
    }

    const formatError = rule.validate?.(value);
    if (formatError) {
      problems.push(`  • ${rule.name}: ${formatError}`);
    }
  }

  if (process.env.HAGGLE_ENV?.trim().toLowerCase() === "staging") {
    const expectedStagingValues = {
      HAGGLE_SETTLEMENT_ASSET_PROFILE: "base-sepolia-husdc",
      HAGGLE_X402_NETWORK: "base-sepolia",
      HAGGLE_X402_WALLET_NETWORK: "eip155:84532",
      BASE_CHAIN_ID: "84532",
      HAGGLE_X402_USDC_ASSET_ADDRESS: BASE_SEPOLIA_HAGGLE_TEST_USDC_ADDRESS,
      HAGGLE_SETTLEMENT_ROUTER_ADDRESS: BASE_SEPOLIA_CONTRACT_ADDRESSES.settlementRouter,
      HAGGLE_CONDITIONAL_SETTLEMENT_ADDRESS: BASE_SEPOLIA_CONTRACT_ADDRESSES.conditionalSettlement,
      HAGGLE_DISPUTE_REGISTRY_ADDRESS: BASE_SEPOLIA_CONTRACT_ADDRESSES.disputeRegistry,
    } as const;

    for (const [name, expected] of Object.entries(expectedStagingValues)) {
      const actual = process.env[name]?.trim();
      if (!actual) {
        problems.push(`  • ${name}: required in staging — expected ${expected}`);
      } else if (actual.toLowerCase() !== expected.toLowerCase()) {
        problems.push(`  • ${name}: staging must use ${expected} (got "${actual}")`);
      }
    }

    if (process.env.HAGGLE_ENABLE_STAGING_LIVE_SHIPPING?.trim() === "true") {
      for (const missing of physicalShippingReadiness().missing) {
        problems.push(`  • ${missing}: required when staging live shipping is enabled`);
      }
    }

    const rpcUrl = process.env.HAGGLE_BASE_RPC_URL?.trim();
    if (!rpcUrl) {
      problems.push("  • HAGGLE_BASE_RPC_URL: required in staging for Base Sepolia");
    } else {
      try {
        const parsed = new URL(rpcUrl);
        if (parsed.protocol !== "https:") {
          problems.push("  • HAGGLE_BASE_RPC_URL: staging RPC URL must use https://");
        }
      } catch {
        problems.push("  • HAGGLE_BASE_RPC_URL: must be a valid https:// URL");
      }
    }
  }

  if (process.env.HAGGLE_ENV?.trim().toLowerCase() === "production") {
    const expectedProductionValues = {
      HAGGLE_SETTLEMENT_ASSET_PROFILE: "base-usdc",
      HAGGLE_X402_NETWORK: "base",
      HAGGLE_X402_WALLET_NETWORK: "eip155:8453",
      BASE_CHAIN_ID: "8453",
      HAGGLE_X402_USDC_ASSET_ADDRESS: BASE_MAINNET_USDC_ADDRESS,
    } as const;

    for (const [name, expected] of Object.entries(expectedProductionValues)) {
      const actual = process.env[name]?.trim();
      if (!actual) {
        problems.push(`  • ${name}: required in production — expected ${expected}`);
      } else if (actual.toLowerCase() !== expected.toLowerCase()) {
        problems.push(`  • ${name}: production must use ${expected} (got "${actual}")`);
      }
    }
  }

  if (problems.length > 0) {
    const scopeLabel = inProduction ? "production" : "development";
    throw new Error(
      `[CONFIG] Invalid environment (${problems.length} problem(s), runtime=${scopeLabel}):\n` +
        `${problems.join("\n")}\n` +
        `→ See apps/api/.env.example and fill the missing values in your .env file.`,
    );
  }
}
