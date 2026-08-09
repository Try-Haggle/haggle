import type { Database } from "@haggle/db";
import Fastify from "fastify";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { registerSettlementReleaseRoutes } from "../routes/settlement-releases.js";
import { getActiveDisputeByOrderId } from "../services/dispute-record.service.js";
import { getCommerceOrderByOrderId } from "../services/payment-record.service.js";
import {
  getSettlementReleaseById,
  getSettlementReleaseByOrderId,
  updateSettlementReleaseRecord,
} from "../services/settlement-release.service.js";
import {
  decideShipmentApvPayoutCancellation,
  getShipmentApvPayoutCancellationTimeline,
  listPendingShipmentApvPayoutCancellations,
  requestShipmentApvPayoutCancellation,
} from "../services/shipment-apv-payout-cancellation.service.js";
import {
  enqueueShipmentApvCancellationAuditArchive,
  getShipmentApvCancellationAuditArchiveHealth,
  getShipmentApvCancellationAuditArchiveStatus,
  listShipmentApvCancellationAuditArchiveFailures,
  requeueShipmentApvCancellationAuditArchive,
} from "../services/shipment-apv-payout-cancellation-audit-archive.service.js";
import { createSignedShipmentApvPayoutCancellationAuditExport } from "../services/shipment-apv-payout-cancellation-audit-export.service.js";
import { getShipmentByOrderId } from "../services/shipment-record.service.js";

vi.mock("../services/payment-record.service.js", () => ({
  getCommerceOrderByOrderId: vi.fn(),
  createPaymentSettlementRecord: vi.fn(),
  getPaymentIntentById: vi.fn(),
  getPaymentIntentRowById: vi.fn(),
  updateStoredPaymentIntent: vi.fn(),
}));

vi.mock("../services/settlement-release.service.js", () => ({
  createSettlementReleaseRecord: vi.fn(),
  getSettlementReleaseById: vi.fn(),
  getSettlementReleaseByOrderId: vi.fn(),
  updateSettlementReleaseRecord: vi.fn(),
}));

vi.mock("../services/dispute-record.service.js", () => ({
  getActiveDisputeByOrderId: vi.fn(),
}));

vi.mock("../services/shipment-record.service.js", () => ({
  getShipmentByOrderId: vi.fn(),
}));

vi.mock("../services/trust-ledger.service.js", () => ({
  applyTrustTriggers: vi.fn(),
}));

vi.mock("../services/admin-action-log.service.js", () => ({
  writeAuditLog: vi.fn().mockResolvedValue(undefined),
}));

vi.mock("../payments/settlement-signer.js", () => ({
  createConditionalReleaseSigner: vi.fn(),
}));

vi.mock("../services/shipment-apv-payout-offset.service.js", () => ({
  reserveShipmentApvPayoutOffset: vi.fn().mockResolvedValue({ outcome: "not_found" }),
  bindShipmentApvPayoutOffsetSignature: vi.fn().mockResolvedValue({ outcome: "bound" }),
  cancelExpiredShipmentApvPayoutOffset: vi.fn().mockResolvedValue({ outcome: "not_found" }),
  completeShipmentApvPayoutOffset: vi.fn().mockResolvedValue({ outcome: "not_found" }),
}));

vi.mock("../services/shipment-apv-payout-cancellation.service.js", () => ({
  requestShipmentApvPayoutCancellation: vi.fn(),
  decideShipmentApvPayoutCancellation: vi.fn(),
  getShipmentApvPayoutCancellationTimeline: vi.fn(),
  listPendingShipmentApvPayoutCancellations: vi
    .fn()
    .mockResolvedValue({ items: [], nextCursor: null, recordedAt: "2026-07-12T00:00:00.000Z" }),
}));

vi.mock("../services/shipment-apv-payout-cancellation-audit-export.service.js", () => ({
  ShipmentApvCancellationAuditSigningNotConfiguredError: class extends Error {},
  createSignedShipmentApvPayoutCancellationAuditExport: vi.fn().mockReturnValue({
    manifest: {
      schema: "haggle.shipment-apv-payout-cancellation-audit.v1",
      chain_valid: true,
      event_count: 1,
    },
    events: [],
    signature: {
      algorithm: "Ed25519",
      key_id: "test-key",
      public_key_spki_base64: "key",
      value_base64: "signature",
    },
  }),
}));

