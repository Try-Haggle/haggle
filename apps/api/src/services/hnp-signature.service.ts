import {
  constants,
  createPublicKey,
  createVerify,
  type KeyObject,
} from "node:crypto";
import { isProductionRuntime } from "../config/runtime.js";

export type HnpSignedEnvelope = Record<string, unknown> & {
  message_id?: unknown;
  detached_signature?: unknown;
};

export type HnpSignatureValidationResult =
  | { ok: true; verified: boolean }
  | { ok: false; status: 401; error: "INVALID_SIGNATURE"; relatedMessageId?: string };

interface JwkRecord extends Record<string, unknown> {
  kid?: string;
  alg?: string;
  kty?: string;
}

interface ProtectedHeader {
  alg?: string;
  kid?: string;
  b64?: boolean;
  crit?: unknown;
}

const SUPPORTED_ALGORITHMS: Record<string, string> = {
  RS256: "RSA-SHA256",
  PS256: "RSA-SHA256",
};

export function validateHnpDetachedSignature(envelope: HnpSignedEnvelope): HnpSignatureValidationResult {
  const signature = typeof envelope.detached_signature === "string" ? envelope.detached_signature : undefined;
  const requireSignature = isHnpSignatureRequired();
  const relatedMessageId = typeof envelope.message_id === "string" ? envelope.message_id : undefined;

  if (!signature) {
    return requireSignature
      ? { ok: false, status: 401, error: "INVALID_SIGNATURE", relatedMessageId }
      : { ok: true, verified: false };
  }

  try {
    const parsed = parseDetachedJws(signature);
    if (!parsed) {
      return { ok: false, status: 401, error: "INVALID_SIGNATURE", relatedMessageId };
    }

    const key = resolveTrustedKey(parsed.header);
    if (!key) {
      return { ok: false, status: 401, error: "INVALID_SIGNATURE", relatedMessageId };
    }

    const payload = canonicalJson(withoutDetachedSignature(envelope));
    const encodedPayload = parsed.header.b64 === false
      ? payload
      : base64url(Buffer.from(payload, "utf8"));
    const signingInput = `${parsed.encodedHeader}.${encodedPayload}`;

    const verifier = createVerify(SUPPORTED_ALGORITHMS[parsed.header.alg!]);
    verifier.update(signingInput);
    verifier.end();

    const valid = parsed.header.alg === "PS256"
      ? verifier.verify({
          key,
          padding: constants.RSA_PKCS1_PSS_PADDING,
          saltLength: constants.RSA_PSS_SALTLEN_DIGEST,
        }, parsed.signature)
      : verifier.verify(key, parsed.signature);

    return valid
      ? { ok: true, verified: true }
      : { ok: false, status: 401, error: "INVALID_SIGNATURE", relatedMessageId };
  } catch {
    return { ok: false, status: 401, error: "INVALID_SIGNATURE", relatedMessageId };
  }
}

export function isHnpSignatureRequired(): boolean {
  const configured = process.env.HNP_REQUIRE_SIGNATURE?.trim().toLowerCase();
  if (configured === "true") return true;
  if (configured === "false") return false;
  return isProductionRuntime();
}

export function canonicalJson(value: unknown): string {
  return JSON.stringify(canonicalize(value));
}

function canonicalize(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(canonicalize);
  if (!value || typeof value !== "object") return value;

  const record = value as Record<string, unknown>;
  return Object.keys(record)
    .filter((key) => record[key] !== undefined)
    .sort()
    .reduce<Record<string, unknown>>((acc, key) => {
      acc[key] = canonicalize(record[key]);
      return acc;
    }, {});
}

function parseDetachedJws(signature: string): {
  encodedHeader: string;
  header: ProtectedHeader;
  signature: Buffer;
} | null {
  const parts = signature.split(".");
  if (parts.length !== 3 || parts[1] !== "") return null;

  const header = JSON.parse(Buffer.from(parts[0], "base64url").toString("utf8")) as ProtectedHeader;
  if (!header.alg || !SUPPORTED_ALGORITHMS[header.alg]) return null;
  if (header.b64 === false) {
    const crit = Array.isArray(header.crit) ? header.crit : [];
    if (!crit.includes("b64")) return null;
  }

  return {
    encodedHeader: parts[0],
    header,
    signature: Buffer.from(parts[2], "base64url"),
  };
}

function resolveTrustedKey(header: ProtectedHeader): KeyObject | null {
  const jwks = parseTrustedJwks();
  if (!jwks.length) return null;

  const jwk = jwks.find((candidate) => {
    if (header.kid && candidate.kid !== header.kid) return false;
    if (candidate.alg && candidate.alg !== header.alg) return false;
    return true;
  });
  if (!jwk) return null;

  return createPublicKey({ key: jwk, format: "jwk" });
}

function parseTrustedJwks(): JwkRecord[] {
  const raw = process.env.HNP_TRUSTED_JWKS?.trim();
  if (!raw) return [];

  const parsed = JSON.parse(raw) as { keys?: unknown };
  return Array.isArray(parsed.keys)
    ? parsed.keys.filter((key): key is JwkRecord => Boolean(key && typeof key === "object"))
    : [];
}

function withoutDetachedSignature(envelope: HnpSignedEnvelope): Record<string, unknown> {
  const { detached_signature: _detachedSignature, ...rest } = envelope;
  return rest;
}

function base64url(input: Buffer): string {
  return input.toString("base64url");
}
