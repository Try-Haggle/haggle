import type { Database } from "@haggle/db";
import { afterEach, describe, expect, it, vi } from "vitest";
import { type PaymentMetricEvent, setPaymentMetricSink } from "../payments/observability.js";
import {
  buildPaymentReconciliationReport,
  collectPaymentReconciliationInput,
  detectLocalPaymentLedgerFindings,
  emitPaymentReconciliationMetrics,
  type PaymentLedgerSnapshot,
} from "../services/payment-reconciliation-report.service.js";

function createCollectDb(options: {
  intents?: unknown[];
  orders?: unknown[];
  refunds?: unknown[];
  releases?: unknown[];
}): Database {
  const intents = options.intents ?? [];
  const orders = options.orders ?? [];
  const refundRows = options.refunds ?? [];
  const releases = options.releases ?? [];
  let selectCount = 0;

  return {
    select: vi.fn(() => {
      selectCount += 1;
      const call = selectCount;
      return {
        from: vi.fn(() => {
          if (call === 1) {
            return {
              orderBy: vi.fn(() => ({
                limit: vi.fn(async () => intents),
              })),
            };
          }
          const rows = call === 2 ? orders : call === 3 ? refundRows : call === 4 ? releases : [];
          return {
            where: vi.fn(async () => rows),
          };
        }),
      };
    }),
  } as unknown as Database;
}

function baseLedger(overrides: Partial<PaymentLedgerSnapshot> = {}): PaymentLedgerSnapshot {
  const paymentIntentId = overrides.payment_intent_id ?? "pi_1";
  const hasReleaseOverride = Object.hasOwn(overrides, "settlement_release_payment_intent_id");
  return {
    order_id: overrides.order_id ?? "ord_1",
    intent_status: "SETTLED",
    intent_canonical_status: "captured",
    intent_amount_minor: 1000,
    intent_selected_rail: "stripe",
    order_status: "PAID",
    order_amount_minor: 1000,
    completed_refund_amount_minor: 0,
    has_completed_refund: false,
    settlement_release_id: "rel_1",
    product_release_status: "PENDING_DELIVERY",
    ...overrides,
    payment_intent_id: paymentIntentId,
    settlement_release_payment_intent_id: hasReleaseOverride
      ? overrides.settlement_release_payment_intent_id
      : paymentIntentId,
  };
}

