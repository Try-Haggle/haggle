import { createHash, createPrivateKey, createPublicKey, sign, verify, type KeyObject } from "node:crypto";
import type { DisputeEvidenceDerivedArtifact } from "@haggle/dispute-core";
import { canonicalDisputeAuditJson } from "./dispute-ai-assessment-event.service.js";
import { DisputeAuditSigningNotConfiguredError } from "./dispute-ai-audit-export.service.js";
import { disputeAuditKeyId, type DisputeAuditPublicKeyRecord } from "./dispute-audit-public-key-registry.service.js";

export interface DisputeEvidenceProvenanceManifest {
  schema: "haggle.dispute-evidence-derived-artifacts.v1";
  dispute_id: string;
  evidence_id: string;
  source_content_sha256: string;
  verifier_provider: string;
  generated_at: string;
  artifact_count: number;
  artifacts_sha256: string;
}

function privateKeyFromEnv(value?: string): KeyObject {
  const encoded = value ?? process.env.DISPUTE_AUDIT_SIGNING_PRIVATE_KEY_BASE64;
  if (!encoded?.trim()) throw new DisputeAuditSigningNotConfiguredError();
  return createPrivateKey({ key: Buffer.from(encoded.trim(), "base64"), format: "der", type: "pkcs8" });
}

export function createSignedDisputeEvidenceProvenance(input: {
  disputeId: string; evidenceId: string; sourceContentSha256: string; verifierProvider: string;
  artifacts: DisputeEvidenceDerivedArtifact[]; generatedAt: Date; privateKey?: KeyObject; privateKeyBase64?: string;
}) {
  if (!/^[0-9a-f]{64}$/.test(input.sourceContentSha256)) throw new Error("INVALID_EVIDENCE_SOURCE_CONTENT_SHA256");
  if (!input.artifacts.length || input.artifacts.length > 20) throw new Error("INVALID_EVIDENCE_DERIVED_ARTIFACT_COUNT");
  if (input.artifacts.some((artifact) => artifact.source_evidence_id !== input.evidenceId)) {
    throw new Error("EVIDENCE_DERIVED_ARTIFACT_SOURCE_MISMATCH");
  }
  if (!input.verifierProvider.trim() || input.artifacts.some((artifact) => (
    artifact.kind === "image_visual_observation"
    && artifact.metadata?.provider !== input.verifierProvider
  ))) {
    throw new Error("EVIDENCE_DERIVED_ARTIFACT_PROVIDER_MISMATCH");
  }
  const artifactsSha256 = createHash("sha256")
    .update(canonicalDisputeAuditJson(input.artifacts)).digest("hex");
  const manifest: DisputeEvidenceProvenanceManifest = {
    schema: "haggle.dispute-evidence-derived-artifacts.v1",
    dispute_id: input.disputeId,
    evidence_id: input.evidenceId,
    source_content_sha256: input.sourceContentSha256,
    verifier_provider: input.verifierProvider.slice(0, 120),
    generated_at: input.generatedAt.toISOString(),
    artifact_count: input.artifacts.length,
    artifacts_sha256: artifactsSha256,
  };
  const privateKey = input.privateKey ?? privateKeyFromEnv(input.privateKeyBase64);
  const publicKey = createPublicKey(privateKey);
  const publicKeyDer = publicKey.export({ format: "der", type: "spki" });
  return { manifest, signature: { algorithm: "Ed25519" as const,
    key_id: disputeAuditKeyId(publicKeyDer), public_key_spki_base64: publicKeyDer.toString("base64"),
    value_base64: sign(null, Buffer.from(canonicalDisputeAuditJson(manifest)), privateKey).toString("base64") } };
}

export function verifyTrustedDisputeEvidenceProvenance(input: {
  provenance: unknown; artifacts: DisputeEvidenceDerivedArtifact[]; disputeId: string; evidenceId: string;
  sourceContentSha256: string | null; keys: DisputeAuditPublicKeyRecord[];
}) {
  try {
    if (!input.provenance || typeof input.provenance !== "object" || Array.isArray(input.provenance)) throw new Error("INVALID_PROVENANCE");
    const value = input.provenance as Record<string, unknown>;
    const manifest = value.manifest as DisputeEvidenceProvenanceManifest | undefined;
    const signature = value.signature as Record<string, unknown> | undefined;
    if (manifest?.schema !== "haggle.dispute-evidence-derived-artifacts.v1"
      || manifest.dispute_id !== input.disputeId || manifest.evidence_id !== input.evidenceId
      || manifest.source_content_sha256 !== input.sourceContentSha256
      || typeof manifest.verifier_provider !== "string" || !manifest.verifier_provider
      || manifest.verifier_provider.length > 120
      || manifest.artifact_count !== input.artifacts.length
      || input.artifacts.some((artifact) => artifact.source_evidence_id !== input.evidenceId
      || (artifact.kind === "image_visual_observation" && artifact.metadata?.provider !== manifest.verifier_provider))
      || createHash("sha256").update(canonicalDisputeAuditJson(input.artifacts)).digest("hex") !== manifest.artifacts_sha256
      || signature?.algorithm !== "Ed25519" || typeof signature.key_id !== "string"
      || typeof signature.public_key_spki_base64 !== "string" || typeof signature.value_base64 !== "string") {
      return { valid: false as const, reason: "PROVENANCE_MANIFEST_MISMATCH" as const };
    }
    const publicKeyDer = Buffer.from(signature.public_key_spki_base64, "base64");
    if (disputeAuditKeyId(publicKeyDer) !== signature.key_id) return { valid: false as const, reason: "PROVENANCE_KEY_ID_MISMATCH" as const };
    const publicKey = createPublicKey({ key: publicKeyDer, format: "der", type: "spki" });
    if (publicKey.asymmetricKeyType !== "ed25519" || !verify(null, Buffer.from(canonicalDisputeAuditJson(manifest)),
      publicKey, Buffer.from(signature.value_base64, "base64"))) {
      return { valid: false as const, reason: "PROVENANCE_SIGNATURE_INVALID" as const };
    }
    const key = input.keys.find((candidate) => candidate.key_id === signature.key_id);
    if (!key || key.public_key_spki_base64 !== signature.public_key_spki_base64) {
      return { valid: false as const, reason: "PROVENANCE_KEY_UNTRUSTED" as const };
    }
    if (key.status === "revoked") return { valid: false as const, reason: "PROVENANCE_KEY_REVOKED" as const };
    const generatedAt = Date.parse(manifest.generated_at);
    if (!Number.isFinite(generatedAt) || generatedAt < Date.parse(key.not_before)
      || (key.not_after && generatedAt > Date.parse(key.not_after))
      || (key.status === "retired" && (!key.retired_at || generatedAt > Date.parse(key.retired_at)))) {
      return { valid: false as const, reason: "PROVENANCE_KEY_OUTSIDE_VALID_WINDOW" as const };
    }
    return { valid: true as const, reason: key.status === "retired" ? "TRUSTED_RETIRED_KEY" as const : "TRUSTED_ACTIVE_KEY" as const,
      keyId: key.key_id, artifactsSha256: manifest.artifacts_sha256 };
  } catch { return { valid: false as const, reason: "PROVENANCE_INVALID" as const }; }
}
