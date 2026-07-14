import { describe, expect, it, vi } from "vitest";
import type { Database } from "@haggle/db";
import { createShipmentApvFailureAlertReceiverManifestArchiveIntent } from
  "../services/shipment-apv-chaos-failure-alert-receiver-manifest-archive-intent.service.js";

const now = new Date("2026-07-13T23:00:00.000Z");
const requestedBy = "66666666-6666-4666-8666-666666666666";
const clientId = "11111111-1111-4111-8111-111111111111";
const receiptId = "22222222-2222-4222-8222-222222222222";
const intentId = "33333333-3333-4333-8333-333333333333";
const manifestDigest = "a".repeat(64);
const blockers = ["independent_worm_endpoint_missing",
  "archive_credential_missing", "archive_signing_key_missing",
  "archive_delivery_worker_missing"];

const healthRow = { receipt_count: 1, latest_revision: 1, latest_entry_count: 0,
  current_source_entry_count: 0, revision_gap_count: 0,
  previous_mismatch_count: 0, manifest_digest_mismatch_count: 0,
  receipt_set_mismatch_count: 0, unsafe_side_effect_count: 0,
  timestamp_violation_count: 0, source_limit_violation_count: 0,
  source_covered: true, latest_receipt_age_seconds: 60,
  observed_at: now.toISOString() };

function latest(overrides: Record<string, unknown> = {}) {
  return { receipt_id: receiptId, revision: 1, manifest_digest: manifestDigest,
    intent_id: null, client_archive_intent_id: null, status: null,
    blocking_reasons: null, http_request_created: null, delivery_attempted: null,
    external_receipt_verified: null, production_accepted: null,
    requested_by: null, created_at: null, ...overrides };
}

function intent(overrides: Record<string, unknown> = {}) {
  return { id: intentId, client_archive_intent_id: clientId,
    manifest_receipt_id: receiptId, manifest_revision: 1, manifest_digest: manifestDigest,
    status: "BLOCKED_EXTERNAL_ARCHIVE_CONFIGURATION_DRY_RUN",
    blocking_reasons: blockers, http_request_created: false,
    delivery_attempted: false, external_receipt_verified: false,
    production_accepted: false, requested_by: requestedBy,
    created_at: now.toISOString(), inserted: true, ...overrides };
}

const input = { clientArchiveIntentId: clientId, requestedBy, now };

describe("shipment APV receiver manifest blocked archive intents", () => {
  it("stores a persistent non-executable intent for the covered latest receipt", async () => {
    const execute = vi.fn().mockResolvedValueOnce([]).mockResolvedValueOnce([healthRow])
      .mockResolvedValueOnce([latest()]).mockResolvedValueOnce([intent()]);
    const result = await createShipmentApvFailureAlertReceiverManifestArchiveIntent(
      { execute } as unknown as Pick<Database, "execute">, input);
    expect(result).toMatchObject({ archiveIntentId: intentId, manifestRevision: 1,
      manifestDigest, status: "BLOCKED_EXTERNAL_ARCHIVE_CONFIGURATION_DRY_RUN",
      blockingReasons: blockers, replayed: false, persistent: true, appendOnly: true,
      executable: false, containsRawIdentifiers: false,
      http: { requestCreated: false }, delivery: { enabled: false, attempted: false },
      externalReceipt: { verified: false }, productionAccepted: false });
    expect(execute).toHaveBeenCalledTimes(4);
  });

  it("returns an exact client replay before live health checks", async () => {
    const execute = vi.fn().mockResolvedValueOnce([intent({ inserted: false })]);
    await expect(createShipmentApvFailureAlertReceiverManifestArchiveIntent(
      { execute } as unknown as Pick<Database, "execute">, input))
      .resolves.toMatchObject({ replayed: true, manifestRevision: 1 });
    expect(execute).toHaveBeenCalledOnce();
  });

  it("blocks an uncovered or stale manifest chain", async () => {
    const execute = vi.fn().mockResolvedValueOnce([]).mockResolvedValueOnce([{
      ...healthRow, source_covered: false,
    }]);
    await expect(createShipmentApvFailureAlertReceiverManifestArchiveIntent(
      { execute } as unknown as Pick<Database, "execute">, input)).rejects.toThrow(
      "SHIPMENT_APV_FAILURE_ALERT_RECEIVER_MANIFEST_ARCHIVE_INTENT_HEALTH_BLOCKED");
  });

  it("fails closed when the covered receipt cannot be loaded", async () => {
    const execute = vi.fn().mockResolvedValueOnce([]).mockResolvedValueOnce([healthRow])
      .mockResolvedValueOnce([]);
    await expect(createShipmentApvFailureAlertReceiverManifestArchiveIntent(
      { execute } as unknown as Pick<Database, "execute">, input)).rejects.toThrow(
      "SHIPMENT_APV_FAILURE_ALERT_RECEIVER_MANIFEST_ARCHIVE_INTENT_RECEIPT_NOT_FOUND");
  });

  it("rejects a second client intent for the same receipt", async () => {
    const execute = vi.fn().mockResolvedValueOnce([]).mockResolvedValueOnce([healthRow])
      .mockResolvedValueOnce([latest({ intent_id: intentId,
        client_archive_intent_id: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
        status: "BLOCKED_EXTERNAL_ARCHIVE_CONFIGURATION_DRY_RUN",
        blocking_reasons: blockers, http_request_created: false,
        delivery_attempted: false, external_receipt_verified: false,
        production_accepted: false, requested_by: requestedBy,
        created_at: now.toISOString() })]);
    await expect(createShipmentApvFailureAlertReceiverManifestArchiveIntent(
      { execute } as unknown as Pick<Database, "execute">, input)).rejects.toThrow(
      "SHIPMENT_APV_FAILURE_ALERT_RECEIVER_MANIFEST_ARCHIVE_INTENT_ALREADY_CREATED");
  });

  it("fails closed when a client id is rebound to another actor", async () => {
    const execute = vi.fn().mockResolvedValueOnce([intent({ inserted: false,
      requested_by: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa" })]);
    await expect(createShipmentApvFailureAlertReceiverManifestArchiveIntent(
      { execute } as unknown as Pick<Database, "execute">, input)).rejects.toThrow(
      "SHIPMENT_APV_FAILURE_ALERT_RECEIVER_MANIFEST_ARCHIVE_INTENT_REPLAY_CONFLICT");
  });
});
