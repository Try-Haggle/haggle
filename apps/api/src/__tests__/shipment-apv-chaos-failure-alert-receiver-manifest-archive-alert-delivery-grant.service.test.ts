import type { Database } from "@haggle/db";
import { PgDialect } from "drizzle-orm/pg-core";
import { describe, expect, it, vi } from "vitest";
import { createShipmentApvReceiverManifestArchiveAlertDeliveryGrant } from "../services/shipment-apv-chaos-failure-alert-receiver-manifest-archive-alert-delivery-grant.service.js";
import { evaluateShipmentApvFailureAlertReceiverManifestArchiveAlertPreview } from "../services/shipment-apv-chaos-failure-alert-receiver-manifest-archive-alert-preview.service.js";

vi.unmock("@haggle/db");

const now = new Date("2026-07-14T00:05:00.000Z");
const maker = "55555555-5555-4555-8555-555555555555";
const checker = "66666666-6666-4666-8666-666666666666";
const requestId = "22222222-2222-4222-8222-222222222222";
const decisionId = "44444444-4444-4444-8444-444444444444";
const clientGrantId = "77777777-7777-4777-8777-777777777777";
const grantId = "88888888-8888-4888-8888-888888888888";
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
    id: null,
    client_grant_id: null,
    approval_decision_id: decisionId,
    state_fingerprint: fingerprint,
    status: "GRANTED_DRY_RUN",
    granted_by: checker,
    granted_at: "2026-07-14T00:04:00.000Z",
    cooldown_expires_at: "2026-07-14T00:19:00.000Z",
    inserted: false,
    decision: "APPROVED",
    decision_reason: "checker_approved_snapshot",
    decided_by: checker,
    decided_at: "2026-07-14T00:04:00.000Z",
    approval_request_id: requestId,
    preview_schema_version: previewSchema,
    approval_state_fingerprint: fingerprint,
    preview_action: "review_warning",
    preview_severity: "warning",
    preview_reasons: ["current_archive_intent_missing"],
    requested_by: maker,
    request_created_at: "2026-07-14T00:00:00.000Z",
    request_expires_at: "2026-07-14T00:15:00.000Z",
    prior_grant_id: null,
    prior_client_grant_id: null,
    prior_granted_by: null,
    ...overrides,
  };
}

function grantRow(overrides: Record<string, unknown> = {}) {
  return {
    ...bindingRow(),
    id: grantId,
    client_grant_id: clientGrantId,
    granted_at: now.toISOString(),
    cooldown_expires_at: "2026-07-14T00:20:00.000Z",
    inserted: true,
    ...overrides,
  };
}

function database(results: unknown[][]) {
  const execute = vi.fn();
  for (const result of results) execute.mockResolvedValueOnce(result);
  const transaction = vi.fn(async (callback) => callback({ execute }));
  return { db: { transaction } as unknown as Pick<Database, "transaction">, execute, transaction };
}

const input = { approvalDecisionId: decisionId, clientGrantId, grantedBy: checker, now, grantId };

