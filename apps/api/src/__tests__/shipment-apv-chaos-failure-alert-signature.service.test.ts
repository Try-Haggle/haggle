import { generateKeyPairSync } from "node:crypto";
import { describe, expect, it, vi } from "vitest";
import type { Database } from "@haggle/db";
import { PgDialect } from "drizzle-orm/pg-core";
import {
  createShipmentApvFailureAlertPayloadSignature,
  createShipmentApvFailureAlertTestSigner,
  verifyShipmentApvFailureAlertPayloadSignature,
} from "../services/shipment-apv-chaos-failure-alert-signature.service.js";

vi.unmock("@haggle/db");

const now = new Date("2026-07-13T12:30:00.000Z");
const checker = "66666666-6666-4666-8666-666666666666";
const outboxId = "33333333-3333-4333-8333-333333333333";
const clientSignatureId = "11111111-1111-4111-8111-111111111111";
const signatureId = "55555555-5555-4555-8555-555555555555";
const fingerprint = "39bd711222a81681011ab563de9792d57d1fe98f509c2675b6285be528ab0b8b";
const payloadSha256 = "c".repeat(64);
const signingDomain = "haggle.shipment-apv-failure-alert.payload-sha256.v1";
const { privateKey } = generateKeyPairSync("ed25519");
const signer = createShipmentApvFailureAlertTestSigner(privateKey);
const signatureBase64 = signer.signMessage(
  Buffer.from(`${signingDomain}:${payloadSha256}`, "utf8"));

const warningHealthRows = [{
  stage: "rollback_verification", failure_count: "1",
  first_failure_at: "2026-07-13T10:00:00.000Z",
  warning_observed_at: "2026-07-13T10:00:00.000Z",
  critical_observed_at: null,
  last_failure_at: "2026-07-13T10:05:00.000Z",
  retained_first_failure_at: "2026-07-13T10:00:00.000Z",
  retained_warning_observed_at: "2026-07-13T10:00:00.000Z",
  retained_critical_observed_at: null,
  retained_latest_bucket_start: "2026-07-13T10:00:00.000Z",
  retained_last_failure_at: "2026-07-13T10:05:00.000Z",
}];

function bindingRow(overrides: Record<string, unknown> = {}) {
  return {
    outbox_id: outboxId,
    payload_sha256: payloadSha256,
    state_fingerprint: fingerprint,
    created_by: checker,
    cooldown_expires_at: "2026-07-13T12:45:00.000Z",
    signature_id: null,
    client_signature_id: null,
    signing_domain: null,
    algorithm: null,
    key_id: null,
    public_key_spki_base64: null,
    signature_base64: null,
    signature_status: null,
    signed_by: null,
    signed_at: null,
    ...overrides,
  };
}

function signatureRow(overrides: Record<string, unknown> = {}) {
  return {
    id: signatureId,
    client_signature_id: clientSignatureId,
    payload_outbox_id: outboxId,
    payload_sha256: payloadSha256,
    signing_domain: signingDomain,
    algorithm: "Ed25519",
    key_id: signer.keyId,
    public_key_spki_base64: signer.publicKeySpkiBase64,
    signature_base64: signatureBase64,
    status: "SIGNED_DRY_RUN",
    signed_by: checker,
    signed_at: now.toISOString(),
    inserted: true,
    ...overrides,
  };
}

const input = { payloadOutboxId: outboxId, clientSignatureId,
  signedBy: checker, signer, now };
const activeRegistryRow = { key_id: signer.keyId,
  public_key_spki_base64: signer.publicKeySpkiBase64, event_type: "REGISTERED" };

