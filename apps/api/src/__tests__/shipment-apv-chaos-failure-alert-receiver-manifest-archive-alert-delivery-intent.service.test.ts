import { createHash, generateKeyPairSync } from "node:crypto";
import type { Database } from "@haggle/db";
import { PgDialect } from "drizzle-orm/pg-core";
import { describe, expect, it, vi } from "vitest";
import { createShipmentApvReceiverManifestArchiveAlertDeliveryIntent } from "../services/shipment-apv-chaos-failure-alert-receiver-manifest-archive-alert-delivery-intent.service.js";
import { evaluateShipmentApvFailureAlertReceiverManifestArchiveAlertPreview } from "../services/shipment-apv-chaos-failure-alert-receiver-manifest-archive-alert-preview.service.js";
import { SHIPMENT_APV_RECEIVER_MANIFEST_ARCHIVE_ALERT_SIGNING_DOMAIN } from "../services/shipment-apv-chaos-failure-alert-receiver-manifest-archive-alert-signature.service.js";
import { createShipmentApvFailureAlertTestSigner } from "../services/shipment-apv-chaos-failure-alert-signature.service.js";

vi.unmock("@haggle/db");

const now = new Date("2026-07-14T00:08:00.000Z");
const maker = "55555555-5555-4555-8555-555555555555";
const checker = "66666666-6666-4666-8666-666666666666";
const grantId = "88888888-8888-4888-8888-888888888888";
const outboxId = "22222222-2222-4222-8222-222222222222";
const signatureId = "33333333-3333-4333-8333-333333333333";
const intentId = "44444444-4444-4444-8444-444444444444";
const clientIntentId = "11111111-1111-4111-8111-111111111111";
const previewSchema = "shipment-apv-failure-alert-receiver-manifest-archive-alert-preview-v1";
const fingerprint = evaluateShipmentApvFailureAlertReceiverManifestArchiveAlertPreview({
  schemaVersion: "shipment-apv-failure-alert-receiver-manifest-archive-health-v1",
  status: "warning",
  totals: {
    intents: 0,
    latestReceiptRevision: null,
    latestIntentRevision: null,
    currentSourceEntries: 0,
  },
  violations: { binding: 0, blockers: 0, unsafeSideEffect: 0, timestamp: 0, sourceLimit: 0 },
  criticalCount: 0,
  coverage: { currentReceiptIntentCovered: false, missingCurrentArchiveIntent: true },
  freshness: { slaSeconds: 86400, latestIntentAgeSeconds: null, stale: false },
  containsRawIdentifiers: false,
  httpRequestCreated: false,
  networkDelivered: false,
  externalReceiptVerified: false,
  productionAccepted: false,
  observedAt: now.toISOString(),
}).stateFingerprint;
const payload = {
  schema_version: "shipment-apv-failure-alert-receiver-manifest-archive-alert-payload-v1" as const,
  event_type: "shipment_apv_failure_alert_receiver_manifest_archive_alert" as const,
  action: "review_warning",
  severity: "warning",
  reasons: ["current_archive_intent_missing"],
  state_fingerprint: fingerprint,
};
const canonical = JSON.stringify({
  action: payload.action,
  event_type: payload.event_type,
  reasons: payload.reasons,
  schema_version: payload.schema_version,
  severity: payload.severity,
  state_fingerprint: payload.state_fingerprint,
});
const payloadSha256 = createHash("sha256").update(canonical).digest("hex");
const signer = createShipmentApvFailureAlertTestSigner(generateKeyPairSync("ed25519").privateKey);
const signatureBase64 = signer.signMessage(
  Buffer.from(
    `${SHIPMENT_APV_RECEIVER_MANIFEST_ARCHIVE_ALERT_SIGNING_DOMAIN}:${payloadSha256}`,
    "utf8",
  ),
);
const blockers = [
  "independent_trust_anchor_missing",
  "receiver_endpoint_missing",
  "receiver_credential_missing",
];

function healthRow(overrides: Record<string, unknown> = {}) {
  return {
    intent_count: 0,
    latest_receipt_revision: null,
    latest_intent_revision: null,
    current_source_entry_count: 0,
    binding_violation_count: 0,
    blocker_violation_count: 0,
    unsafe_side_effect_count: 0,
    timestamp_violation_count: 0,
    source_limit_violation_count: 0,
    current_receipt_intent_covered: false,
    latest_intent_age_seconds: null,
    observed_at: now.toISOString(),
    ...overrides,
  };
}

