import { createHash, generateKeyPairSync } from "node:crypto";
import { describe, expect, it, vi } from "vitest";
import type { Database } from "@haggle/db";
import { PgDialect } from "drizzle-orm/pg-core";
import { createShipmentApvFailureAlertTestSigner } from
  "../services/shipment-apv-chaos-failure-alert-signature.service.js";
import {
  createShipmentApvReceiverManifestArchiveAlertPayloadSignature,
  SHIPMENT_APV_RECEIVER_MANIFEST_ARCHIVE_ALERT_SIGNING_DOMAIN,
  verifyShipmentApvReceiverManifestArchiveAlertPayloadSignature,
} from
  "../services/shipment-apv-chaos-failure-alert-receiver-manifest-archive-alert-signature.service.js";
import { evaluateShipmentApvFailureAlertReceiverManifestArchiveAlertPreview } from
  "../services/shipment-apv-chaos-failure-alert-receiver-manifest-archive-alert-preview.service.js";

vi.unmock("@haggle/db");

const now = new Date("2026-07-14T00:07:00.000Z");
const maker = "55555555-5555-4555-8555-555555555555";
const checker = "66666666-6666-4666-8666-666666666666";
const grantId = "88888888-8888-4888-8888-888888888888";
const outboxId = "22222222-2222-4222-8222-222222222222";
const signatureId = "33333333-3333-4333-8333-333333333333";
const clientSignatureId = "11111111-1111-4111-8111-111111111111";
const previewSchema =
  "shipment-apv-failure-alert-receiver-manifest-archive-alert-preview-v1";
const fingerprint = evaluateShipmentApvFailureAlertReceiverManifestArchiveAlertPreview({
  schemaVersion: "shipment-apv-failure-alert-receiver-manifest-archive-health-v1",
  status: "warning", totals: { intents: 0, latestReceiptRevision: null,
    latestIntentRevision: null, currentSourceEntries: 0 },
  violations: { binding: 0, blockers: 0, unsafeSideEffect: 0,
    timestamp: 0, sourceLimit: 0 }, criticalCount: 0,
  coverage: { currentReceiptIntentCovered: false,
    missingCurrentArchiveIntent: true },
  freshness: { slaSeconds: 86400, latestIntentAgeSeconds: null, stale: false },
  containsRawIdentifiers: false, httpRequestCreated: false,
  networkDelivered: false, externalReceiptVerified: false,
  productionAccepted: false, observedAt: now.toISOString(),
}).stateFingerprint;
const payload = {
  schema_version:
    "shipment-apv-failure-alert-receiver-manifest-archive-alert-payload-v1" as const,
  event_type:
    "shipment_apv_failure_alert_receiver_manifest_archive_alert" as const,
  action: "review_warning", severity: "warning",
  reasons: ["current_archive_intent_missing"],
  state_fingerprint: fingerprint,
};
const canonical = JSON.stringify({ action: payload.action,
  event_type: payload.event_type, reasons: payload.reasons,
  schema_version: payload.schema_version, severity: payload.severity,
  state_fingerprint: payload.state_fingerprint });
const payloadSha256 = createHash("sha256").update(canonical).digest("hex");
const signer = createShipmentApvFailureAlertTestSigner(
  generateKeyPairSync("ed25519").privateKey);
const signatureBase64 = signer.signMessage(Buffer.from(
  `${SHIPMENT_APV_RECEIVER_MANIFEST_ARCHIVE_ALERT_SIGNING_DOMAIN}:${payloadSha256}`,
  "utf8"));

function healthRow(overrides: Record<string, unknown> = {}) {
  return { intent_count: 0, latest_receipt_revision: null,
    latest_intent_revision: null, current_source_entry_count: 0,
    binding_violation_count: 0, blocker_violation_count: 0,
    unsafe_side_effect_count: 0, timestamp_violation_count: 0,
    source_limit_violation_count: 0, current_receipt_intent_covered: false,
    latest_intent_age_seconds: null, observed_at: now.toISOString(), ...overrides };
}

