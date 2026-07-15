import type { Database } from "@haggle/db";
import { describe, expect, it, vi } from "vitest";
import { exportShipmentApvFailureAlertReceiverClaimManifest } from "../services/shipment-apv-chaos-failure-alert-receiver-claim-export.service.js";
import { recordShipmentApvFailureAlertReceiverClaimManifestReceipt } from "../services/shipment-apv-chaos-failure-alert-receiver-claim-manifest-receipt.service.js";

vi.unmock("@haggle/db");
vi.mock("../services/shipment-apv-chaos-failure-alert-receiver-claim-export.service.js", () => ({
  exportShipmentApvFailureAlertReceiverClaimManifest: vi.fn(),
}));

const digest = "a".repeat(64);
const previous = "b".repeat(64);
const receiptDigest = "c".repeat(64);
const generatedAt = "2026-07-13T21:00:00.000Z";
const manifest = {
  manifestDigest: digest,
  entryCount: 1,
  receiptDigests: [receiptDigest],
  generatedAt,
};
type ManifestResult = Awaited<
  ReturnType<typeof exportShipmentApvFailureAlertReceiverClaimManifest>
>;
const manifestResult = manifest as unknown as ManifestResult;
function row(overrides: Record<string, unknown> = {}) {
  return {
    revision: 1,
    manifest_digest: digest,
    previous_manifest_digest: null,
    entry_count: 1,
    receipt_digests: [receiptDigest],
    status: "PERSISTED_LOCAL_MANIFEST_RECEIPT_DRY_RUN",
    health_status: "healthy",
    contains_raw_identifiers: false,
    external_archive: false,
    network_delivered: false,
    production_accepted: false,
    generated_at: generatedAt,
    recorded_at: "2026-07-13T21:00:01.000Z",
    inserted: true,
    ...overrides,
  };
}
function database(...results: unknown[][]) {
  const execute = vi.fn().mockImplementation(() => Promise.resolve(results.shift() ?? []));
  const transaction = vi.fn(async (callback) => callback({ execute }));
  return { execute, transaction } as unknown as Database;
}

describe("shipment APV receiver claim manifest receipts", () => {
  it("stores the first append-only local manifest receipt", async () => {
    vi.mocked(exportShipmentApvFailureAlertReceiverClaimManifest).mockResolvedValueOnce(
      manifestResult,
    );
    await expect(
      recordShipmentApvFailureAlertReceiverClaimManifestReceipt(database([], [], [], [row()])),
    ).resolves.toMatchObject({
      status: "PERSISTED_LOCAL_MANIFEST_RECEIPT_DRY_RUN",
      revision: 1,
      manifestDigest: digest,
      previousManifestDigest: null,
      replayed: false,
      persistent: true,
      appendOnly: true,
      digestVerified: true,
      containsRawIdentifiers: false,
      externalArchive: false,
      networkDelivered: false,
      productionAccepted: false,
    });
  });

  it("replays the exact existing snapshot without a new revision", async () => {
    vi.mocked(exportShipmentApvFailureAlertReceiverClaimManifest).mockResolvedValueOnce(
      manifestResult,
    );
    const result = await recordShipmentApvFailureAlertReceiverClaimManifestReceipt(
      database([], [row({ inserted: false })]),
    );
    expect(result).toMatchObject({ revision: 1, replayed: true, manifestDigest: digest });
  });

  it("links a changed manifest to the latest revision", async () => {
    vi.mocked(exportShipmentApvFailureAlertReceiverClaimManifest).mockResolvedValueOnce(
      manifestResult,
    );
    const result = await recordShipmentApvFailureAlertReceiverClaimManifestReceipt(
      database(
        [],
        [],
        [{ revision: 1, manifest_digest: previous }],
        [row({ revision: 2, previous_manifest_digest: previous })],
      ),
    );
    expect(result).toMatchObject({ revision: 2, previousManifestDigest: previous });
  });

  it("rejects a conflicting persisted snapshot", async () => {
    vi.mocked(exportShipmentApvFailureAlertReceiverClaimManifest).mockResolvedValueOnce(
      manifestResult,
    );
    await expect(
      recordShipmentApvFailureAlertReceiverClaimManifestReceipt(
        database([], [row({ receipt_digests: ["d".repeat(64)], inserted: false })]),
      ),
    ).rejects.toThrow("SHIPMENT_APV_FAILURE_ALERT_RECEIVER_MANIFEST_RECEIPT_CONFLICT");
  });

  it("fails closed on an invalid latest revision or missing insert result", async () => {
    vi.mocked(exportShipmentApvFailureAlertReceiverClaimManifest).mockResolvedValue(manifestResult);
    await expect(
      recordShipmentApvFailureAlertReceiverClaimManifestReceipt(
        database([], [], [{ revision: "bad", manifest_digest: previous }]),
      ),
    ).rejects.toThrow("SHIPMENT_APV_FAILURE_ALERT_RECEIVER_MANIFEST_RECEIPT_INVALID");
    await expect(
      recordShipmentApvFailureAlertReceiverClaimManifestReceipt(database([], [], [], [])),
    ).rejects.toThrow("SHIPMENT_APV_FAILURE_ALERT_RECEIVER_MANIFEST_RECEIPT_UNAVAILABLE");
  });

  it("propagates export health and limit blockers without inserting", async () => {
    vi.mocked(exportShipmentApvFailureAlertReceiverClaimManifest).mockRejectedValueOnce(
      new Error("SHIPMENT_APV_FAILURE_ALERT_RECEIVER_CLAIM_EXPORT_HEALTH_BLOCKED"),
    );
    const db = database([]);
    await expect(recordShipmentApvFailureAlertReceiverClaimManifestReceipt(db)).rejects.toThrow(
      "SHIPMENT_APV_FAILURE_ALERT_RECEIVER_CLAIM_EXPORT_HEALTH_BLOCKED",
    );
    expect(db.transaction).toHaveBeenCalledOnce();
  });
});