describe("shipment APV failure alert payload signatures", () => {
  it("appends a publicly verifiable Ed25519 dry-run receipt", async () => {
    const execute = vi.fn().mockResolvedValueOnce([])
      .mockResolvedValueOnce([bindingRow()])
      .mockResolvedValueOnce([activeRegistryRow])
      .mockResolvedValueOnce(warningHealthRows)
      .mockResolvedValueOnce([signatureRow()]);
    const result = await createShipmentApvFailureAlertPayloadSignature(
      { execute } as unknown as Pick<Database, "execute">, input);
    expect(result).toMatchObject({ status: "SIGNED_DRY_RUN", algorithm: "Ed25519",
      signatureVerified: true, privateKeyExposed: false, replayed: false,
      keyManagement: "EPHEMERAL_PROCESS_TEST_KEY", trustAnchored: false,
      registryBound: true, registryStatusAtSigning: "ACTIVE",
      independentTrustAnchor: false,
      delivery: { enabled: false, attempted: false } });
    expect(result).not.toHaveProperty("privateKey");
    expect(execute).toHaveBeenCalledTimes(5);
    const statement = new PgDialect().sqlToQuery(execute.mock.calls[4]![0]);
    expect(statement.sql.toLowerCase()).toContain(
      "insert into shipment_apv_failure_alert_payload_signatures");
  });

  it("returns an exact verified replay before live binding checks", async () => {
    const execute = vi.fn().mockResolvedValueOnce([signatureRow({ inserted: false })]);
    const result = await createShipmentApvFailureAlertPayloadSignature(
      { execute } as unknown as Pick<Database, "execute">, input);
    expect(result).toMatchObject({ replayed: true, signatureVerified: true });
    expect(execute).toHaveBeenCalledOnce();
  });

  it("requires the unsigned outbox creator and an active cooldown", async () => {
    const actorExecute = vi.fn().mockResolvedValueOnce([])
      .mockResolvedValueOnce([bindingRow()]);
    await expect(createShipmentApvFailureAlertPayloadSignature(
      { execute: actorExecute } as unknown as Pick<Database, "execute">,
      { ...input, signedBy: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa" }))
      .rejects.toThrow("SHIPMENT_APV_FAILURE_ALERT_SIGNATURE_ACTOR_MISMATCH");

    const expiredExecute = vi.fn().mockResolvedValueOnce([]).mockResolvedValueOnce([
      bindingRow({ cooldown_expires_at: "2026-07-13T12:29:59.999Z" }),
    ]);
    await expect(createShipmentApvFailureAlertPayloadSignature(
      { execute: expiredExecute } as unknown as Pick<Database, "execute">, input))
      .rejects.toThrow("SHIPMENT_APV_FAILURE_ALERT_COOLDOWN_EXPIRED");
  });

  it("rejects a changed current state before signing", async () => {
    const execute = vi.fn().mockResolvedValueOnce([])
      .mockResolvedValueOnce([bindingRow()])
      .mockResolvedValueOnce([activeRegistryRow]).mockResolvedValueOnce([]);
    await expect(createShipmentApvFailureAlertPayloadSignature(
      { execute } as unknown as Pick<Database, "execute">, input))
      .rejects.toThrow("SHIPMENT_APV_FAILURE_ALERT_STATE_CHANGED");
    expect(execute).toHaveBeenCalledTimes(4);
  });

  it("requires an active matching test registry key before signing", async () => {
    const missing = vi.fn().mockResolvedValueOnce([])
      .mockResolvedValueOnce([bindingRow()]).mockResolvedValueOnce([]);
    await expect(createShipmentApvFailureAlertPayloadSignature(
      { execute: missing } as unknown as Pick<Database, "execute">, input))
      .rejects.toThrow("SHIPMENT_APV_FAILURE_ALERT_SIGNING_KEY_NOT_ACTIVE");

    const revoked = vi.fn().mockResolvedValueOnce([])
      .mockResolvedValueOnce([bindingRow()]).mockResolvedValueOnce([{
        ...activeRegistryRow, event_type: "REVOKED",
      }]);
    await expect(createShipmentApvFailureAlertPayloadSignature(
      { execute: revoked } as unknown as Pick<Database, "execute">, input))
      .rejects.toThrow("SHIPMENT_APV_FAILURE_ALERT_SIGNING_KEY_NOT_ACTIVE");
  });

  it("rejects a second client id for an already signed payload", async () => {
    const execute = vi.fn().mockResolvedValueOnce([]).mockResolvedValueOnce([
      bindingRow({ signature_id: signatureId,
        client_signature_id: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
        signing_domain: signingDomain, algorithm: "Ed25519", key_id: signer.keyId,
        public_key_spki_base64: signer.publicKeySpkiBase64,
        signature_base64: signatureBase64, signature_status: "SIGNED_DRY_RUN",
        signed_by: checker, signed_at: now.toISOString() }),
    ]);
    await expect(createShipmentApvFailureAlertPayloadSignature(
      { execute } as unknown as Pick<Database, "execute">, input))
      .rejects.toThrow("SHIPMENT_APV_FAILURE_ALERT_PAYLOAD_ALREADY_SIGNED");
  });

  it("fails closed for client id rebinding and corrupt persisted signatures", async () => {
    const rebound = vi.fn().mockResolvedValueOnce([signatureRow({
      signed_by: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa", inserted: false,
    })]);
    await expect(createShipmentApvFailureAlertPayloadSignature(
      { execute: rebound } as unknown as Pick<Database, "execute">, input))
      .rejects.toThrow("SHIPMENT_APV_FAILURE_ALERT_SIGNATURE_REPLAY_CONFLICT");

    const corrupt = vi.fn().mockResolvedValueOnce([signatureRow({
      signature_base64: Buffer.alloc(64).toString("base64"), inserted: false,
    })]);
    await expect(createShipmentApvFailureAlertPayloadSignature(
      { execute: corrupt } as unknown as Pick<Database, "execute">, input))
      .rejects.toThrow("SHIPMENT_APV_FAILURE_ALERT_SIGNATURE_INTEGRITY_FAILED");
  });

  it("rejects a signer whose signature does not match its public key", async () => {
    const execute = vi.fn().mockResolvedValueOnce([])
      .mockResolvedValueOnce([bindingRow()])
      .mockResolvedValueOnce([activeRegistryRow]).mockResolvedValueOnce(warningHealthRows);
    await expect(createShipmentApvFailureAlertPayloadSignature(
      { execute } as unknown as Pick<Database, "execute">,
      { ...input, signer: { ...signer,
        signMessage: () => Buffer.alloc(64).toString("base64") } }))
      .rejects.toThrow("SHIPMENT_APV_FAILURE_ALERT_SIGNER_VERIFICATION_FAILED");
    expect(execute).toHaveBeenCalledTimes(4);
  });

  it("public verification detects payload hash and signature tampering", () => {
    const receipt = { payloadSha256, signingDomain, algorithm: "Ed25519",
      keyId: signer.keyId, publicKeySpkiBase64: signer.publicKeySpkiBase64,
      signatureBase64 };
    expect(verifyShipmentApvFailureAlertPayloadSignature(receipt)).toBe(true);
    expect(verifyShipmentApvFailureAlertPayloadSignature({
      ...receipt, payloadSha256: "d".repeat(64) })).toBe(false);
    expect(verifyShipmentApvFailureAlertPayloadSignature({
      ...receipt, signatureBase64: Buffer.alloc(64).toString("base64") })).toBe(false);
  });
});
