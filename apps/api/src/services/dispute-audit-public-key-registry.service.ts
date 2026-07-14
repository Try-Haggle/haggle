import { createHash, createPrivateKey, createPublicKey } from "node:crypto";
import { canonicalDisputeAuditJson } from "./dispute-ai-assessment-event.service.js";
import type { createSignedDisputeAiAuditExport } from "./dispute-ai-audit-export.service.js";
import { verifySignedDisputeAiAuditExport } from "./dispute-ai-audit-export.service.js";

export type DisputeAuditKeyStatus = "active" | "retired" | "revoked";
export interface DisputeAuditPublicKeyRecord {
  key_id: string;
  algorithm: "Ed25519";
  public_key_spki_base64: string;
  status: DisputeAuditKeyStatus;
  not_before: string;
  not_after: string | null;
  retired_at: string | null;
  revoked_at: string | null;
}
type SignedAudit = ReturnType<typeof createSignedDisputeAiAuditExport>;

export function disputeAuditKeyId(publicKeyDer: Buffer) {
  return createHash("sha256").update(publicKeyDer).digest("hex").slice(0, 24);
}

function iso(value: unknown, field: string, nullable = false): string | null {
  if (nullable && (value === null || value === undefined || value === "")) return null;
  if (typeof value !== "string" || !Number.isFinite(Date.parse(value)))
    throw new Error(`INVALID_DISPUTE_AUDIT_KEY_${field.toUpperCase()}`);
  return new Date(value).toISOString();
}

export function normalizeDisputeAuditPublicKeyRecord(value: unknown): DisputeAuditPublicKeyRecord {
  if (!value || typeof value !== "object" || Array.isArray(value))
    throw new Error("INVALID_DISPUTE_AUDIT_KEY_RECORD");
  const record = value as Record<string, unknown>;
  if (record.status !== "active" && record.status !== "retired" && record.status !== "revoked")
    throw new Error("INVALID_DISPUTE_AUDIT_KEY_STATUS");
  if (typeof record.public_key_spki_base64 !== "string" || !record.public_key_spki_base64.trim())
    throw new Error("INVALID_DISPUTE_AUDIT_PUBLIC_KEY");
  const der = Buffer.from(record.public_key_spki_base64.trim(), "base64");
  const key = createPublicKey({ key: der, format: "der", type: "spki" });
  if (key.asymmetricKeyType !== "ed25519") throw new Error("INVALID_DISPUTE_AUDIT_PUBLIC_KEY_TYPE");
  const canonicalDer = key.export({ format: "der", type: "spki" });
  const keyId = disputeAuditKeyId(canonicalDer);
  if (record.key_id !== undefined && record.key_id !== keyId)
    throw new Error("DISPUTE_AUDIT_KEY_ID_MISMATCH");
  const notBefore = iso(record.not_before ?? "1970-01-01T00:00:00.000Z", "not_before")!;
  const notAfter = iso(record.not_after, "not_after", true);
  const retiredAt = iso(record.retired_at, "retired_at", true);
  const revokedAt = iso(record.revoked_at, "revoked_at", true);
  if (notAfter && notAfter < notBefore) throw new Error("INVALID_DISPUTE_AUDIT_KEY_WINDOW");
  if (retiredAt && retiredAt < notBefore) throw new Error("INVALID_DISPUTE_AUDIT_KEY_WINDOW");
  if (record.status === "active" && (retiredAt || revokedAt))
    throw new Error("INVALID_DISPUTE_AUDIT_ACTIVE_KEY_DATES");
  if (record.status === "retired" && !retiredAt)
    throw new Error("DISPUTE_AUDIT_RETIRED_KEY_MISSING_DATE");
  if (record.status === "retired" && revokedAt)
    throw new Error("INVALID_DISPUTE_AUDIT_RETIRED_KEY_DATES");
  if (record.status === "revoked" && !revokedAt)
    throw new Error("DISPUTE_AUDIT_REVOKED_KEY_MISSING_DATE");
  return {
    key_id: keyId,
    algorithm: "Ed25519",
    public_key_spki_base64: canonicalDer.toString("base64"),
    status: record.status,
    not_before: notBefore,
    not_after: notAfter,
    retired_at: retiredAt,
    revoked_at: revokedAt,
  };
}

