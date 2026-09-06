import {
  classifyEasyPostApiKey,
  type EasyPostKeyMode,
  isEasyPostLiveApiKey,
  isEasyPostTestApiKey,
} from "@haggle/shipping-core";

export type { EasyPostKeyMode } from "@haggle/shipping-core";

export const SHIPPING_EXECUTION_MODES = ["integration_manual", "physical_live"] as const;

export type ShippingExecutionMode = (typeof SHIPPING_EXECUTION_MODES)[number];
export type ShippingProviderEnvironment = "test" | "live";

const MODE_METADATA_KEY = "shipping_execution_mode";
const PROVIDER_ENV_METADATA_KEY = "shipping_provider_environment";
const DEFAULT_STAGING_LIVE_LABEL_MAX_MINOR = 5_000;
const ABSOLUTE_STAGING_LIVE_LABEL_MAX_MINOR = 50_000;

function normalized(value: string | undefined): string {
  return value?.trim() ?? "";
}

export function defaultShippingExecutionMode(): ShippingExecutionMode {
  return normalized(process.env.HAGGLE_ENV).toLowerCase() === "staging" ||
    process.env.NODE_ENV !== "production"
    ? "integration_manual"
    : "physical_live";
}

export function readShippingExecutionMode(
  metadata: Record<string, unknown> | null | undefined,
): ShippingExecutionMode {
  const value = metadata?.[MODE_METADATA_KEY];
  return value === "integration_manual" || value === "physical_live"
    ? value
    : defaultShippingExecutionMode();
}

export function providerEnvironmentForMode(
  mode: ShippingExecutionMode,
): ShippingProviderEnvironment {
  return mode === "physical_live" ? "live" : "test";
}

export function metadataForShippingExecutionMode(
  mode: ShippingExecutionMode,
  current: Record<string, unknown> | null | undefined = {},
): Record<string, unknown> {
  return {
    ...(current ?? {}),
    [MODE_METADATA_KEY]: mode,
    [PROVIDER_ENV_METADATA_KEY]: providerEnvironmentForMode(mode),
    shipping_execution_mode_locked_at: new Date().toISOString(),
  };
}

export function easyPostApiKeyForMode(mode: ShippingExecutionMode): string | null {
  const legacy = normalized(process.env.EASYPOST_API_KEY);
  if (mode === "integration_manual") {
    const candidate = normalized(process.env.EASYPOST_TEST_API_KEY) || legacy;
    return candidate && isEasyPostTestApiKey(candidate) ? candidate : null;
  }

  const candidate = normalized(process.env.EASYPOST_LIVE_API_KEY) || legacy;
  return candidate && isEasyPostLiveApiKey(candidate) ? candidate : null;
}

export function easyPostWebhookSecrets(): string[] {
  return [
    normalized(process.env.EASYPOST_WEBHOOK_SECRET),
    normalized(process.env.EASYPOST_TEST_WEBHOOK_SECRET),
    normalized(process.env.EASYPOST_LIVE_WEBHOOK_SECRET),
  ].filter((value, index, values) => value.length > 0 && values.indexOf(value) === index);
}

export function isHusdcStagingRuntime(): boolean {
  return (
    normalized(process.env.HAGGLE_ENV).toLowerCase() === "staging" &&
    normalized(process.env.HAGGLE_X402_NETWORK) === "base-sepolia" &&
    normalized(process.env.HAGGLE_SETTLEMENT_ASSET_PROFILE) === "base-sepolia-husdc"
  );
}

export function stagingLiveLabelMaxMinor(): number {
  const configured = Number(normalized(process.env.HAGGLE_STAGING_LIVE_LABEL_MAX_MINOR));
  if (!Number.isSafeInteger(configured) || configured <= 0) {
    return DEFAULT_STAGING_LIVE_LABEL_MAX_MINOR;
  }
  return Math.min(configured, ABSOLUTE_STAGING_LIVE_LABEL_MAX_MINOR);
}

export function stagingLiveLabelCostLimit(
  mode: ShippingExecutionMode,
  rateMinor: number,
): { rateMinor: number; maxRateMinor: number } | null {
  if (mode !== "physical_live" || normalized(process.env.HAGGLE_ENV).toLowerCase() !== "staging") {
    return null;
  }
  const maxRateMinor = stagingLiveLabelMaxMinor();
  return rateMinor > maxRateMinor ? { rateMinor, maxRateMinor } : null;
}