function bindingRow(overrides: Record<string, unknown> = {}) {
  return {
    signature_id: null, client_signature_id: null,
    signature_payload_outbox_id: null, signature_payload_sha256: null,
    signing_domain: null, algorithm: null, key_id: null,
    public_key_spki_base64: null, signature_base64: null,
    signature_status: null, signed_by: null, signed_at: null,
    registry_public_key: null, registry_event_type: null,
    registry_event_created_at: null,
    outbox_id: outboxId, outbox_delivery_grant_id: grantId,
    state_fingerprint: fingerprint, payload, canonical_payload: canonical,
    payload_sha256: payloadSha256, outbox_status: "UNSIGNED_DRY_RUN",
    created_by: checker, outbox_created_at: "2026-07-14T00:06:00.000Z",
    grant_id: grantId, grant_status: "GRANTED_DRY_RUN", granted_by: checker,
    granted_at: "2026-07-14T00:05:00.000Z",
    cooldown_expires_at: "2026-07-14T00:20:00.000Z",
    current_cooldown_grant_id: grantId,
    current_cooldown_claimed_at: "2026-07-14T00:05:00.000Z",
    current_cooldown_expires_at: "2026-07-14T00:20:00.000Z",
    decision: "APPROVED", decision_reason: "checker_approved_snapshot",
    decided_by: checker, decided_at: "2026-07-14T00:04:00.000Z",
    requested_by: maker, request_created_at: "2026-07-14T00:00:00.000Z",
    request_expires_at: "2026-07-14T00:15:00.000Z",
    preview_schema_version: previewSchema, preview_action: "review_warning",
    preview_severity: "warning", preview_reasons: ["current_archive_intent_missing"],
    ...overrides,
  };
}

function signatureRow(overrides: Record<string, unknown> = {}) {
  return bindingRow({ signature_id: signatureId,
    client_signature_id: clientSignatureId,
    signature_payload_outbox_id: outboxId,
    signature_payload_sha256: payloadSha256,
    signing_domain: SHIPMENT_APV_RECEIVER_MANIFEST_ARCHIVE_ALERT_SIGNING_DOMAIN,
    algorithm: "Ed25519", key_id: signer.keyId,
    public_key_spki_base64: signer.publicKeySpkiBase64,
    signature_base64: signatureBase64, signature_status: "SIGNED_DRY_RUN",
    signed_by: checker, signed_at: now.toISOString(),
    registry_public_key: signer.publicKeySpkiBase64,
    registry_event_type: "REGISTERED",
    registry_event_created_at: "2026-07-14T00:01:00.000Z",
    current_cooldown_grant_id: null, current_cooldown_claimed_at: null,
    current_cooldown_expires_at: null, ...overrides });
}

const activeRegistry = { key_id: signer.keyId,
  public_key_spki_base64: signer.publicKeySpkiBase64,
  registered_at: "2026-07-14T00:01:00.000Z", event_type: "REGISTERED",
  event_created_at: "2026-07-14T00:01:00.000Z" };

function database(results: unknown[][]) {
  const execute = vi.fn();
  for (const result of results) execute.mockResolvedValueOnce(result);
  const transaction = vi.fn(async (callback) => callback({ execute }));
  return { db: { transaction } as unknown as Pick<Database, "transaction">,
    execute, transaction };
}

const input = { payloadOutboxId: outboxId, clientSignatureId,
  signedBy: checker, signer, now };