vi.mock("../services/shipment-apv-payout-cancellation-audit-archive.service.js", () => ({
  enqueueShipmentApvCancellationAuditArchive: vi.fn(),
  getShipmentApvCancellationAuditArchiveHealth: vi.fn(),
  getShipmentApvCancellationAuditArchiveDeliveryPolicyStatus: vi.fn(() => ({
    configured: false,
    configurationState: "not_configured",
    jobEnabled: false,
    unfinishedMaxAgeMinutes: 15,
  })),
  getShipmentApvCancellationAuditArchiveStatus: vi.fn(),
  listShipmentApvCancellationAuditArchiveFailures: vi.fn(),
  requeueShipmentApvCancellationAuditArchive: vi.fn(),
}));

vi.mock("../services/shipment-apv-payout-cancellation-audit-archive-alert.service.js", () => ({
  getShipmentApvCancellationAuditArchiveAlertPolicyStatus: vi.fn(() => ({
    configured: false,
    configurationState: "not_configured",
    jobEnabled: false,
    cooldownMinutes: 15,
    staleThreshold: 1,
    retryReadyThreshold: 5,
    deadLetterThreshold: 1,
    overdueUnfinishedThreshold: 1,
  })),
}));

const mockGetCommerceOrderByOrderId = vi.mocked(getCommerceOrderByOrderId);
const mockGetSettlementReleaseById = vi.mocked(getSettlementReleaseById);
const mockGetSettlementReleaseByOrderId = vi.mocked(getSettlementReleaseByOrderId);
const mockUpdateSettlementReleaseRecord = vi.mocked(updateSettlementReleaseRecord);
const mockGetActiveDisputeByOrderId = vi.mocked(getActiveDisputeByOrderId);
const mockGetShipmentByOrderId = vi.mocked(getShipmentByOrderId);
const mockRequestPayoutCancellation = vi.mocked(requestShipmentApvPayoutCancellation);
const mockDecidePayoutCancellation = vi.mocked(decideShipmentApvPayoutCancellation);
const mockListPayoutCancellations = vi.mocked(listPendingShipmentApvPayoutCancellations);
const mockGetPayoutCancellationTimeline = vi.mocked(getShipmentApvPayoutCancellationTimeline);
const mockCreateCancellationAuditExport = vi.mocked(
  createSignedShipmentApvPayoutCancellationAuditExport,
);
const mockEnqueueCancellationAuditArchive = vi.mocked(enqueueShipmentApvCancellationAuditArchive);
const mockGetCancellationAuditArchive = vi.mocked(getShipmentApvCancellationAuditArchiveStatus);
const mockGetCancellationAuditArchiveHealth = vi.mocked(
  getShipmentApvCancellationAuditArchiveHealth,
);
const mockRequeueCancellationAuditArchive = vi.mocked(requeueShipmentApvCancellationAuditArchive);
const mockListCancellationAuditArchiveFailures = vi.mocked(
  listShipmentApvCancellationAuditArchiveFailures,
);

const release = {
  id: "release_1",
  payment_intent_id: "payment_1",
  order_id: "order_1",
  product_amount: { currency: "USDC", amount_minor: 10_000_000 },
  product_release_status: "BUYER_REVIEW",
  buffer_amount: { currency: "USDC", amount_minor: 0 },
  buffer_release_status: "HELD",
  apv_adjustment_minor: 0,
  delivery_confirmed_at: "2026-06-30T00:00:00.000Z",
  buyer_review_deadline: "2026-07-01T00:00:00.000Z",
  created_at: "2026-06-30T00:00:00.000Z",
  updated_at: "2026-06-30T00:00:00.000Z",
} as const;

function makeApp(user = { id: "buyer_1", role: "authenticated" }) {
  const app = Fastify();
  app.addHook("onRequest", async (request) => {
    request.user = user;
  });
  const db = {} as Database;
  Object.assign(db, {
    transaction: async (operation: (tx: Database) => Promise<unknown>) => operation(db),
  });
  registerSettlementReleaseRoutes(app, db);
  return app;
}

