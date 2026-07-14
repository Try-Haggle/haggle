import { createHash, createHmac, timingSafeEqual } from "node:crypto";

export interface DisputeModuleSignatureInput {
  method: string;
  path: string;
  rawBody: Buffer | string;
  platformId?: string | string[];
  timestamp?: string | string[];
  signature?: string | string[];
  idempotencyKey?: string | string[];
  nowMs?: number;
  secretResolver: (platformId: string) => string | string[] | null | undefined;
}

export type DisputeModuleSignatureResult =
  | {
      ok: true;
      platformId: string;
      idempotencyKey: string;
      verifiedAtMs: number;
    }
  | {
      ok: false;
      status: 400 | 401;
      error:
        | "MISSING_MODULE_AUTH"
        | "INVALID_MODULE_TIMESTAMP"
        | "MODULE_TIMESTAMP_OUT_OF_RANGE"
        | "INVALID_IDEMPOTENCY_KEY"
        | "UNKNOWN_PLATFORM"
        | "INVALID_MODULE_SIGNATURE";
    };

const MAX_CLOCK_SKEW_MS = 5 * 60 * 1000;
const IDEMPOTENCY_KEY_RE = /^[A-Za-z0-9._:-]{8,128}$/;

function singleHeader(value: string | string[] | undefined): string | undefined {
  if (Array.isArray(value)) return value[0];
  return value;
}

export function resolveDisputeModuleSecretFromEnv(platformId: string): string | null {
  const secrets = resolveDisputeModuleSecretsFromEnv(platformId);
  return secrets[0] ?? null;
}

export function resolveDisputeModuleSecretsFromEnv(platformId: string): string[] {
  const raw = process.env.DISPUTE_MODULE_PLATFORM_SECRETS;
  if (!raw) return [];
  try {
    const parsed = JSON.parse(raw) as Record<string, unknown>;
    return normalizeSecretCandidates(parsed[platformId]);
  } catch {
    return [];
  }
}

function normalizeSecretCandidates(config: unknown): string[] {
  const candidates: unknown[] = [];
  if (typeof config === "string") {
    candidates.push(config);
  } else if (Array.isArray(config)) {
    candidates.push(...config);
  } else if (config && typeof config === "object") {
    const record = config as Record<string, unknown>;
    candidates.push(record.current);
    if (Array.isArray(record.previous)) {
      candidates.push(...record.previous);
    } else {
      candidates.push(record.previous);
    }
  }

  const seen = new Set<string>();
  return candidates.filter((candidate): candidate is string => {
    if (typeof candidate !== "string" || candidate.length < 16 || seen.has(candidate)) {
      return false;
    }
    seen.add(candidate);
    return true;
  });
}

export function buildDisputeModuleSigningPayload(params: {
  timestamp: string;
  method: string;
  path: string;
  rawBody: Buffer | string;
}): string {
  const bodyHash = createHash("sha256").update(params.rawBody).digest("hex");
  return `${params.timestamp}.${params.method.toUpperCase()}.${params.path}.${bodyHash}`;
}

export function signDisputeModulePayload(params: {
  secret: string;
  timestamp: string;
  method: string;
  path: string;
  rawBody: Buffer | string;
}): string {
  const payload = buildDisputeModuleSigningPayload(params);
  return `sha256=${createHmac("sha256", params.secret).update(payload).digest("hex")}`;
}

export function verifyDisputeModuleSignature(
  input: DisputeModuleSignatureInput,
): DisputeModuleSignatureResult {
  const platformId = singleHeader(input.platformId);
  const timestamp = singleHeader(input.timestamp);
  const signature = singleHeader(input.signature);
  const idempotencyKey = singleHeader(input.idempotencyKey);

  if (!platformId || !timestamp || !signature || !idempotencyKey) {
    return { ok: false, status: 401, error: "MISSING_MODULE_AUTH" };
  }

  if (!IDEMPOTENCY_KEY_RE.test(idempotencyKey)) {
    return { ok: false, status: 400, error: "INVALID_IDEMPOTENCY_KEY" };
  }

  const timestampMs = Date.parse(timestamp);
  if (!Number.isFinite(timestampMs)) {
    return { ok: false, status: 400, error: "INVALID_MODULE_TIMESTAMP" };
  }

  const nowMs = input.nowMs ?? Date.now();
  if (Math.abs(nowMs - timestampMs) > MAX_CLOCK_SKEW_MS) {
    return { ok: false, status: 401, error: "MODULE_TIMESTAMP_OUT_OF_RANGE" };
  }

  const secrets = normalizeSecretCandidates(input.secretResolver(platformId));
  if (secrets.length === 0) {
    return { ok: false, status: 401, error: "UNKNOWN_PLATFORM" };
  }

  const received = signature.startsWith("sha256=") ? signature : `sha256=${signature}`;
  const receivedBuf = Buffer.from(received);
  let matched = false;
  for (const secret of secrets) {
    const expected = signDisputeModulePayload({
      secret,
      timestamp,
      method: input.method,
      path: input.path,
      rawBody: input.rawBody,
    });
    const expectedBuf = Buffer.from(expected);
    matched =
      (expectedBuf.length === receivedBuf.length && timingSafeEqual(expectedBuf, receivedBuf)) ||
      matched;
  }
  if (!matched) {
    return { ok: false, status: 401, error: "INVALID_MODULE_SIGNATURE" };
  }

  return {
    ok: true,
    platformId,
    idempotencyKey,
    verifiedAtMs: nowMs,
  };
}
