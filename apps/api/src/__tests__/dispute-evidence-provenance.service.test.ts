import { generateKeyPairSync } from "node:crypto";
import { describe, expect, it } from "vitest";
import type { DisputeEvidenceDerivedArtifact } from "@haggle/dispute-core";
import { normalizeDisputeAuditPublicKeyRecord } from "../services/dispute-audit-public-key-registry.service.js";
import {
  createSignedDisputeEvidenceProvenance,
  verifyTrustedDisputeEvidenceProvenance,
} from "../services/dispute-evidence-provenance.service.js";

const disputeId = "11111111-1111-4111-8111-111111111111";
const evidenceId = "22222222-2222-4222-8222-222222222222";
const sourceContentSha256 = "a".repeat(64);
const generatedAt = new Date("2026-07-12T12:00:00.000Z");

function fixture() {
  const { privateKey } = generateKeyPairSync("ed25519");
  const artifacts: DisputeEvidenceDerivedArtifact[] = [{
    id: `${evidenceId}:visual:1`,
    kind: "image_visual_observation",
    source_evidence_id: evidenceId,
    text: "렌즈 오른쪽 가장자리에 균열이 보입니다.",
    metadata: { category: "visible_damage", confidence: 0.91, provider: "test-vision" },
    created_at: generatedAt.toISOString(),
  }];
  const provenance = createSignedDisputeEvidenceProvenance({
    disputeId, evidenceId, sourceContentSha256, verifierProvider: "test-vision",
    artifacts, generatedAt, privateKey,
  });
  const activeKey = normalizeDisputeAuditPublicKeyRecord({
    public_key_spki_base64: provenance.signature.public_key_spki_base64,
    status: "active",
    not_before: "2026-07-12T11:00:00.000Z",
  });
  return { artifacts, provenance, activeKey };
}

describe("dispute evidence derived-artifact provenance", () => {
  it("accepts an artifact manifest signed by a trusted active key", () => {
    const value = fixture();
    expect(verifyTrustedDisputeEvidenceProvenance({
      provenance: value.provenance, artifacts: value.artifacts, disputeId, evidenceId,
      sourceContentSha256, keys: [value.activeKey],
    })).toMatchObject({ valid: true, reason: "TRUSTED_ACTIVE_KEY", keyId: value.activeKey.key_id });
  });

  it("rejects artifact text mutation and source-content substitution", () => {
    const value = fixture();
    const tampered = structuredClone(value.artifacts);
    tampered[0]!.text = "판매자가 모든 책임을 인정했습니다.";
    expect(verifyTrustedDisputeEvidenceProvenance({
      provenance: value.provenance, artifacts: tampered, disputeId, evidenceId,
      sourceContentSha256, keys: [value.activeKey],
    })).toMatchObject({ valid: false, reason: "PROVENANCE_MANIFEST_MISMATCH" });
    expect(verifyTrustedDisputeEvidenceProvenance({
      provenance: value.provenance, artifacts: value.artifacts, disputeId, evidenceId,
      sourceContentSha256: "b".repeat(64), keys: [value.activeKey],
    })).toMatchObject({ valid: false, reason: "PROVENANCE_MANIFEST_MISMATCH" });
  });

  it("rejects an otherwise valid signature when its key is revoked", () => {
    const value = fixture();
    const revokedKey = normalizeDisputeAuditPublicKeyRecord({
      public_key_spki_base64: value.provenance.signature.public_key_spki_base64,
      status: "revoked",
      not_before: "2026-07-12T11:00:00.000Z",
      revoked_at: "2026-07-12T13:00:00.000Z",
    });
    expect(verifyTrustedDisputeEvidenceProvenance({
      provenance: value.provenance, artifacts: value.artifacts, disputeId, evidenceId,
      sourceContentSha256, keys: [revokedKey],
    })).toMatchObject({ valid: false, reason: "PROVENANCE_KEY_REVOKED" });
  });

  it("refuses to sign a visual observation attributed to another verifier", () => {
    const { privateKey } = generateKeyPairSync("ed25519");
    const artifacts = fixture().artifacts.map((artifact) => ({
      ...artifact,
      metadata: { ...artifact.metadata, provider: "unbound-provider" },
    }));
    expect(() => createSignedDisputeEvidenceProvenance({
      disputeId, evidenceId, sourceContentSha256, verifierProvider: "test-vision",
      artifacts, generatedAt, privateKey,
    })).toThrow("EVIDENCE_DERIVED_ARTIFACT_PROVIDER_MISMATCH");
  });
});