function bindingRow(overrides: Record<string, unknown> = {}) {
  return {
    intent_id: null,
    client_delivery_intent_id: null,
    intent_payload_signature_id: null,
    intent_payload_outbox_id: null,
    intent_payload_sha256: null,
    intent_key_id: null,
    intent_status: null,
    blocking_reasons: null,
    http_request_created: null,
    delivery_attempted: null,
    intent_requested_by: null,
    intent_created_at: null,
    signature_id: signatureId,
    signature_payload_outbox_id: outboxId,
    signature_payload_sha256: payloadSha256,
    signing_domain: SHIPMENT_APV_RECEIVER_MANIFEST_ARCHIVE_ALERT_SIGNING_DOMAIN,
    algorithm: "Ed25519",
    key_id: signer.keyId,
    public_key_spki_base64: signer.publicKeySpkiBase64,
    signature_base64: signatureBase64,
    signature_status: "SIGNED_DRY_RUN",
    signed_by: checker,
    signed_at: "2026-07-14T00:07:00.000Z",
    registry_public_key: signer.publicKeySpkiBase64,
    registry_event_type: "REGISTERED",
    registry_event_created_at: "2026-07-14T00:01:00.000Z",
    current_registry_public_key: signer.publicKeySpkiBase64,
    current_registry_event_type: "REGISTERED",
    current_registry_event_created_at: "2026-07-14T00:01:00.000Z",
    outbox_id: outboxId,
    outbox_delivery_grant_id: grantId,
    state_fingerprint: fingerprint,
    payload,
    canonical_payload: canonical,
    payload_sha256: payloadSha256,
    outbox_status: "UNSIGNED_DRY_RUN",
    created_by: checker,
    outbox_created_at: "2026-07-14T00:06:00.000Z",
    grant_id: grantId,
    grant_status: "GRANTED_DRY_RUN",
    granted_by: checker,
    granted_at: "2026-07-14T00:05:00.000Z",
    cooldown_expires_at: "2026-07-14T00:20:00.000Z",
    current_cooldown_grant_id: grantId,
    current_cooldown_claimed_at: "2026-07-14T00:05:00.000Z",
    current_cooldown_expires_at: "2026-07-14T00:20:00.000Z",
    decision: "APPROVED",
    decision_reason: "checker_approved_snapshot",
    decided_by: checker,
    decided_at: "2026-07-14T00:04:00.000Z",
    requested_by: maker,
    request_created_at: "2026-07-14T00:00:00.000Z",
    request_expires_at: "2026-07-14T00:15:00.000Z",
    preview_schema_version: previewSchema,
    preview_action: "review_warning",
    preview_severity: "warning",
    preview_reasons: ["current_archive_intent_missing"],
    ...overrides,
  };
}

function intentRow(overrides: Record<string, unknown> = {}) {
  return bindingRow({
    intent_id: intentId,
    client_delivery_intent_id: clientIntentId,
    intent_payload_signature_id: signatureId,
    intent_payload_outbox_id: outboxId,
    intent_payload_sha256: payloadSha256,
    intent_key_id: signer.keyId,
    intent_status: "BLOCKED_CONFIGURATION_DRY_RUN",
    blocking_reasons: blockers,
    http_request_created: false,
    delivery_attempted: false,
    intent_requested_by: checker,
    intent_created_at: now.toISOString(),
    current_registry_public_key: null,
    current_registry_event_type: null,
    current_registry_event_created_at: null,
    current_cooldown_grant_id: null,
    current_cooldown_claimed_at: null,
    current_cooldown_expires_at: null,
    ...overrides,
  });
}

function database(results: unknown[][]) {
  const execute = vi.fn();
  for (const result of results) execute.mockResolvedValueOnce(result);
  const transaction = vi.fn(async (callback) => callback({ execute }));
  return { db: { transaction } as unknown as Pick<Database, "transaction">, execute, transaction };
}

const input = {
  payloadSignatureId: signatureId,
  clientDeliveryIntentId: clientIntentId,
  requestedBy: checker,
  now,
};

