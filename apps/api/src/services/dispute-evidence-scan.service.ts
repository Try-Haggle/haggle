import { createHash } from "node:crypto";
import type { Database } from "@haggle/db";
import {
  acquireDisputeEvidenceScannerPermit,
  type DisputeEvidenceScannerCircuitConfig,
  finalizeDisputeEvidenceScannerPermit,
} from "./dispute-evidence-scanner-circuit.service.js";
import {
  assertDisputeModuleOutboundUrl,
  DISPUTE_MODULE_MAX_RESOLVED_ADDRESSES,
  type DisputeModuleDnsLookup,
  postDisputeModulePinnedBytes,
} from "./dispute-module-outbound-url.service.js";

export type DisputeEvidenceScanStatus = "CLEAN" | "INFECTED" | "PENDING" | "FAILED";

export interface DisputeEvidenceScanResult {
  status: DisputeEvidenceScanStatus;
  sha256?: string;
  provider: string;
  detail: string;
}

export interface DisputeEvidenceScannerConfig {
  url: string;
  token: string;
  timeoutMs: number;
  maxResponseBytes: number;
  allowInsecureHttp: boolean;
  allowPrivateNetwork: boolean;
}

export type DisputeEvidenceScannerConfigurationState =
  | "not_configured"
  | "partial"
  | "invalid"
  | "valid";

const DEFAULT_TIMEOUT_MS = 15_000;
const MAX_RESPONSE_BYTES = 16_384;
const MAX_FILENAME_CHARS = 160;

function boundedInteger(
  raw: string | undefined,
  fallback: number,
  min: number,
  max: number,
): number {
  if (raw === undefined || raw.trim() === "") return fallback;
  const value = Number(raw);
  if (!Number.isInteger(value) || value < min || value > max) {
    throw new Error(`evidence scanner integer must be from ${min} to ${max}`);
  }
  return value;
}

function isProductionEnvironment(): boolean {
  return process.env.NODE_ENV === "production" || process.env.VERCEL_ENV === "production";
}

function validateScannerToken(token: string): void {
  if (
    token.length < 16 ||
    token.length > 512 ||
    token !== token.trim() ||
    // biome-ignore lint/suspicious/noControlCharactersInRegex: Scanner tokens reject ASCII controls.
    /[\u0000-\u001f\u007f]/.test(token)
  ) {
    throw new Error("evidence scanner token must be 16 to 512 non-control characters");
  }
}

export function assertDisputeEvidenceScannerConfig(
  config: DisputeEvidenceScannerConfig,
  options: { production?: boolean } = {},
): URL {
  validateScannerToken(config.token);
  if (!Number.isInteger(config.timeoutMs) || config.timeoutMs < 250 || config.timeoutMs > 30_000) {
    throw new Error("evidence scanner timeout must be from 250 to 30000 ms");
  }
  if (
    !Number.isInteger(config.maxResponseBytes) ||
    config.maxResponseBytes < 1_024 ||
    config.maxResponseBytes > MAX_RESPONSE_BYTES
  ) {
    throw new Error("evidence scanner response limit is invalid");
  }
  const production = options.production ?? isProductionEnvironment();
  if (production && (config.allowInsecureHttp || config.allowPrivateNetwork)) {
    throw new Error("evidence scanner network safety overrides are forbidden in production");
  }
  return assertDisputeModuleOutboundUrl(config.url, {
    label: "dispute evidence scanner",
    allowInsecureHttp: config.allowInsecureHttp,
    allowPrivateNetwork: config.allowPrivateNetwork,
  });
}

