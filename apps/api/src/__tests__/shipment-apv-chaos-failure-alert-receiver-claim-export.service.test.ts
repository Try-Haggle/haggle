import { createHash } from "node:crypto";
import type { Database } from "@haggle/db";
import { describe, expect, it, vi } from "vitest";
import { exportShipmentApvFailureAlertReceiverClaimManifest } from "../services/shipment-apv-chaos-failure-alert-receiver-claim-export.service.js";
import { getShipmentApvFailureAlertReceiverClaimHealth } from "../services/shipment-apv-chaos-failure-alert-receiver-claim-health.service.js";

vi.unmock("@haggle/db");
vi.mock("../services/shipment-apv-chaos-failure-alert-receiver-claim-health.service.js", () => ({
  getShipmentApvFailureAlertReceiverClaimHealth: vi.fn().mockResolvedValue({
    status: "healthy",
    criticalCount: 0,
  }),
}));

function database(row: Record<string, unknown>) {
  const execute = vi.fn().mockResolvedValue([row]);
  return { execute } as unknown as Pick<Database, "execute">;
}

const generatedAt = "2026-07-13T21:00:00.000Z";
const domain = "haggle.shipment-apv-failure-alert.receiver-claim-manifest.v1";

describe("shipment APV local receiver claim manifest export", () => {
  it("exports sorted opaque receipt digests with a reproducible manifest digest", async () => {
    const digests = ["a".repeat(64), "b".repeat(64)];
    const expected = createHash("sha256")
      .update(`${domain}:2:${digests.join(",")}`, "utf8")
      .digest("hex");
    await expect(
      exportShipmentApvFailureAlertReceiverClaimManifest(
        database({
          observed_count: 2,
          receipt_digests: digests,
          generated_at: generatedAt,
        }),
      ),
    ).resolves.toEqual({
      schemaVersion: "shipment-apv-failure-alert-receiver-claim-manifest-v1",
      status: "COMPLETE_LOCAL_MANIFEST_DRY_RUN",
      manifestDomain: domain,
      manifestDigest: expected,
      entryCount: 2,
      receiptDigests: digests,
      maxEntries: 1000,
      complete: true,
      healthStatus: "healthy",
      containsRawIdentifiers: false,
      persistent: false,
      externalArchive: false,
      networkDelivered: false,
      productionAccepted: false,
      generatedAt,
    });
  });

  it("exports an empty complete manifest", async () => {
    const result = await exportShipmentApvFailureAlertReceiverClaimManifest(
      database({
        observed_count: 0,
        receipt_digests: [],
        generated_at: generatedAt,
      }),
    );
    expect(result).toMatchObject({ entryCount: 0, receiptDigests: [], complete: true });
    expect(result.manifestDigest).toBe(
      createHash("sha256").update(`${domain}:0:`, "utf8").digest("hex"),
    );
  });

  it("blocks export when health is not clean", async () => {
    vi.mocked(getShipmentApvFailureAlertReceiverClaimHealth).mockResolvedValueOnce({
      status: "critical",
      criticalCount: 1,
    } as Awaited<ReturnType<typeof getShipmentApvFailureAlertReceiverClaimHealth>>);
    const db = database({ observed_count: 0, receipt_digests: [], generated_at: generatedAt });
    await expect(exportShipmentApvFailureAlertReceiverClaimManifest(db)).rejects.toThrow(
      "SHIPMENT_APV_FAILURE_ALERT_RECEIVER_CLAIM_EXPORT_HEALTH_BLOCKED",
    );
    expect(db.execute).not.toHaveBeenCalled();
  });

  it("fails closed on limit overflow, malformed digests or unsorted results", async () => {
    await expect(
      exportShipmentApvFailureAlertReceiverClaimManifest(
        database({
          observed_count: 1001,
          receipt_digests: [],
          generated_at: generatedAt,
        }),
      ),
    ).rejects.toThrow("SHIPMENT_APV_FAILURE_ALERT_RECEIVER_CLAIM_EXPORT_LIMIT_EXCEEDED");
    await expect(
      exportShipmentApvFailureAlertReceiverClaimManifest(
        database({
          observed_count: 1,
          receipt_digests: ["bad"],
          generated_at: generatedAt,
        }),
      ),
    ).rejects.toThrow("SHIPMENT_APV_FAILURE_ALERT_RECEIVER_CLAIM_EXPORT_INVALID");
    await expect(
      exportShipmentApvFailureAlertReceiverClaimManifest(
        database({
          observed_count: 2,
          receipt_digests: ["b".repeat(64), "a".repeat(64)],
          generated_at: generatedAt,
        }),
      ),
    ).rejects.toThrow("SHIPMENT_APV_FAILURE_ALERT_RECEIVER_CLAIM_EXPORT_INVALID");
  });
});