describe("receiver manifest archive alert delivery grant", () => {
  it("claims the state cooldown and records a non-delivering grant", async () => {
    const { db, execute, transaction } = database([
      [],
      [],
      [bindingRow()],
      [healthRow()],
      [grantRow()],
    ]);
    const result = await createShipmentApvReceiverManifestArchiveAlertDeliveryGrant(db, input);
    expect(result).toMatchObject({
      schemaVersion: "shipment-apv-failure-alert-receiver-manifest-archive-alert-delivery-grant-v1",
      deliveryGrantId: grantId,
      clientGrantId,
      approvalDecisionId: decisionId,
      stateFingerprint: fingerprint,
      status: "GRANTED_DRY_RUN",
      cooldown: { scope: "state_fingerprint", windowMinutes: 15, active: true },
      replayed: false,
      persistent: true,
      appendOnly: true,
      makerCheckerSeparated: true,
      makerIdentityReturned: false,
      checkerIdentityReturned: false,
      containsArchiveIdentifiers: false,
      payloadCreated: false,
      signed: false,
      delivery: { enabled: false, attempted: false },
      externalReceiptVerified: false,
      productionAccepted: false,
    });
    expect(transaction).toHaveBeenCalledOnce();
    expect(execute).toHaveBeenCalledTimes(5);
    const lock = new PgDialect().sqlToQuery(execute.mock.calls[0]![0]).sql;
    expect(lock).toContain("receiver-manifest-archive-grant.v1");
    const insert = new PgDialect().sqlToQuery(execute.mock.calls[4]![0]).sql;
    expect(insert).toContain("shipment_apv_manifest_archive_alert_cooldown_claims");
    expect(insert).toContain("shipment_apv_manifest_archive_alert_delivery_grants");
  });

  it("returns an exact immutable replay before decision and health reads", async () => {
    const { db, execute } = database([[], [grantRow({ inserted: false })]]);
    await expect(
      createShipmentApvReceiverManifestArchiveAlertDeliveryGrant(db, input),
    ).resolves.toMatchObject({ replayed: true, deliveryGrantId: grantId });
    expect(execute).toHaveBeenCalledTimes(2);
  });

  it("fails closed on replay key rebinding or malformed stored data", async () => {
    const rebound = database([[], [grantRow({ granted_by: maker })]]);
    await expect(
      createShipmentApvReceiverManifestArchiveAlertDeliveryGrant(rebound.db, input),
    ).rejects.toThrow("GRANT_REPLAY_CONFLICT");

    const malformed = database([[], [grantRow({ status: "DELIVERED" })]]);
    await expect(
      createShipmentApvReceiverManifestArchiveAlertDeliveryGrant(malformed.db, input),
    ).rejects.toThrow("GRANT_REPLAY_CONFLICT");
  });

  it("requires an approved decision and the original checker", async () => {
    const rejected = database([
      [],
      [],
      [bindingRow({ decision: "REJECTED", decision_reason: "checker_rejected_snapshot" })],
    ]);
    await expect(
      createShipmentApvReceiverManifestArchiveAlertDeliveryGrant(rejected.db, input),
    ).rejects.toThrow("DECISION_NOT_APPROVED");

    const wrongActor = database([[], [], [bindingRow()]]);
    await expect(
      createShipmentApvReceiverManifestArchiveAlertDeliveryGrant(wrongActor.db, {
        ...input,
        grantedBy: maker,
      }),
    ).rejects.toThrow("GRANT_ACTOR_MISMATCH");
  });

  it("blocks expired approvals and current-state changes", async () => {
    const expired = database([
      [],
      [],
      [
        bindingRow({
          request_expires_at: "2026-07-14T00:04:59.999Z",
        }),
      ],
    ]);
    await expect(
      createShipmentApvReceiverManifestArchiveAlertDeliveryGrant(expired.db, input),
    ).rejects.toThrow("APPROVAL_REQUEST_EXPIRED");

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
      createShipmentApvReceiverManifestArchiveAlertDeliveryGrant(changed.db, input),
    ).rejects.toThrow("STATE_CHANGED");
  });

  it("blocks another grant while the same state cooldown is active", async () => {
    const active = database([[], [], [bindingRow()], [healthRow()], []]);
    await expect(
      createShipmentApvReceiverManifestArchiveAlertDeliveryGrant(active.db, input),
    ).rejects.toThrow("COOLDOWN_ACTIVE");
  });

  it("rejects a second client id for an already granted decision", async () => {
    const prior = database([
      [],
      [],
      [
        bindingRow({
          prior_grant_id: grantId,
          prior_client_grant_id: "99999999-9999-4999-8999-999999999999",
          prior_granted_by: checker,
        }),
      ],
    ]);
    await expect(
      createShipmentApvReceiverManifestArchiveAlertDeliveryGrant(prior.db, input),
    ).rejects.toThrow("ALREADY_GRANTED");
  });

  it("rejects invalid decision bindings before current-state evaluation", async () => {
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
      createShipmentApvReceiverManifestArchiveAlertDeliveryGrant(invalid.db, input),
    ).rejects.toThrow("DECISION_INVALID");
    expect(invalid.execute).toHaveBeenCalledTimes(3);
  });
});
