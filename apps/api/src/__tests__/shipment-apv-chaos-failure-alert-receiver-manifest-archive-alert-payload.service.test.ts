import { createHash } from "node:crypto";
import type { Database } from "@haggle/db";
import { PgDialect } from "drizzle-orm/pg-core";
import { describe, expect, it, vi } from "vitest";
import { createShipmentApvReceiverManifestArchiveAlertPayloadOutbox } from "../services/shipment-apv-chaos-failure-alert-receiver-manifest-archive-alert-payload.service.js";
import { evaluateShipmentApvFailureAlertReceiverManifestArchiveAlertPreview } from "../services/shipment-apv-chaos-failure-alert-receiver-manifest-archive-alert-preview.service.js";

vi.unmock("@haggle/db");

const now = new Date("2026-07-14T00:06:00.000Z");
const maker = "55555555-5555-4555-8555-555555555555";
const checker = "66666666-6666-4666-8666-666666666666";
const decisionId = "44444444-4444-4444-8444-444444444444";
const grantId = "88888888-8888-4888-8888-888888888888";
const clientOutboxId = "11111111-1111-4111-8111-111111111111";
const outboxId = "22222222-2222-4222-8222-222222222222";
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
const sha256 = createHash("sha256").update(canonical).digest("hex");

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
    outbox_id: null,
    client_outbox_id: null,
    outbox_delivery_grant_id: null,
    outbox_state_fingerprint: null,
    payload: null,
    canonical_payload: null,
    payload_sha256: null,
    outbox_status: null,
    created_by: null,
    outbox_created_at: null,
    grant_id: grantId,
    client_grant_id: "77777777-7777-4777-8777-777777777777",
    approval_decision_id: decisionId,
    grant_state_fingerprint: fingerprint,
    grant_status: "GRANTED_DRY_RUN",
    granted_by: checker,
    granted_at: "2026-07-14T00:05:00.000Z",
    grant_cooldown_expires_at: "2026-07-14T00:20:00.000Z",
    cooldown_grant_id: grantId,
    cooldown_claimed_at: "2026-07-14T00:05:00.000Z",
    cooldown_expires_at: "2026-07-14T00:20:00.000Z",
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
    prior_outbox_id: null,
    prior_client_outbox_id: null,
    prior_created_by: null,
    ...overrides,
  };
}

function outboxRow(overrides: Record<string, unknown> = {}) {
  return {
    ...bindingRow(),
    outbox_id: outboxId,
    client_outbox_id: clientOutboxId,
    outbox_delivery_grant_id: grantId,
    outbox_state_fingerprint: fingerprint,
    payload,
    canonical_payload: canonical,
    payload_sha256: sha256,
    outbox_status: "UNSIGNED_DRY_RUN",
    created_by: checker,
    outbox_created_at: now.toISOString(),
    ...overrides,
  };
}

function database(results: unknown[][]) {
  const execute = vi.fn();
  for (const result of results) execute.mockResolvedValueOnce(result);
  const transaction = vi.fn(async (callback) => callback({ execute }));
  return { db: { transaction } as unknown as Pick<Database, "transaction">, execute, transaction };
}

const input = { deliveryGrantId: grantId, clientOutboxId, createdBy: checker, now };

