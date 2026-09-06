import type { Database } from "@haggle/db";
import { afterEach, describe, expect, it, vi } from "vitest";
import { runPaymentReconciliationReport } from "../jobs/payment-reconciliation-report.js";

const collectPaymentReconciliationInputMock = vi.fn();
const buildPaymentReconciliationReportMock = vi.fn();
const emitPaymentReconciliationMetricsMock = vi.fn();

vi.mock("../services/payment-reconciliation-report.service.js", () => ({
  collectPaymentReconciliationInput: (...args: unknown[]) =>
    collectPaymentReconciliationInputMock(...args),
  buildPaymentReconciliationReport: (...args: unknown[]) =>
    buildPaymentReconciliationReportMock(...args),
  emitPaymentReconciliationMetrics: (...args: unknown[]) =>
    emitPaymentReconciliationMetricsMock(...args),
}));

describe("payment reconciliation report job", () => {
  afterEach(() => {
    vi.unstubAllEnvs();
    vi.restoreAllMocks();
    collectPaymentReconciliationInputMock.mockReset();
    buildPaymentReconciliationReportMock.mockReset();
    emitPaymentReconciliationMetricsMock.mockReset();
  });

  it("always runs local ledger path and emits metrics even without provider source", async () => {
    const db = {} as Database;
    collectPaymentReconciliationInputMock.mockResolvedValue({
      generatedAt: "2026-09-06T00:00:00.000Z",
      ledger: [{ payment_intent_id: "pi_1" }],
      localPayments: [],
      providerPayments: [],
    });
    buildPaymentReconciliationReportMock.mockReturnValue({
      reportOnly: true,
      summary: {
        critical: 1,
        warning: 1,
        total: 2,
        local_ledger: 2,
        provider: 0,
      },
      nextActions: ["first", "second", "third", "fourth"],
      findings: { local_ledger: [], provider: [] },
    });
    emitPaymentReconciliationMetricsMock.mockResolvedValue(undefined);
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});

    await runPaymentReconciliationReport(db);

    expect(collectPaymentReconciliationInputMock).toHaveBeenCalledWith(db, { limit: 200 });
    expect(buildPaymentReconciliationReportMock).toHaveBeenCalledWith({
      generatedAt: "2026-09-06T00:00:00.000Z",
      ledger: [{ payment_intent_id: "pi_1" }],
      localPayments: [],
      providerPayments: [],
      runProviderCompare: false,
    });
    expect(emitPaymentReconciliationMetricsMock).toHaveBeenCalledTimes(1);
    expect(warnSpy).toHaveBeenNthCalledWith(
      1,
      "[payment-reconciliation] report_only=true critical=1 warning=1 local_ledger=2 provider=0",
    );
    expect(warnSpy).toHaveBeenNthCalledWith(
      2,
      '[payment-reconciliation] next_actions=["first","second","third"]',
    );
  });

  it("returns quietly when there are no findings after emitting zero-open metrics", async () => {
    vi.stubEnv("PAYMENT_RECONCILIATION_REPORT_LIMIT", "25");
    vi.stubEnv("PAYMENT_RECONCILIATION_INCLUDE_PROVIDER_COMPARE", "true");
    const db = {} as Database;
    collectPaymentReconciliationInputMock.mockResolvedValue({
      generatedAt: "2026-09-06T00:00:00.000Z",
      ledger: [],
      localPayments: [],
      providerPayments: [],
    });
    buildPaymentReconciliationReportMock.mockReturnValue({
      reportOnly: true,
      summary: {
        critical: 0,
        warning: 0,
        total: 0,
        local_ledger: 0,
        provider: 0,
      },
      nextActions: [],
      findings: { local_ledger: [], provider: [] },
    });
    emitPaymentReconciliationMetricsMock.mockResolvedValue(undefined);
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});

    await runPaymentReconciliationReport(db);

    expect(collectPaymentReconciliationInputMock).toHaveBeenCalledWith(db, { limit: 25 });
    expect(buildPaymentReconciliationReportMock).toHaveBeenCalledWith({
      generatedAt: "2026-09-06T00:00:00.000Z",
      ledger: [],
      localPayments: [],
      providerPayments: [],
      runProviderCompare: false,
    });
    expect(emitPaymentReconciliationMetricsMock).toHaveBeenCalledTimes(1);
    expect(warnSpy).not.toHaveBeenCalled();
  });
});