export function resolveDisputeEvidenceScannerConfigFromEnv(): DisputeEvidenceScannerConfig | null {
  const url = process.env.DISPUTE_EVIDENCE_SCANNER_URL?.trim() ?? "";
  const token = process.env.DISPUTE_EVIDENCE_SCANNER_TOKEN ?? "";
  const allowInsecureHttp = process.env.DISPUTE_EVIDENCE_SCANNER_ALLOW_INSECURE_HTTP === "true";
  const allowPrivateNetwork = process.env.DISPUTE_EVIDENCE_SCANNER_ALLOW_PRIVATE_NETWORK === "true";
  if (!url && !token) {
    if (allowInsecureHttp || allowPrivateNetwork) {
      throw new Error("evidence scanner network overrides require a configured scanner");
    }
    return null;
  }
  if (!url || !token) {
    throw new Error("evidence scanner URL and token must be configured together");
  }
  const config: DisputeEvidenceScannerConfig = {
    url,
    token,
    timeoutMs: boundedInteger(
      process.env.DISPUTE_EVIDENCE_SCANNER_TIMEOUT_MS,
      DEFAULT_TIMEOUT_MS,
      250,
      30_000,
    ),
    maxResponseBytes: MAX_RESPONSE_BYTES,
    allowInsecureHttp,
    allowPrivateNetwork,
  };
  assertDisputeEvidenceScannerConfig(config);
  return config;
}

export function getDisputeEvidenceScannerPolicyStatus() {
  const hasUrl = Boolean(process.env.DISPUTE_EVIDENCE_SCANNER_URL?.trim());
  const hasToken = Boolean(process.env.DISPUTE_EVIDENCE_SCANNER_TOKEN);
  const hasNetworkOverride =
    process.env.DISPUTE_EVIDENCE_SCANNER_ALLOW_INSECURE_HTTP === "true" ||
    process.env.DISPUTE_EVIDENCE_SCANNER_ALLOW_PRIVATE_NETWORK === "true";
  let configurationState: DisputeEvidenceScannerConfigurationState =
    !hasUrl && !hasToken
      ? hasNetworkOverride
        ? "invalid"
        : "not_configured"
      : hasUrl !== hasToken
        ? "partial"
        : "valid";
  if (configurationState === "valid") {
    try {
      resolveDisputeEvidenceScannerConfigFromEnv();
    } catch {
      configurationState = "invalid";
    }
  }
  let timeoutMs = DEFAULT_TIMEOUT_MS;
  try {
    timeoutMs = boundedInteger(
      process.env.DISPUTE_EVIDENCE_SCANNER_TIMEOUT_MS,
      DEFAULT_TIMEOUT_MS,
      250,
      30_000,
    );
  } catch {
    configurationState = configurationState === "not_configured" ? "not_configured" : "invalid";
  }
  return {
    schemaVersion: "dispute-evidence-scanner-readiness-v1" as const,
    configurationState,
    configured: configurationState === "valid",
    authenticated: configurationState === "valid" && hasToken,
    transport: {
      httpsRequired: true,
      insecureHttpOverride: process.env.DISPUTE_EVIDENCE_SCANNER_ALLOW_INSECURE_HTTP === "true",
    },
    network: {
      privateNetworkBlocked: process.env.DISPUTE_EVIDENCE_SCANNER_ALLOW_PRIVATE_NETWORK !== "true",
      redirectsBlocked: true,
      dnsResolutionValidated: true,
      dnsConnectionPinned: true,
    },
    limits: {
      timeoutMs,
      maxResponseBytes: MAX_RESPONSE_BYTES,
      maxFilenameChars: MAX_FILENAME_CHARS,
      maxResolvedAddresses: DISPUTE_MODULE_MAX_RESOLVED_ADDRESSES,
    },
    containsUrl: false,
    containsToken: false,
  };
}

function hasPrefix(bytes: Buffer, prefix: number[]): boolean {
  return prefix.every((value, index) => bytes[index] === value);
}

async function readBoundedResponseText(
  response: Response,
  maxBytes: number,
): Promise<string | null> {
  if (!response.body) return "";
  const reader = response.body.getReader();
  const chunks: Buffer[] = [];
  let totalBytes = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      totalBytes += value.byteLength;
      if (totalBytes > maxBytes) {
        await reader.cancel().catch(() => undefined);
        return null;
      }
      chunks.push(Buffer.from(value));
    }
  } finally {
    reader.releaseLock();
  }
  return Buffer.concat(chunks, totalBytes).toString("utf8");
}

