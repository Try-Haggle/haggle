import type { Database } from "@haggle/db";
import { afterEach, describe, expect, it, vi } from "vitest";
import { runShipmentApvInvoiceRestorationStagingMaintenance } from "../jobs/shipment-apv-invoice-restoration-staging-maintenance.js";
import { maintainShipmentApvInvoiceRestorationStaging } from "../services/shipment-apv-invoice-restoration.service.js";

vi.mock("../services/shipment-apv-invoice-restoration.service.js", () => ({
  maintainShipmentApvInvoiceRestorationStaging: vi.fn(),
}));

const actorId = "99999999-9999-4999-8999-999999999999";
const result = {
  mode: "apply" as const,
  scanned: 1,
  eligible: 1,
  expired: 1,
  preserved: 1,
  resumed: 0,
  sourceMissing: 0,
  conflicts: 0,
  truncated: false,
};

afterEach(() => {
  delete process.env.SHIPMENT_APV_INVOICE_RESTORATION_MAINTENANCE_ACTOR_ID;
  delete process.env.SHIPMENT_APV_INVOICE_RESTORATION_MAINTENANCE_LIMIT;
  vi.clearAllMocks();
});

describe("shipment APV invoice restoration staging maintenance job", () => {
  it("skips without an explicit system actor", async () => {
    await expect(
      runShipmentApvInvoiceRestorationStagingMaintenance({} as Database),
    ).resolves.toEqual({
      status: "skipped",
      reason: "not_configured",
    });
    expect(maintainShipmentApvInvoiceRestorationStaging).not.toHaveBeenCalled();
  });

  it("applies bounded maintenance and reports completed work", async () => {
    vi.mocked(maintainShipmentApvInvoiceRestorationStaging).mockResolvedValueOnce(result);
    await expect(
      runShipmentApvInvoiceRestorationStagingMaintenance({} as Database, {
        actorId,
        limit: 25,
      }),
    ).resolves.toEqual({ status: "completed", reason: undefined, maintenance: result });
    expect(maintainShipmentApvInvoiceRestorationStaging).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ mode: "apply", actorId, limit: 25 }),
    );
  });

  it("converges to a healthy no-op after the queue is empty", async () => {
    vi.mocked(maintainShipmentApvInvoiceRestorationStaging).mockResolvedValueOnce({
      ...result,
      scanned: 0,
      eligible: 0,
      expired: 0,
      preserved: 0,
    });
    await expect(
      runShipmentApvInvoiceRestorationStagingMaintenance({} as Database, { actorId }),
    ).resolves.toMatchObject({
      status: "skipped",
      reason: "healthy",
      maintenance: { eligible: 0 },
    });
  });
});