export function resolveDisputeAuditPublicKeyRegistryFromEnv(): DisputeAuditPublicKeyRecord[] {
  const entries: unknown[] = [];
  const privateKeyBase64 = process.env.DISPUTE_AUDIT_SIGNING_PRIVATE_KEY_BASE64?.trim();
  if (privateKeyBase64) {
    const privateKey = createPrivateKey({
      key: Buffer.from(privateKeyBase64, "base64"),
      format: "der",
      type: "pkcs8",
    });
    const publicKeyDer = createPublicKey(privateKey).export({ format: "der", type: "spki" });
    entries.push({
      public_key_spki_base64: publicKeyDer.toString("base64"),
      status: "active",
      not_before: process.env.DISPUTE_AUDIT_CURRENT_KEY_NOT_BEFORE ?? "1970-01-01T00:00:00.000Z",
      not_after: process.env.DISPUTE_AUDIT_CURRENT_KEY_NOT_AFTER ?? null,
    });
  }
  const configured = process.env.DISPUTE_AUDIT_TRUSTED_PUBLIC_KEYS_JSON?.trim();
  if (configured) {
    let parsed: unknown;
    try {
      parsed = JSON.parse(configured);
    } catch {
      throw new Error("INVALID_DISPUTE_AUDIT_TRUSTED_PUBLIC_KEYS_JSON");
    }
    if (!Array.isArray(parsed)) throw new Error("INVALID_DISPUTE_AUDIT_TRUSTED_PUBLIC_KEYS_JSON");
    entries.push(...parsed);
  }
  const keys = entries.map(normalizeDisputeAuditPublicKeyRecord);
  const byId = new Map<string, DisputeAuditPublicKeyRecord>();
  for (const key of keys) {
    const existing = byId.get(key.key_id);
    if (existing && canonicalDisputeAuditJson(existing) !== canonicalDisputeAuditJson(key))
      throw new Error("DISPUTE_AUDIT_KEY_REGISTRY_CONFLICT");
    byId.set(key.key_id, key);
  }
  return [...byId.values()].sort((a, b) => a.key_id.localeCompare(b.key_id));
}

export function disputeAuditPublicKeyRegistryDocument(
  keys: DisputeAuditPublicKeyRecord[],
  generatedAt = new Date(),
) {
  const records = [...keys].sort((a, b) => a.key_id.localeCompare(b.key_id));
  return {
    schema: "haggle.dispute-audit-key-registry.v1" as const,
    generated_at: generatedAt.toISOString(),
    registry_sha256: createHash("sha256").update(canonicalDisputeAuditJson(records)).digest("hex"),
    keys: records,
  };
}

export function verifyTrustedSignedDisputeAiAuditExport(
  value: SignedAudit,
  keys: DisputeAuditPublicKeyRecord[],
) {
  if (!verifySignedDisputeAiAuditExport(value))
    return { valid: false as const, reason: "INVALID_SIGNATURE_OR_MANIFEST" as const };
  const key = keys.find((candidate) => candidate.key_id === value.signature.key_id);
  if (!key) return { valid: false as const, reason: "UNTRUSTED_KEY" as const };
  if (key.public_key_spki_base64 !== value.signature.public_key_spki_base64)
    return { valid: false as const, reason: "TRUSTED_KEY_MATERIAL_MISMATCH" as const };
  if (key.algorithm !== "Ed25519")
    return { valid: false as const, reason: "INVALID_TRUSTED_KEY_ALGORITHM" as const };
  if (key.status === "revoked")
    return { valid: false as const, reason: "KEY_REVOKED" as const, key };
  const generatedAt = Date.parse(value.manifest.generated_at);
  if (!Number.isFinite(generatedAt))
    return { valid: false as const, reason: "INVALID_GENERATED_AT" as const, key };
  if (generatedAt < Date.parse(key.not_before))
    return { valid: false as const, reason: "KEY_NOT_YET_VALID" as const, key };
  if (key.not_after && generatedAt > Date.parse(key.not_after))
    return { valid: false as const, reason: "KEY_EXPIRED" as const, key };
  if (key.status === "retired" && (!key.retired_at || generatedAt > Date.parse(key.retired_at))) {
    return { valid: false as const, reason: "SIGNED_AFTER_KEY_RETIREMENT" as const, key };
  }
  return {
    valid: true as const,
    reason:
      key.status === "retired" ? ("TRUSTED_RETIRED_KEY" as const) : ("TRUSTED_ACTIVE_KEY" as const),
    key,
  };
}