describe("receiver manifest archive alert unsigned payload outbox", () => {
  it("records a canonical identifier-free payload without signing or delivery", async () => {
    const { db, execute, transaction } = database([
      [],
      [],
      [bindingRow()],
      [healthRow()],
      [{ id: outboxId }],
      [outboxRow()],
    ]);
    const result = await createShipmentApvReceiverManifestArchiveAlertPayloadOutbox(db, input);
    expect(result).toMatchObject({
      schemaVersion: "shipment-apv-failure-alert-receiver-manifest-archive-alert-payload-outbox-v1",
      payloadOutboxId: outboxId,
      clientOutboxId,
      deliveryGrantId: grantId,
      stateFingerprint: fingerprint,
      payload,
      payloadSha256: sha256,
      status: "UNSIGNED_DRY_RUN",
      replayed: false,
      persistent: true,
      appendOnly: true,
      containsArchiveIdentifiers: false,
      createdByIdentityReturned: false,
      signed: false,
      signature: null,
      delivery: { enabled: false, attempted: false },
      externalReceiptVerified: false,
      productionAccepted: false,
    });
    expect(JSON.stringify(result.payload)).not.toMatch(
      /user|actor|request|approval|grant|archive_id|created_at|timestamp/i,
    );
    expect(transaction).toHaveBeenCalledOnce();
    const lock = new PgDialect().sqlToQuery(execute.mock.calls[0]![0]).sql;
    expect(lock).toContain("receiver-manifest-archive-payload.v1");
    const insert = new PgDialect().sqlToQuery(execute.mock.calls[4]![0]);
    expect(insert.sql).toContain("shipment_apv_manifest_archive_alert_payload_outbox");
    expect(insert.params).toContain(canonical);
    expect(insert.params).toContain(sha256);
  });

  it("returns an exact immutable replay before grant and current-state reads", async () => {
    const { db, execute } = database([[], [outboxRow()]]);
    await expect(
      createShipmentApvReceiverManifestArchiveAlertPayloadOutbox(db, input),
    ).resolves.toMatchObject({ replayed: true, payloadOutboxId: outboxId, payloadSha256: sha256 });
    expect(execute).toHaveBeenCalledTimes(2);
    const replayQuery = new PgDialect().sqlToQuery(execute.mock.calls[1]![0]).sql;
    expect(replayQuery).not.toContain("join shipment_apv_manifest_archive_alert_cooldown_claims");
  });

  it("fails closed on client replay rebinding or malformed stored payload", async () => {
    const rebound = database([[], [outboxRow({ created_by: maker })]]);
    await expect(
      createShipmentApvReceiverManifestArchiveAlertPayloadOutbox(rebound.db, input),
    ).rejects.toThrow("PAYLOAD_REPLAY_CONFLICT");

    const malformed = database([
      [],
      [
        outboxRow({
          payload: { ...payload, requested_by: maker },
        }),
      ],
    ]);
    await expect(
      createShipmentApvReceiverManifestArchiveAlertPayloadOutbox(malformed.db, input),
    ).rejects.toThrow("PAYLOAD_REPLAY_CONFLICT");
  });

  it("requires the original checker and an active grant cooldown", async () => {
    const actor = database([[], [], [bindingRow()]]);
    await expect(
      createShipmentApvReceiverManifestArchiveAlertPayloadOutbox(actor.db, {
        ...input,
        createdBy: maker,
      }),
    ).rejects.toThrow("PAYLOAD_ACTOR_MISMATCH");

    const expired = database([[], [], [bindingRow()]]);
    await expect(
      createShipmentApvReceiverManifestArchiveAlertPayloadOutbox(expired.db, {
        ...input,
        now: new Date("2026-07-14T00:20:00.000Z"),
      }),
    ).rejects.toThrow("COOLDOWN_EXPIRED");
  });

  it("rejects a changed current archive state before insert", async () => {
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
      createShipmentApvReceiverManifestArchiveAlertPayloadOutbox(changed.db, input),
    ).rejects.toThrow("STATE_CHANGED");
    expect(changed.execute).toHaveBeenCalledTimes(4);
  });

  it("blocks a second client id when the grant already has an outbox", async () => {
    const prior = database([
      [],
      [],
      [
        bindingRow({
          prior_outbox_id: outboxId,
          prior_client_outbox_id: "99999999-9999-4999-8999-999999999999",
          prior_created_by: checker,
        }),
      ],
    ]);
    await expect(
      createShipmentApvReceiverManifestArchiveAlertPayloadOutbox(prior.db, input),
    ).rejects.toThrow("PAYLOAD_ALREADY_CREATED");
  });

  it("rejects malformed grant ancestry before current-state evaluation", async () => {
    const invalid = database([
      [],
      [],
      [
        bindingRow({
          preview_reasons: ["archive_intent_stale", "current_archive_intent_missing"],
        }),
      ],
    ]);
    await expect(
      createShipmentApvReceiverManifestArchiveAlertPayloadOutbox(invalid.db, input),
    ).rejects.toThrow("DELIVERY_GRANT_INVALID");
    expect(invalid.execute).toHaveBeenCalledTimes(3);
  });

  it("classifies a conflicting winner without returning its data", async () => {
    const conflict = database([
      [],
      [],
      [bindingRow()],
      [healthRow()],
      [],
      [outboxRow({ client_outbox_id: "99999999-9999-4999-8999-999999999999" })],
    ]);
    await expect(
      createShipmentApvReceiverManifestArchiveAlertPayloadOutbox(conflict.db, input),
    ).rejects.toThrow("PAYLOAD_ALREADY_CREATED");
  });
});
