import { createHash, createPrivateKey, createPublicKey, sign, verify, type KeyObject } from "node:crypto";
import { canonicalDisputeAuditJson } from "./dispute-ai-assessment-event.service.js";
import type { HashableDisputeSimilarityExpiryEvent } from "./dispute-similarity-review-expiry.service.js";
import { hashDisputeSimilarityExpiryEvent } from "./dispute-similarity-review-expiry.service.js";

export class DisputeSimilarityReviewAuditSigningNotConfiguredError extends Error {
  constructor() {
    super("DISPUTE_AUDIT_SIGNING_PRIVATE_KEY_BASE64 is not configured");
    this.name = "DisputeSimilarityReviewAuditSigningNotConfiguredError";
  }
}

function privateKeyFromBase64(value: string | undefined): KeyObject {
  if (!value?.trim()) throw new DisputeSimilarityReviewAuditSigningNotConfiguredError();
  return createPrivateKey({ key: Buffer.from(value.trim(), "base64"), format: "der", type: "pkcs8" });
}

export function createSignedDisputeSimilarityReviewAuditExport(input: {
  event: HashableDisputeSimilarityExpiryEvent;
  storedEventHash: string;
  generatedAt: Date;
  privateKey?: KeyObject;
  privateKeyBase64?: string;
}) {
  const computedEventHash = hashDisputeSimilarityExpiryEvent(input.event);
  if (computedEventHash !== input.storedEventHash) throw new Error("SIMILARITY_REVIEW_AUDIT_INTEGRITY_INVALID");
  const manifest = {
    schema: "haggle.dispute-similarity-review-audit.v1" as const,
    event_id: input.event.event_id,
    generated_at: input.generatedAt.toISOString(),
    event_hash: computedEventHash,
    event_payload_sha256: createHash("sha256").update(canonicalDisputeAuditJson(input.event)).digest("hex"),
    integrity_valid: true as const,
  };
  const privateKey = input.privateKey
    ?? privateKeyFromBase64(input.privateKeyBase64 ?? process.env.DISPUTE_AUDIT_SIGNING_PRIVATE_KEY_BASE64);
  const publicKey = createPublicKey(privateKey);
  const publicKeyDer = publicKey.export({ format: "der", type: "spki" });
  return {
    manifest,
    event: input.event,
    signature: {
      algorithm: "Ed25519" as const,
      key_id: createHash("sha256").update(publicKeyDer).digest("hex").slice(0, 24),
      public_key_spki_base64: publicKeyDer.toString("base64"),
      value_base64: sign(null, Buffer.from(canonicalDisputeAuditJson(manifest)), privateKey).toString("base64"),
    },
  };
}

export function verifySignedDisputeSimilarityReviewAuditExport(
  value: ReturnType<typeof createSignedDisputeSimilarityReviewAuditExport>,
) {
  if (value.signature.algorithm !== "Ed25519"
    || value.manifest.integrity_valid !== true
    || value.manifest.event_id !== value.event.event_id
    || value.manifest.event_hash !== hashDisputeSimilarityExpiryEvent(value.event)
    || value.manifest.event_payload_sha256 !== createHash("sha256").update(canonicalDisputeAuditJson(value.event)).digest("hex")) return false;
  const publicKey = createPublicKey({
    key: Buffer.from(value.signature.public_key_spki_base64, "base64"), format: "der", type: "spki",
  });
  const publicKeyDer = publicKey.export({ format: "der", type: "spki" });
  if (createHash("sha256").update(publicKeyDer).digest("hex").slice(0, 24) !== value.signature.key_id) return false;
  return verify(null, Buffer.from(canonicalDisputeAuditJson(value.manifest)), publicKey, Buffer.from(value.signature.value_base64, "base64"));
}
