import { afterEach, describe, expect, it, vi } from "vitest";
import type { Database } from "@haggle/db";
import { runProductionReconciliationReport } from "../jobs/production-reconciliation-report.js";

const collectProductionReconciliationInputMock = vi.fn();
const buildProductionReconciliationReportMock = vi.fn();

vi.mock("../services/production-reconciliation.service.js", () => ({
  collectProductionReconciliationInput: (...args: unknown[]) =>
    collectProductionReconciliationInputMock(...args),
  buildProductionReconciliationReport: (...args: unknown[]) =>
    buildProductionReconciliationReportMock(...args),
}));

describe("production reconciliation report job", () => {
  afterEach(() => {
    vi.unstubAllEnvs();
    vi.restoreAllMocks();
    collectProductionReconciliationInputMock.mockReset();
    buildProductionReconciliationReportMock.mockReset();
  });

  it("collects and returns quietly when there are no findings", async () => {
    const db = {} as Database;
    collectProductionReconciliationInputMock.mockResolvedValue({
      generatedAt: "2026-05-12T00:00:00.000Z",
      shipments: { local: [], provider: [] },
      disputes: { local: [] },
    });
    buildProductionReconciliationReportMock.mockReturnValue({
      reportOnly: true,
      summary: {
        critical: 0,
        warning: 0,
        total: 0,
        payments: 0,
        shipments: 0,
        disputes: 0,
      },
      nextActions: [],
    });
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});

    await runProductionReconciliationReport(db);

    expect(collectProductionReconciliationInputMock).toHaveBeenCalledWith(db, {
      limit: 200,
    });
    expect(buildProductionReconciliationReportMock).toHaveBeenCalledWith({
      generatedAt: "2026-05-12T00:00:00.000Z",
      shipments: { local: [], provider: [] },
      disputes: { local: [] },
    });
    expect(warnSpy).not.toHaveBeenCalled();
  });

  it("emits a bounded report-only warning when findings exist", async () => {
    vi.stubEnv("PRODUCTION_RECONCILIATION_LIMIT", "25");
    const db = {} as Database;
    collectProductionReconciliationInputMock.mockResolvedValue({
      shipments: { local: [], provider: [] },
      disputes: { local: [] },
    });
    buildProductionReconciliationReportMock.mockReturnValue({
      reportOnly: true,
      summary: {
        critical: 1,
        warning: 2,
        total: 3,
        payments: 0,
        shipments: 1,
        disputes: 2,
      },
      nextActions: ["first", "second", "third", "fourth"],
    });
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});

    await runProductionReconciliationReport(db);

    expect(collectProductionReconciliationInputMock).toHaveBeenCalledWith(db, {
      limit: 25,
    });
    expect(warnSpy).toHaveBeenNthCalledWith(
      1,
      "[production-reconciliation] report_only=true critical=1 warning=2 payments=0 shipments=1 disputes=2",
    );
    expect(warnSpy).toHaveBeenNthCalledWith(
      2,
      '[production-reconciliation] next_actions=["first","second","third"]',
    );
  });
});