describe("payment reconciliation report service", () => {
  afterEach(() => {
    vi.unstubAllEnvs();
    vi.restoreAllMocks();
  });

  it("detects local order↔intent↔refund↔release mismatches without provider source", () => {
    const findings = detectLocalPaymentLedgerFindings([
      baseLedger({
        intent_status: "AUTHORIZED",
        intent_canonical_status: "authorized",
        order_status: "PAID",
        settlement_release_id: undefined,
        settlement_release_payment_intent_id: undefined,
        product_release_status: undefined,
      }),
      baseLedger({
        payment_intent_id: "pi_2",
        order_id: "ord_2",
        order_status: "PAYMENT_PENDING",
      }),
      baseLedger({
        payment_intent_id: "pi_3",
        order_id: "ord_3",
        order_status: "REFUNDED",
        has_completed_refund: false,
        completed_refund_amount_minor: 0,
      }),
      baseLedger({
        payment_intent_id: "pi_4",
        order_id: "ord_4",
        completed_refund_amount_minor: 1500,
        has_completed_refund: true,
      }),
      baseLedger({
        payment_intent_id: "pi_5",
        order_id: "ord_5",
        settlement_release_id: undefined,
        settlement_release_payment_intent_id: undefined,
        product_release_status: undefined,
      }),
      baseLedger({
        payment_intent_id: "pi_6",
        order_id: "ord_6",
        product_release_status: "RELEASED",
        order_status: "FULFILLMENT_ACTIVE",
      }),
      baseLedger({
        payment_intent_id: "pi_7",
        order_id: "ord_7",
        settlement_release_payment_intent_id: "pi_other",
      }),
    ]);

    expect(findings.map((finding) => finding.type).sort()).toEqual([
      "completed_refund_exceeds_intent_amount",
      "intent_settled_order_not_paid_like",
      "order_paid_like_intent_not_settled",
      "order_refunded_without_completed_refund",
      "product_released_order_not_terminal",
      "release_intent_order_mismatch",
      "settled_intent_missing_settlement_release",
    ]);
    expect(findings.every((finding) => finding.recommended_action.length > 0)).toBe(true);
  });

  it("builds a report-only summary and optionally includes provider findings", () => {
    const report = buildPaymentReconciliationReport({
      generatedAt: "2026-09-06T00:00:00.000Z",
      ledger: [
        baseLedger({
          intent_status: "AUTHORIZED",
          order_status: "PAID",
          settlement_release_id: undefined,
          settlement_release_payment_intent_id: undefined,
          product_release_status: undefined,
        }),
      ],
      localPayments: [
        {
          payment_intent_id: "pi_1",
          order_id: "ord_1",
          state: "authorized",
          amount_minor: 1000,
          provider_reference: "prov_1",
        },
      ],
      providerPayments: [
        {
          provider_reference: "prov_1",
          state: "captured",
          amount_minor: 1000,
        },
      ],
      runProviderCompare: true,
    });

    expect(report.reportOnly).toBe(true);
    expect(report.summary.local_ledger).toBeGreaterThan(0);
    expect(report.findings.provider.map((finding) => finding.type)).toEqual([
      "provider_captured_local_not_captured",
    ]);
    expect(report.summary.provider).toBe(1);
    expect(report.summary.total).toBe(report.summary.local_ledger + report.summary.provider);
  });

  it("skips provider compare by default so empty provider sets do not emit false capture drift", () => {
    const report = buildPaymentReconciliationReport({
      ledger: [baseLedger()],
      localPayments: [
        {
          payment_intent_id: "pi_1",
          order_id: "ord_1",
          state: "captured",
          amount_minor: 1000,
          provider_reference: "prov_1",
        },
      ],
      providerPayments: [],
      runProviderCompare: false,
    });

    expect(report.findings.provider).toEqual([]);
    expect(report.summary.local_ledger).toBe(0);
  });

  it("collects ledger snapshots from local tables without mutating state", async () => {
    const db = createCollectDb({
      intents: [
        {
          id: "pi_1",
          orderId: "ord_1",
          status: "SETTLED",
          canonicalStatus: "captured",
          selectedRail: "stripe",
          amountMinor: "1000",
        },
      ],
      orders: [
        {
          id: "ord_1",
          status: "PAID",
          amountMinor: "1000",
        },
      ],
      refunds: [
        {
          paymentIntentId: "pi_1",
          status: "COMPLETED",
          amountMinor: "250",
        },
      ],
      releases: [
        {
          id: "rel_1",
          orderId: "ord_1",
          paymentIntentId: "pi_1",
          productReleaseStatus: "PENDING_DELIVERY",
        },
      ],
    });

    const input = await collectPaymentReconciliationInput(db, {
      limit: 10,
      generatedAt: "2026-09-06T00:00:00.000Z",
    });

    expect(input.generatedAt).toBe("2026-09-06T00:00:00.000Z");
    expect(input.ledger).toEqual([
      {
        payment_intent_id: "pi_1",
        order_id: "ord_1",
        intent_status: "SETTLED",
        intent_canonical_status: "captured",
        intent_amount_minor: 1000,
        intent_selected_rail: "stripe",
        order_status: "PAID",
        order_amount_minor: 1000,
        completed_refund_amount_minor: 250,
        has_completed_refund: true,
        settlement_release_id: "rel_1",
        settlement_release_payment_intent_id: "pi_1",
        product_release_status: "PENDING_DELIVERY",
      },
    ]);
    expect(input.localPayments).toEqual([
      {
        payment_intent_id: "pi_1",
        order_id: "ord_1",
        state: "partially_refunded",
        amount_minor: 1000,
        refunded_amount_minor: 250,
      },
    ]);
    expect(input.providerPayments).toEqual([]);
  });

  it("emits payment.reconciliation.finding and drift_open metrics without PAN or ids", async () => {
    const events: PaymentMetricEvent[] = [];
    const restore = setPaymentMetricSink((event) => {
      events.push(event);
    });

    try {
      await emitPaymentReconciliationMetrics(
        {
          generatedAt: "2026-09-06T00:00:00.000Z",
          reportOnly: true,
          summary: {
            critical: 1,
            warning: 0,
            total: 1,
            local_ledger: 1,
            provider: 0,
          },
          findings: {
            local_ledger: [
              {
                type: "order_paid_like_intent_not_settled",
                severity: "critical",
                payment_intent_id: "pi_1",
                order_id: "ord_1",
                message: "Order looks paid/fulfillable but payment intent is not SETTLED.",
                recommended_action: "Compare order status with intent rows.",
              },
            ],
            provider: [],
          },
          nextActions: ["Compare order status with intent rows."],
        },
        { environment: "test" },
      );
    } finally {
      restore();
    }

    expect(events.map((event) => event.name).sort()).toEqual([
      "payment.reconciliation.drift_open",
      "payment.reconciliation.finding",
    ]);
    for (const event of events) {
      expect(event.dimensions.environment).toBe("test");
      expect(event.dimensions.reconciliation_type).toBe("order_paid_like_intent_not_settled");
      expect(JSON.stringify(event)).not.toMatch(/pi_1|ord_1|\d{13,}/);
    }
  });
});