beforeEach(() => {
  vi.clearAllMocks();
  mockGetCommerceOrderByOrderId.mockResolvedValue({
    id: "order_1",
    status: "IN_DISPUTE",
    buyerId: "buyer_1",
    sellerId: "seller_1",
  } as never);
  mockGetSettlementReleaseById.mockResolvedValue(release as never);
  mockGetSettlementReleaseByOrderId.mockResolvedValue(release as never);
  mockGetActiveDisputeByOrderId.mockResolvedValue({
    id: "dispute_1",
    order_id: "order_1",
    reason_code: "ITEM_NOT_AS_DESCRIBED",
    status: "OPEN",
    opened_by: "buyer",
    opened_at: "2026-06-30T00:00:00.000Z",
    evidence: [],
    metadata: null,
  } as never);
});

describe("settlement release dispute guard", () => {
  it("disables the legacy admin APV mutation that bypasses the provider ledger", async () => {
    const app = makeApp({ id: "admin_1", role: "admin" });
    const res = await app.inject({
      method: "POST",
      url: "/settlement-releases/release_1/apply-adjustment",
      payload: { adjustment_minor: 999_999 },
    });

    expect(res.statusCode).toBe(410);
    expect(res.json()).toMatchObject({ error: "DIRECT_APV_ADJUSTMENT_DISABLED" });
    expect(mockUpdateSettlementReleaseRecord).not.toHaveBeenCalled();
    await app.close();
  });

  it("disables direct payout cancellation in favor of maker-checker approval", async () => {
    const app = makeApp({ id: "99999999-9999-4999-8999-999999999999", role: "admin" });
    const res = await app.inject({
      method: "POST",
      url: "/settlement-releases/22222222-2222-4222-8222-222222222222/apv-payout-offsets/33333333-3333-4333-8333-333333333333/cancel-expired",
      payload: { reason: "A direct cancellation must no longer be accepted by the API." },
    });
    expect(res.statusCode).toBe(410);
    expect(res.json()).toMatchObject({ error: "APV_PAYOUT_CANCELLATION_APPROVAL_REQUIRED" });
    await app.close();
  });

  it("allows an admin maker to create an idempotent payout cancellation request", async () => {
    mockRequestPayoutCancellation.mockResolvedValueOnce({
      outcome: "requested",
      request: {
        id: "44444444-4444-4444-8444-444444444444",
        client_request_id: "55555555-5555-4555-8555-555555555555",
        payout_offset_id: "33333333-3333-4333-8333-333333333333",
        settlement_release_id: "22222222-2222-4222-8222-222222222222",
        requester_id: "99999999-9999-4999-8999-999999999999",
        reason: "The expired signature was not executed and requires checker approval.",
        status: "PENDING",
        version: 0,
        expires_at: "2026-07-12T01:00:00.000Z",
        created_at: "2026-07-12T00:30:00.000Z",
      },
    });
    const app = makeApp({ id: "99999999-9999-4999-8999-999999999999", role: "admin" });
    const res = await app.inject({
      method: "POST",
      url: "/settlement-releases/22222222-2222-4222-8222-222222222222/apv-payout-offsets/33333333-3333-4333-8333-333333333333/cancellation-requests",
      payload: {
        client_request_id: "55555555-5555-4555-8555-555555555555",
        reason: "The expired signature was not executed and requires checker approval.",
      },
    });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toMatchObject({
      cancellation_request: { status: "PENDING", version: 0 },
      idempotent: false,
    });
    expect(mockRequestPayoutCancellation).toHaveBeenCalledOnce();
    await app.close();
  });

  it("maps maker self-approval to a forbidden decision", async () => {
    mockDecidePayoutCancellation.mockResolvedValueOnce({ outcome: "self_approval_forbidden" });
    const app = makeApp({ id: "99999999-9999-4999-8999-999999999999", role: "admin" });
    const res = await app.inject({
      method: "POST",
      url: "/settlement-releases/22222222-2222-4222-8222-222222222222/apv-payout-offsets/33333333-3333-4333-8333-333333333333/cancellation-requests/44444444-4444-4444-8444-444444444444/decision",
      payload: {
        decision_request_id: "66666666-6666-4666-8666-666666666666",
        decision: "REJECT",
        reason: "The original requester cannot decide the same cancellation request.",
        expected_version: 0,
      },
    });
    expect(res.statusCode).toBe(403);
    expect(res.json()).toMatchObject({ error: "APV_PAYOUT_CANCELLATION_SELF_APPROVAL_FORBIDDEN" });
    await app.close();
  });

  it("passes bounded pagination to the admin cancellation approval queue", async () => {
    const app = makeApp({ id: "99999999-9999-4999-8999-999999999999", role: "admin" });
    const res = await app.inject({
      method: "GET",
      url: "/admin/settlement-releases/apv-payout-cancellation-requests/pending?limit=1&cursor=opaque-cursor",
    });
    expect(res.statusCode).toBe(200);
    expect(mockListPayoutCancellations).toHaveBeenCalledWith(expect.anything(), {
      limit: 1,
      cursor: "opaque-cursor",
    });
    await app.close();
  });

  it("rejects malformed cancellation approval cursors without returning a server error", async () => {
    mockListPayoutCancellations.mockRejectedValueOnce(
      new Error("INVALID_APV_PAYOUT_CANCELLATION_CURSOR"),
    );
    const app = makeApp({ id: "99999999-9999-4999-8999-999999999999", role: "admin" });
    const res = await app.inject({
      method: "GET",
      url: "/admin/settlement-releases/apv-payout-cancellation-requests/pending?cursor=malformed",
    });
    expect(res.statusCode).toBe(400);
    expect(res.json()).toMatchObject({ error: "INVALID_APV_PAYOUT_CANCELLATION_CURSOR" });
    await app.close();
  });

  it("returns the bounded cancellation lifecycle timeline to an admin", async () => {
    mockGetPayoutCancellationTimeline.mockResolvedValueOnce({
      request: {
        id: "44444444-4444-4444-8444-444444444444",
        status: "REJECTED",
        requester_id: "99999999-9999-4999-8999-999999999999",
        approver_id: "88888888-8888-4888-8888-888888888888",
        created_at: "2026-07-12T00:00:00.000Z",
        decided_at: "2026-07-12T00:01:00.000Z",
      },
      events: [
        {
          id: "77777777-7777-4777-8777-777777777777",
          cancellation_request_id: "44444444-4444-4444-8444-444444444444",
          event_type: "REJECTED",
          actor_id: "88888888-8888-4888-8888-888888888888",
          request_version: 1,
          metadata: {},
          previous_event_hash: null,
          event_hash: "a".repeat(64),
          created_at: "2026-07-12T00:01:00.000Z",
        },
      ],
      integrity: {
        valid: true,
        complete: true,
        sealedEvents: 1,
        legacyUnsealedEvents: 0,
        headEventHash: "a".repeat(64),
      },
    });
    const app = makeApp({ id: "99999999-9999-4999-8999-999999999999", role: "admin" });
    const res = await app.inject({
      method: "GET",
      url: "/admin/settlement-releases/apv-payout-cancellation-requests/44444444-4444-4444-8444-444444444444/timeline",
    });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toMatchObject({
      cancellation_timeline: {
        request: { status: "REJECTED" },
        events: [{ event_type: "REJECTED" }],
      },
    });
    await app.close();
  });

  it("blocks non-admin lifecycle timeline access", async () => {
    const app = makeApp();
    const res = await app.inject({
      method: "GET",
      url: "/admin/settlement-releases/apv-payout-cancellation-requests/44444444-4444-4444-8444-444444444444/timeline",
    });
    expect(res.statusCode).toBe(403);
    expect(mockGetPayoutCancellationTimeline).not.toHaveBeenCalled();
    await app.close();
  });

  it("returns a signed cancellation audit export only for a valid chain", async () => {
    mockGetPayoutCancellationTimeline.mockResolvedValueOnce({
      request: {
        id: "44444444-4444-4444-8444-444444444444",
        status: "PENDING",
        requester_id: "99999999-9999-4999-8999-999999999999",
        approver_id: null,
        created_at: "2026-07-12T00:00:00.000Z",
        decided_at: null,
      },
      events: [
        {
          id: "77777777-7777-4777-8777-777777777777",
          cancellation_request_id: "44444444-4444-4444-8444-444444444444",
          event_type: "REQUESTED",
          actor_id: "99999999-9999-4999-8999-999999999999",
          request_version: 0,
          metadata: {},
          previous_event_hash: null,
          event_hash: "a".repeat(64),
          created_at: "2026-07-12T00:00:00.000Z",
        },
      ],
      integrity: {
        valid: true,
        complete: true,
        sealedEvents: 1,
        legacyUnsealedEvents: 0,
        headEventHash: "a".repeat(64),
      },
    });
    const app = makeApp({ id: "99999999-9999-4999-8999-999999999999", role: "admin" });
    const res = await app.inject({
      method: "GET",
      url: "/admin/settlement-releases/apv-payout-cancellation-requests/44444444-4444-4444-8444-444444444444/audit-export",
    });
    expect(res.statusCode).toBe(200);
    expect(res.headers["content-disposition"]).toContain("haggle-apv-cancellation-44444444");
    expect(mockCreateCancellationAuditExport).toHaveBeenCalledOnce();
    await app.close();
  });

  it("refuses to sign a cancellation audit export with a broken chain", async () => {
    mockGetPayoutCancellationTimeline.mockResolvedValueOnce({
      request: {
        id: "44444444-4444-4444-8444-444444444444",
        status: "PENDING",
        requester_id: "99999999-9999-4999-8999-999999999999",
        approver_id: null,
        created_at: "2026-07-12T00:00:00.000Z",
        decided_at: null,
      },
      events: [],
      integrity: {
        valid: false,
        complete: false,
        sealedEvents: 0,
        legacyUnsealedEvents: 0,
        headEventHash: null,
      },
    });
    const app = makeApp({ id: "99999999-9999-4999-8999-999999999999", role: "admin" });
    const res = await app.inject({
      method: "GET",
      url: "/admin/settlement-releases/apv-payout-cancellation-requests/44444444-4444-4444-8444-444444444444/audit-export",
    });
    expect(res.statusCode).toBe(409);
    expect(res.json()).toMatchObject({ error: "APV_PAYOUT_CANCELLATION_AUDIT_CHAIN_INVALID" });
    expect(mockCreateCancellationAuditExport).not.toHaveBeenCalled();
    await app.close();
  });

  it("enqueues one signed audit archive without exposing the stored payload", async () => {
    const event = {
      id: "77777777-7777-4777-8777-777777777777",
      cancellation_request_id: "44444444-4444-4444-8444-444444444444",
      event_type: "REJECTED" as const,
      actor_id: "99999999-9999-4999-8999-999999999999",
      request_version: 1,
      metadata: {},
      previous_event_hash: null,
      event_hash: "a".repeat(64),
      created_at: "2026-07-12T00:00:00.000Z",
    };
    mockGetPayoutCancellationTimeline.mockResolvedValueOnce({
      request: {
        id: event.cancellation_request_id,
        status: "REJECTED",
        requester_id: event.actor_id,
        approver_id: "88888888-8888-4888-8888-888888888888",
        created_at: event.created_at,
        decided_at: event.created_at,
      },
      events: [event],
      integrity: {
        valid: true,
        complete: true,
        sealedEvents: 1,
        legacyUnsealedEvents: 0,
        headEventHash: event.event_hash,
      },
    });
    mockEnqueueCancellationAuditArchive.mockResolvedValueOnce({
      outcome: "enqueued",
      archive: {
        id: "88888888-8888-4888-8888-888888888888",
        archiveKey: `apvca_${"b".repeat(64)}`,
        cancellationRequestId: event.cancellation_request_id,
        payload: { secret: "must-not-be-returned" },
        payloadSha256: "c".repeat(64),
        status: "PENDING",
        attemptCount: 0,
        nextAttemptAt: event.created_at,
        leaseToken: null,
        leaseExpiresAt: null,
        lastError: null,
        httpStatus: null,
        receiptId: null,
        receiptSha256: null,
        deliveredAt: null,
        createdAt: event.created_at,
        updatedAt: event.created_at,
      },
    });
    const app = makeApp({ id: "99999999-9999-4999-8999-999999999999", role: "admin" });
    const res = await app.inject({
      method: "POST",
      url: `/admin/settlement-releases/apv-payout-cancellation-requests/${event.cancellation_request_id}/audit-archive`,
    });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toMatchObject({
      audit_archive: { status: "PENDING", payload_sha256: "c".repeat(64) },
      idempotent: false,
    });
    expect(res.body).not.toContain("must-not-be-returned");
    await app.close();
  });

  it("returns the latest archive receipt status to an admin", async () => {
    mockGetCancellationAuditArchive.mockResolvedValueOnce({
      id: "88888888-8888-4888-8888-888888888888",
      archiveKey: `apvca_${"b".repeat(64)}`,
      cancellationRequestId: "44444444-4444-4444-8444-444444444444",
      payload: {},
      payloadSha256: "c".repeat(64),
      status: "DELIVERED",
      attemptCount: 1,
      nextAttemptAt: "2026-07-12T00:00:00.000Z",
      leaseToken: null,
      leaseExpiresAt: null,
      lastError: null,
      httpStatus: 201,
      receiptId: "worm_receipt_1",
      receiptSha256: "c".repeat(64),
      deliveredAt: "2026-07-12T00:01:00.000Z",
      createdAt: "2026-07-12T00:00:00.000Z",
      updatedAt: "2026-07-12T00:01:00.000Z",
    });
    const app = makeApp({ id: "99999999-9999-4999-8999-999999999999", role: "admin" });
    const res = await app.inject({
      method: "GET",
      url: "/admin/settlement-releases/apv-payout-cancellation-requests/44444444-4444-4444-8444-444444444444/audit-archive",
    });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toMatchObject({
      audit_archive: { status: "DELIVERED", receipt_id: "worm_receipt_1" },
    });
    await app.close();
  });

  it("returns aggregate archive health only to an admin", async () => {
    mockGetCancellationAuditArchiveHealth.mockResolvedValueOnce({
      status: "attention",
      pending: 2,
      processing: 1,
      failed: 1,
      deadLetter: 0,
      staleProcessing: 1,
      retryReady: 1,
      oldestUnfinishedAgeSeconds: 900,
      overdueUnfinished: 1,
      unfinishedMaxAgeMinutes: 15,
      recordedAt: "2026-07-12T00:00:00.000Z",
    });
    const path = "/admin/settlement-releases/apv-payout-cancellation-audit-archives/health";
    const admin = makeApp({ id: "99999999-9999-4999-8999-999999999999", role: "admin" });
    const response = await admin.inject({ method: "GET", url: path });
    expect(response.statusCode).toBe(200);
    expect(response.json()).toMatchObject({
      audit_archive_health: {
        status: "attention",
        pending: 2,
        staleProcessing: 1,
        overdueUnfinished: 1,
      },
      archive_delivery: { configured: false },
      alerting: { configured: false },
    });
    expect(response.body).not.toMatch(/request_id|archive_key|receipt_id/);
    await admin.close();
    const buyer = makeApp();
    expect((await buyer.inject({ method: "GET", url: path })).statusCode).toBe(403);
    await buyer.close();
  });

  it("requeues a failed archive as an audited admin action", async () => {
    mockRequeueCancellationAuditArchive.mockResolvedValueOnce({
      outcome: "requeued",
      archive: {
        id: "88888888-8888-4888-8888-888888888888",
        archiveKey: `apvca_${"b".repeat(64)}`,
        cancellationRequestId: "44444444-4444-4444-8444-444444444444",
        payload: {},
        payloadSha256: "c".repeat(64),
        status: "PENDING",
        attemptCount: 0,
        nextAttemptAt: "2026-07-12T00:00:00.000Z",
        leaseToken: null,
        leaseExpiresAt: null,
        lastError: null,
        httpStatus: null,
        receiptId: null,
        receiptSha256: null,
        deliveredAt: null,
        createdAt: "2026-07-12T00:00:00.000Z",
        updatedAt: "2026-07-12T00:00:00.000Z",
      },
    });
    const app = makeApp({ id: "99999999-9999-4999-8999-999999999999", role: "admin" });
    const response = await app.inject({
      method: "POST",
      url: "/admin/settlement-releases/apv-payout-cancellation-requests/44444444-4444-4444-8444-444444444444/audit-archive/retry",
      payload: { reason: "Retry after the external archive endpoint recovered." },
    });
    expect(response.statusCode).toBe(200);
    expect(response.json()).toMatchObject({
      outcome: "requeued",
      audit_archive: { status: "PENDING", attempt_count: 0 },
    });
    expect(mockRequeueCancellationAuditArchive).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ actorId: "99999999-9999-4999-8999-999999999999" }),
    );
    await app.close();
  });

  it("lists failed archives only for administrators without payloads", async () => {
    mockListCancellationAuditArchiveFailures.mockResolvedValueOnce({
      items: [
        {
          id: "88888888-8888-4888-8888-888888888888",
          cancellationRequestId: "44444444-4444-4444-8444-444444444444",
          payloadSha256: "c".repeat(64),
          status: "DEAD_LETTER",
          attemptCount: 3,
          nextAttemptAt: "2026-07-12T00:00:00.000Z",
          lastError: "HTTP 503",
          httpStatus: 503,
          createdAt: "2026-07-12T00:00:00.000Z",
          updatedAt: "2026-07-12T00:01:00.000Z",
          failureAgeSeconds: 60,
        },
      ],
      nextCursor: null,
      recordedAt: "2026-07-12T00:02:00.000Z",
    });
    const path =
      "/admin/settlement-releases/apv-payout-cancellation-audit-archives/failures?limit=20";
    const admin = makeApp({ id: "99999999-9999-4999-8999-999999999999", role: "admin" });
    const response = await admin.inject({ method: "GET", url: path });
    expect(response.statusCode).toBe(200);
    expect(response.json()).toMatchObject({
      audit_archive_failures: { items: [{ status: "DEAD_LETTER", attemptCount: 3 }] },
    });
    expect(response.body).not.toContain('payload"');
    await admin.close();
    const buyer = makeApp();
    expect((await buyer.inject({ method: "GET", url: path })).statusCode).toBe(403);
    await buyer.close();
  });

  it("blocks buyer confirmation while the order is in dispute", async () => {
    const app = makeApp();
    const res = await app.inject({
      method: "POST",
      url: "/settlement-releases/by-order/order_1/buyer-confirm",
    });

    expect(res.statusCode).toBe(409);
    expect(res.json()).toMatchObject({ error: "ORDER_IN_DISPUTE" });
    expect(mockUpdateSettlementReleaseRecord).not.toHaveBeenCalled();
    await app.close();
  });

  it("blocks buyer confirmation when an active dispute exists even before order status catches up", async () => {
    mockGetCommerceOrderByOrderId.mockResolvedValueOnce({
      id: "order_1",
      status: "DELIVERED",
      buyerId: "buyer_1",
      sellerId: "seller_1",
    } as never);
    const app = makeApp();
    const res = await app.inject({
      method: "POST",
      url: "/settlement-releases/by-order/order_1/buyer-confirm",
    });

    expect(res.statusCode).toBe(409);
    expect(res.json()).toMatchObject({ error: "ORDER_IN_DISPUTE" });
    expect(mockUpdateSettlementReleaseRecord).not.toHaveBeenCalled();
    await app.close();
  });

  it("lets the seller finalize a verified EasyPost test buffer only in Base Sepolia staging", async () => {
    const previous = {
      haggleEnv: process.env.HAGGLE_ENV,
      network: process.env.HAGGLE_X402_NETWORK,
      assetProfile: process.env.HAGGLE_SETTLEMENT_ASSET_PROFILE,
      easypostKey: process.env.EASYPOST_API_KEY,
    };
    process.env.HAGGLE_ENV = "staging";
    process.env.HAGGLE_X402_NETWORK = "base-sepolia";
    process.env.HAGGLE_SETTLEMENT_ASSET_PROFILE = "base-sepolia-husdc";
    process.env.EASYPOST_API_KEY = "EZTK_test_key";
    mockGetCommerceOrderByOrderId.mockResolvedValue({
      id: "order_1",
      status: "CLOSED",
      buyerId: "buyer_1",
      sellerId: "seller_1",
    } as never);
    mockGetActiveDisputeByOrderId.mockResolvedValue(null);
    mockGetSettlementReleaseByOrderId.mockResolvedValue({
      ...release,
      product_release_status: "RELEASED",
      product_released_at: "2026-07-01T00:00:00.000Z",
    } as never);
    mockGetShipmentByOrderId.mockResolvedValue({
      id: "shipment_1",
      order_id: "order_1",
      status: "DELIVERED",
      metadata: {
        easypost_test_tracker: {
          easypost_test_status_verified: true,
          requested_status: "delivered",
          easypost_tracker_id: "trk_delivered",
          easypost_test_tracking_code: "EZ4000000004",
        },
      },
    } as never);
    const app = makeApp({ id: "seller_1", role: "authenticated" });

    try {
      const res = await app.inject({
        method: "POST",
        url: "/settlement-releases/by-order/order_1/complete-test-buffer",
      });

      expect(res.statusCode).toBe(200);
      expect(res.json()).toMatchObject({
        release: { buffer_release_status: "RELEASED" },
        phase: "FULLY_RELEASED",
        provider_verification: {
          provider: "easypost",
          mode: "test",
          tracker_id: "trk_delivered",
        },
      });
      expect(mockUpdateSettlementReleaseRecord).toHaveBeenCalledWith(
        expect.anything(),
        expect.objectContaining({ buffer_release_status: "RELEASED" }),
      );
    } finally {
      await app.close();
      if (previous.haggleEnv === undefined) delete process.env.HAGGLE_ENV;
      else process.env.HAGGLE_ENV = previous.haggleEnv;
      if (previous.network === undefined) delete process.env.HAGGLE_X402_NETWORK;
      else process.env.HAGGLE_X402_NETWORK = previous.network;
      if (previous.assetProfile === undefined) delete process.env.HAGGLE_SETTLEMENT_ASSET_PROFILE;
      else process.env.HAGGLE_SETTLEMENT_ASSET_PROFILE = previous.assetProfile;
      if (previous.easypostKey === undefined) delete process.env.EASYPOST_API_KEY;
      else process.env.EASYPOST_API_KEY = previous.easypostKey;
    }
  });

  it("hides test buffer completion when staging is not using the hUSDC asset profile", async () => {
    const previous = {
      haggleEnv: process.env.HAGGLE_ENV,
      network: process.env.HAGGLE_X402_NETWORK,
      assetProfile: process.env.HAGGLE_SETTLEMENT_ASSET_PROFILE,
      easypostKey: process.env.EASYPOST_API_KEY,
    };
    process.env.HAGGLE_ENV = "staging";
    process.env.HAGGLE_X402_NETWORK = "base-sepolia";
    process.env.HAGGLE_SETTLEMENT_ASSET_PROFILE = "base-sepolia-usdc";
    process.env.EASYPOST_API_KEY = "EZTK_test_key";
    const app = makeApp({ id: "seller_1", role: "authenticated" });

    try {
      const res = await app.inject({
        method: "POST",
        url: "/settlement-releases/by-order/order_1/complete-test-buffer",
      });

      expect(res.statusCode).toBe(404);
      expect(res.json()).toMatchObject({ error: "TEST_BUFFER_COMPLETION_NOT_AVAILABLE" });
      expect(mockUpdateSettlementReleaseRecord).not.toHaveBeenCalled();
    } finally {
      await app.close();
      if (previous.haggleEnv === undefined) delete process.env.HAGGLE_ENV;
      else process.env.HAGGLE_ENV = previous.haggleEnv;
      if (previous.network === undefined) delete process.env.HAGGLE_X402_NETWORK;
      else process.env.HAGGLE_X402_NETWORK = previous.network;
      if (previous.assetProfile === undefined) delete process.env.HAGGLE_SETTLEMENT_ASSET_PROFILE;
      else process.env.HAGGLE_SETTLEMENT_ASSET_PROFILE = previous.assetProfile;
      if (previous.easypostKey === undefined) delete process.env.EASYPOST_API_KEY;
      else process.env.EASYPOST_API_KEY = previous.easypostKey;
    }
  });

  it("blocks automatic buyer review completion while the order is in dispute", async () => {
    const app = makeApp({ id: "admin_1", role: "admin" });
    const res = await app.inject({
      method: "POST",
      url: "/settlement-releases/release_1/complete-buyer-review",
    });

    expect(res.statusCode).toBe(409);
    expect(res.json()).toMatchObject({ error: "ORDER_IN_DISPUTE" });
    expect(mockUpdateSettlementReleaseRecord).not.toHaveBeenCalled();
    await app.close();
  });

  it("blocks a buyer contract release request while the order is in dispute", async () => {
    const app = makeApp({ id: "buyer_1", role: "authenticated" });
    const res = await app.inject({
      method: "POST",
      url: "/settlement-releases/release_1/conditional-release-request",
      payload: {},
    });

    expect(res.statusCode).toBe(409);
    expect(res.json()).toMatchObject({ error: "ORDER_IN_DISPUTE" });
    await app.close();
  });
});