async function cancelScannerResponse(response: Response): Promise<void> {
  await response.body?.cancel().catch(() => undefined);
}

export function contentMatchesClaimedType(bytes: Buffer, contentType: string): boolean {
  if (contentType === "image/jpeg") return hasPrefix(bytes, [0xff, 0xd8, 0xff]);
  if (contentType === "image/png") {
    return hasPrefix(bytes, [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
  }
  if (contentType === "image/webp") {
    return (
      bytes.subarray(0, 4).toString("ascii") === "RIFF" &&
      bytes.subarray(8, 12).toString("ascii") === "WEBP"
    );
  }
  if (contentType === "image/heic") {
    const brand = bytes.subarray(8, 12).toString("ascii");
    return (
      bytes.subarray(4, 8).toString("ascii") === "ftyp" &&
      ["heic", "heix", "hevc", "hevx", "mif1", "msf1"].includes(brand)
    );
  }
  if (contentType === "video/mp4") {
    return bytes.subarray(4, 8).toString("ascii") === "ftyp";
  }
  if (contentType === "video/quicktime") {
    return (
      bytes.subarray(4, 8).toString("ascii") === "ftyp" &&
      bytes.subarray(8, 12).toString("ascii") === "qt  "
    );
  }
  if (contentType === "video/webm") {
    return hasPrefix(bytes, [0x1a, 0x45, 0xdf, 0xa3]);
  }
  return false;
}

export async function scanDisputeEvidence(
  input: {
    bytes: Buffer;
    contentType: string;
    expectedSizeBytes: number;
    filename: string;
  },
  options: {
    config?: DisputeEvidenceScannerConfig | null;
    fetchImpl?: typeof fetch;
    dnsLookupImpl?: DisputeModuleDnsLookup;
    db?: Database;
    circuitConfig?: DisputeEvidenceScannerCircuitConfig;
    trustedStagingFixture?: boolean;
  } = {},
): Promise<DisputeEvidenceScanResult> {
  const sha256 = createHash("sha256").update(input.bytes).digest("hex");
  if (input.bytes.length !== input.expectedSizeBytes) {
    return {
      status: "INFECTED",
      sha256,
      provider: "haggle-integrity",
      detail: "FILE_SIZE_MISMATCH",
    };
  }
  if (!contentMatchesClaimedType(input.bytes, input.contentType)) {
    return {
      status: "INFECTED",
      sha256,
      provider: "haggle-integrity",
      detail: "CONTENT_TYPE_MISMATCH",
    };
  }
  if (options.trustedStagingFixture) {
    return {
      status: "CLEAN",
      sha256,
      provider: "haggle-staging-fixture-integrity",
      detail: "INTEGRITY_ONLY_FIXTURE",
    };
  }

  const config =
    options.config === undefined ? resolveDisputeEvidenceScannerConfigFromEnv() : options.config;
  if (!config) {
    return {
      status: "PENDING",
      sha256,
      provider: "not-configured",
      detail: "MALWARE_SCANNER_NOT_CONFIGURED",
    };
  }
  const scanner = assertDisputeEvidenceScannerConfig(config);
  const permit = options.db
    ? await acquireDisputeEvidenceScannerPermit(options.db, {
        config: options.circuitConfig,
      }).catch(() => null)
    : null;
  if (options.db && permit === null) {
    return {
      status: "FAILED",
      sha256,
      provider: "haggle-scanner-circuit",
      detail: "SCANNER_CIRCUIT_UNAVAILABLE",
    };
  }
  if (permit && !permit.acquired) {
    return {
      status: "PENDING",
      sha256,
      provider: "haggle-scanner-circuit",
      detail: permit.reason === "CAPACITY_BUSY" ? "SCANNER_CAPACITY_BUSY" : "SCANNER_CIRCUIT_OPEN",
    };
  }
  const provider = scanner.hostname;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), config.timeoutMs);
  let result: DisputeEvidenceScanResult | undefined;
  try {
    const headers = {
      "content-type": input.contentType,
      "x-haggle-content-sha256": sha256,
      "x-haggle-filename": encodeURIComponent(input.filename.slice(0, MAX_FILENAME_CHARS)),
      authorization: `Bearer ${config.token}`,
    };
    const response = options.fetchImpl
      ? await options.fetchImpl(scanner, {
          method: "POST",
          redirect: "error",
          headers,
          body: input.bytes,
          signal: controller.signal,
        })
      : await postDisputeModulePinnedBytes(
          scanner,
          {
            headers,
            body: input.bytes,
            signal: controller.signal,
          },
          {
            label: "dispute evidence scanner",
            allowInsecureHttp: config.allowInsecureHttp,
            allowPrivateNetwork: config.allowPrivateNetwork,
          },
          { lookupImpl: options.dnsLookupImpl },
        );
    if (!response.ok) {
      await cancelScannerResponse(response);
      result = {
        status: "FAILED",
        sha256,
        provider,
        detail: `SCANNER_HTTP_${response.status}`,
      };
      return result;
    }
    const responseContentType = response.headers
      .get("content-type")
      ?.split(";", 1)[0]
      ?.trim()
      .toLowerCase();
    if (responseContentType !== "application/json") {
      await cancelScannerResponse(response);
      result = {
        status: "FAILED",
        sha256,
        provider,
        detail: "INVALID_SCANNER_CONTENT_TYPE",
      };
      return result;
    }
    const contentLength = Number(response.headers.get("content-length"));
    if (Number.isFinite(contentLength) && contentLength > config.maxResponseBytes) {
      await cancelScannerResponse(response);
      result = {
        status: "FAILED",
        sha256,
        provider,
        detail: "SCANNER_RESPONSE_TOO_LARGE",
      };
      return result;
    }
    const responseText = await readBoundedResponseText(response, config.maxResponseBytes);
    if (responseText === null) {
      result = {
        status: "FAILED",
        sha256,
        provider,
        detail: "SCANNER_RESPONSE_TOO_LARGE",
      };
      return result;
    }
    let payload: { status?: unknown; detail?: unknown };
    try {
      payload = JSON.parse(responseText) as {
        status?: unknown;
        detail?: unknown;
      };
    } catch {
      result = {
        status: "FAILED",
        sha256,
        provider,
        detail: "INVALID_SCANNER_RESPONSE",
      };
      return result;
    }
    if (payload.status === "clean") {
      result = { status: "CLEAN", sha256, provider, detail: "CLEAN" };
      return result;
    }
    if (payload.status === "infected") {
      result = {
        status: "INFECTED",
        sha256,
        provider,
        detail:
          typeof payload.detail === "string" ? payload.detail.slice(0, 200) : "MALWARE_DETECTED",
      };
      return result;
    }
    result = {
      status: "FAILED",
      sha256,
      provider,
      detail: "INVALID_SCANNER_RESPONSE",
    };
    return result;
  } catch (error) {
    result = {
      status: "FAILED",
      sha256,
      provider,
      detail:
        error instanceof Error && error.name === "AbortError"
          ? "SCANNER_TIMEOUT"
          : "SCANNER_UNAVAILABLE",
    };
    return result;
  } finally {
    clearTimeout(timer);
    if (permit?.acquired) {
      const finalized = await finalizeDisputeEvidenceScannerPermit(options.db!, permit, {
        scannerOperational: result?.status === "CLEAN" || result?.status === "INFECTED",
        config: options.circuitConfig,
      }).catch(() => false);
      if (!finalized) {
        // biome-ignore lint/correctness/noUnsafeFinally: Fail closed if circuit state cannot be finalized.
        throw new Error("SCANNER_CIRCUIT_FINALIZE_FAILED");
      }
    }
  }
}
