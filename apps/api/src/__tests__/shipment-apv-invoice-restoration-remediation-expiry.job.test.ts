import type { Database } from "@haggle/db";
import { afterEach, describe, expect, it, vi } from "vitest";
import { runShipmentApvInvoiceRestorationRemediationExpiry } from "../jobs/shipment-apv-invoice-restoration-remediation-expiry.js";
import { expireShipmentApvInvoiceRestorationRemediations } from "../services/shipment-apv-invoice-restoration-remediation.service.js";

vi.mock("../services/shipment-apv-invoice-restoration-remediation.service.js", () => ({
  expireShipmentApvInvoiceRestorationRemediations: vi.fn(),
}));

afterEach(() => {
  delete process.env.SHIPMENT_APV_INVOICE_RESTORATION_REMEDIATION_EXPIRY_LIMIT;
  vi.clearAllMocks();
});

describe("shipment APV restoration remediation expiry job", () => {
  it("expires a bounded batch without accepting a file or actor", async () => {
    vi.mocked(expireShipmentApvInvoiceRestorationRemediations).mockResolvedValueOnce({
      scanned: 2,
      expired: 2,
      limit: 25,
      truncated: false,
      recordedAt: "2026-07-12T00:00:00.000Z",
    });
    await expect(
      runShipmentApvInvoiceRestorationRemediationExpiry({} as Database, { limit: 25 }),
    ).resolves.toMatchObject({ status: "completed", expiry: { expired: 2, limit: 25 } });
    expect(expireShipmentApvInvoiceRestorationRemediations).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ limit: 25 }),
    );
  });

  it("converges to a healthy no-op", async () => {
    vi.mocked(expireShipmentApvInvoiceRestorationRemediations).mockResolvedValueOnce({
      scanned: 0,
      expired: 0,
      limit: 100,
      truncated: false,
      recordedAt: "2026-07-12T00:00:00.000Z",
    });
    await expect(
      runShipmentApvInvoiceRestorationRemediationExpiry({} as Database),
    ).resolves.toMatchObject({ status: "skipped", reason: "healthy", expiry: { expired: 0 } });
  });
});