describe("receiver manifest archive alert payload signature", () => {
  it("appends a publicly verifiable domain-separated dry-run signature", async () => {
    const fixture = database([
      [], [], [bindingRow()], [activeRegistry], [healthRow()],
      [{ id: signatureId }], [signatureRow()],
    ]);
    const result =
      await createShipmentApvReceiverManifestArchiveAlertPayloadSignature(
        fixture.db, input);
    expect(result).toMatchObject({
      schemaVersion:
        "shipment-apv-failure-alert-receiver-manifest-archive-alert-payload-signature-v1",
      signatureId, clientSignatureId, payloadOutboxId: outboxId,
      payloadSha256, status: "SIGNED_DRY_RUN", signatureVerified: true,
      persistent: true, appendOnly: true,
      keyManagement: "EPHEMERAL_PROCESS_TEST_KEY",
      registry: "DATABASE_TEST_REGISTRY", registryBound: true,
      registryStatusAtSigning: "ACTIVE", independentTrustAnchor: false,
      trustAnchored: false, signedByIdentityReturned: false,
      signedMessageContainsArchiveIdentifiers: false, privateKeyExposed: false,
      delivery: { enabled: false, attempted: false },
      externalReceiptVerified: false, productionAccepted: false,
    });
    expect(result).not.toHaveProperty("signedBy");
    expect(verifyShipmentApvReceiverManifestArchiveAlertPayloadSignature(result))
      .toBe(true);
    const lock = new PgDialect().sqlToQuery(fixture.execute.mock.calls[0]![0]).sql;
    expect(lock).toContain("receiver-manifest-archive-signature.v1");
    const insert = new PgDialect().sqlToQuery(fixture.execute.mock.calls[5]![0]);
    expect(insert.sql).toContain(
      "shipment_apv_manifest_archive_alert_payload_signatures");
  });

  it("returns exact historical replay without current cooldown or key reads", async () => {
    const fixture = database([[], [signatureRow()]]);
    await expect(createShipmentApvReceiverManifestArchiveAlertPayloadSignature(
      fixture.db, input)).resolves.toMatchObject({ replayed: true, signatureId });
    expect(fixture.execute).toHaveBeenCalledTimes(2);
    const replay = new PgDialect().sqlToQuery(fixture.execute.mock.calls[1]![0]).sql;
    expect(replay).not.toContain(
      "join shipment_apv_manifest_archive_alert_cooldown_claims");
    expect(replay).toContain("event.created_at <= signature.signed_at");
  });

  it("fails closed on replay rebinding and corrupt persisted signatures", async () => {
    const rebound = database([[], [signatureRow({ signed_by: maker })]]);
    await expect(createShipmentApvReceiverManifestArchiveAlertPayloadSignature(
      rebound.db, input)).rejects.toThrow("SIGNATURE_REPLAY_CONFLICT");
    const corrupt = database([[], [signatureRow({
      signature_base64: Buffer.alloc(64).toString("base64") })]]);
    await expect(createShipmentApvReceiverManifestArchiveAlertPayloadSignature(
      corrupt.db, input)).rejects.toThrow("SIGNATURE_REPLAY_CONFLICT");
  });

  it("requires the outbox checker and active original cooldown", async () => {
    const actor = database([[], [], [bindingRow()]]);
    await expect(createShipmentApvReceiverManifestArchiveAlertPayloadSignature(
      actor.db, { ...input, signedBy: maker }))
      .rejects.toThrow("SIGNATURE_ACTOR_MISMATCH");
    const expired = database([[], [], [bindingRow()] ]);
    await expect(createShipmentApvReceiverManifestArchiveAlertPayloadSignature(
      expired.db, { ...input, now: new Date("2026-07-14T00:20:00.000Z") }))
      .rejects.toThrow("COOLDOWN_EXPIRED");
  });

  it("requires an active matching registry key and current archive state", async () => {
    const retired = database([[], [], [bindingRow()], [{
      ...activeRegistry, event_type: "RETIRED",
    }]]);
    await expect(createShipmentApvReceiverManifestArchiveAlertPayloadSignature(
      retired.db, input)).rejects.toThrow("SIGNING_KEY_NOT_ACTIVE");
    const changed = database([[], [], [bindingRow()], [activeRegistry],
      [healthRow({ current_receipt_intent_covered: true,
        latest_receipt_revision: 1, latest_intent_revision: 1,
        latest_intent_age_seconds: 60 })]]);
    await expect(createShipmentApvReceiverManifestArchiveAlertPayloadSignature(
      changed.db, input)).rejects.toThrow("STATE_CHANGED");
  });

  it("blocks a second client signature for the same payload", async () => {
    const fixture = database([[], [], [bindingRow({
      signature_id: signatureId,
      client_signature_id: "99999999-9999-4999-8999-999999999999",
      signed_by: checker,
    })]]);
    await expect(createShipmentApvReceiverManifestArchiveAlertPayloadSignature(
      fixture.db, input)).rejects.toThrow("PAYLOAD_ALREADY_SIGNED");
  });

  it("rejects malformed payload ancestry before signing", async () => {
    const fixture = database([[], [], [bindingRow({
      payload: { ...payload, requested_by: maker },
    })]]);
    await expect(createShipmentApvReceiverManifestArchiveAlertPayloadSignature(
      fixture.db, input)).rejects.toThrow("PAYLOAD_INVALID");
    expect(fixture.execute).toHaveBeenCalledTimes(3);
  });

  it("classifies a conflicting insert winner without leaking it", async () => {
    const fixture = database([
      [], [], [bindingRow()], [activeRegistry], [healthRow()], [],
      [signatureRow({ client_signature_id:
        "99999999-9999-4999-8999-999999999999" })],
    ]);
    await expect(createShipmentApvReceiverManifestArchiveAlertPayloadSignature(
      fixture.db, input)).rejects.toThrow("PAYLOAD_ALREADY_SIGNED");
  });
});