export function physicalShippingReadiness() {
  const staging = isHusdcStagingRuntime();
  const enabled = normalized(process.env.HAGGLE_ENABLE_STAGING_LIVE_SHIPPING) === "true";
  const liveApiKey = Boolean(easyPostApiKeyForMode("physical_live"));
  const liveWebhookSecret = Boolean(
    normalized(process.env.EASYPOST_LIVE_WEBHOOK_SECRET) ||
      normalized(process.env.EASYPOST_WEBHOOK_SECRET),
  );
  const missing = [
    ...(!staging ? ["hUSDC Base Sepolia staging profile"] : []),
    ...(!enabled ? ["HAGGLE_ENABLE_STAGING_LIVE_SHIPPING=true"] : []),
    ...(!liveApiKey ? ["EASYPOST_LIVE_API_KEY"] : []),
    ...(!liveWebhookSecret ? ["EASYPOST_LIVE_WEBHOOK_SECRET"] : []),
  ];
  return {
    ready: missing.length === 0,
    staging_husdc: staging,
    live_shipping_enabled: enabled,
    live_api_key_configured: liveApiKey,
    live_webhook_configured: liveWebhookSecret,
    live_label_max_minor: stagingLiveLabelMaxMinor(),
    live_label_funding_source: "haggle_staging_fiat_subsidy",
    missing,
  };
}

export function integrationShippingReadiness() {
  const staging = isHusdcStagingRuntime();
  const testApiKey = Boolean(easyPostApiKeyForMode("integration_manual"));
  const missing = [
    ...(!staging ? ["hUSDC Base Sepolia staging profile"] : []),
    ...(!testApiKey ? ["EASYPOST_TEST_API_KEY"] : []),
  ];
  return {
    ready: missing.length === 0,
    staging_husdc: staging,
    test_api_key_configured: testApiKey,
    missing,
  };
}

// ---------------------------------------------------------------------------
// A9: staging EasyPost test-label key gate (R4 Stripe spirit)
// ---------------------------------------------------------------------------

export const STAGING_LIVE_EASYPOST_KEYS_FORBIDDEN = "STAGING_LIVE_EASYPOST_KEYS_FORBIDDEN" as const;

export type StagingLiveEasyPostKeysGateEnv = Partial<Pick<NodeJS.ProcessEnv, "HAGGLE_ENV">>;

/**
 * Classify an EasyPost API key without exposing secret material.
 * Test keys: EZTK / EZTEST. Live keys: EZAK.
 */
export function classifyEasyPostKeyMode(apiKey: string | undefined): EasyPostKeyMode {
  return classifyEasyPostApiKey(apiKey);
}

/**
 * Candidate key for the one-step EasyPost **test** label path.
 * Never reads EASYPOST_LIVE_API_KEY — live/prod keys cannot purchase via this path.
 */
export function resolveEasyPostTestLabelCandidateKey(
  env: Partial<NodeJS.ProcessEnv> = process.env,
): string | null {
  const candidate = normalized(env.EASYPOST_TEST_API_KEY) || normalized(env.EASYPOST_API_KEY);
  return candidate.length > 0 ? candidate : null;
}

/**
 * Staging must use EasyPost test/mock keys only for the one-step test-label dogfood path.
 * Live (EZAK) keys on staging fail closed — no real paid label purchase.
 */
export function isStagingLiveEasyPostKeysForbidden(
  env: StagingLiveEasyPostKeysGateEnv = { HAGGLE_ENV: process.env.HAGGLE_ENV },
  keyMode: EasyPostKeyMode = classifyEasyPostKeyMode(resolveEasyPostTestLabelCandidateKey()),
): boolean {
  const haggleEnv = normalized(env.HAGGLE_ENV).toLowerCase();
  return haggleEnv === "staging" && keyMode === "live";
}

export function assertStagingEasyPostTestLabelKeysAllowed(
  env: StagingLiveEasyPostKeysGateEnv = { HAGGLE_ENV: process.env.HAGGLE_ENV },
  keyMode: EasyPostKeyMode = classifyEasyPostKeyMode(resolveEasyPostTestLabelCandidateKey()),
): void {
  if (!isStagingLiveEasyPostKeysForbidden(env, keyMode)) return;
  throw Object.assign(
    new Error(
      `${STAGING_LIVE_EASYPOST_KEYS_FORBIDDEN}: Staging forbids live EasyPost keys for the one-step test label path. Configure EASYPOST_TEST_API_KEY (EZTK/EZTEST) or omit for mock.`,
    ),
    {
      code: STAGING_LIVE_EASYPOST_KEYS_FORBIDDEN,
      statusCode: 503,
    },
  );
}

export function isStagingLiveEasyPostKeysForbiddenError(
  error: unknown,
): error is Error & { code: typeof STAGING_LIVE_EASYPOST_KEYS_FORBIDDEN } {
  return (
    typeof error === "object" &&
    error !== null &&
    "code" in error &&
    (error as { code?: unknown }).code === STAGING_LIVE_EASYPOST_KEYS_FORBIDDEN
  );
}
