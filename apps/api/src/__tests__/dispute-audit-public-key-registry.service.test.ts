import { generateKeyPairSync } from "node:crypto";
import { afterEach, describe, expect, it } from "vitest";
import { createSignedDisputeAiAuditExport } from "../services/dispute-ai-audit-export.service.js";
import {
  disputeAuditPublicKeyRegistryDocument,
  normalizeDisputeAuditPublicKeyRecord,
  resolveDisputeAuditPublicKeyRegistryFromEnv,
  verifyTrustedSignedDisputeAiAuditExport,
} from "../services/dispute-audit-public-key-registry.service.js";

const generatedAt = new Date("2026-07-12T12:00:00.000Z");
function fixture() {
  const { privateKey } = generateKeyPairSync("ed25519");
  const signed = createSignedDisputeAiAuditExport({
    disputeId: "11111111-1111-4111-8111-111111111111",
    generatedAt,
    privateKey,
    events: [],
    chain: {
      valid: true,
      complete: true,
      headEventHash: null,
      sealedEvents: 0,
      legacyUnsealedEvents: 0,
    },
  });
  return { privateKey, signed, publicKey: signed.signature.public_key_spki_base64 };
}
describe("dispute audit public key registry", () => {
  afterEach(() => {
    delete process.env.DISPUTE_AUDIT_SIGNING_PRIVATE_KEY_BASE64;
    delete process.env.DISPUTE_AUDIT_CURRENT_KEY_NOT_BEFORE;
    delete process.env.DISPUTE_AUDIT_CURRENT_KEY_NOT_AFTER;
    delete process.env.DISPUTE_AUDIT_TRUSTED_PUBLIC_KEYS_JSON;
  });

  it("normalizes Ed25519 material and rejects a mismatched key id", () => {
    const { publicKey } = fixture();
    expect(
      normalizeDisputeAuditPublicKeyRecord({ public_key_spki_base64: publicKey, status: "active" })
        .key_id,
    ).toMatch(/^[a-f0-9]{24}$/);
    expect(() =>
      normalizeDisputeAuditPublicKeyRecord({
        key_id: "0".repeat(24),
        public_key_spki_base64: publicKey,
        status: "active",
      }),
    ).toThrow("DISPUTE_AUDIT_KEY_ID_MISMATCH");
    expect(() =>
      normalizeDisputeAuditPublicKeyRecord({
        public_key_spki_base64: publicKey,
        status: "active",
        retired_at: "2026-07-12T13:00:00.000Z",
      }),
    ).toThrow("INVALID_DISPUTE_AUDIT_ACTIVE_KEY_DATES");
  });

  it("trusts active and historically valid retired keys", () => {
    const { signed, publicKey } = fixture();
    const active = normalizeDisputeAuditPublicKeyRecord({
      public_key_spki_base64: publicKey,
      status: "active",
      not_before: "2026-07-12T11:00:00.000Z",
    });
    const retired = normalizeDisputeAuditPublicKeyRecord({
      public_key_spki_base64: publicKey,
      status: "retired",
      not_before: "2026-07-12T11:00:00.000Z",
      retired_at: "2026-07-12T13:00:00.000Z",
    });
    expect(verifyTrustedSignedDisputeAiAuditExport(signed, [active])).toMatchObject({
      valid: true,
      reason: "TRUSTED_ACTIVE_KEY",
    });
    expect(verifyTrustedSignedDisputeAiAuditExport(signed, [retired])).toMatchObject({
      valid: true,
      reason: "TRUSTED_RETIRED_KEY",
    });
  });

  it("rejects revoked, unknown, not-yet-valid and post-retirement signatures", () => {
    const { signed, publicKey } = fixture();
    const record = (
      status: "active" | "retired" | "revoked",
      extra: Record<string, unknown> = {},
    ) =>
      normalizeDisputeAuditPublicKeyRecord({ public_key_spki_base64: publicKey, status, ...extra });
    expect(
      verifyTrustedSignedDisputeAiAuditExport(signed, [
        record("revoked", { revoked_at: "2026-07-12T13:00:00.000Z" }),
      ]),
    ).toMatchObject({ valid: false, reason: "KEY_REVOKED" });
    expect(verifyTrustedSignedDisputeAiAuditExport(signed, [])).toEqual({
      valid: false,
      reason: "UNTRUSTED_KEY",
    });
    expect(
      verifyTrustedSignedDisputeAiAuditExport(signed, [
        record("active", { not_before: "2026-07-12T13:00:00.000Z" }),
      ]),
    ).toMatchObject({ valid: false, reason: "KEY_NOT_YET_VALID" });
    expect(
      verifyTrustedSignedDisputeAiAuditExport(signed, [
        record("retired", { retired_at: "2026-07-12T11:00:00.000Z" }),
      ]),
    ).toMatchObject({ valid: false, reason: "SIGNED_AFTER_KEY_RETIREMENT" });
  });

  it("derives the active public key from the private environment key", () => {
    const { privateKey, signed } = fixture();
    process.env.DISPUTE_AUDIT_SIGNING_PRIVATE_KEY_BASE64 = privateKey
      .export({ format: "der", type: "pkcs8" })
      .toString("base64");
    const keys = resolveDisputeAuditPublicKeyRegistryFromEnv();
    expect(keys).toHaveLength(1);
    expect(keys[0]).toMatchObject({ key_id: signed.signature.key_id, status: "active" });
    expect(JSON.stringify(keys)).not.toContain("PRIVATE");
  });

  it("rejects conflicting duplicate registry records", () => {
    const { privateKey, publicKey } = fixture();
    process.env.DISPUTE_AUDIT_SIGNING_PRIVATE_KEY_BASE64 = privateKey
      .export({ format: "der", type: "pkcs8" })
      .toString("base64");
    process.env.DISPUTE_AUDIT_TRUSTED_PUBLIC_KEYS_JSON = JSON.stringify([
      {
        public_key_spki_base64: publicKey,
        status: "revoked",
        revoked_at: "2026-07-12T13:00:00.000Z",
      },
    ]);
    expect(() => resolveDisputeAuditPublicKeyRegistryFromEnv()).toThrow(
      "DISPUTE_AUDIT_KEY_REGISTRY_CONFLICT",
    );
  });

  it("publishes a deterministic digest over sorted public records", () => {
    const { publicKey } = fixture();
    const key = normalizeDisputeAuditPublicKeyRecord({
      public_key_spki_base64: publicKey,
      status: "active",
    });
    const document = disputeAuditPublicKeyRegistryDocument([key], generatedAt);
    expect(document).toMatchObject({
      schema: "haggle.dispute-audit-key-registry.v1",
      keys: [{ key_id: key.key_id }],
    });
    expect(document.registry_sha256).toMatch(/^[a-f0-9]{64}$/);
  });
});