describe("receiver manifest archive alert blocked delivery intent", () => {
  it("records a persistent non-executable intent with fixed blockers", async () => {
    const fixture = database([[], [], [bindingRow()], [healthRow()], [], [intentRow()]]);
    const result = await createShipmentApvReceiverManifestArchiveAlertDeliveryIntent(
      fixture.db,
      input,
    );
    expect(result).toMatchObject({
      schemaVersion:
        "shipment-apv-failure-alert-receiver-manifest-archive-alert-delivery-intent-v1",
      deliveryIntentId: intentId,
      clientDeliveryIntentId: clientIntentId,
      payloadSignatureId: signatureId,
      payloadOutboxId: outboxId,
      status: "BLOCKED_CONFIGURATION_DRY_RUN",
      blockingReasons: blockers,
      replayed: false,
      persistent: true,
      appendOnly: true,
      executable: false,
      requestedByIdentityReturned: false,
      signatureValueReturned: false,
      publicKeyReturned: false,
      independentTrustAnchor: false,
      endpointConfigured: false,
      credentialConfigured: false,
      http: { requestCreated: false },
      delivery: { enabled: false, attempted: false },
      networkRequestSent: false,
      externalReceiptVerified: false,
      productionAccepted: false,
    });
    expect(result).not.toHaveProperty("requestedBy");
    expect(result).not.toHaveProperty("signatureBase64");
    expect(result).not.toHaveProperty("publicKeySpkiBase64");
    const lock = new PgDialect().sqlToQuery(fixture.execute.mock.calls[0]![0]).sql;
    expect(lock).toContain("receiver-manifest-archive-delivery-intent.v1");
    const insert = new PgDialect().sqlToQuery(fixture.execute.mock.calls[4]![0]);
    expect(insert.sql).toContain("shipment_apv_manifest_archive_alert_delivery_intents");
  });

  it("returns exact historical replay without current state or key reads", async () => {
    const fixture = database([[], [intentRow()]]);
    await expect(
      createShipmentApvReceiverManifestArchiveAlertDeliveryIntent(fixture.db, input),
    ).resolves.toMatchObject({ replayed: true, deliveryIntentId: intentId });
    expect(fixture.execute).toHaveBeenCalledTimes(2);
    const replay = new PgDialect().sqlToQuery(fixture.execute.mock.calls[1]![0]).sql;
    expect(replay).not.toContain("current_cooldown_claims cooldown");
    expect(replay).toContain("event.created_at <= signature.signed_at");
  });

  it("fails closed on replay rebinding and persisted intent mutation", async () => {
    const rebound = database([[], [intentRow({ intent_requested_by: maker })]]);
    await expect(
      createShipmentApvReceiverManifestArchiveAlertDeliveryIntent(rebound.db, input),
    ).rejects.toThrow("DELIVERY_INTENT_REPLAY_CONFLICT");
    const unsafe = database([[], [intentRow({ delivery_attempted: true })]]);
    await expect(
      createShipmentApvReceiverManifestArchiveAlertDeliveryIntent(unsafe.db, input),
    ).rejects.toThrow("DELIVERY_INTENT_REPLAY_CONFLICT");
  });

  it("requires the signing checker and active original cooldown", async () => {
    const actor = database([[], [], [bindingRow()]]);
    await expect(
      createShipmentApvReceiverManifestArchiveAlertDeliveryIntent(actor.db, {
        ...input,
        requestedBy: maker,
      }),
    ).rejects.toThrow("DELIVERY_INTENT_ACTOR_MISMATCH");
    const expired = database([[], [], [bindingRow()]]);
    await expect(
      createShipmentApvReceiverManifestArchiveAlertDeliveryIntent(expired.db, {
        ...input,
        now: new Date("2026-07-14T00:20:00.000Z"),
      }),
    ).rejects.toThrow("COOLDOWN_EXPIRED");
  });

  it("requires the current registered key and unchanged archive state", async () => {
    const retired = database([
      [],
      [],
      [
        bindingRow({
          current_registry_event_type: "RETIRED",
        }),
      ],
    ]);
    await expect(
      createShipmentApvReceiverManifestArchiveAlertDeliveryIntent(retired.db, input),
    ).rejects.toThrow("SIGNING_KEY_NOT_ACTIVE");
    const changed = database([
      [],
      [],
      [bindingRow()],
      [
        healthRow({
          current_receipt_intent_covered: true,
          latest_receipt_revision: 1,
          latest_intent_revision: 1,
          latest_intent_age_seconds: 60,
        }),
      ],
    ]);
    await expect(
      createShipmentApvReceiverManifestArchiveAlertDeliveryIntent(changed.db, input),
    ).rejects.toThrow("STATE_CHANGED");
  });

  it("blocks a second client intent for the same signed payload", async () => {
    const fixture = database([
      [],
      [],
      [
        intentRow({
          client_delivery_intent_id: "99999999-9999-4999-8999-999999999999",
          current_registry_public_key: signer.publicKeySpkiBase64,
          current_registry_event_type: "REGISTERED",
          current_registry_event_created_at: "2026-07-14T00:01:00.000Z",
          current_cooldown_grant_id: grantId,
          current_cooldown_claimed_at: "2026-07-14T00:05:00.000Z",
          current_cooldown_expires_at: "2026-07-14T00:20:00.000Z",
        }),
      ],
    ]);
    await expect(
      createShipmentApvReceiverManifestArchiveAlertDeliveryIntent(fixture.db, input),
    ).rejects.toThrow("DELIVERY_INTENT_ALREADY_CREATED");
  });

  it("rejects malformed signature ancestry before planning delivery", async () => {
    const fixture = database([
      [],
      [],
      [
        bindingRow({
          signature_base64: Buffer.alloc(64).toString("base64"),
        }),
      ],
    ]);
    await expect(
      createShipmentApvReceiverManifestArchiveAlertDeliveryIntent(fixture.db, input),
    ).rejects.toThrow("SIGNATURE_INVALID");
    expect(fixture.execute).toHaveBeenCalledTimes(3);
  });

  it("classifies a conflicting insert winner without leaking it", async () => {
    const fixture = database([
      [],
      [],
      [bindingRow()],
      [healthRow()],
      [],
      [
        intentRow({
          client_delivery_intent_id: "99999999-9999-4999-8999-999999999999",
        }),
      ],
    ]);
    await expect(
      createShipmentApvReceiverManifestArchiveAlertDeliveryIntent(fixture.db, input),
    ).rejects.toThrow("DELIVERY_INTENT_ALREADY_CREATED");
  });
});
